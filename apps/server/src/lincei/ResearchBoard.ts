/**
 * ResearchBoard - the Vitrine server that shows a study.
 *
 * Vitrine keeps one study store per working directory (`.vitrine`, found by
 * walking up from where it runs) and one server per store. Agents publish
 * cards into the store from their thread's working directory; `open` starts,
 * or finds, the server for that same directory so a client can show it beside
 * the conversation. Vitrine's servers never stop by themselves and Vitrine
 * has ten ports for them, so when this server shuts down it stops the ones
 * for the folders it opened or watched. Starting one again is quick and finds
 * the study as it was. Servers in folders this server never touched are left
 * alone.
 *
 * `activity` answers "has this study gained a card?" for a client deciding
 * whether to open the board by itself. It is asked every few seconds while an
 * agent works, so after one `vitrine status` to learn where the store is, it
 * only reads file times from the layout Vitrine documents:
 * `studies/<study>/index.json`, rewritten whenever a card is added or changed.
 *
 * @module ResearchBoard
 */
import type { ResearchBoard as ResearchBoardInfo } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";

/** The fields Lincei reads from Vitrine's lifecycle contract, version 1. */
const VitrineLifecycle = Schema.Struct({
  status: Schema.String,
  url: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
  data_dir: Schema.NullOr(Schema.String),
  error: Schema.optional(Schema.Unknown),
});
const decodeVitrineLifecycle = Schema.decodeUnknownEffect(Schema.fromJsonString(VitrineLifecycle));

export class ResearchBoardError extends Schema.TaggedError<ResearchBoardError>()(
  "ResearchBoardError",
  {
    /** What went wrong and what to do next, in words for the person looking at the board. */
    message: Schema.String,
    /** What Vitrine reported, for whoever helps them. */
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const TRY_AGAIN =
  "Press the research board button again; if it keeps failing, quit Lincei and open it again.";

export class ResearchBoard extends Context.Service<
  ResearchBoard,
  {
    /**
     * Starts the board for the study in `cwd`, or returns the one already
     * running. Needs the clinical runtime to be installed.
     */
    readonly open: (cwd: string) => Effect.Effect<ResearchBoardInfo, ResearchBoardError>;
    /**
     * When the study in `cwd` last gained or changed a card, in epoch
     * milliseconds. None while it has no cards. Starts nothing.
     */
    readonly activity: (cwd: string) => Effect.Effect<Option.Option<number>, ResearchBoardError>;
  }
>()("t3/lincei/ResearchBoard") {}

const describeError = (error: unknown): string | undefined =>
  error === undefined || error === null
    ? undefined
    : typeof error === "string"
      ? error
      : JSON.stringify(error);

const make = Effect.gen(function* () {
  const clinicalRuntime = yield* ClinicalRuntime.ClinicalRuntime;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  /** Where each working directory's study store is, as Vitrine resolved it. */
  const storeByCwd = new Map<string, string>();

  const vitrineCommand = Effect.map(clinicalRuntime.status, ({ python }) =>
    path.join(path.dirname(python), platform === "win32" ? "vitrine.exe" : "vitrine"),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      // One folder per store: several folders can share a study.
      const folders = new Map([...storeByCwd].map(([cwd, store]) => [store, cwd]));
      if (folders.size === 0) return;
      const vitrine = yield* vitrineCommand;
      // All at once, and each in its own process: a server that is being
      // killed still gets its boards stopped.
      yield* Effect.forEach(
        folders.values(),
        (cwd) =>
          processRunner
            .run({
              command: vitrine,
              args: ["stop", "--json"],
              cwd,
              timeout: "20 seconds",
              outputMode: "truncate",
              maxOutputBytes: 64 * 1024,
            })
            .pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      );
    }),
  );

  /** Runs a Vitrine lifecycle command in `cwd` and reads the JSON it prints. */
  const lifecycleOf = Effect.fn("ResearchBoard.lifecycleOf")(function* (
    cwd: string,
    command: "start" | "status",
  ) {
    const isDirectory = yield* fileSystem.stat(cwd).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) {
      return yield* new ResearchBoardError({
        message:
          "The folder this conversation works in no longer exists, so its research board cannot be shown. Continue in a conversation whose folder is still there.",
        detail: cwd,
      });
    }

    const vitrine = yield* vitrineCommand;
    const output = yield* processRunner
      .run({
        command: vitrine,
        args: command === "start" ? ["start", "--no-open", "--json"] : ["status", "--json"],
        cwd,
        timeout: "60 seconds",
        outputMode: "truncate",
        maxOutputBytes: 64 * 1024,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ResearchBoardError({
              message:
                command === "start"
                  ? `Lincei could not start the research board. ${TRY_AGAIN}`
                  : `Lincei could not look for new research cards in this conversation's study. ${TRY_AGAIN}`,
              cause,
            }),
        ),
      );

    // Vitrine prints one JSON document; anything before it is a warning.
    const report = output.stdout.trim().split("\n").at(-1) ?? "";
    const lifecycle = yield* decodeVitrineLifecycle(report).pipe(
      Effect.mapError(
        () =>
          new ResearchBoardError({
            message: `The research board did not say how to reach it. ${TRY_AGAIN}`,
            detail: (output.stderr.trim() || output.stdout.trim()).slice(-800),
          }),
      ),
    );
    if (lifecycle.data_dir !== null) storeByCwd.set(cwd, lifecycle.data_dir);
    return { lifecycle, output };
  });

  const open = Effect.fn("ResearchBoard.open")(function* (cwd: string) {
    const { lifecycle, output } = yield* lifecycleOf(cwd, "start");
    if (lifecycle.status !== "running" || lifecycle.url === null || lifecycle.port === null) {
      const detail = describeError(lifecycle.error) ?? output.stderr.trim().slice(-800);
      return yield* new ResearchBoardError({
        // Quitting stops the boards Lincei opened, which frees a place for this one.
        message: `The research board did not start. ${TRY_AGAIN}`,
        ...(detail.length === 0 ? {} : { detail }),
      });
    }
    return {
      url: lifecycle.url,
      port: lifecycle.port,
      dataDir: lifecycle.data_dir ?? path.join(cwd, ".vitrine"),
    };
  });

  const activity = Effect.fn("ResearchBoard.activity")(function* (cwd: string) {
    const store =
      storeByCwd.get(cwd) ?? (yield* lifecycleOf(cwd, "status")).lifecycle.data_dir ?? undefined;
    if (store === undefined) return Option.none<number>();
    const studiesDir = path.join(store, "studies");
    const studies = yield* fileSystem
      .readDirectory(studiesDir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const times = yield* Effect.forEach(
      studies,
      (study) =>
        fileSystem.stat(path.join(studiesDir, study, "index.json")).pipe(
          Effect.map((info) => Option.map(info.mtime, (time) => time.getTime())),
          Effect.orElseSucceed(() => Option.none<number>()),
        ),
      { concurrency: 8 },
    );
    const latest = Math.max(...times.map(Option.getOrElse(() => 0)));
    return latest > 0 ? Option.some(latest) : Option.none<number>();
  });

  return ResearchBoard.of({ open, activity });
});

export const layer = Layer.effect(ResearchBoard, make);
