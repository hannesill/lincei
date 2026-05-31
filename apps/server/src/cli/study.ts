import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import {
  captureRun,
  getArtifact,
  getStudyStatus,
  initializeStudyRecord,
  listArtifacts,
  previewArtifact,
} from "../study/StudyRecordService.ts";

class StudyCliError extends Data.TaggedError("StudyCliError")<{
  readonly message: string;
}> {}

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const studyRootFlag = Flag.string("study-root").pipe(
  Flag.withDescription("Study project root. Defaults to the current working directory."),
  Flag.optional,
);

const titleFlag = Flag.string("title").pipe(Flag.withDescription("Study title."), Flag.optional);

const depFlag = Flag.string("dep").pipe(
  Flag.withDescription("Study-relative input dependency path. May be repeated."),
  Flag.atLeast(0),
);

const outFlag = Flag.string("out").pipe(
  Flag.withDescription("Study-relative output artifact path. May be repeated."),
  Flag.atLeast(0),
);

const maxBytesFlag = Flag.integer("max-bytes").pipe(
  Flag.withDescription("Maximum bytes to read for text previews."),
  Flag.optional,
);

const commandArgument = Argument.string("command").pipe(
  Argument.withDescription("Command and arguments to execute."),
  Argument.variadic({ min: 1 }),
);

const artifactIdArgument = Argument.string("artifact-id").pipe(
  Argument.withDescription("Stable study artifact id."),
);

function resolveStudyRoot(root: Option.Option<string>): string {
  return Option.getOrElse(root, () => process.cwd());
}

function stringifyOutput(value: unknown, json: boolean): string {
  if (json) {
    return JSON.stringify(value, null, 2);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "study" in value &&
    "summary" in value &&
    "cards" in value
  ) {
    const status = value as {
      readonly study: { readonly title: string };
      readonly summary: Record<string, number>;
      readonly cards: ReadonlyArray<unknown>;
    };
    return [
      `${status.study.title}`,
      `cards: ${status.cards.length}`,
      `current: ${status.summary.current ?? 0}`,
      `stale: ${status.summary.stale ?? 0}`,
      `missing: ${status.summary.missing ?? 0}`,
      `unknown: ${status.summary.unknown ?? 0}`,
    ].join("\n");
  }
  return JSON.stringify(value, null, 2);
}

function shortContentHash(hash: string | null | undefined): string {
  return hash?.startsWith("sha256:") ? hash.slice("sha256:".length, "sha256:".length + 12) : "-";
}

function formatArtifactLine(record: Awaited<ReturnType<typeof getArtifact>>): string {
  const runId = record.artifact.producingRunId ?? "-";
  return [
    record.artifact.id,
    record.artifact.kind,
    record.relativePath,
    `${record.currentSize ?? record.artifact.size}b`,
    shortContentHash(record.currentContentHash ?? record.artifact.contentHash),
    record.status,
    runId,
  ].join("\t");
}

function stringifyArtifactList(
  result: Awaited<ReturnType<typeof listArtifacts>>,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify(result, null, 2);
  }
  if (result.artifacts.length === 0) {
    return "No artifacts.";
  }
  return result.artifacts.map(formatArtifactLine).join("\n");
}

function stringifyArtifact(record: Awaited<ReturnType<typeof getArtifact>>, json: boolean): string {
  return json ? JSON.stringify(record, null, 2) : formatArtifactLine(record);
}

const studyInitCommand = Command.make("init", {
  studyRoot: studyRootFlag,
  title: titleFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Create or read the study-local .lincei record."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () =>
        initializeStudyRecord({
          studyRoot: resolveStudyRoot(flags.studyRoot),
          ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}),
        }),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to initialize study.",
        }),
    }).pipe(
      Effect.flatMap((manifest) => Console.log(stringifyOutput({ study: manifest }, flags.json))),
    ),
  ),
);

const studyStatusCommand = Command.make("status", {
  studyRoot: studyRootFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Report study-local research card consistency."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () => getStudyStatus(resolveStudyRoot(flags.studyRoot)),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to read study status.",
        }),
    }).pipe(Effect.flatMap((status) => Console.log(stringifyOutput(status, flags.json)))),
  ),
);

export const studyCommand = Command.make("study").pipe(
  Command.withDescription("Manage the portable study-local research record."),
  Command.withSubcommands([studyInitCommand, studyStatusCommand]),
);

const runCaptureCommand = Command.make("capture", {
  studyRoot: studyRootFlag,
  dep: depFlag,
  out: outFlag,
  command: commandArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Execute a command and record declared deps and outputs."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const command = [...flags.command];
      if (command.length === 0) {
        return yield* new StudyCliError({ message: "Missing command to capture." });
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          captureRun({
            studyRoot: resolveStudyRoot(flags.studyRoot),
            deps: flags.dep,
            outs: flags.out,
            command: command as [string, ...string[]],
          }),
        catch: (cause) =>
          new StudyCliError({
            message: cause instanceof Error ? cause.message : "Failed to capture run.",
          }),
      });
      yield* Console.log(stringifyOutput(result, flags.json));
    }),
  ),
);

export const runCommand = Command.make("run").pipe(
  Command.withDescription("Run commands with study-local provenance capture."),
  Command.withSubcommands([runCaptureCommand]),
);

const artifactListCommand = Command.make("list", {
  studyRoot: studyRootFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List study-local artifact manifests."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () => listArtifacts(resolveStudyRoot(flags.studyRoot)),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to list artifacts.",
        }),
    }).pipe(Effect.flatMap((result) => Console.log(stringifyArtifactList(result, flags.json)))),
  ),
);

const artifactShowCommand = Command.make("show", {
  studyRoot: studyRootFlag,
  artifactId: artifactIdArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show a study-local artifact manifest by id."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () =>
        getArtifact({
          studyRoot: resolveStudyRoot(flags.studyRoot),
          artifactId: flags.artifactId,
        }),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to read artifact.",
        }),
    }).pipe(Effect.flatMap((record) => Console.log(stringifyArtifact(record, flags.json)))),
  ),
);

const artifactPreviewCommand = Command.make("preview", {
  studyRoot: studyRootFlag,
  artifactId: artifactIdArgument,
  maxBytes: maxBytesFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Preview a study-local artifact by id."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () =>
        previewArtifact({
          studyRoot: resolveStudyRoot(flags.studyRoot),
          artifactId: flags.artifactId,
          ...(Option.isSome(flags.maxBytes) ? { maxBytes: flags.maxBytes.value } : {}),
        }),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to preview artifact.",
        }),
    }).pipe(
      Effect.flatMap((result) =>
        Console.log(flags.json ? JSON.stringify(result, null, 2) : (result.preview.text ?? "")),
      ),
    ),
  ),
);

export const artifactCommand = Command.make("artifact").pipe(
  Command.withDescription("Inspect study-local artifacts by stable id."),
  Command.withSubcommands([artifactListCommand, artifactShowCommand, artifactPreviewCommand]),
);
