import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  buildRuntimeInstructions,
  setRuntimeProductContext,
} from "@t3tools/provider-core/server/runtimeInstructions";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";

type Invocation = Pick<ProcessRunner.ProcessRunInput, "command" | "args">;

const exited = (code: number, stderr = ""): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const events = (...lines: ReadonlyArray<Record<string, unknown>>) =>
  new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));

/** M4 saying that a dataset command finished, which is the only thing that counts as done. */
const finished = (run: ProcessRunner.ProcessRunInput) => {
  run.onStdoutChunk?.(events({ event: "operation_completed", command: run.args[0] }));
  return exited(0);
};

/** The step a provisioning command belongs to, named the way the status reports it. */
const stepOf = ({ command, args }: Invocation) => {
  // `uv` on PATH, or Lincei's own copy by its path on this host.
  if (/(?:^|[\\/])uv$/.test(command)) {
    return args[0] === "--version" ? "uv" : args[0] === "venv" ? "python" : "packages";
  }
  // M4: its skills, a check that it still runs, or work on the demo dataset.
  return args[0] === "skills" ? "skills" : args[0] === "--version" ? "check" : "dataset";
};

/** The demo dataset as M4 lists it before anything of it is on this machine. */
const DEMO_LISTING = JSON.stringify({
  ok: true,
  data: {
    datasets: [
      {
        name: "mimic-iv-demo",
        setup_state: "missing_raw_files",
        raw_present: false,
        parquet_present: false,
        requires_authentication: false,
        download_available: true,
      },
    ],
  },
});

/** The setup step's two commands on the demo dataset: download its files, then prepare them. */
const DEMO_STEPS = ["dataset", "dataset"];

/**
 * The clinical research tools over a real temporary home whose commands are
 * answered by `respond`. Like the real ones, creating the environment writes
 * its interpreter, installing the packages writes M4's program, and M4 says so
 * when a dataset command finished.
 */
const withRuntime = <A, E>(
  respond: (invocation: Invocation) => ProcessRunner.ProcessRunOutput | "not-found",
  use: (context: {
    readonly runtime: ClinicalRuntime.ClinicalRuntime["Service"];
    readonly datasets: ClinicalDatasets.ClinicalDatasets["Service"];
    /** The step of every command that was run, in order. */
    readonly steps: Array<string>;
    readonly invocations: Array<Invocation>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  options: {
    /** The agent skill folder of this machine's user; none unless a test looks at it. */
    readonly skillDirectory?: string;
    /** The skill the installed M4 bundles. */
    readonly bundledSkill?: () => string;
    /** The home of an earlier run, to start again on the same machine. */
    readonly baseDir?: string;
    /** What this version of Lincei installs, when not the default. */
    readonly requirements?: string;
    /** Answers the download of the demo's files instead of `respond`. */
    readonly demoDownload?: (
      run: ProcessRunner.ProcessRunInput,
    ) => Effect.Effect<ProcessRunner.ProcessRunOutput>;
    /** The built web app the server serves; none, like a test or dev server, unless given. */
    readonly staticDir?: string;
  } = {},
) => {
  const steps: Array<string> = [];
  const invocations: Array<Invocation> = [];
  const bundledSkill = options.bundledSkill ?? (() => "sofa-score");
  const layerProcessRunner = Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.gen(function* () {
            // What M4 only reports is not a step of setup.
            if (input.args[0] === "list-datasets") return { ...exited(0), stdout: DEMO_LISTING };
            const step = stepOf(input);
            steps.push(step);
            invocations.push({ command: input.command, args: input.args });
            if (input.args[0] === "download" && options.demoDownload !== undefined) {
              return yield* options.demoDownload(input);
            }
            const response = respond(input);
            if (response === "not-found") {
              return yield* new ProcessRunner.ProcessSpawnError({
                command: input.command,
                argumentCount: input.args.length,
                cause: new Error("ENOENT"),
              });
            }
            if (Number(response.code) !== 0) return response;
            if (step === "python") {
              const binDir = path.join(input.args.at(-1) ?? "", "bin");
              yield* fileSystem.makeDirectory(binDir, { recursive: true }).pipe(Effect.orDie);
              yield* fileSystem.writeFileString(path.join(binDir, "python"), "").pipe(Effect.orDie);
            }
            if (step === "packages") {
              const python = input.args[input.args.indexOf("--python") + 1] ?? "";
              yield* fileSystem
                .writeFileString(path.join(path.dirname(python), "m4"), "")
                .pipe(Effect.orDie);
            }
            if (step === "skills") {
              const target = input.args[input.args.indexOf("--target") + 1] ?? "";
              // Like M4, which will not replace a bundle that is already there.
              if (yield* fileSystem.exists(target).pipe(Effect.orDie)) return exited(1);
              const skill = path.join(target, "clinical", bundledSkill());
              yield* fileSystem.makeDirectory(skill, { recursive: true }).pipe(Effect.orDie);
              yield* fileSystem
                .writeFileString(path.join(skill, "SKILL.md"), "")
                .pipe(Effect.orDie);
            }
            return step === "dataset" ? finished(input) : response;
          }),
      });
    }),
  );
  const layerConfig = ServerConfig.layerTest(
    process.cwd(),
    options.baseDir ?? { prefix: "lincei-clinical-test-" },
  );
  const layerDependencies = Layer.mergeAll(
    options.staticDir === undefined
      ? layerConfig
      : Layer.effect(
          ServerConfig.ServerConfig,
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            return {
              ...config,
              staticDir: options.staticDir,
            } satisfies ServerConfig.ServerConfig["Service"];
          }),
        ).pipe(Layer.provide(layerConfig)),
    Layer.succeed(HostProcessPlatform, "darwin"),
    // Never the real home: setup links skills into the user's agent folders.
    Layer.succeed(HostProcessEnvironment, {
      LINCEI_CLINICAL_SKILL_DIRS: options.skillDirectory ?? "",
    }),
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env:
          options.requirements === undefined
            ? {}
            : { LINCEI_CLINICAL_REQUIREMENTS: options.requirements },
      }),
    ),
    layerProcessRunner,
    // No network: a machine without uv cannot download one either.
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 503 }))),
      ),
    ),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return Effect.gen(function* () {
    const runtime = yield* ClinicalRuntime.ClinicalRuntime;
    const datasets = yield* ClinicalDatasets.ClinicalDatasets;
    return yield* use({ runtime, datasets, steps, invocations });
  }).pipe(
    Effect.provide(
      ClinicalRuntime.layer.pipe(
        Layer.provideMerge(ClinicalDatasets.layer),
        Layer.provideMerge(layerDependencies),
      ),
    ),
  );
};

