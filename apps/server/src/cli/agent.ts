import {
  CommandId,
  OrchestrationReadModel,
  ResearchCardArtifactReference,
  ResearchCardId,
  ResearchCardLifecycleStatus,
  ResearchCardType,
  SessionId,
  type ClientOrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationResearchCard,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { isActiveResearchCard } from "@t3tools/shared/researchCards";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
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
  LINCEI_PROJECT_ID_ENV,
  LINCEI_SESSION_ID_ENV,
  LINCEI_WORKSPACE_ROOT_ENV,
} from "../provider/LinceiAmbientEnvironment.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { upsertCardManifest } from "../study/StudyRecordService.ts";

type AgentDispatchCommand = Extract<
  ClientOrchestrationCommand,
  | { type: "session.research-card.propose" }
  | { type: "session.research-card.update" }
  | { type: "session.research-card.review" }
  | { type: "session.research-card.lifecycle" }
  | { type: "session.research-card.supersede" }
>;

type SnapshotSource = "live" | "offline";

class AgentCliError extends Data.TaggedError("AgentCliError")<{
  readonly message: string;
}> {}

const agentCommandUuid = Crypto.Crypto.pipe(
  Effect.flatMap((crypto) => crypto.randomUUIDv4),
  Effect.mapError(
    () =>
      new AgentCliError({
        message: "Failed to generate an agent command identifier.",
      }),
  ),
);

const AGENT_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);

const AgentOfflineReadLayer = Layer.mergeAll(
  WorkspacePathsLive,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolverLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const allFlag = Flag.boolean("all").pipe(
  Flag.withDescription("Include inactive research cards."),
  Flag.withDefault(false),
);

const sessionFlag = Flag.string("session").pipe(
  Flag.withDescription("Session id. Defaults to the current Lincei session when available."),
  Flag.withSchema(SessionId),
  Flag.optional,
);

const cardTypeFlag = Flag.choice("type", ResearchCardType.literals).pipe(
  Flag.withDescription("Research card type."),
  Flag.optional,
);

const cardStatusFlag = Flag.choice("status", ResearchCardLifecycleStatus.literals).pipe(
  Flag.withDescription("Research card lifecycle status."),
  Flag.optional,
);

const previewJsonFlag = Flag.string("preview-json").pipe(
  Flag.withDescription("JSON preview payload."),
  Flag.optional,
);

const previewFlag = Flag.string("preview").pipe(
  Flag.withDescription("Markdown preview text."),
  Flag.optional,
);

const previewFileFlag = Flag.string("preview-file").pipe(
  Flag.withDescription("Path to a markdown or JSON preview file."),
  Flag.optional,
);

const artifactsJsonFlag = Flag.string("artifacts-json").pipe(
  Flag.withDescription("JSON array of artifact references."),
  Flag.optional,
);

const artifactsFileFlag = Flag.string("artifacts-file").pipe(
  Flag.withDescription("Path to a JSON array of artifact references."),
  Flag.optional,
);

const titleFlag = Flag.string("title").pipe(Flag.withDescription("Research card title."));

const optionalTitleFlag = Flag.string("title").pipe(
  Flag.withDescription("Updated research card title."),
  Flag.optional,
);

const noteFlag = Flag.string("note").pipe(
  Flag.withDescription("Optional review request note."),
  Flag.optional,
);

const depFlag = Flag.string("dep").pipe(
  Flag.withDescription("Study-relative dependency path. May be repeated."),
  Flag.atLeast(0),
);

const artifactFlag = Flag.string("artifact").pipe(
  Flag.withDescription("Study-local artifact id to associate with this card. May be repeated."),
  Flag.atLeast(0),
);

const runIdFlag = Flag.string("run-id").pipe(
  Flag.withDescription("Study-local run id that produced or supports this card."),
  Flag.optional,
);

const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeArtifactsJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(ResearchCardArtifactReference)),
);

const parseJsonValue = (raw: string, flagName: string) =>
  decodeUnknownJson(raw).pipe(
    Effect.mapError(
      (cause) =>
        new AgentCliError({
          message: `Invalid ${flagName}: ${String(cause)}`,
        }),
    ),
  );

