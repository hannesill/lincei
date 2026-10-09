/**
 * ClinicalRuntime - the Python environment Lincei manages for clinical research.
 *
 * Lincei owns one virtual environment under its home directory holding M4
 * (clinical datasets) and Vitrine (research cards). `activate` puts it first on
 * the server's PATH, so every agent, terminal, and project script the server
 * spawns resolves `python`, `m4`, and `vitrine` to it without per-provider
 * wiring. Provisioning runs `uv`, fetching Lincei's own copy when the machine
 * has none, so setup needs no terminal and installs nothing globally.
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
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
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
import * as ClinicalSkillLinks from "./ClinicalSkillLinks.ts";
import * as UvInstallation from "./UvInstallation.ts";

/**
 * What a fresh environment installs. Bump the ranges here when M4 or Vitrine
 * ship a release Lincei should adopt; a changed list reinstalls on next setup.
 */
const DEFAULT_CLINICAL_REQUIREMENTS = [
  "m4-infra[research]>=0.5.5,<0.6",
  "vitrine>=0.1.1,<0.2",
] as const;

const CLINICAL_PYTHON_VERSION = "3.12";
/** The open dataset setup downloads, so there is something to query on first run. */
export const DEMO_DATASET = "mimic-iv-demo";
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
    outputTail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === undefined
      ? `Clinical runtime setup could not run its ${this.step} step.`
      : `Clinical runtime setup failed at its ${this.step} step (exit code ${this.exitCode}).`;
  }
}

const STEP_MESSAGES: Record<ClinicalProvisionStep, string> = {
  uv: "Getting uv to install Python.",
  python: `Creating the Python ${CLINICAL_PYTHON_VERSION} environment.`,
  packages: "Installing M4 and Vitrine.",
  skills: "Installing clinical skills.",
  dataset: "Downloading the MIMIC-IV demo dataset.",
};

const FAILURE_MESSAGES: Record<ClinicalProvisionStep, string> = {
  uv: "Could not get uv, which Lincei installs Python with.",
  python: "Could not create the Python environment.",
  packages: "Could not install M4 and Vitrine. Check the network connection and run setup again.",
  skills: "Could not install the clinical skills.",
  dataset: "Could not download the MIMIC-IV demo dataset.",
};

interface ClinicalPaths {
  readonly home: string;
  /** Tools Lincei fetched for itself, such as uv. */
  readonly toolsDir: string;
  readonly venvDir: string;
  readonly binDir: string;
  readonly python: string;
  readonly skillsDir: string;
  readonly dataDir: string;
  readonly statePath: string;
}

const clinicalPaths = (input: {
  readonly baseDir: string;
  readonly platform: NodeJS.Platform;
  readonly join: Path.Path["join"];
}): ClinicalPaths => {
  const home = input.join(input.baseDir, "clinical");
  const venvDir = input.join(home, "venv");
  const windows = input.platform === "win32";
  const binDir = input.join(venvDir, windows ? "Scripts" : "bin");
  return {
    home,
    toolsDir: input.join(home, "bin"),
    venvDir,
    binDir,
    python: input.join(binDir, windows ? "python.exe" : "python"),
    skillsDir: input.join(home, "skills"),
    dataDir: input.join(home, "m4_data"),
    statePath: input.join(home, "runtime.json"),
  };
};

/**
 * Makes this server a Lincei server: puts the managed environment first on its
 * PATH, points M4 at Lincei's shared dataset store, and tells every agent
 * about the clinical tooling. Run after `fixPath`, which rebuilds PATH from
 * the login shell, and before anything spawns a child process or starts a
 * session. A dataset directory the user already exported wins.
 */
export const activate = Effect.fn("ClinicalRuntime.activate")(function* (baseDir: string) {
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const paths = clinicalPaths({ baseDir, platform, join: path.join });
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const entries = (env[pathKey] ?? "").split(delimiter).filter((entry) => entry.length > 0);
  const managed = [paths.binDir, paths.toolsDir];
  env[pathKey] = [...managed, ...entries.filter((entry) => !managed.includes(entry))].join(
    delimiter,
  );
  env.LINCEI_CLINICAL_HOME = paths.home;
  if ((env.M4_DATA_DIR ?? "").trim().length === 0) {
    env.M4_DATA_DIR = paths.dataDir;
  }
  setRuntimeProductContext({ name: "Lincei", instructions: LINCEI_CLINICAL_INSTRUCTIONS });
});

