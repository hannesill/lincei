import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type ClinicalRuntimeStatus,
  clientRpcRequiredScopes,
  LINCEI_WS_METHODS,
  LinceiRequest,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";
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

type Spawned = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
};

/**
 * Lincei's request handler over clinical research tools in `state` and a
 * Vitrine that prints `vitrineStdout`, which may depend on the folder it runs
 * in. `spawned` records what was run where, up to and including what the
 * server runs while it shuts down.
 */
const withRequests = <A, E>(
  input: {
    readonly state: ClinicalRuntimeStatus["state"];
    readonly step?: ClinicalRuntimeStatus["step"];
    readonly vitrineStdout?: string | ((cwd: string | undefined) => string);
  },
  use: (context: {
    readonly requests: LinceiRequests.LinceiRequests["Service"];
    readonly spawned: Array<Spawned>;
    readonly existingDirectory: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
) => {
  const spawned: Array<Spawned> = [];
  const status = statusOf(input.state, input.step);
  const layerDependencies = Layer.mergeAll(
    Layer.succeed(
      ClinicalRuntime.ClinicalRuntime,
      ClinicalRuntime.ClinicalRuntime.of({
        status: Effect.succeed(status),
        provision: Effect.succeed(status),
        setup: () => Effect.succeed({ ...status, state: "installing" }),
        skills: Effect.succeed([
          { name: "sofa-score", category: "clinical", description: "SOFA", shadowed: false },
        ]),
        skillText: (name) =>
          Effect.succeed(name === "sofa-score" ? Option.some("# SOFA") : Option.none()),
      }),
    ),
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (run) =>
          Effect.sync(() => {
            spawned.push({ command: run.command, args: run.args, cwd: run.cwd });
            return {
              stdout:
                typeof input.vitrineStdout === "function"
                  ? input.vitrineStdout(run.cwd)
                  : (input.vitrineStdout ?? RUNNING),
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
    ServerConfig.layerTest(process.cwd(), { prefix: "lincei-requests-test-" }),
    // Never the developer's own dataset store.
    Layer.succeed(HostProcessEnvironment, {}),
    // The paths above are a Mac's, whatever this host is.
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodePath.layerPosix)));

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
        Layer.provideMerge(LinceiPreferences.layer),
        Layer.provideMerge(ClinicalDatasets.layer),
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
          {
            command: "/home/ada/.lincei/clinical/venv/bin/vitrine",
            args: ["start", "--no-open", "--json"],
            cwd: existingDirectory,
          },
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

  it.effect("stops the boards it opened or watched when the server shuts down", () =>
    Effect.gen(function* () {
      const context = yield* withRequests(
        {
          state: "ready",
          // A study store is found from the folder Vitrine runs in, or from one above it.
          vitrineStdout: (cwd) =>
            JSON.stringify({
              status: "running",
              url: "http://vitrine.localhost:7741",
              port: 7741,
              data_dir: `${cwd?.replace(/\/analysis$/, "")}/.vitrine`,
              error: null,
            }),
        },
        (machine) =>
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const folder = (name: string) => `${machine.existingDirectory}/${name}`;
            for (const name of ["sepsis/analysis", "aki", "untouched"]) {
              yield* fileSystem.makeDirectory(folder(name), { recursive: true });
            }
            yield* machine.requests.handle({ _tag: "ResearchBoardOpen", cwd: folder("sepsis") });
            yield* machine.requests.handle({
              _tag: "ResearchBoardActivity",
              cwd: folder("sepsis/analysis"),
            });
            yield* machine.requests.handle({ _tag: "ResearchBoardActivity", cwd: folder("aki") });
            expect(machine.spawned.some((run) => run.args[0] === "stop")).toBe(false);
            return { spawned: machine.spawned, folder };
          }),
      );

      // Vitrine's servers never stop by themselves, and it has ten ports for them.
      const stopped = context.spawned.filter((run) => run.args[0] === "stop");
      expect(stopped.every((run) => run.args.join(" ") === "stop --json")).toBe(true);
      // Once per study, from a folder that finds it, and never where this server did not look.
      expect(stopped.map((run) => run.cwd?.replace(/\/analysis$/, "")).sort()).toEqual(
        [context.folder("aki"), context.folder("sepsis")].sort(),
      );
    }),
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
            // What to do, for the user; what Vitrine said, for whoever helps them.
            message:
              "The research board did not start. Press the research board button again; if it keeps failing, quit Lincei and open it again.",
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
  /** A Vitrine that is not running and keeps its store in the folder it was asked about. */
  const notRunningIn = (cwd: string | undefined) =>
    JSON.stringify({
      status: "not_running",
      url: null,
      port: null,
      data_dir: `${cwd}/.vitrine`,
      error: null,
    });

  it.effect("reports when a study last gained a card, asking Vitrine only once", () =>
    withRequests(
      { state: "ready", vitrineStdout: notRunningIn },
      ({ requests, spawned, existingDirectory }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const request = { _tag: "ResearchBoardActivity", cwd: existingDirectory } as const;
          expect(yield* requests.handle(request)).toEqual({ _tag: "ResearchBoardActivity" });

          const older = `${existingDirectory}/.vitrine/studies/2026-01-01_cohort`;
          const newer = `${existingDirectory}/.vitrine/studies/2026-01-02_sepsis`;
          for (const [study, seconds] of [
            [older, 1_700_000_000],
            [newer, 1_700_000_500],
          ] as const) {
            yield* fileSystem.makeDirectory(study, { recursive: true });
            yield* fileSystem.writeFileString(`${study}/index.json`, "[]");
            yield* fileSystem.utimes(`${study}/index.json`, seconds, seconds);
          }

          expect(yield* requests.handle(request)).toEqual({
            _tag: "ResearchBoardActivity",
            updatedAt: 1_700_000_500_000,
          });
          // Asked every few seconds while an agent works, so it must not spawn each time.
          expect(spawned).toHaveLength(1);
        }),
    ),
  );

  it.effect("reads and changes Techie mode, whatever the state of the clinical tools", () =>
    withRequests({ state: "not-installed" }, ({ requests }) =>
      Effect.gen(function* () {
        expect(yield* requests.handle({ _tag: "Preferences" })).toEqual({
          _tag: "Preferences",
          preferences: { techieMode: false },
        });
        expect(yield* requests.handle({ _tag: "PreferencesUpdate", techieMode: true })).toEqual({
          _tag: "Preferences",
          preferences: { techieMode: true },
        });
        expect(yield* requests.handle({ _tag: "Preferences" })).toEqual({
          _tag: "Preferences",
          preferences: { techieMode: true },
        });
      }),
    ),
  );

  it.effect("shows what agents are told in the mode in force, and one skill's text", () =>
    withRequests({ state: "ready" }, ({ requests }) =>
      Effect.gen(function* () {
        const researcher = yield* requests.handle({ _tag: "AgentBriefing" });
        expect(researcher).toMatchObject({
          _tag: "AgentBriefing",
          techieMode: false,
          skills: [{ name: "sofa-score", shadowed: false }],
        });
        expect(researcher._tag === "AgentBriefing" && researcher.instructions).toContain(
          "<lincei_researcher>",
        );

        yield* requests.handle({ _tag: "PreferencesUpdate", techieMode: true });
        const techie = yield* requests.handle({ _tag: "AgentBriefing" });
        expect(techie._tag === "AgentBriefing" && techie.instructions).not.toContain(
          "<lincei_researcher>",
        );

        expect(yield* requests.handle({ _tag: "ClinicalSkillText", name: "sofa-score" })).toEqual({
          _tag: "ClinicalSkillText",
          name: "sofa-score",
          text: "# SOFA",
        });
        const unknown = yield* Effect.flip(
          requests.handle({ _tag: "ClinicalSkillText", name: "../../etc/passwd" }),
        );
        expect(unknown.message).toContain("no clinical skill");
      }),
    ),
  );

  it.effect("answers a dataset request with the setup state until M4 is installed", () =>
    withRequests({ state: "installing", step: "packages" }, ({ requests, spawned }) =>
      Effect.gen(function* () {
        for (const request of [
          { _tag: "ClinicalDatasets" },
          { _tag: "ClinicalDatasetDownload", name: "mimic-iv-demo" },
        ] as const) {
          expect(yield* requests.handle(request)).toMatchObject({
            _tag: "Clinical",
            status: { state: "installing" },
          });
        }
        expect(spawned).toEqual([]);
      }),
    ),
  );
  it("decodes a PhysioNet password into a value that does not print", () => {
    const request = Schema.decodeUnknownSync(LinceiRequest)({
      _tag: "ClinicalDatasetDownload",
      name: "mimic-iv",
      credentials: { username: "ada", password: "correct-horse-battery-staple" },
    });
    // Whatever logs, traces, or formats a request sees this, not the password.
    for (const printed of [JSON.stringify(request), String(Object.values(request)), `${request}`]) {
      expect(printed).not.toContain("correct-horse");
    }
    expect(JSON.stringify(request)).toContain("<redacted>");
  });
});