const parseArtifactsJsonText = (raw: string, sourceName: string) =>
  decodeArtifactsJson(raw).pipe(
    Effect.mapError(
      (cause) =>
        new AgentCliError({
          message: `Invalid ${sourceName}: ${String(cause)}`,
        }),
    ),
  );

const parsePreviewInput = (input: {
  readonly previewJson: Option.Option<string>;
  readonly preview: Option.Option<string>;
  readonly previewFile: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const provided = [
      Option.isSome(input.previewJson),
      Option.isSome(input.preview),
      Option.isSome(input.previewFile),
    ].filter(Boolean).length;
    if (provided > 1) {
      return yield* new AgentCliError({
        message: "Use only one of --preview-json, --preview, or --preview-file.",
      });
    }
    if (Option.isSome(input.previewJson)) {
      return yield* parseJsonValue(input.previewJson.value, "--preview-json");
    }
    if (Option.isSome(input.preview)) {
      return { markdown: input.preview.value };
    }
    if (Option.isSome(input.previewFile)) {
      const previewFile = input.previewFile.value;
      const fs = yield* FileSystem.FileSystem;
      const raw = yield* fs.readFileString(previewFile).pipe(
        Effect.mapError(
          (cause) =>
            new AgentCliError({
              message: `Failed to read --preview-file '${previewFile}': ${String(cause)}`,
            }),
        ),
      );
      return previewFile.endsWith(".json")
        ? yield* parseJsonValue(raw, "--preview-file")
        : { markdown: raw };
    }
    return undefined;
  });

const parseArtifactsInput = (input: {
  readonly artifactsJson: Option.Option<string>;
  readonly artifactsFile: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(input.artifactsJson) && Option.isSome(input.artifactsFile)) {
      return yield* new AgentCliError({
        message: "Use only one of --artifacts-json or --artifacts-file.",
      });
    }
    if (Option.isSome(input.artifactsJson)) {
      return yield* parseArtifactsJsonText(input.artifactsJson.value, "--artifacts-json");
    }
    if (Option.isSome(input.artifactsFile)) {
      const artifactsFile = input.artifactsFile.value;
      const fs = yield* FileSystem.FileSystem;
      const raw = yield* fs.readFileString(artifactsFile).pipe(
        Effect.mapError(
          (cause) =>
            new AgentCliError({
              message: `Failed to read --artifacts-file '${artifactsFile}': ${String(cause)}`,
            }),
        ),
      );
      return yield* parseArtifactsJsonText(raw, "--artifacts-file");
    }
    return [];
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

const dispatchLiveOrchestrationCommand = (
  origin: string,
  bearerToken: string,
  command: AgentDispatchCommand,
) => {
  const request = HttpClientRequest.post(`${origin}/api/orchestration/dispatch`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.bodyJson(command),
  );

  return Effect.flatMap(request, (resolvedRequest) =>
    runLiveServerRequest(
      resolvedRequest,
      HttpClientResponse.matchStatus({
        "2xx": () => Effect.void,
        orElse: (response) =>
          readErrorMessageFromResponse(response).pipe(
            Effect.flatMap((message) => Effect.fail(new AgentCliError({ message }))),
          ),
      }),
    ),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof AgentCliError
        ? error
        : new AgentCliError({ message: "Failed to dispatch orchestration command." }),
    ),
  );
};

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