export class ClinicalRuntime extends Context.Service<
  ClinicalRuntime,
  {
    /** The environment's current state. */
    readonly status: Effect.Effect<ClinicalRuntimeStatus>;
    /**
     * Installs or repairs the environment and waits for it. Concurrent calls
     * share the run already in flight. Failures are reported in the status.
     */
    readonly provision: Effect.Effect<ClinicalRuntimeStatus>;
    /** Starts `provision` in the background and returns the status right away. */
    readonly setup: Effect.Effect<ClinicalRuntimeStatus>;
  }
>()("t3/lincei/ClinicalRuntime") {}

const outputTail = (output: ProcessRunner.ProcessRunOutput): string | undefined => {
  const text = (output.stderr.trim().length > 0 ? output.stderr : output.stdout).trim();
  return text.length === 0 ? undefined : text.slice(-OUTPUT_TAIL_CHARACTERS);
};

const make = Effect.gen(function* () {
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

  const paths = clinicalPaths({ baseDir: config.baseDir, platform, join: path.join });
  // The store `activate` chose: the user's own when they exported one.
  const dataDir = hostEnvironment.M4_DATA_DIR?.trim() || paths.dataDir;
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
    dataDir,
    requirements,
    ...fields,
  });

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

  /** Installed and current, judged from disk without running anything. */
  const installedAndCurrent = Effect.gen(function* () {
    const installed = yield* readInstalledState;
    if (Option.isNone(installed) || !sameRequirements(installed.value)) return Option.none();
    const pythonExists = yield* fileSystem
      .exists(paths.python)
      .pipe(Effect.orElseSucceed(() => false));
    return pythonExists ? installed : Option.none();
  });

  const initialInstalled = yield* installedAndCurrent;
  const statusRef = yield* Ref.make(
    Option.match(initialInstalled, {
      onNone: () =>
        describe({
          state: "not-installed",
          message: "The clinical runtime is not installed yet.",
          demoDataset: "not-installed",
        }),
      onSome: (installed) =>
        describe({
          state: "ready",
          message: "The clinical runtime is ready.",
          demoDataset: installed.demoDataset,
        }),
    }),
  );
  const running = yield* Ref.make<Option.Option<Deferred.Deferred<ClinicalRuntimeStatus>>>(
    Option.none(),
  );
  const startLock = yield* Semaphore.make(1);

  const enterStep = (step: ClinicalProvisionStep) =>
    Ref.update(statusRef, (current) =>
      describe({
        state: "installing",
        step,
        message: STEP_MESSAGES[step],
        demoDataset: current.demoDataset,
      }),
    );

  const runStep = Effect.fn("ClinicalRuntime.runStep")(function* (
    step: ClinicalProvisionStep,
    command: string,
    args: ReadonlyArray<string>,
    timeout: ProcessRunner.ProcessRunInput["timeout"],
    env?: NodeJS.ProcessEnv,
  ) {
    yield* enterStep(step);
    const output = yield* processRunner
      .run({ command, args, timeout, env, outputMode: "truncate", maxOutputBytes: 256 * 1024 })
      .pipe(Effect.mapError((cause) => new ClinicalProvisionError({ step, cause })));
    if (output.code === null || Number(output.code) !== 0) {
      const tail = outputTail(output);
      return yield* new ClinicalProvisionError({
        step,
        ...(output.code === null ? {} : { exitCode: Number(output.code) }),
        ...(tail === undefined ? {} : { outputTail: tail }),
      });
    }
  });

  const install = Effect.gen(function* () {
    yield* fileSystem
      .makeDirectory(paths.home, { recursive: true })
      .pipe(Effect.mapError((cause) => new ClinicalProvisionError({ step: "python", cause })));
    // M4 refuses to materialize skills through a symlinked path, such as macOS's /var.
    const realHome = yield* fileSystem
      .realPath(paths.home)
      .pipe(Effect.orElseSucceed(() => paths.home));
    const installed = yield* installedAndCurrent;
    let demoDataset: ClinicalDemoDatasetState = Option.match(installed, {
      onNone: () => "not-installed" as const,
      onSome: (state) => state.demoDataset,
    });

    if (Option.isNone(installed)) {
      yield* enterStep("uv");
      const uv = yield* UvInstallation.ensure({ managedDirectory: paths.toolsDir }).pipe(
        Effect.provide(uvServices),
        Effect.mapError(
          (cause) => new ClinicalProvisionError({ step: "uv", cause, outputTail: cause.detail }),
        ),
      );
      yield* runStep(
        "python",
        uv,
        ["venv", "--allow-existing", "--seed", "--python", CLINICAL_PYTHON_VERSION, paths.venvDir],
        "10 minutes",
      );
      yield* runStep(
        "packages",
        uv,
        ["pip", "install", "--python", paths.python, ...requirements],
        "20 minutes",
      );
      // M4 will not replace a bundle another version wrote, and this step only
      // runs when the environment is being rebuilt.
      yield* fileSystem
        .remove(path.join(realHome, "skills"), { recursive: true, force: true })
        .pipe(Effect.ignore);
      yield* runStep(
        "skills",
        path.join(paths.binDir, "m4"),
        ["skills", "materialize", "--target", path.join(realHome, "skills"), "--json"],
        "2 minutes",
      );
      demoDataset = "not-installed";
      yield* writeInstalledState({ requirements, demoDataset }).pipe(
        Effect.mapError((cause) => new ClinicalProvisionError({ step: "skills", cause })),
      );
    }

    // On every run, so an environment an older Lincei installed gets them too.
    // Agents can still read the skills from Lincei's home, so this never fails setup.
    yield* ClinicalSkillLinks.sync({
      bundle: paths.skillsDir,
      directories: ClinicalSkillLinks.defaultSkillDirectories({
        path,
        platform,
        environment: hostEnvironment,
      }),
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

    // The runtime is usable without the demo, so its download never fails setup.
    if (demoDataset !== "ready") {
      demoDataset = yield* runStep(
        "dataset",
        path.join(paths.binDir, "m4"),
        ["init", DEMO_DATASET, "--json", "--no-interactive", "--download"],
        "20 minutes",
        { M4_DATA_DIR: dataDir },
      ).pipe(
        Effect.as("ready" as const),
        Effect.catchTags({
          ClinicalProvisionError: (error) =>
            Effect.logWarning(error).pipe(Effect.as("failed" as const)),
        }),
      );
      yield* writeInstalledState({ requirements, demoDataset }).pipe(Effect.ignore);
    }

    return describe({
      state: "ready",
      message:
        demoDataset === "ready"
          ? "The clinical runtime is ready."
          : "The clinical runtime is ready, but the MIMIC-IV demo dataset could not be downloaded. Run `m4 init mimic-iv-demo --download` to retry.",
      demoDataset,
    });
  });

  const runProvision = install.pipe(
    Effect.catchTags({
      ClinicalProvisionError: (error) =>
        Effect.logWarning(error).pipe(
          Effect.andThen(Ref.get(statusRef)),
          Effect.map((current) =>
            describe({
              state: "failed",
              step: error.step,
              message: FAILURE_MESSAGES[error.step],
              demoDataset: current.demoDataset,
              ...(error.outputTail === undefined ? {} : { detail: error.outputTail }),
            }),
          ),
        ),
    }),
    Effect.tap((next) => Ref.set(statusRef, next)),
  );

  /** The run in flight, starting one in the server's scope when there is none. */
  const joinOrStart = startLock.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(running);
      if (Option.isSome(current)) return current.value;
      const done = yield* Deferred.make<ClinicalRuntimeStatus>();
      yield* Ref.set(running, Option.some(done));
      yield* runProvision.pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Ref.set(running, Option.none()).pipe(Effect.andThen(Deferred.done(done, exit))),
        ),
        Effect.forkIn(scope),
      );
      return done;
    }),
  );

  const status = Ref.get(statusRef);
  const provision = Effect.flatMap(joinOrStart, Deferred.await);
  const setup = joinOrStart.pipe(
    // Let the run publish its first step so the caller sees progress, not the stale state.
    Effect.andThen(Effect.yieldNow),
    Effect.andThen(status),
  );

  // The desktop app is the clinical product, so it prepares itself. A dev
  // server keeps one home per worktree and installs only when asked.
  if (config.mode === "desktop" && config.devUrl === undefined) {
    yield* setup;
  }

  return ClinicalRuntime.of({ status, provision, setup });
});

export const layer = Layer.effect(ClinicalRuntime, make);