describe("ClinicalRuntime", () => {
  it.effect("installs each step in order, then leaves an installed environment alone", () =>
    withRuntime(
      () => exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          expect(yield* runtime.status).toMatchObject({
            state: "not-installed",
            message: "The clinical research tools are not installed yet.",
          });

          const installed = yield* runtime.provision;
          expect(installed).toMatchObject({
            state: "ready",
            demoDataset: "ready",
            message: "The clinical research tools are ready.",
          });
          expect(steps).toEqual(["uv", "python", "packages", "skills", ...DEMO_STEPS]);

          steps.length = 0;
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual([]);
        }),
    ),
  );

  it.effect("sets itself up as it starts when it serves the web app to a browser", () =>
    withRuntime(
      () => exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          // Nobody asked: the run began with the server.
          expect((yield* runtime.status).state).toBe("installing");
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual(["uv", "python", "packages", "skills", ...DEMO_STEPS]);
        }),
      { staticDir: "/lincei/client" },
    ),
  );

  // The runtime here is a Mac's: it splits LINCEI_CLINICAL_SKILL_DIRS at `:`,
  // which cuts a Windows path after its drive letter. ClinicalSkillLinks.test.ts
  // covers Windows.
  it.effect.skipIf(process.platform === "win32")(
    "offers M4's skills where agents look for skills, following a rebuilt bundle",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const skillDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "lincei-agent-skills-",
        });
        let bundled = "sofa-score";
        yield* withRuntime(
          () => exited(0),
          ({ runtime }) =>
            Effect.gen(function* () {
              const { python } = yield* runtime.provision;
              expect(
                yield* fileSystem.exists(path.join(skillDirectory, "sofa-score", "SKILL.md")),
              ).toBe(true);

              // A changed environment is rebuilt, and its M4 may bundle other skills.
              yield* fileSystem.remove(python);
              bundled = "kdigo-aki-staging";
              expect((yield* runtime.provision).state).toBe("ready");
              expect(yield* fileSystem.readDirectory(skillDirectory)).toEqual([
                "kdigo-aki-staging",
              ]);
            }),
          { skillDirectory, bundledSkill: () => bundled },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says what to do, without naming uv, when the installer cannot be downloaded", () =>
    withRuntime(
      () => "not-found",
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          const status = yield* runtime.provision;
          expect(status).toMatchObject({
            state: "failed",
            step: "uv",
            message:
              "Lincei could not download the installer for the clinical research tools. Check the internet connection, then try again. Some hospital and university networks block this download; if it keeps failing, try another network.",
          });
          // The technical account is for whoever helps the user.
          expect(status.detail).toContain("Downloading uv");
          // Looked on PATH, then for Lincei's own copy, and ran nothing else.
          expect(steps).toEqual(["uv", "uv"]);
        }),
    ),
  );

  it.effect("keeps the end of a failed install's output for whoever repairs it", () =>
    withRuntime(
      (invocation) =>
        stepOf(invocation) === "packages"
          ? exited(1, "No solution found when resolving dependencies")
          : exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          const status = yield* runtime.provision;
          expect(status).toMatchObject({
            state: "failed",
            step: "packages",
            message: expect.stringContaining(
              "Lincei could not install M4 and Vitrine. Check the internet connection and that the disk has free space, then try again.",
            ),
            detail: "No solution found when resolving dependencies",
          });
          expect(steps).toEqual(["uv", "python", "packages"]);
        }),
    ),
  );

  it.effect(
    "answers a setup request with the run it starts, not with how the last one ended",
    () => {
      let online = false;
      return withRuntime(
        (invocation) =>
          stepOf(invocation) === "packages" && !online ? exited(1, "dns error") : exited(0),
        ({ runtime }) =>
          Effect.gen(function* () {
            // A first run has started by the time its request is answered.
            expect((yield* runtime.setup()).state).toBe("installing");
            expect(yield* runtime.provision).toMatchObject({ state: "failed", step: "packages" });

            online = true;
            const answer = yield* runtime.setup();
            expect(answer).toMatchObject({ state: "installing", step: "uv" });
            expect(answer.detail).toBeUndefined();
            expect((yield* runtime.provision).state).toBe("ready");

            // With nothing left to do there is nothing to wait for.
            expect((yield* runtime.setup()).state).toBe("ready");
          }),
      );
    },
  );

  it.effect("stays usable when the demo download fails, and retries only the download", () => {
    let online = false;
    return withRuntime(
      (invocation) => (stepOf(invocation) === "dataset" && !online ? exited(1) : exited(0)),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          expect(yield* runtime.provision).toMatchObject({
            state: "ready",
            demoDataset: "failed",
            // Where to retry, in the app. Never a command to type.
            message:
              "The clinical research tools are ready, but the MIMIC-IV demo dataset could not be downloaded. Check the internet connection, then try again from Settings, Clinical Data.",
          });

          steps.length = 0;
          online = true;
          expect((yield* runtime.setup()).step).toBe("dataset");
          expect(yield* runtime.provision).toMatchObject({ state: "ready", demoDataset: "ready" });
          expect(steps).toEqual(DEMO_STEPS);
        }),
    );
  });

  it.effect("shows how far the demo download is on the dataset while setup runs", () =>
    Effect.gen(function* () {
      const downloading = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* withRuntime(
        () => exited(0),
        ({ runtime, datasets }) =>
          Effect.gen(function* () {
            yield* runtime.setup();
            yield* Deferred.await(downloading);
            expect(yield* runtime.status).toMatchObject({ state: "installing", step: "dataset" });
            expect(
              (yield* datasets.list).find((dataset) => dataset.name === "mimic-iv-demo")?.job,
            ).toMatchObject({ kind: "setup", state: "running", completed: 2, total: 31 });

            yield* Deferred.succeed(release, undefined);
            expect(yield* runtime.provision).toMatchObject({
              state: "ready",
              demoDataset: "ready",
            });
          }),
        {
          demoDownload: (run) =>
            Effect.gen(function* () {
              run.onStdoutChunk?.(
                events(
                  { event: "download_started", file_count: 31 },
                  { event: "download_file_completed", path: "/data/hosp/patients.csv.gz" },
                  { event: "download_file_completed", path: "/data/hosp/admissions.csv.gz" },
                ),
              );
              yield* Deferred.succeed(downloading, undefined);
              yield* Deferred.await(release);
              return finished(run);
            }),
        },
      );
    }),
  );

  it.effect("forgets that the demo download failed once the demo is downloaded another way", () => {
    let online = false;
    return withRuntime(
      (invocation) => (stepOf(invocation) === "dataset" && !online ? exited(1) : exited(0)),
      ({ runtime, datasets, steps }) =>
        Effect.gen(function* () {
          expect((yield* runtime.provision).demoDataset).toBe("failed");

          // From the dataset's own row under Settings, Clinical Data.
          online = true;
          expect(yield* Fiber.join(yield* datasets.download({ name: "mimic-iv-demo" }))).toBe(true);
          expect(yield* runtime.status).toMatchObject({
            state: "ready",
            demoDataset: "ready",
            message: "The clinical research tools are ready.",
          });

          // And for good: the next setup has no demo left to download.
          steps.length = 0;
          yield* runtime.provision;
          expect(steps).toEqual([]);
        }),
    );
  });

  it.effect("installs everything again when asked to repair tools that are there", () => {
    let online = true;
    return withRuntime(
      (invocation) => (stepOf(invocation) === "packages" && !online ? exited(1) : exited(0)),
      ({ runtime, steps, invocations }) =>
        Effect.gen(function* () {
          yield* runtime.provision;
          const reinstalls = () =>
            invocations.filter((invocation) => invocation.args.includes("--reinstall")).length;
          expect(reinstalls()).toBe(0);

          steps.length = 0;
          online = false;
          expect((yield* runtime.setup({ force: true })).state).toBe("installing");
          // A repair that failed says so: what it was repairing cannot be trusted.
          expect(yield* runtime.provision).toMatchObject({ state: "failed", step: "packages" });
          expect(reinstalls()).toBe(1);

          // Trying again repeats the repair, not a setup that would find everything in place.
          steps.length = 0;
          online = true;
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual(["uv", "python", "packages", "skills"]);
          expect(reinstalls()).toBe(2);

          steps.length = 0;
          yield* runtime.provision;
          expect(steps).toEqual([]);
        }),
    );
  });

  it.effect("keeps tools that work usable when their update cannot be installed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-clinical-test-",
      });
      yield* withRuntime(
        () => exited(0),
        ({ runtime }) => runtime.provision,
        { baseDir },
      );

      // A newer Lincei wants newer tools, and starts on a machine that is offline.
      let online = false;
      yield* withRuntime(
        (invocation) =>
          stepOf(invocation) === "packages" && !online ? exited(1, "dns error") : exited(0),
        ({ runtime, steps }) =>
          Effect.gen(function* () {
            expect((yield* runtime.status).state).toBe("ready");
            expect((yield* runtime.setup()).state).toBe("installing");
            expect(yield* runtime.provision).toMatchObject({
              state: "ready",
              step: "packages",
              message:
                "The clinical research tools are ready, but an update for them could not be installed, so the installed version stays in use. Check the internet connection, then try again; Lincei also tries again the next time it starts.",
              detail: "dns error",
              demoDataset: "ready",
            });
            // The interpreter the working tools run on is left as it is, and
            // that they still run is asked, not assumed.
            expect(steps).toEqual(["uv", "packages", "check"]);

            steps.length = 0;
            online = true;
            expect(yield* runtime.provision).toMatchObject({
              state: "ready",
              message: "The clinical research tools are ready.",
            });
            expect(steps).toEqual(["uv", "packages", "skills"]);
          }),
        { baseDir, requirements: "m4-infra[research]>=0.6 vitrine>=0.2" },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not call tools ready that an update left unable to run", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-clinical-test-",
      });
      yield* withRuntime(
        () => exited(0),
        ({ runtime }) => runtime.provision,
        { baseDir },
      );

      // The disk filled up while the new packages were being put in place.
      yield* withRuntime(
        (invocation) =>
          stepOf(invocation) === "packages" || stepOf(invocation) === "check"
            ? exited(1, "No space left on device")
            : exited(0),
        ({ runtime }) =>
          Effect.gen(function* () {
            expect(yield* runtime.provision).toMatchObject({
              state: "failed",
              step: "packages",
              detail: "No space left on device",
            });
          }),
        { baseDir, requirements: "m4-infra[research]>=0.6 vitrine>=0.2" },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("ends as failed, not as installing for good, when setup itself breaks", () =>
    withRuntime(
      (invocation) => {
        if (stepOf(invocation) === "packages") throw new Error("a bug in setup");
        return exited(0);
      },
      ({ runtime }) =>
        Effect.gen(function* () {
          yield* runtime.provision.pipe(Effect.exit);
          expect(yield* runtime.status).toMatchObject({
            state: "failed",
            step: "packages",
            message:
              "Setting up the clinical research tools stopped unexpectedly. Try again; if it keeps happening, restart Lincei.",
          });
          // And the next request starts a run instead of waiting on the broken one.
          expect((yield* runtime.setup()).state).toBe("installing");
        }),
    ),
  );

  it.effect("starts setup in the background and reports the run already in flight", () =>
    withRuntime(
      () => exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          yield* runtime.setup();
          yield* runtime.setup();
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual(["uv", "python", "packages", "skills", ...DEMO_STEPS]);
        }),
    ),
  );
});