const runLiveWrite = Effect.fn("runAgentLiveWrite")(function* (
  flags: CliAuthLocationFlags,
  run: (
    snapshot: OrchestrationReadModel,
    dispatch: (
      command: AgentDispatchCommand,
    ) => Effect.Effect<void, AgentCliError, HttpClient.HttpClient>,
  ) => Effect.Effect<
    unknown,
    AgentCliError,
    Crypto.Crypto | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
  >,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);

  if (Option.isNone(runtimeState)) {
    return yield* new AgentCliError({ message: "start the Lincei server first." });
  }

  return yield* Effect.gen(function* () {
    const authControlPlane = yield* AuthControlPlane;
    return yield* withAgentCliSessionToken(authControlPlane, (token) =>
      Effect.gen(function* () {
        const snapshot = yield* fetchLiveOrchestrationSnapshot(runtimeState.value.origin, token);
        return yield* run(snapshot, (command) =>
          dispatchLiveOrchestrationCommand(runtimeState.value.origin, token, command),
        );
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
    Effect.mapError((error) =>
      error instanceof AgentCliError
        ? error
        : new AgentCliError({
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
  const envWorkspaceRoot = yield* readProcessEnv(LINCEI_WORKSPACE_ROOT_ENV);
  const cwd = process.cwd();
  const candidates = [
    Option.getOrUndefined(explicitProject),
    envProjectId,
    envWorkspaceRoot,
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

const findCard = (session: OrchestrationSession, cardId: ResearchCardId) => {
  const card = session.researchCards.find((candidate) => candidate.id === cardId);
  if (!card) {
    return Effect.fail(new AgentCliError({ message: `No research card found for '${cardId}'.` }));
  }
  return Effect.succeed(card);
};

const relevantCards = (session: OrchestrationSession, includeAll: boolean) =>
  includeAll ? session.researchCards : session.researchCards.filter(isActiveResearchCard);

const compactCard = (card: OrchestrationResearchCard) => ({
  id: card.id,
  title: card.title,
  type: card.type,
  status: card.status,
  updatedAt: card.updatedAt,
  artifactCount: card.artifacts.length,
  hasPreview: card.preview !== undefined,
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
  lifecycle: {
    archived: session.archivedAt !== null,
    deleted: session.deletedAt !== null,
    runtimeStatus: session.session?.status ?? null,
  },
});

const compactProject = (
  project: OrchestrationProject,
  sessions: ReadonlyArray<OrchestrationSession>,
) => ({
  id: project.id,
  title: project.title,
  workspaceRoot: project.workspaceRoot,
  repositoryIdentity: project.repositoryIdentity ?? null,
  activeSessionIds: sessions.map((session) => session.id),
  activeSessionCount: sessions.length,
});

const makeSessionContext = (session: OrchestrationSession, includeAll: boolean) => {
  const cards = relevantCards(session, includeAll);
  return {
    ...compactSession(session),
    activeCardIds: session.researchCards.filter(isActiveResearchCard).map((card) => card.id),
    activeCardCount: session.researchCards.filter(isActiveResearchCard).length,
    cards: cards.map(compactCard),
  };
};

const formatOutput = (value: unknown, json: boolean) => {
  if (json) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2);
};

const makeCard = Effect.fn("makeAgentResearchCard")(function* (input: {
  readonly session: OrchestrationSession;
  readonly title: string;
  readonly type: ResearchCardType;
  readonly preview: unknown | undefined;
  readonly artifacts: ReadonlyArray<ResearchCardArtifactReference>;
  readonly status?: ResearchCardLifecycleStatus;
}) {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    return yield* new AgentCliError({ message: "Research card title cannot be empty." });
  }
  const now = DateTime.formatIso(yield* DateTime.now);
  return {
    id: ResearchCardId.make(yield* agentCommandUuid),
    type: input.type,
    status: input.status ?? "proposed",
    title: trimmedTitle,
    ...(input.preview !== undefined ? { preview: input.preview } : {}),
    artifacts: [...input.artifacts],
    provenance: [],
    turnId: input.session.latestTurn?.turnId ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies OrchestrationResearchCard;
});

const updateCard = Effect.fn("updateAgentResearchCard")(function* (input: {
  readonly card: OrchestrationResearchCard;
  readonly title?: string;
  readonly status?: ResearchCardLifecycleStatus;
  readonly preview?: unknown;
  readonly replacePreview: boolean;
  readonly artifacts?: ReadonlyArray<ResearchCardArtifactReference>;
}) {
  const now = DateTime.formatIso(yield* DateTime.now);
  const title = input.title?.trim();
  if (title !== undefined && title.length === 0) {
    return yield* new AgentCliError({ message: "Research card title cannot be empty." });
  }
  return {
    ...input.card,
    ...(title !== undefined ? { title } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.replacePreview ? { preview: input.preview } : {}),
    ...(input.artifacts !== undefined ? { artifacts: [...input.artifacts] } : {}),
    updatedAt: now,
  } satisfies OrchestrationResearchCard;
});

const runReadCommand = (
  flags: CliAuthLocationFlags,
  run: (
    snapshot: OrchestrationReadModel,
    source: SnapshotSource,
  ) => Effect.Effect<unknown, AgentCliError, Path.Path>,
) =>
  Effect.gen(function* () {
    const resolved = yield* resolveReadSnapshot(flags);
    const output = yield* run(resolved.snapshot, resolved.source);
    yield* Console.log(formatOutput(output, "json" in flags && flags.json === true));
  });

const runWriteCommand = (
  flags: CliAuthLocationFlags & { readonly json: boolean },
  run: (
    snapshot: OrchestrationReadModel,
    dispatch: (
      command: AgentDispatchCommand,
    ) => Effect.Effect<void, AgentCliError, HttpClient.HttpClient>,
  ) => Effect.Effect<
    unknown,
    AgentCliError,
    Crypto.Crypto | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
  >,
) =>
  Effect.gen(function* () {
    const output = yield* runLiveWrite(flags, run);
    yield* Console.log(formatOutput(output, flags.json));
  });

const resolveStudyRootForSession = (
  snapshot: OrchestrationReadModel,
  session: OrchestrationSession,
) =>
  Effect.gen(function* () {
    const project = snapshot.projects.find(
      (candidate) => candidate.id === session.projectId && candidate.deletedAt === null,
    );
    if (!project) {
      return yield* new AgentCliError({
        message: `Project ${session.projectId} was not found for session ${session.id}.`,
      });
    }
    return project.workspaceRoot;
  });

const persistCardStudyManifest = (input: {
  readonly snapshot: OrchestrationReadModel;
  readonly session: OrchestrationSession;
  readonly card: OrchestrationResearchCard;
  readonly deps: ReadonlyArray<string>;
  readonly artifactIds: ReadonlyArray<string>;
  readonly artifacts: ReadonlyArray<ResearchCardArtifactReference>;
  readonly runId: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const studyRoot = yield* resolveStudyRootForSession(input.snapshot, input.session);
    yield* Effect.tryPromise({
      try: () =>
        upsertCardManifest({
          studyRoot,
          card: input.card,
          deps: input.deps,
          artifactIds: input.artifactIds,
          artifacts: input.artifacts,
          ...(Option.isSome(input.runId) ? { runId: input.runId.value } : {}),
        }),
      catch: (cause) =>
        new AgentCliError({
          message:
            cause instanceof Error
              ? `Failed to persist study card manifest: ${cause.message}`
              : "Failed to persist study card manifest.",
        }),
    });
  });

const cardListCommand = Command.make("list", {
  ...projectLocationFlags,
  session: sessionFlag,
  all: allFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List research cards for a session."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        return relevantCards(session, flags.all).map(compactCard);
      }),
    ),
  ),
);

const cardContextCommand = Command.make("context", {
  ...projectLocationFlags,
  session: sessionFlag,
  all: allFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show compact research-card context for a session."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        return {
          source,
          session: makeSessionContext(session, flags.all),
        };
      }),
    ),
  ),
);

const cardProposeCommand = Command.make("propose", {
  ...projectLocationFlags,
  session: sessionFlag,
  title: titleFlag,
  type: cardTypeFlag,
  previewJson: previewJsonFlag,
  preview: previewFlag,
  previewFile: previewFileFlag,
  artifactsJson: artifactsJsonFlag,
  artifactsFile: artifactsFileFlag,
  dep: depFlag,
  artifact: artifactFlag,
  runId: runIdFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Propose a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        const preview = yield* parsePreviewInput(flags);
        const artifacts = yield* parseArtifactsInput(flags);
        const card = yield* makeCard({
          session,
          title: flags.title,
          type: Option.getOrElse(flags.type, () => "markdown" as const),
          preview,
          artifacts,
        });
        yield* persistCardStudyManifest({
          snapshot,
          session,
          card,
          deps: flags.dep,
          artifactIds: flags.artifact,
          artifacts,
          runId: flags.runId,
        });
        yield* dispatch({
          type: "session.research-card.propose",
          commandId: CommandId.make(yield* agentCommandUuid),
          sessionId: session.id,
          researchCard: card,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        return { card: compactCard(card) };
      }),
    ),
  ),
);

const cardUpdateCommand = Command.make("update", {
  ...projectLocationFlags,
  cardId: Argument.string("card-id").pipe(Argument.withSchema(ResearchCardId)),
  session: sessionFlag,
  title: optionalTitleFlag,
  status: cardStatusFlag,
  previewJson: previewJsonFlag,
  preview: previewFlag,
  previewFile: previewFileFlag,
  artifactsJson: artifactsJsonFlag,
  artifactsFile: artifactsFileFlag,
  dep: depFlag,
  artifact: artifactFlag,
  runId: runIdFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Update a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        const existing = yield* findCard(session, flags.cardId);
        const preview = yield* parsePreviewInput(flags);
        const artifacts = yield* parseArtifactsInput(flags);
        const shouldReplacePreview =
          Option.isSome(flags.previewJson) ||
          Option.isSome(flags.preview) ||
          Option.isSome(flags.previewFile);
        const card = yield* updateCard({
          card: existing,
          ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}),
          ...(Option.isSome(flags.status) ? { status: flags.status.value } : {}),
          preview,
          replacePreview: shouldReplacePreview,
          ...(Option.isSome(flags.artifactsJson) || Option.isSome(flags.artifactsFile)
            ? { artifacts }
            : {}),
        });
        yield* persistCardStudyManifest({
          snapshot,
          session,
          card,
          deps: flags.dep,
          artifactIds: flags.artifact,
          artifacts: card.artifacts,
          runId: flags.runId,
        });
        yield* dispatch({
          type: "session.research-card.update",
          commandId: CommandId.make(yield* agentCommandUuid),
          sessionId: session.id,
          cardId: flags.cardId,
          researchCard: card,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        return { card: compactCard(card) };
      }),
    ),
  ),
);

