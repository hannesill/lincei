/**
 * ClinicalRuntime - the clinical research tools Lincei installs and keeps current.
 *
 * Lincei owns one Python environment under its home directory holding M4
 * (clinical datasets) and Vitrine (research cards). `activate` puts it first on
 * the server's PATH, so every agent, terminal, and project script the server
 * spawns resolves `python`, `m4`, and `vitrine` to it without per-provider
 * wiring. Setup runs `uv`, fetching Lincei's own copy when the machine has
 * none, so it needs no terminal, and ends by asking ClinicalDatasets for the
 * open demo dataset.
 *
 * What the status says is read by a researcher who may never have opened a
 * terminal: every message names what happened and what to do next, and calls
 * what is installed the clinical research tools. Command output goes in
 * `detail`.
 *
 * @module ClinicalRuntime
 */
import {
  ClinicalDemoDatasetState,
  ClinicalProvisionStep,
  type ClinicalRuntimeStatus,
} from "@t3tools/contracts";
import { setRuntimeProductContext } from "@t3tools/provider-core/server/runtimeInstructions";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { LINCEI_CLINICAL_INSTRUCTIONS } from "./agentInstructions.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import { clinicalPaths } from "./clinicalPaths.ts";
import * as ClinicalSkillLinks from "./ClinicalSkillLinks.ts";
import * as UvInstallation from "./UvInstallation.ts";

/**
 * What a fresh environment installs. Bump the ranges here when M4 or Vitrine
 * ship a release Lincei should adopt; a changed list updates on next setup.
 */
const DEFAULT_CLINICAL_REQUIREMENTS = [
  "m4-infra[research]>=0.5.6,<0.6",
  "vitrine>=0.1.3,<0.2",
] as const;

const CLINICAL_PYTHON_VERSION = "3.12";
const OUTPUT_TAIL_CHARACTERS = 800;

/** Whitespace-separated pip requirements replacing the defaults, e.g. a local Vitrine checkout. */
const requirementsOverride = Config.String("LINCEI_CLINICAL_REQUIREMENTS").pipe(Config.option);

/** What the last successful setup installed, so an unchanged environment is not rebuilt. */
const InstalledState = Schema.Struct({
  requirements: Schema.Array(Schema.String),
  demoDataset: ClinicalDemoDatasetState,
});
type InstalledState = typeof InstalledState.Type;
const InstalledStateJson = Schema.fromJsonString(InstalledState);
const decodeInstalledState = Schema.decodeUnknownEffect(InstalledStateJson);
const encodeInstalledState = Schema.encodeEffect(InstalledStateJson);

