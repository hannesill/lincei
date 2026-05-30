// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeHttp from "node:http";
// @effect-diagnostics-next-line nodeBuiltinImport:off - CLI help tests spawn the local entrypoints.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { cli } from "./bin.ts";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import {
  CommandId,
  ProviderInstanceId,
  ProjectId,
  ResearchCardId,
  SessionId,
  type ModelSelection,
  type OrchestrationResearchCard,
  type ResearchCardType,
} from "@t3tools/contracts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState.ts";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { ServerAuthLive } from "./auth/Layers/ServerAuth.ts";
import { agentCli } from "./lincei.ts";
import packageJson from "../package.json" with { type: "json" };
import tsdownConfig from "../tsdown.config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);
const runAgentCli = (args: ReadonlyArray<string>) =>
  Command.runWith(agentCli, { version: "0.0.0" })(args);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));
const runAgentCliWithRuntime = (args: ReadonlyArray<string>) =>
  runAgentCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const makeCliTestServerConfig = (baseDir: string) =>
  Effect.gen(function* () {
    const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "t3-server",
      mode: "web",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    } satisfies ServerConfigShape;
  });

const makeProjectPersistenceLayer = (config: ServerConfigShape) =>
  Layer.mergeAll(
    OrchestrationLayerLive.pipe(
      Layer.provideMerge(RepositoryIdentityResolverLive),
      Layer.provideMerge(SqlitePersistenceLayerLive),
    ),
    WorkspacePathsLive,
  ).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(Layer.succeed(ServerConfig, config)),
  );

const readPersistedSnapshot = (baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    return yield* Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      return yield* projectionSnapshotQuery.getSnapshot();
    }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));
  });

const runHelpCommand = (entrypoint: "bin.ts" | "lincei.ts") =>
  Effect.promise(async () => {
    const child = spawn("bun", [`src/${entrypoint}`, "--help"], {
      cwd: join(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    return stdout;
  });

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.3-codex",
  options: [],
} satisfies ModelSelection;

const seedOfflineAgentContext = (baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    const projectId = ProjectId.make("project-agent-cli");
    const sessionId = SessionId.make("session-agent-cli");
    const cardId = ResearchCardId.make("card-agent-cli");
    const now = "2026-05-30T00:00:00.000Z";
    const card = {
      id: cardId,
      type: "markdown" satisfies ResearchCardType,
      status: "proposed",
      title: "Baseline cohort",
      preview: { markdown: "Cohort summary" },
      artifacts: [],
      provenance: [],
      turnId: null,
      createdAt: now,
      updatedAt: now,
    } satisfies OrchestrationResearchCard;

    yield* Effect.gen(function* () {
      const orchestrationEngine = yield* OrchestrationEngineService;
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-agent-project"),
        projectId,
        title: "Agent Project",
        workspaceRoot: "/tmp/agent-project",
        defaultModelSelection: modelSelection,
        createdAt: now,
      });
      yield* orchestrationEngine.dispatch({
        type: "session.create",
        commandId: CommandId.make("cmd-agent-session"),
        sessionId,
        projectId,
        title: "Agent Session",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* orchestrationEngine.dispatch({
        type: "session.research-card.propose",
        commandId: CommandId.make("cmd-agent-card"),
        sessionId,
        researchCard: card,
        createdAt: now,
      });
    }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));

    return { projectId, sessionId, cardId };
  });

