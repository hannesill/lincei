import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { captureRun, getStudyStatus, initializeStudyRecord } from "../study/StudyRecordService.ts";

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

const commandArgument = Argument.string("command").pipe(
  Argument.withDescription("Command and arguments to execute."),
  Argument.variadic({ min: 1 }),
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
