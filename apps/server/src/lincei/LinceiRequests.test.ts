import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as LinceiRequests from "./LinceiRequests.ts";
import * as ResearchBoard from "./ResearchBoard.ts";

const statusOf = (
  state: ClinicalRuntimeStatus["state"],
  step?: ClinicalRuntimeStatus["step"],
): ClinicalRuntimeStatus => ({
  state,
  ...(step === undefined ? {} : { step }),
  message: state,
  home: "/home/ada/.lincei/clinical",
  python: "/home/ada/.lincei/clinical/venv/bin/python",
  skillsDir: "/home/ada/.lincei/clinical/skills",
  dataDir: "/home/ada/.lincei/clinical/m4_data",
  requirements: [],
  demoDataset: "not-installed",
});

const RUNNING = JSON.stringify({
  status: "running",
  lifecycle_contract_version: 1,
  url: "http://vitrine.localhost:7741",
  api_url: "http://127.0.0.1:7741",
  pid: 4242,
  port: 7741,
  data_dir: "/studies/sepsis/.vitrine",
  error: null,
});

/**
 * Lincei's request handler over a clinical runtime in `state` and a Vitrine
 * whose `start` prints `vitrineStdout`. `spawned` records what was run where.
 */
const withRequests = <A, E>(
  input: {
    readonly state: ClinicalRuntimeStatus["state"];
    readonly step?: ClinicalRuntimeStatus["step"];
    readonly vitrineStdout?: string;
  },
  use: (context: {
    readonly requests: LinceiRequests.LinceiRequests["Service"];
    readonly spawned: Array<{ readonly command: string; readonly cwd: string | undefined }>;
    readonly existingDirectory: string;
  }) => Effect.Effect<A, E>,
) => {
  const spawned: Array<{ readonly command: string; readonly cwd: string | undefined }> = [];
  const status = statusOf(input.state, input.step);
  const layerDependencies = Layer.mergeAll(
    Layer.succeed(
      ClinicalRuntime.ClinicalRuntime,
      ClinicalRuntime.ClinicalRuntime.of({
        status: Effect.succeed(status),
        provision: Effect.succeed(status),
        setup: Effect.succeed({ ...status, state: "installing" }),
      }),
    ),
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (run) =>
          Effect.sync(() => {
            spawned.push({ command: run.command, cwd: run.cwd });
            return {
              stdout: input.vitrineStdout ?? RUNNING,
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }),
      }),
    ),
    Layer.succeed(HostProcessPlatform, "darwin"),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const existingDirectory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "lincei-board-test-",
    });
    const requests = yield* LinceiRequests.LinceiRequests;
    return yield* use({ requests, spawned, existingDirectory });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      LinceiRequests.layer.pipe(
        Layer.provideMerge(ResearchBoard.layer),
        Layer.provideMerge(layerDependencies),
      ),
    ),
  );
};

describe("LinceiRequests", () => {
  it.effect("opens the board for the study in the thread's folder", () =>
    withRequests({ state: "ready" }, ({ requests, spawned, existingDirectory }) =>
      Effect.gen(function* () {
        const response = yield* requests.handle({
          _tag: "ResearchBoardOpen",
          cwd: existingDirectory,
        });
        expect(response).toEqual({
          _tag: "ResearchBoard",
          board: {
            url: "http://vitrine.localhost:7741",
            port: 7741,
            dataDir: "/studies/sepsis/.vitrine",
          },
        });
        // Vitrine finds the study from where it runs, so it must run in that folder.
        expect(spawned).toEqual([
          { command: "/home/ada/.lincei/clinical/venv/bin/vitrine", cwd: existingDirectory },
        ]);
      }),
    ),
  );

  it.effect("opens the board while only the demo dataset is still downloading", () =>
    withRequests({ state: "installing", step: "dataset" }, ({ requests, existingDirectory }) =>
      Effect.gen(function* () {
        const response = yield* requests.handle({
          _tag: "ResearchBoardOpen",
          cwd: existingDirectory,
        });
        expect(response._tag).toBe("ResearchBoard");
      }),
    ),
  );

  it.effect("answers with the setup state instead of a board while Vitrine is not installed", () =>
    withRequests(
      { state: "installing", step: "packages" },
      ({ requests, spawned, existingDirectory }) =>
        Effect.gen(function* () {
          const response = yield* requests.handle({
            _tag: "ResearchBoardOpen",
            cwd: existingDirectory,
          });
          expect(response).toMatchObject({ _tag: "Clinical", status: { state: "installing" } });
          expect(spawned).toEqual([]);
        }),
    ),
  );

  it.effect("reports why the board did not start", () =>
    withRequests(
      {
        state: "ready",
        vitrineStdout: JSON.stringify({
          status: "error",
          url: null,
          port: null,
          data_dir: null,
          error: "port 7741 is in use",
        }),
      },
      ({ requests, existingDirectory }) =>
        Effect.gen(function* () {
          const failure = yield* requests
            .handle({ _tag: "ResearchBoardOpen", cwd: existingDirectory })
            .pipe(Effect.flip);
          expect(failure).toMatchObject({
            _tag: "LinceiRequestError",
            detail: "port 7741 is in use",
          });
        }),
    ),
  );

  it.effect("does not start a board in a folder that is gone", () =>
    withRequests({ state: "ready" }, ({ requests, spawned, existingDirectory }) =>
      Effect.gen(function* () {
        const failure = yield* requests
          .handle({ _tag: "ResearchBoardOpen", cwd: `${existingDirectory}/removed` })
          .pipe(Effect.flip);
        expect(failure._tag).toBe("LinceiRequestError");
        expect(spawned).toEqual([]);
      }),
    ),
  );
});
