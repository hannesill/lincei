import {
  OrchestrationReadModel,
  SessionId,
  type OrchestrationProject,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { AuthControlPlaneRuntimeLive } from "../auth/Layers/AuthControlPlane.ts";
import { AuthControlPlane } from "../auth/Services/AuthControlPlane.ts";
import type { AuthControlPlaneShape } from "../auth/Services/AuthControlPlane.ts";
import { ServerConfig } from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import {
  LINCEI_PROJECT_DIR_ENV,
  LINCEI_PROJECT_ID_ENV,
  LINCEI_SESSION_ID_ENV,
} from "../provider/LinceiAmbientEnvironment.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

type SnapshotSource = "live" | "offline";

class AgentCliError extends Data.TaggedError("AgentCliError")<{
  readonly message: string;
}> {}

const AGENT_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);

const AgentOfflineReadLayer = Layer.mergeAll(
  WorkspacePathsLive,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolverLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const prettyFlag = Flag.boolean("pretty").pipe(
  Flag.withDescription("Pretty-print JSON output."),
  Flag.withDefault(false),
);

const diagnosticsFlag = Flag.boolean("diagnostics").pipe(
  Flag.withDescription("Include resolution diagnostics and otherwise suppressed details."),
  Flag.withDefault(false),
);

const sessionFlag = Flag.string("session").pipe(
  Flag.withDescription("Session id. Defaults to the current Lincei session when available."),
  Flag.withSchema(SessionId),
  Flag.optional,
);

const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const runLiveServerRequest = <A, E, R>(
  request: HttpClientRequest.HttpClientRequest,
  handle: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.execute(request);
    return yield* handle(response);
  }).pipe(Effect.timeout(AGENT_CLI_LIVE_SERVER_TIMEOUT));

const readErrorMessageFromResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationHttpErrorResponse)(response).pipe(
    Effect.map((body) => body.error),
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((body) => {
      if (typeof body === "string" && body.trim().length > 0) {
        return body;
      }
      return `Server request failed with status ${response.status}.`;
    }),
  );

const fetchLiveOrchestrationSnapshot = (origin: string, bearerToken: string) =>
  runLiveServerRequest(
    HttpClientRequest.get(`${origin}/api/orchestration/snapshot`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(bearerToken),
    ),
    HttpClientResponse.matchStatus({
      "2xx": (response) =>
        HttpClientResponse.schemaBodyJson(OrchestrationReadModel)(response).pipe(
          Effect.mapError(
            () => new AgentCliError({ message: "Invalid orchestration snapshot response." }),
          ),
        ),
      orElse: (response) =>
        readErrorMessageFromResponse(response).pipe(
          Effect.flatMap((message) => Effect.fail(new AgentCliError({ message }))),
        ),
    }),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof AgentCliError
        ? error
        : new AgentCliError({
            message:
              "Lincei server runtime was found but could not be reached; refusing to use stale projection.",
          }),
    ),
  );

const withAgentCliSessionToken = <A, E, R>(
  authControlPlane: AuthControlPlaneShape,
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    authControlPlane.issueSession({
      role: "owner",
      label: "lincei agent cli",
    }),
    (issued) => run(issued.token),
    (issued) => authControlPlane.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const getOfflineSnapshot = Effect.fn("getAgentOfflineSnapshot")(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  return yield* projectionSnapshotQuery.getSnapshot();
});

const resolveReadSnapshot = Effect.fn("resolveAgentReadSnapshot")(function* (
  flags: CliAuthLocationFlags,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);

  if (Option.isNone(runtimeState)) {
    const offlineLayer = AgentOfflineReadLayer.pipe(
      Layer.provide(Layer.succeed(ServerConfig, config)),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
    );
    const snapshot = yield* getOfflineSnapshot().pipe(Effect.provide(offlineLayer));
    return {
      snapshot,
      source: "offline" as SnapshotSource,
    };
  }

  return yield* Effect.gen(function* () {
    const authControlPlane = yield* AuthControlPlane;
    return yield* withAgentCliSessionToken(authControlPlane, (token) =>
      Effect.gen(function* () {
        const snapshot = yield* fetchLiveOrchestrationSnapshot(runtimeState.value.origin, token);
        return {
          snapshot,
          source: "live" as SnapshotSource,
        };
      }),
    );
  }).pipe(
    Effect.provide(
      AuthControlPlaneRuntimeLive.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(ServerConfig, config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      ),
    ),
    Effect.mapError(
      () =>
        new AgentCliError({
          message:
            "Lincei server runtime was found but could not be reached; refusing to use stale projection.",
        }),
    ),
  );
});

