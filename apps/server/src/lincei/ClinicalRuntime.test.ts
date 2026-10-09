import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  buildRuntimeInstructions,
  setRuntimeProductContext,
} from "@t3tools/provider-core/server/runtimeInstructions";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
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

/** The step a provisioning command belongs to, named the way the status reports it. */
const stepOf = ({ command, args }: Invocation) => {
  if (command === "uv") {
    return args[0] === "--version" ? "uv" : args[0] === "venv" ? "python" : "packages";
  }
  return args[0] === "skills" ? "skills" : "dataset";
};

/**
 * A runtime over a real temporary home whose commands are answered by
 * `respond`. Creating the environment writes its interpreter, as `uv venv` does.
 */
const withRuntime = <A, E>(
  respond: (invocation: Invocation) => ProcessRunner.ProcessRunOutput | "not-found",
  use: (context: {
    readonly runtime: ClinicalRuntime.ClinicalRuntime["Service"];
    readonly steps: Array<string>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) => {
  const steps: Array<string> = [];
  const layerProcessRunner = Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.gen(function* () {
            steps.push(stepOf(input));
            const response = respond(input);
            if (response === "not-found") {
              return yield* new ProcessRunner.ProcessSpawnError({
                command: input.command,
                argumentCount: input.args.length,
                cause: new Error("ENOENT"),
              });
            }
            if (stepOf(input) === "python" && Number(response.code) === 0) {
              const binDir = path.join(input.args.at(-1) ?? "", "bin");
              yield* fileSystem.makeDirectory(binDir, { recursive: true }).pipe(Effect.orDie);
              yield* fileSystem.writeFileString(path.join(binDir, "python"), "").pipe(Effect.orDie);
            }
            return response;
          }),
      });
    }),
  );
  const layerDependencies = Layer.mergeAll(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "lincei-clinical-test-" }),
    Layer.succeed(HostProcessPlatform, "darwin"),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
    layerProcessRunner,
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return Effect.gen(function* () {
    const runtime = yield* ClinicalRuntime.ClinicalRuntime;
    return yield* use({ runtime, steps });
  }).pipe(Effect.provide(ClinicalRuntime.layer.pipe(Layer.provideMerge(layerDependencies))));
};

describe("ClinicalRuntime", () => {
  it.effect("installs each step in order, then leaves an installed environment alone", () =>
    withRuntime(
      () => exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          expect((yield* runtime.status).state).toBe("not-installed");

          const installed = yield* runtime.provision;
          expect(installed).toMatchObject({ state: "ready", demoDataset: "ready" });
          expect(steps).toEqual(["uv", "python", "packages", "skills", "dataset"]);

          steps.length = 0;
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual([]);
        }),
    ),
  );

  it.effect("tells the user to install uv when it is missing", () =>
    withRuntime(
      () => "not-found",
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          const status = yield* runtime.provision;
          expect(status).toMatchObject({ state: "failed", step: "uv" });
          expect(status.message).toContain("https://docs.astral.sh/uv/");
          expect(steps).toEqual(["uv"]);
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
            detail: "No solution found when resolving dependencies",
          });
          expect(steps).toEqual(["uv", "python", "packages"]);
        }),
    ),
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
          });

          steps.length = 0;
          online = true;
          expect(yield* runtime.provision).toMatchObject({ state: "ready", demoDataset: "ready" });
          expect(steps).toEqual(["dataset"]);
        }),
    );
  });

  it.effect("starts setup in the background and reports the run already in flight", () =>
    withRuntime(
      () => exited(0),
      ({ runtime, steps }) =>
        Effect.gen(function* () {
          yield* runtime.setup;
          yield* runtime.setup;
          expect((yield* runtime.provision).state).toBe("ready");
          expect(steps).toEqual(["uv", "python", "packages", "skills", "dataset"]);
        }),
    ),
  );
});

describe("ClinicalRuntime.activate", () => {
  const activateWith = (env: NodeJS.ProcessEnv) =>
    ClinicalRuntime.activate("/home/ada/.lincei").pipe(
      Effect.provideService(HostProcessEnvironment, env),
      Effect.provideService(HostProcessPlatform, "linux"),
      Effect.provide(NodeServices.layer),
      Effect.ensuring(
        Effect.sync(() => setRuntimeProductContext({ name: "T3 Code", instructions: "" })),
      ),
    );

  it.effect("puts the managed environment ahead of the user's own Python", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/local/bin:/usr/bin" };
    return Effect.gen(function* () {
      yield* activateWith(env);
      yield* activateWith(env);
      expect(env.PATH).toBe("/home/ada/.lincei/clinical/venv/bin:/usr/local/bin:/usr/bin");
      expect(env.M4_DATA_DIR).toBe("/home/ada/.lincei/clinical/m4_data");
      expect(env.LINCEI_CLINICAL_HOME).toBe("/home/ada/.lincei/clinical");
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
      expect(before).not.toContain("lincei_clinical_research");

      yield* ClinicalRuntime.activate("/home/ada/.lincei").pipe(
        Effect.provideService(HostProcessEnvironment, { PATH: "/usr/bin" }),
        Effect.provideService(HostProcessPlatform, "linux"),
        Effect.provide(NodeServices.layer),
      );
      const after = buildRuntimeInstructions({ harness: "Codex" });
      expect(after).toContain("you are running in Lincei through the Codex harness");
      expect(after).toContain("lincei_clinical_setup");
      expect(after).toContain("$LINCEI_CLINICAL_HOME/skills/");
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => setRuntimeProductContext({ name: "T3 Code", instructions: "" })),
      ),
    ),
  );
});