describe("who may ask", () => {
  // Lincei's method beside one every connection may call, and nothing else.
  const kept = [LINCEI_WS_METHODS.request, WS_METHODS.serverProbe] as const;
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (
        tag,
      ): tag is Exclude<keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES, (typeof kept)[number]> =>
        !(kept as ReadonlyArray<string>).includes(tag),
    ),
  );
  const preferences = { _tag: "Preferences", preferences: { techieMode: false } } as const;

  it.effect.each([
    { scopes: [AuthOrchestrationReadScope], answered: false },
    { scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope], answered: true },
  ])("answers only a connection that may operate ($answered)", ({ scopes, answered }) =>
    Effect.gen(function* () {
      const handled: Array<string> = [];
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            group.toLayerHandler(LINCEI_WS_METHODS.request, (request) =>
              Effect.sync(() => {
                handled.push(request._tag);
                return preferences;
              }),
            ),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );

      expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
      const answer = yield* client[LINCEI_WS_METHODS.request]({ _tag: "Preferences" }).pipe(
        Effect.result,
      );
      if (answered) {
        expect(answer).toMatchObject({ _tag: "Success", success: preferences });
        expect(handled).toEqual(["Preferences"]);
      } else {
        expect(answer).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "EnvironmentAuthorizationError",
            requiredPermission: AuthOrchestrationOperateScope,
          },
        });
        expect(handled).toEqual([]);
      }
    }).pipe(Effect.scoped),
  );

  it("is the scope clients check before they send a command, so a control can say so first", () => {
    for (const request of [{ _tag: "ClinicalSetup" }, { _tag: "Preferences" }] as const) {
      expect(clientRpcRequiredScopes(LINCEI_WS_METHODS.request, request)).toEqual([
        AuthOrchestrationOperateScope,
      ]);
    }
  });
});