const withLiveProjectCliServer = <A, E, R>(baseDir: string, run: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    const routesLayer = Layer.mergeAll(
      orchestrationSnapshotRouteLayer,
      orchestrationDispatchRouteLayer,
    );
    const appLayer = HttpRouter.serve(routesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(
        ServerAuthLive.pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerSecretStoreLive),
        ),
      ),
      Layer.provideMerge(makeProjectPersistenceLayer(config)),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: 0,
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(Layer.succeed(ServerConfig, config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          assert.fail(`Expected TCP address, got ${address}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({
            config,
            port: address.port,
          }),
        });
        return yield* run();
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
    );
  });

const assertAgentCliError = (error: unknown, expectedMessage: string) => {
  if (typeof error !== "object" || error === null) {
    assert.fail(`Expected AgentCliError, got ${String(error)}`);
  }
  const tagged = error as { readonly _tag?: string; readonly message?: string };
  assert.equal(tagged._tag, "AgentCliError");
  assert.isTrue((tagged.message ?? "").includes(expectedMessage));
};

it.layer(NodeServices.layer)("bin cli parsing", (it) => {
  it.effect("exposes separate admin and agent command trees", () =>
    Effect.gen(function* () {
      const adminHelp = yield* runHelpCommand("bin.ts");
      const agentHelp = yield* runHelpCommand("lincei.ts");

      assert.isTrue(adminHelp.includes("USAGE\n  t3"));
      assert.isTrue(adminHelp.includes("start"));
      assert.isTrue(adminHelp.includes("serve"));
      assert.isTrue(adminHelp.includes("auth"));
      assert.isTrue(adminHelp.includes("project"));
      assert.isFalse(adminHelp.includes("context"));

      assert.isTrue(agentHelp.includes("USAGE\n  lincei"));
      assert.isTrue(agentHelp.includes("card"));
      assert.isTrue(agentHelp.includes("context"));
      assert.isFalse(agentHelp.includes("serve"));
      assert.isFalse(agentHelp.includes("start"));
      assert.isFalse(agentHelp.includes("auth"));
      assert.isFalse(agentHelp.includes("project"));
    }),
  );

  it("maps package bins and build entries to separate admin and agent entrypoints", () => {
    assert.equal(packageJson.bin.t3, "./dist/bin.mjs");
    assert.equal(packageJson.bin.lincei, "./dist/lincei.mjs");

    const config = Array.isArray(tsdownConfig) ? tsdownConfig[0] : tsdownConfig;
    const entries = config?.entry;
    assert.deepEqual(entries, ["src/bin.ts", "src/lincei.ts"]);
  });

  it.effect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  it.effect("accepts canonical --no-<flag> boolean negation", () =>
    runCliWithRuntime(["--no-log-websocket-events", "--version"]),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("executes auth pairing subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-auth-pairing-test-"));

      const createdOutput = yield* captureStdout(
        runCli(["auth", "pairing", "create", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const created = JSON.parse(createdOutput.output) as {
        readonly id: string;
        readonly credential: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly id: string;
        readonly credential?: string;
      }>;

      assert.equal(typeof created.id, "string");
      assert.equal(typeof created.credential, "string");
      assert.equal(created.credential.length > 0, true);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, created.id);
      assert.equal("credential" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("executes auth session subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-auth-session-test-"));

      const issuedOutput = yield* captureStdout(
        runCli(["auth", "session", "issue", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const issued = JSON.parse(issuedOutput.output) as {
        readonly sessionId: string;
        readonly token: string;
        readonly role: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "session", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly sessionId: string;
        readonly token?: string;
        readonly role: string;
      }>;

      assert.equal(typeof issued.sessionId, "string");
      assert.equal(typeof issued.token, "string");
      assert.equal(issued.role, "owner");
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.sessionId, issued.sessionId);
      assert.equal(listed[0]?.role, "owner");
      assert.equal("token" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("rejects invalid ttl values before running auth commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["auth", "pairing", "create", "--ttl", "soon"]).pipe(
        Effect.flip,
      );

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "auth", "pairing", "create"]);
      const ttlError = error.errors[0] as CliError.CliError | undefined;
      if (!ttlError || ttlError._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${String(ttlError?._tag)}`);
      }
      assert.equal(ttlError.option, "ttl");
      assert.equal(ttlError.value, "soon");
      assert.isTrue(ttlError.message.includes("Invalid duration"));
      assert.isTrue(ttlError.message.includes("5m, 1h, 30d, or 15 minutes"));
    }),
  );

  it.effect("adds, renames, and removes projects offline through the orchestration engine", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-projects-offline-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-projects-workspace-"));

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Alpha",
        "--base-dir",
        baseDir,
      ]);
      const afterAdd = yield* readPersistedSnapshot(baseDir);
      const addedProject = afterAdd.projects.find(
        (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
      );
      assert.isTrue(addedProject !== undefined);
      assert.equal(addedProject?.title, "Alpha");

      yield* runCliWithRuntime(["project", "rename", workspaceRoot, "Beta", "--base-dir", baseDir]);
      const afterRename = yield* readPersistedSnapshot(baseDir);
      const renamedProject = afterRename.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.equal(renamedProject?.title, "Beta");
      assert.equal(renamedProject?.deletedAt, null);

      yield* runCliWithRuntime([
        "project",
        "remove",
        addedProject?.id ?? "",
        "--base-dir",
        baseDir,
      ]);
      const afterRemove = yield* readPersistedSnapshot(baseDir);
      const removedProject = afterRemove.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.isTrue((removedProject?.deletedAt ?? null) !== null);
    }),
  );

  it.effect("routes project commands through a running server when runtime state is present", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-projects-live-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-projects-live-workspace-"));

      yield* withLiveProjectCliServer(baseDir, () =>
        Effect.gen(function* () {
          yield* runCliWithRuntime([
            "project",
            "add",
            workspaceRoot,
            "--title",
            "Live Project",
            "--base-dir",
            baseDir,
          ]);
          const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
          const readModel = yield* projectionSnapshotQuery.getSnapshot();
          const addedProject = readModel.projects.find(
            (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
          );
          assert.isTrue(addedProject !== undefined);
          assert.equal(addedProject?.title, "Live Project");
        }),
      );
    }),
  );

  it.effect("rejects dev-url on project commands", () =>
    Effect.gen(function* () {
      const workspaceRoot = mkdtempSync(
        join(tmpdir(), "t3-cli-projects-unknown-option-workspace-"),
      );
      const error = yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--dev-url",
        "http://127.0.0.1:5173",
      ]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "project", "add"]);
      const optionError = error.errors[0] as CliError.CliError | undefined;
      if (!optionError || optionError._tag !== "UnrecognizedOption") {
        assert.fail(`Expected UnrecognizedOption, got ${String(optionError?._tag)}`);
      }
      assert.equal(optionError.option, "--dev-url");
    }),
  );

  it.effect("requires a live server for agent card writes when no runtime state exists", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "lincei-agent-write-no-runtime-"));
      const error = yield* runAgentCliWithRuntime([
        "card",
        "propose",
        "--session",
        "session-agent-cli",
        "--title",
        "Evidence",
        "--base-dir",
        baseDir,
      ]).pipe(Effect.flip);

      assertAgentCliError(error, "start the Lincei server first");
    }),
  );

  it.effect("fails closed for agent card writes when runtime state is stale", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "lincei-agent-write-stale-runtime-"));
      const config = yield* makeCliTestServerConfig(baseDir);
      yield* persistServerRuntimeState({
        path: config.serverRuntimeStatePath,
        state: yield* makePersistedServerRuntimeState({ config, port: 9 }),
      });

      const error = yield* runAgentCliWithRuntime([
        "card",
        "propose",
        "--session",
        "session-agent-cli",
        "--title",
        "Evidence",
        "--base-dir",
        baseDir,
      ]).pipe(Effect.flip);

      assertAgentCliError(error, "refusing to use stale projection");
    }),
  );

  it.effect("fails closed for agent reads when runtime state is stale", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "lincei-agent-read-stale-runtime-"));
      const config = yield* makeCliTestServerConfig(baseDir);
      yield* persistServerRuntimeState({
        path: config.serverRuntimeStatePath,
        state: yield* makePersistedServerRuntimeState({ config, port: 9 }),
      });

      const error = yield* runAgentCliWithRuntime([
        "context",
        "summary",
        "--base-dir",
        baseDir,
      ]).pipe(Effect.flip);

      assertAgentCliError(error, "refusing to use stale projection");
    }),
  );

  it.effect("uses offline projection for agent reads when no runtime state exists", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "lincei-agent-read-offline-"));
      const seeded = yield* seedOfflineAgentContext(baseDir);
      const output = yield* captureStdout(
        runAgentCli([
          "context",
          "session",
          "--session",
          seeded.sessionId,
          "--base-dir",
          baseDir,
          "--json",
        ]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const parsed = JSON.parse(output.output) as {
        readonly source: string;
        readonly session: {
          readonly id: string;
          readonly activeCardIds: ReadonlyArray<string>;
          readonly cards: ReadonlyArray<{
            readonly id: string;
            readonly title: string;
            readonly type: string;
            readonly status: string;
            readonly updatedAt: string;
            readonly artifactCount: number;
            readonly hasPreview: boolean;
          }>;
        };
      };

      assert.equal(parsed.source, "offline");
      assert.equal(parsed.session.id, seeded.sessionId);
      assert.deepEqual(parsed.session.activeCardIds, [seeded.cardId]);
      assert.deepEqual(parsed.session.cards, [
        {
          id: seeded.cardId,
          title: "Baseline cohort",
          type: "markdown",
          status: "proposed",
          updatedAt: "2026-05-30T00:00:00.000Z",
          artifactCount: 0,
          hasPreview: true,
        },
      ]);
    }),
  );
});
