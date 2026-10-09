/**
 * ResearchBoard - the Vitrine server that shows a study.
 *
 * Vitrine keeps one study store per working directory (`.vitrine`, found by
 * walking up from where it runs) and one server per store. Agents publish
 * cards into the store from their thread's working directory; `open` starts,
 * or finds, the server for that same directory so a client can show it beside
 * the conversation. Vitrine owns the server's lifetime: it outlives a Lincei
 * restart, and starting it again returns the one already running.
 *
 * @module ResearchBoard
 */
import type { ResearchBoard as ResearchBoardInfo } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
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
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

export class ResearchBoard extends Context.Service<
  ResearchBoard,
  {
    /**
     * Starts the board for the study in `cwd`, or returns the one already
     * running. Needs the clinical runtime to be installed.
     */
    readonly open: (cwd: string) => Effect.Effect<ResearchBoardInfo, ResearchBoardError>;
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

  const open = Effect.fn("ResearchBoard.open")(function* (cwd: string) {
    const isDirectory = yield* fileSystem.stat(cwd).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) {
      return yield* new ResearchBoardError({
        message: "The folder this thread works in no longer exists.",
        detail: cwd,
      });
    }

    const { python } = yield* clinicalRuntime.status;
    const vitrine = path.join(
      path.dirname(python),
      platform === "win32" ? "vitrine.exe" : "vitrine",
    );
    const output = yield* processRunner
      .run({
        command: vitrine,
        args: ["start", "--no-open", "--json"],
        cwd,
        timeout: "60 seconds",
        outputMode: "truncate",
        maxOutputBytes: 64 * 1024,
      })
      .pipe(
        Effect.mapError(
          () => new ResearchBoardError({ message: "Could not start the research board." }),
        ),
      );

    // Vitrine prints one JSON document; anything before it is a warning.
    const report = output.stdout.trim().split("\n").at(-1) ?? "";
    const lifecycle = yield* decodeVitrineLifecycle(report).pipe(
      Effect.mapError(
        () =>
          new ResearchBoardError({
            message: "The research board did not report how to reach it.",
            detail: (output.stderr.trim() || output.stdout.trim()).slice(-800),
          }),
      ),
    );
    if (lifecycle.status !== "running" || lifecycle.url === null || lifecycle.port === null) {
      const detail = describeError(lifecycle.error) ?? output.stderr.trim().slice(-800);
      return yield* new ResearchBoardError({
        message: "The research board did not start.",
        ...(detail.length === 0 ? {} : { detail }),
      });
    }
    return {
      url: lifecycle.url,
      port: lifecycle.port,
      dataDir: lifecycle.data_dir ?? path.join(cwd, ".vitrine"),
    };
  });

  return ResearchBoard.of({ open });
});

export const layer = Layer.effect(ResearchBoard, make);