const findSession = (snapshot: OrchestrationReadModel, sessionId: SessionId) => {
  const session = snapshot.sessions.find(
    (candidate) => candidate.id === sessionId && candidate.deletedAt === null,
  );
  if (!session) {
    return Effect.fail(
      new AgentCliError({ message: `No active session found for '${sessionId}'.` }),
    );
  }
  return Effect.succeed(session);
};

const activeSessions = (snapshot: OrchestrationReadModel) =>
  snapshot.sessions.filter((session) => session.deletedAt === null && session.archivedAt === null);

const activeProjects = (snapshot: OrchestrationReadModel) =>
  snapshot.projects.filter((project) => project.deletedAt === null);

const readProcessEnv = (name: string) =>
  Effect.sync(() => {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : undefined;
  });

const readAmbientEnvSync = () => ({
  sessionId: process.env[LINCEI_SESSION_ID_ENV]?.trim() || null,
  projectId: process.env[LINCEI_PROJECT_ID_ENV]?.trim() || null,
  projectDir: process.env[LINCEI_PROJECT_DIR_ENV]?.trim() || null,
});

const formatCandidateSessions = (sessions: ReadonlyArray<OrchestrationSession>) =>
  sessions
    .slice(0, 8)
    .map((session) => `${session.id} (${session.title})`)
    .join(", ");

const formatCandidateProjects = (projects: ReadonlyArray<OrchestrationProject>) =>
  projects
    .slice(0, 8)
    .map((project) => `${project.id} (${project.title}, ${project.workspaceRoot})`)
    .join(", ");