const cardRequestReviewCommand = Command.make("request-review", {
  ...projectLocationFlags,
  cardId: Argument.string("card-id").pipe(Argument.withSchema(ResearchCardId)),
  session: sessionFlag,
  note: noteFlag,
  dep: depFlag,
  artifact: artifactFlag,
  runId: runIdFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Attach a review request to a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        const now = DateTime.formatIso(yield* DateTime.now);
        const existing = yield* findCard(session, flags.cardId);
        const reviewPrompt = Option.getOrElse(flags.note, () => "Review this research card.");
        const reviewedCard = {
          ...existing,
          status: "review-requested" as const,
          updatedAt: now,
          ...(existing.review === undefined
            ? {
                review: {
                  prompt: reviewPrompt,
                  actions: [
                    { id: "accept", label: "Accept" },
                    { id: "changes-requested", label: "Request changes" },
                    { id: "reject", label: "Reject" },
                  ],
                },
              }
            : {}),
        };
        yield* persistCardStudyManifest({
          snapshot,
          session,
          card: reviewedCard,
          deps: flags.dep,
          artifactIds: flags.artifact,
          artifacts: reviewedCard.artifacts,
          runId: flags.runId,
        });
        yield* dispatch({
          type: "session.research-card.lifecycle",
          commandId: CommandId.make(yield* agentCommandUuid),
          sessionId: session.id,
          cardId: flags.cardId,
          action: "request_review",
          ...(Option.isSome(flags.note) ? { note: flags.note.value } : {}),
          createdAt: now,
        });
        if (existing.review === undefined) {
          yield* dispatch({
            type: "session.research-card.update",
            commandId: CommandId.make(yield* agentCommandUuid),
            sessionId: session.id,
            cardId: flags.cardId,
            researchCard: {
              ...reviewedCard,
              review: reviewedCard.review,
            },
            createdAt: now,
          });
        }
        return {
          card: compactCard({
            ...existing,
            status: "review-requested",
            updatedAt: now,
          }),
        };
      }),
    ),
  ),
);

