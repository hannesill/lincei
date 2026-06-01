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

const metadataFlag = Flag.boolean("metadata").pipe(
  Flag.withDescription("Emit structured preview metadata instead of preview text."),
  Flag.withDefault(false),
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

function stringifyOutput(value: unknown): string {
  return JSON.stringify(value);
}

const studyInitCommand = Command.make("init", {
  studyRoot: studyRootFlag,
  title: titleFlag,
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
    }).pipe(Effect.flatMap((manifest) => Console.log(stringifyOutput({ study: manifest })))),
  ),
);

const studyStatusCommand = Command.make("status", {
  studyRoot: studyRootFlag,
}).pipe(
  Command.withDescription("Report study-local research card consistency."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () => getStudyStatus(resolveStudyRoot(flags.studyRoot)),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to read study status.",
        }),
    }).pipe(Effect.flatMap((status) => Console.log(stringifyOutput(status)))),
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
      yield* Console.log(stringifyOutput(result));
    }),
  ),
);

export const runCommand = Command.make("run").pipe(
  Command.withDescription("Run commands with study-local provenance capture."),
  Command.withSubcommands([runCaptureCommand]),
);

const artifactListCommand = Command.make("list", {
  studyRoot: studyRootFlag,
}).pipe(
  Command.withDescription("List study-local artifact manifests."),
  Command.withHandler((flags) =>
    Effect.tryPromise({
      try: () => listArtifacts(resolveStudyRoot(flags.studyRoot)),
      catch: (cause) =>
        new StudyCliError({
          message: cause instanceof Error ? cause.message : "Failed to list artifacts.",
        }),
    }).pipe(Effect.flatMap((result) => Console.log(stringifyOutput(result)))),
  ),
);

const artifactShowCommand = Command.make("show", {
  studyRoot: studyRootFlag,
  artifactId: artifactIdArgument,
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
    }).pipe(Effect.flatMap((record) => Console.log(stringifyOutput(record)))),
  ),
);

const artifactPreviewCommand = Command.make("preview", {
  studyRoot: studyRootFlag,
  artifactId: artifactIdArgument,
  maxBytes: maxBytesFlag,
  metadata: metadataFlag,
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
        Console.log(flags.metadata ? stringifyOutput(result) : (result.preview.text ?? "")),
      ),
    ),
  ),
);

export const artifactCommand = Command.make("artifact").pipe(
  Command.withDescription("Inspect study-local artifacts by stable id."),
  Command.withSubcommands([artifactListCommand, artifactShowCommand, artifactPreviewCommand]),
);