const pathWithinWorkspace = (candidatePath: string, workspaceRoot: string) => {
  const normalizedPath = candidatePath.replace(/\/+$/g, "");
  const normalizedRoot = workspaceRoot.replace(/\/+$/g, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

const findProjectByIdentifier = Effect.fn("findAgentProjectByIdentifier")(function* (
  snapshot: OrchestrationReadModel,
  identifier: string,
) {
  const path = yield* Path.Path;
  const trimmed = identifier.trim();
  const resolvedPath = trimmed.length > 0 ? path.resolve(trimmed) : trimmed;
  return activeProjects(snapshot).find(
    (project) =>
      project.id === trimmed ||
      project.workspaceRoot === trimmed ||
      project.workspaceRoot === resolvedPath ||
      pathWithinWorkspace(resolvedPath, project.workspaceRoot),
  );
});

const resolveProjectTarget = Effect.fn("resolveAgentProjectTarget")(function* (
  snapshot: OrchestrationReadModel,
  explicitProject: Option.Option<string>,
) {
  const envProjectId = yield* readProcessEnv(LINCEI_PROJECT_ID_ENV);
  const envProjectDir = yield* readProcessEnv(LINCEI_PROJECT_DIR_ENV);
  const cwd = process.cwd();
  const candidates = [
    Option.getOrUndefined(explicitProject),
    envProjectId,
    envProjectDir,
    cwd,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const project = yield* findProjectByIdentifier(snapshot, candidate);
    if (project) {
      return project;
    }
  }

  const projects = activeProjects(snapshot);
  if (projects.length === 1) {
    return projects[0]!;
  }

  return yield* new AgentCliError({
    message:
      projects.length === 0
        ? "No active project found."
        : `Could not infer project. Pass --project <id-or-workspace-root>. Candidates: ${formatCandidateProjects(projects)}.`,
  });
});

const resolveSessionTarget = Effect.fn("resolveAgentSessionTarget")(function* (
  snapshot: OrchestrationReadModel,
  explicitSession: Option.Option<SessionId>,
) {
  const explicit = Option.getOrUndefined(explicitSession);
  if (explicit !== undefined) {
    return yield* findSession(snapshot, explicit);
  }

  const envSessionId = yield* readProcessEnv(LINCEI_SESSION_ID_ENV);
  if (envSessionId !== undefined) {
    return yield* findSession(snapshot, SessionId.make(envSessionId));
  }

  const project = yield* Effect.exit(resolveProjectTarget(snapshot, Option.none()));
  const sessions = activeSessions(snapshot);
  const projectId = Exit.isSuccess(project) ? project.value.id : undefined;
  const projectSessions =
    projectId !== undefined ? sessions.filter((session) => session.projectId === projectId) : [];

  if (projectSessions.length === 1) {
    return projectSessions[0]!;
  }
  if (projectSessions.length > 1) {
    return yield* new AgentCliError({
      message: `Could not infer session for project '${projectId}'. Pass --session <id>. Candidates: ${formatCandidateSessions(projectSessions)}.`,
    });
  }
  if (sessions.length === 1) {
    return sessions[0]!;
  }

  return yield* new AgentCliError({
    message:
      sessions.length === 0
        ? "No active session found."
        : `Could not infer session. Pass --session <id>. Candidates: ${formatCandidateSessions(sessions)}.`,
  });
});

const compactSession = (session: OrchestrationSession) => ({
  id: session.id,
  title: session.title,
  projectId: session.projectId,
  latestTurn: session.latestTurn
    ? {
        id: session.latestTurn.turnId,
        state: session.latestTurn.state,
      }
    : null,
});

const compactProject = (
  project: OrchestrationProject,
  sessions: ReadonlyArray<OrchestrationSession>,
) => ({
  id: project.id,
  title: project.title,
  workspaceRoot: project.workspaceRoot,
  repositoryIdentity: project.repositoryIdentity ?? null,
  activeSessionCount: sessions.length,
});

const compactProjectDiagnostics = (sessions: ReadonlyArray<OrchestrationSession>) => ({
  activeSessionIds: sessions.map((session) => session.id),
  activeSessions: sessions.map(compactSession),
});

const compactSessionDiagnostics = (session: OrchestrationSession) => ({
  messageCount: session.messages.length,
  proposedPlanCount: session.proposedPlans.length,
  activityCount: session.activities.length,
  checkpointCount: session.checkpoints.length,
  lifecycle: {
    archived: session.archivedAt !== null,
    deleted: session.deletedAt !== null,
    runtimeStatus: session.session?.status ?? null,
  },
});

const findProjectForSession = (snapshot: OrchestrationReadModel, session: OrchestrationSession) =>
  activeProjects(snapshot).find((project) => project.id === session.projectId);

const projectActiveSessions = (snapshot: OrchestrationReadModel, projectId: string) =>
  activeSessions(snapshot).filter((session) => session.projectId === projectId);

const makeCurrentContext = (input: {
  readonly snapshot: OrchestrationReadModel;
  readonly source: SnapshotSource;
  readonly session: OrchestrationSession;
  readonly project: OrchestrationProject | undefined;
  readonly diagnostics: boolean;
}) => {
  const sessions =
    input.project !== undefined ? projectActiveSessions(input.snapshot, input.project.id) : [];
  return {
    source: input.source,
    workspace:
      input.project !== undefined
        ? compactProject(input.project, sessions)
        : { error: "not_found" },
    session: compactSession(input.session),
    ...(input.diagnostics
      ? {
          diagnostics: {
            cwd: process.cwd(),
            env: readAmbientEnvSync(),
            workspace:
              input.project !== undefined ? compactProjectDiagnostics(sessions) : undefined,
            session: compactSessionDiagnostics(input.session),
          },
        }
      : {}),
  };
};

const formatOutput = (value: unknown, pretty: boolean) =>
  pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);

const runReadCommand = (
  flags: CliAuthLocationFlags & { readonly pretty?: boolean },
  run: (
    snapshot: OrchestrationReadModel,
    source: SnapshotSource,
  ) => Effect.Effect<unknown, AgentCliError, Path.Path>,
) =>
  Effect.gen(function* () {
    const resolved = yield* resolveReadSnapshot(flags);
    const output = yield* run(resolved.snapshot, resolved.source);
    yield* Console.log(formatOutput(output, flags.pretty === true));
  });

const contextSessionCommand = Command.make("session", {
  ...projectLocationFlags,
  session: sessionFlag,
  diagnostics: diagnosticsFlag,
  pretty: prettyFlag,
}).pipe(
  Command.withDescription("Show compact context for a session."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        return makeCurrentContext({
          snapshot,
          source,
          session,
          project: findProjectForSession(snapshot, session),
          diagnostics: flags.diagnostics,
        });
      }),
    ),
  ),
);