const cardSupersedeCommand = Command.make("supersede", {
  ...projectLocationFlags,
  oldCardId: Argument.string("old-card-id").pipe(Argument.withSchema(ResearchCardId)),
  session: sessionFlag,
  title: titleFlag,
  type: cardTypeFlag,
  previewJson: previewJsonFlag,
  preview: previewFlag,
  previewFile: previewFileFlag,
  artifactsJson: artifactsJsonFlag,
  artifactsFile: artifactsFileFlag,
  dep: depFlag,
  artifact: artifactFlag,
  runId: runIdFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Supersede a research card with a new proposal."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        const oldCard = yield* findCard(session, flags.oldCardId);
        const preview = yield* parsePreviewInput(flags);
        const artifacts = yield* parseArtifactsInput(flags);
        const newCard = yield* makeCard({
          session,
          title: flags.title,
          type: Option.getOrElse(flags.type, () => oldCard.type),
          preview,
          artifacts,
        });
        yield* persistCardStudyManifest({
          snapshot,
          session,
          card: newCard,
          deps: flags.dep,
          artifactIds: flags.artifact,
          artifacts,
          runId: flags.runId,
        });
        yield* dispatch({
          type: "session.research-card.supersede",
          commandId: CommandId.make(yield* agentCommandUuid),
          sessionId: session.id,
          cardId: flags.oldCardId,
          replacementCard: newCard,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        return { supersededCardId: flags.oldCardId, card: compactCard(newCard) };
      }),
    ),
  ),
);