class ClinicalProvisionError extends Schema.TaggedError<ClinicalProvisionError>()(
  "ClinicalProvisionError",
  {
    step: ClinicalProvisionStep,
    exitCode: Schema.optional(Schema.Number),
    timedOut: Schema.optional(Schema.Boolean),
    /** What the status says in place of the step's usual sentence, when the failure knows better. */
    advice: Schema.optional(Schema.String),
    outputTail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  /** For the log. The status carries `describeFailure`, which is written for the user. */
  override get message(): string {
    return this.exitCode === undefined
      ? `Clinical setup could not run its ${this.step} step.`
      : `Clinical setup failed at its ${this.step} step (exit code ${this.exitCode}).`;
  }
}

const NOT_INSTALLED_MESSAGE = "The clinical research tools are not installed yet.";
const READY_MESSAGE = "The clinical research tools are ready.";
const DEMO_FAILED_MESSAGE =
  "The clinical research tools are ready, but the MIMIC-IV demo dataset could not be downloaded. Check the internet connection, then try again from Settings, Clinical Data.";
const UPDATE_PENDING_MESSAGE =
  "The clinical research tools are ready, but an update for them could not be installed, so the installed version stays in use. Check the internet connection, then try again; Lincei also tries again the next time it starts.";
const STOPPED_MESSAGE =
  "Setting up the clinical research tools stopped unexpectedly. Try again; if it keeps happening, restart Lincei.";
const BLOCKED_NETWORK_HINT =
  "Some hospital and university networks block these downloads; if it keeps failing, try another network.";

const STEP_MESSAGES: Record<ClinicalProvisionStep, string> = {
  uv: "Getting the installer.",
  python: "Setting up Python.",
  packages: "Installing M4 and Vitrine.",
  skills: "Adding the clinical skills for agents.",
  dataset: "Downloading the MIMIC-IV demo dataset.",
};

/** What the status says about a failed step: what happened and what to do next. */
const describeFailure = (error: ClinicalProvisionError): string => {
  if (error.advice !== undefined) return error.advice;
  if (error.timedOut === true) {
    return `Setting up the clinical research tools took too long and was stopped. Check the internet connection, then try again. ${BLOCKED_NETWORK_HINT}`;
  }
  switch (error.step) {
    case "python":
      return `Lincei could not set up Python for the clinical research tools. Check the internet connection, then try again. ${BLOCKED_NETWORK_HINT}`;
    case "packages":
      return `Lincei could not install M4 and Vitrine. Check the internet connection and that the disk has free space, then try again. ${BLOCKED_NETWORK_HINT}`;
    case "skills":
      return "Lincei installed M4 and Vitrine, but could not add the clinical skills for agents. Try again.";
    // The installer's failures bring their own advice, and the demo dataset never fails setup.
    case "uv":
    case "dataset":
      return STOPPED_MESSAGE;
  }
};

/**
 * Whether M4 and Vitrine can be used: the demo dataset downloads after they
 * are installed and is not needed to run them.
 */
export const toolsInstalled = (status: ClinicalRuntimeStatus) =>
  status.state === "ready" || (status.state === "installing" && status.step === "dataset");

/**
 * Makes this server a Lincei server: puts the managed environment first on its
 * PATH and names it in LINCEI_CLINICAL_BIN, points M4 at Lincei's shared
 * dataset store, keeps Vitrine out of the system browser, and tells every
 * agent about the clinical tooling. Run after `fixPath`, which rebuilds PATH
 * from the login shell, and before anything spawns a child process or starts
 * a session. A dataset directory the user already exported wins.
 */
export const activate = Effect.fn("ClinicalRuntime.activate")(function* (baseDir: string) {
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const paths = clinicalPaths({ baseDir, platform, environment: env, join: path.join });
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const entries = (env[pathKey] ?? "").split(delimiter).filter((entry) => entry.length > 0);
  const managed = [paths.binDir, paths.toolsDir];
  env[pathKey] = [...managed, ...entries.filter((entry) => !managed.includes(entry))].join(
    delimiter,
  );
  env.LINCEI_CLINICAL_HOME = paths.home;
  // Agents' login shells reorder PATH, so the instructions name this instead.
  env.LINCEI_CLINICAL_BIN = paths.binDir;
  env.M4_DATA_DIR = paths.dataDir;
  // Lincei shows the research board beside the conversation. Without this, the
  // first card an agent publishes also opens the board in the system browser.
  env.VITRINE_OPEN_BROWSER = "0";
  setRuntimeProductContext({ name: "Lincei", instructions: LINCEI_CLINICAL_INSTRUCTIONS });
});

export class ClinicalRuntime extends Context.Service<
  ClinicalRuntime,
  {
    /** The tools' current state. */
    readonly status: Effect.Effect<ClinicalRuntimeStatus>;
    /**
     * Installs, updates, or completes the tools and waits for it. Concurrent
     * calls share the run already in flight. Failures are reported in the
     * status.
     */
    readonly provision: Effect.Effect<ClinicalRuntimeStatus>;
    /**
     * Starts `provision` in the background and answers with the state of that
     * run: `installing` whenever it has something to install, never what the
     * run before it ended with. `force` installs everything again over tools
     * that are installed but do not work; while a run is in flight it applies
     * to the next one.
     */
    readonly setup: (options?: {
      readonly force?: boolean | undefined;
    }) => Effect.Effect<ClinicalRuntimeStatus>;
    /** M4's skills as agents get them. None before setup has put the bundle in place. */
    readonly skills: Effect.Effect<ReadonlyArray<ClinicalSkillLinks.BundledSkill>>;
    /** The text of one of M4's skills, read from Lincei's copy of the bundle. */
    readonly skillText: (name: string) => Effect.Effect<Option.Option<string>>;
  }
>()("t3/lincei/ClinicalRuntime") {}

/**
 * What a run does to the tools themselves. An `update` replaces tools that
 * work with other versions, so its failure leaves working tools behind. An
 * `install` has nothing to fall back on, and a `reinstall` was asked for
 * because what is there does not work.
 */
type ToolsPlan = "install" | "reinstall" | "update" | "keep";

interface Plan {
  readonly tools: ToolsPlan;
  /** What the last setup recorded about the demo dataset. */
  readonly demoDataset: ClinicalDemoDatasetState;
}

const outputTail = (output: ProcessRunner.ProcessRunOutput): string | undefined => {
  const text = (output.stderr.trim().length > 0 ? output.stderr : output.stdout).trim();
  return text.length === 0 ? undefined : text.slice(-OUTPUT_TAIL_CHARACTERS);
};

const make = Effect.gen(function* () {
  const clinicalDatasets = yield* ClinicalDatasets.ClinicalDatasets;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const hostEnvironment = yield* HostProcessEnvironment;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const uvServices = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | ProcessRunner.ProcessRunner
  >();
  const scope = yield* Effect.scope;

  const paths = clinicalPaths({
    baseDir: config.baseDir,
    platform,
    environment: hostEnvironment,
    join: path.join,
  });
  const skillDirectories = ClinicalSkillLinks.defaultSkillDirectories({
    path,
    platform,
    environment: hostEnvironment,
  });
  const requirements = Option.match(yield* requirementsOverride, {
    onNone: (): ReadonlyArray<string> => DEFAULT_CLINICAL_REQUIREMENTS,
    onSome: (raw) => raw.split(/\s+/).filter((entry) => entry.length > 0),
  });

  const describe = (
    fields: Pick<ClinicalRuntimeStatus, "state" | "message" | "demoDataset"> &
      Partial<Pick<ClinicalRuntimeStatus, "step" | "detail">>,
  ): ClinicalRuntimeStatus => ({
    home: paths.home,
    python: paths.python,
    skillsDir: paths.skillsDir,
    dataDir: paths.dataDir,
    requirements,
    ...fields,
  });
  const ready = (demoDataset: ClinicalDemoDatasetState) =>
    describe({
      state: "ready",
      message: demoDataset === "failed" ? DEMO_FAILED_MESSAGE : READY_MESSAGE,
      demoDataset,
    });
  const installing = (step: ClinicalProvisionStep, demoDataset: ClinicalDemoDatasetState) =>
    describe({ state: "installing", step, message: STEP_MESSAGES[step], demoDataset });

  const readInstalledState = fileSystem
    .readFileString(paths.statePath)
    .pipe(Effect.flatMap(decodeInstalledState), Effect.option);
  const writeInstalledState = (state: InstalledState) =>
    encodeInstalledState(state).pipe(
      Effect.flatMap((json) => fileSystem.writeFileString(paths.statePath, json)),
    );
  const sameRequirements = (installed: InstalledState) =>
    installed.requirements.length === requirements.length &&
    installed.requirements.every((entry, index) => entry === requirements[index]);

  /** Whether a forced reinstall was asked for and has not gone through yet. */
  const repairPending = yield* Ref.make(false);

  /**
   * What a run has to do, judged from disk without running anything. Tools
   * that were installed and still have their interpreter are usable, whatever
   * version they are.
   */
  const plan = Effect.gen(function* () {
    const installed = Option.getOrUndefined(yield* readInstalledState);
    const usable =
      installed !== undefined &&
      (yield* fileSystem.exists(paths.python).pipe(Effect.orElseSucceed(() => false)));
    const tools: ToolsPlan = (yield* Ref.get(repairPending))
      ? "reinstall"
      : installed === undefined || !usable
        ? "install"
        : sameRequirements(installed)
          ? "keep"
          : "update";
    return { tools, demoDataset: installed?.demoDataset ?? "not-installed", usable };
  });

  const initial = yield* plan;
  const statusRef = yield* Ref.make(
    initial.usable
      ? ready(initial.demoDataset)
      : describe({
          state: "not-installed",
          message: NOT_INSTALLED_MESSAGE,
          demoDataset: "not-installed",
        }),
  );
  const running = yield* Ref.make<Option.Option<Deferred.Deferred<ClinicalRuntimeStatus>>>(
    Option.none(),
  );
  const startLock = yield* Semaphore.make(1);

  const enterStep = (step: ClinicalProvisionStep) =>
    Ref.update(statusRef, (current) => installing(step, current.demoDataset));

  const runStep = Effect.fn("ClinicalRuntime.runStep")(function* (
    step: ClinicalProvisionStep,
    command: string,
    args: ReadonlyArray<string>,
    timeout: ProcessRunner.ProcessRunInput["timeout"],
  ) {
    yield* enterStep(step);
    const output = yield* processRunner
      .run({ command, args, timeout, outputMode: "truncate", maxOutputBytes: 256 * 1024 })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ClinicalProvisionError({
              step,
              cause,
              ...(cause._tag === "ProcessTimeoutError" ? { timedOut: true } : {}),
            }),
        ),
      );
    if (output.code === null || Number(output.code) !== 0) {
      const tail = outputTail(output);
      return yield* new ClinicalProvisionError({
        step,
        ...(output.code === null ? {} : { exitCode: Number(output.code) }),
        ...(tail === undefined ? {} : { outputTail: tail }),
      });
    }
  });

  /** Installs the tools as `tools` says, then records what is installed. */
  const installTools = Effect.fn("ClinicalRuntime.installTools")(function* (
    tools: Exclude<ToolsPlan, "keep">,
    demoDataset: ClinicalDemoDatasetState,
  ) {
    // M4 refuses to materialize skills through a symlinked path, such as macOS's /var.
    const realHome = yield* fileSystem
      .realPath(paths.home)
      .pipe(Effect.orElseSucceed(() => paths.home));
    yield* enterStep("uv");
    const uv = yield* UvInstallation.ensure({ managedDirectory: paths.toolsDir }).pipe(
      Effect.provide(uvServices),
      Effect.mapError(
        (cause) =>
          new ClinicalProvisionError({
            step: "uv",
            cause,
            advice: cause.message,
            outputTail: cause.detail,
          }),
      ),
    );
    // An update keeps the interpreter the working tools already run on.
    if (tools !== "update") {
      yield* runStep(
        "python",
        uv,
        ["venv", "--allow-existing", "--seed", "--python", CLINICAL_PYTHON_VERSION, paths.venvDir],
        "10 minutes",
      );
    }
    yield* runStep(
      "packages",
      uv,
      [
        "pip",
        "install",
        // Over tools that are there but broken, installed packages are not to be trusted.
        ...(tools === "reinstall" ? ["--reinstall"] : []),
        "--python",
        paths.python,
        ...requirements,
      ],
      "20 minutes",
    );
    // M4 will not replace a bundle another version wrote.
    yield* fileSystem
      .remove(path.join(realHome, "skills"), { recursive: true, force: true })
      .pipe(Effect.ignore);
    yield* runStep(
      "skills",
      paths.m4,
      ["skills", "materialize", "--target", path.join(realHome, "skills"), "--json"],
      "2 minutes",
    );
    yield* writeInstalledState({ requirements, demoDataset }).pipe(
      Effect.mapError(
        (cause) =>
          new ClinicalProvisionError({
            step: "skills",
            cause,
            advice:
              "Lincei installed the clinical research tools but could not record it. Check that the disk has free space, then try again.",
          }),
      ),
    );
    yield* Ref.set(repairPending, false);
  });

  const run = Effect.fn("ClinicalRuntime.run")(function* (planned: Plan) {
    yield* fileSystem.makeDirectory(paths.home, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ClinicalProvisionError({
            step: "python",
            cause,
            advice:
              "Lincei could not create its folder for the clinical research tools. Check that the disk has free space, then try again.",
          }),
      ),
    );
    if (planned.tools !== "keep") yield* installTools(planned.tools, planned.demoDataset);

    // On every run, so an environment an older Lincei installed gets them too.
    // Agents can still read the skills from Lincei's home, so this never fails setup.
    yield* ClinicalSkillLinks.sync({
      bundle: paths.skillsDir,
      directories: skillDirectories,
    }).pipe(
      Effect.tap(({ shadowed }) =>
        shadowed.length === 0
          ? Effect.void
          : Effect.logInfo("clinical skills not linked: the user has skills of the same name", {
              shadowed,
            }),
      ),
      Effect.tapError((cause) => Effect.logWarning("could not link the clinical skills", cause)),
      Effect.ignore,
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

    // The tools are usable without the demo, so its download never fails setup.
    // It is a dataset job like any other: the dataset's row shows how far it is
    // and, when it fails, why.
    let demoDataset = planned.demoDataset;
    if (demoDataset !== "ready") {
      yield* enterStep("dataset");
      demoDataset = (yield* clinicalDatasets.prepareDemo) ? "ready" : "failed";
      yield* writeInstalledState({ requirements, demoDataset }).pipe(Effect.ignore);
    }
    return ready(demoDataset);
  });

  /**
   * Whether the tools an update set out to replace still run. An update that
   * could not reach the network has changed nothing; this is asked rather than
   * assumed, because one that failed while installing may have.
   */
  const toolsStillRun = processRunner
    .run({
      command: paths.m4,
      args: ["--version"],
      timeout: "60 seconds",
      outputMode: "truncate",
      maxOutputBytes: 4096,
    })
    .pipe(
      Effect.map((output) => output.code !== null && Number(output.code) === 0),
      Effect.orElseSucceed(() => false),
    );

  const runProvision = (planned: Plan) =>
    run(planned).pipe(
      Effect.catchTags({
        ClinicalProvisionError: (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(error);
            const detail = error.outputTail === undefined ? {} : { detail: error.outputTail };
            // Up to the packages step an update has only added to what was there.
            const keptWorking =
              planned.tools === "update" && error.step !== "skills" && (yield* toolsStillRun);
            return keptWorking
              ? describe({
                  state: "ready",
                  step: error.step,
                  message: UPDATE_PENDING_MESSAGE,
                  demoDataset: planned.demoDataset,
                  ...detail,
                })
              : describe({
                  state: "failed",
                  step: error.step,
                  message: describeFailure(error),
                  demoDataset: (yield* Ref.get(statusRef)).demoDataset,
                  ...detail,
                });
          }),
      }),
      Effect.tap((next) => Ref.set(statusRef, next)),
    );

  /** The run in flight, starting one in the server's scope when there is none. */
  const joinOrStart = (force: boolean) =>
    startLock.withPermits(1)(
      Effect.gen(function* () {
        if (force) yield* Ref.set(repairPending, true);
        const current = yield* Ref.get(running);
        if (Option.isSome(current)) return current.value;
        const planned = yield* plan;
        const done = yield* Deferred.make<ClinicalRuntimeStatus>();
        yield* Ref.set(running, Option.some(done));
        // Whoever started this run is answered before it has done anything, so
        // the status has to be about this run already: not what the last one
        // failed with.
        yield* Ref.set(
          statusRef,
          planned.tools !== "keep"
            ? installing("uv", planned.demoDataset)
            : planned.demoDataset !== "ready"
              ? installing("dataset", planned.demoDataset)
              : ready(planned.demoDataset),
        );
        yield* runProvision(planned).pipe(
          Effect.exit,
          Effect.tap((exit) =>
            Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
              ? // A defect would otherwise leave the status at `installing` for good.
                Ref.update(statusRef, (stopped) =>
                  describe({
                    state: "failed",
                    ...(stopped.step === undefined ? {} : { step: stopped.step }),
                    message: STOPPED_MESSAGE,
                    demoDataset: stopped.demoDataset,
                  }),
                )
              : Effect.void,
          ),
          Effect.flatMap((exit) =>
            Ref.set(running, Option.none()).pipe(Effect.andThen(Deferred.done(done, exit))),
          ),
          Effect.forkIn(scope),
        );
        return done;
      }),
    );

  /**
   * The demo dataset can become ready after setup gave up on it: downloaded
   * from its row, or prepared by an agent. Then setup's verdict is out of date.
   */
  const status = Effect.gen(function* () {
    const current = yield* Ref.get(statusRef);
    if (current.state !== "ready" || current.demoDataset === "ready") return current;
    if (!(yield* clinicalDatasets.demoReady)) return current;
    const next = yield* Ref.updateAndGet(statusRef, (latest) =>
      latest.state === "ready" && latest.demoDataset !== "ready"
        ? {
            ...latest,
            demoDataset: "ready" as const,
            message: latest.message === DEMO_FAILED_MESSAGE ? READY_MESSAGE : latest.message,
          }
        : latest,
    );
    // Recorded with what is installed, which an update still pending has not changed.
    yield* readInstalledState.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (installed) => writeInstalledState({ ...installed, demoDataset: "ready" }),
        }),
      ),
      Effect.ignore,
    );
    return next;
  });

  const provision = Effect.flatMap(joinOrStart(false), Deferred.await);
  const setup: ClinicalRuntime["Service"]["setup"] = (options) =>
    joinOrStart(options?.force === true).pipe(Effect.andThen(status));

  // The desktop app is the clinical product, so it prepares itself. A dev
  // server keeps one home per worktree and installs only when asked.
  if (config.mode === "desktop" && config.devUrl === undefined) {
    yield* setup();
  }

  const skills = ClinicalSkillLinks.describe({
    bundle: paths.skillsDir,
    directories: skillDirectories,
  }).pipe(
    Effect.orElseSucceed((): ReadonlyArray<ClinicalSkillLinks.BundledSkill> => []),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );
  const skillText: ClinicalRuntime["Service"]["skillText"] = (name) =>
    ClinicalSkillLinks.readSkill({ bundle: paths.skillsDir, name }).pipe(
      Effect.orElseSucceed(() => Option.none<string>()),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  return ClinicalRuntime.of({ status, provision, setup, skills, skillText });
});

export const layer = Layer.effect(ClinicalRuntime, make);