const contextProjectCommand = Command.make("project", {
  ...projectLocationFlags,
  project: Flag.string("project").pipe(
    Flag.withDescription("Project id or workspace root."),
    Flag.withAlias("workspace-root"),
    Flag.optional,
  ),
  diagnostics: diagnosticsFlag,
  pretty: prettyFlag,
}).pipe(
  Command.withDescription("Show compact context for a project."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const project = yield* resolveProjectTarget(snapshot, flags.project);
        const sessions = snapshot.sessions.filter(
          (session) =>
            session.projectId === project.id &&
            session.archivedAt === null &&
            session.deletedAt === null,
        );
        return {
          source,
          workspace: compactProject(project, sessions),
          ...(flags.diagnostics
            ? { diagnostics: { workspace: compactProjectDiagnostics(sessions) } }
            : {}),
        };
      }),
    ),
  ),
);

const contextCurrentCommand = Command.make("current", {
  ...projectLocationFlags,
  diagnostics: diagnosticsFlag,
  pretty: prettyFlag,
}).pipe(
  Command.withDescription("Show inferred current Lincei session and project context."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const projectExit = yield* Effect.exit(resolveProjectTarget(snapshot, Option.none()));
        const sessionExit = yield* Effect.exit(resolveSessionTarget(snapshot, Option.none()));
        const project = Exit.isSuccess(projectExit) ? projectExit.value : undefined;
        const session = Exit.isSuccess(sessionExit) ? sessionExit.value : undefined;
        if (session !== undefined) {
          return makeCurrentContext({
            snapshot,
            source,
            session,
            project: project ?? findProjectForSession(snapshot, session),
            diagnostics: flags.diagnostics,
          });
        }
        return {
          source,
          workspace:
            project !== undefined
              ? compactProject(project, projectActiveSessions(snapshot, project.id))
              : { error: "not_inferred" },
          session: { error: "not_inferred" },
          ...(flags.diagnostics
            ? {
                diagnostics: {
                  cwd: process.cwd(),
                  env: readAmbientEnvSync(),
                  activeSessionIds: activeSessions(snapshot).map((candidate) => candidate.id),
                  projectError: Exit.isFailure(projectExit) ? projectExit.cause.toString() : null,
                  sessionError: Exit.isFailure(sessionExit) ? sessionExit.cause.toString() : null,
                },
              }
            : {}),
        };
      }),
    ),
  ),
);

const contextSummaryCommand = Command.make("summary", {
  ...projectLocationFlags,
  diagnostics: diagnosticsFlag,
  pretty: prettyFlag,
}).pipe(
  Command.withDescription("Show compact project and session context."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.sync(() => {
        const projects = activeProjects(snapshot);
        const sessions = activeSessions(snapshot);
        return {
          source,
          activeProjectCount: projects.length,
          activeSessionCount: sessions.length,
          ...(flags.diagnostics
            ? {
                projects: projects.map((project) => {
                  const projectSessions = sessions.filter(
                    (session) => session.projectId === project.id,
                  );
                  return compactProject(project, projectSessions);
                }),
                sessions: sessions.map(compactSession),
              }
            : {}),
        };
      }),
    ),
  ),
);

export const contextCommand = Command.make("context").pipe(
  Command.withDescription("Read compact orchestration context."),
  Command.withSubcommands([
    contextCurrentCommand,
    contextSessionCommand,
    contextProjectCommand,
    contextSummaryCommand,
  ]),
);