export const cardCommand = Command.make("card").pipe(
  Command.withDescription("Manage research cards."),
  Command.withSubcommands([
    cardListCommand,
    cardContextCommand,
    cardProposeCommand,
    cardUpdateCommand,
    cardRequestReviewCommand,
    cardSupersedeCommand,
  ]),
);

const contextSessionCommand = Command.make("session", {
  ...projectLocationFlags,
  session: sessionFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show compact context for a session."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const session = yield* resolveSessionTarget(snapshot, flags.session);
        return { source, session: makeSessionContext(session, true) };
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
  json: jsonFlag,
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
        return { source, project: compactProject(project, sessions) };
      }),
    ),
  ),
);

const contextCurrentCommand = Command.make("current", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show inferred current Lincei session and project context."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const envSessionId = yield* readProcessEnv(LINCEI_SESSION_ID_ENV);
        const envProjectId = yield* readProcessEnv(LINCEI_PROJECT_ID_ENV);
        const envWorkspaceRoot = yield* readProcessEnv(LINCEI_WORKSPACE_ROOT_ENV);
        const projectExit = yield* Effect.exit(resolveProjectTarget(snapshot, Option.none()));
        const sessionExit = yield* Effect.exit(resolveSessionTarget(snapshot, Option.none()));
        return {
          source,
          cwd: process.cwd(),
          env: {
            sessionId: envSessionId ?? null,
            projectId: envProjectId ?? null,
            workspaceRoot: envWorkspaceRoot ?? null,
          },
          project: Exit.isSuccess(projectExit)
            ? compactProject(
                projectExit.value,
                activeSessions(snapshot).filter(
                  (session) => session.projectId === projectExit.value.id,
                ),
              )
            : { error: "Could not infer current project." },
          session: Exit.isSuccess(sessionExit)
            ? makeSessionContext(sessionExit.value, true)
            : { error: "Could not infer current session." },
        };
      }),
    ),
  ),
);

const contextSummaryCommand = Command.make("summary", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show compact project and session context."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.succeed({
        source,
        activeProjectCount: snapshot.projects.filter((project) => project.deletedAt === null)
          .length,
        activeSessionCount: snapshot.sessions.filter(
          (session) => session.archivedAt === null && session.deletedAt === null,
        ).length,
        projects: snapshot.projects
          .filter((project) => project.deletedAt === null)
          .map((project) => {
            const sessions = snapshot.sessions.filter(
              (session) =>
                session.projectId === project.id &&
                session.archivedAt === null &&
                session.deletedAt === null,
            );
            return compactProject(project, sessions);
          }),
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