describe("ClinicalRuntime.activate", () => {
  const activateWith = (env: NodeJS.ProcessEnv) =>
    ClinicalRuntime.activate("/home/ada/.lincei").pipe(
      Effect.provideService(HostProcessEnvironment, env),
      Effect.provideService(HostProcessPlatform, "linux"),
      Effect.provide(NodePath.layerPosix),
      Effect.ensuring(
        Effect.sync(() => setRuntimeProductContext({ name: "T3 Code", instructions: "" })),
      ),
    );

  it.effect("puts the managed environment ahead of the user's own Python", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/local/bin:/usr/bin" };
    return Effect.gen(function* () {
      yield* activateWith(env);
      yield* activateWith(env);
      expect(env.PATH).toBe(
        "/home/ada/.lincei/clinical/venv/bin:/home/ada/.lincei/clinical/bin:/usr/local/bin:/usr/bin",
      );
      expect(env.M4_DATA_DIR).toBe("/home/ada/.lincei/clinical/m4_data");
      expect(env.LINCEI_CLINICAL_HOME).toBe("/home/ada/.lincei/clinical");
      // An agent's login shell reorders PATH, so agents are given the folder by name.
      expect(env.LINCEI_CLINICAL_BIN).toBe("/home/ada/.lincei/clinical/venv/bin");
    });
  });

  it.effect("keeps Vitrine from opening the research board in a browser of its own", () => {
    // An agent's first card starts Vitrine's server, which opens the system
    // browser unless this says not to. Lincei shows the board itself.
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", VITRINE_OPEN_BROWSER: "1" };
    return Effect.gen(function* () {
      yield* activateWith(env);
      expect(env.VITRINE_OPEN_BROWSER).toBe("0");
    });
  });

  it.effect("leaves Vitrine's board name alone outside Windows", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    return Effect.gen(function* () {
      yield* activateWith(env);
      expect(env.VITRINE_DISPLAY_HOST).toBeUndefined();
    });
  });

  it.effect("keeps a dataset directory the user exported", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", M4_DATA_DIR: "/data/m4" };
    return Effect.gen(function* () {
      yield* activateWith(env);
      expect(env.M4_DATA_DIR).toBe("/data/m4");
    });
  });

  it.effect("tells every agent it runs in Lincei and how to reach the clinical tools", () =>
    Effect.gen(function* () {
      const before = buildRuntimeInstructions({ harness: "Codex" });
      expect(before).not.toContain("<lincei>");

      yield* ClinicalRuntime.activate("/home/ada/.lincei").pipe(
        Effect.provideService(HostProcessEnvironment, { PATH: "/usr/bin" }),
        Effect.provideService(HostProcessPlatform, "linux"),
        Effect.provide(NodePath.layerPosix),
      );
      const after = buildRuntimeInstructions({ harness: "Codex" });
      expect(after).toContain("you are running in Lincei through the Codex harness");
      expect(after).toContain("lincei_clinical_setup");
      expect(after).toContain('export PATH="$LINCEI_CLINICAL_BIN:$PATH";');
      expect(after).toContain("$LINCEI_CLINICAL_HOME/skills/");
      // Researcher mode until the stored mode has been read.
      expect(after).toContain("<lincei_researcher>");
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => setRuntimeProductContext({ name: "T3 Code", instructions: "" })),
      ),
    ),
  );

  it.effect("on Windows, puts the venv's Scripts first under the key Windows spells Path", () => {
    const env: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\system32;C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps",
    };
    return Effect.gen(function* () {
      yield* ClinicalRuntime.activate("C:\\Users\\ada\\.lincei").pipe(
        Effect.provideService(HostProcessEnvironment, env),
        Effect.provideService(HostProcessPlatform, "win32"),
        Effect.provide(NodePath.layerWin32),
      );
      // Ahead of the Microsoft Store's `python` stand-in in WindowsApps.
      expect(env.Path).toBe(
        "C:\\Users\\ada\\.lincei\\clinical\\venv\\Scripts;C:\\Users\\ada\\.lincei\\clinical\\bin;C:\\Windows\\system32;C:\\Users\\ada\\AppData\\Local\\Microsoft\\WindowsApps",
      );
      expect(env.PATH).toBeUndefined();
      expect(env.LINCEI_CLINICAL_BIN).toBe("C:\\Users\\ada\\.lincei\\clinical\\venv\\Scripts");
      // Vitrine would otherwise name its board 127.0.0.1 there.
      expect(env.VITRINE_DISPLAY_HOST).toBe("vitrine.localhost");
      expect(buildRuntimeInstructions({ harness: "Codex" })).toContain(
        '$env:Path = "$env:LINCEI_CLINICAL_BIN;$env:Path";',
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => setRuntimeProductContext({ name: "T3 Code", instructions: "" })),
      ),
    );
  });
});
