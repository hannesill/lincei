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
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
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
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

type AgentDispatchCommand = Extract<
  ClientOrchestrationCommand,
  | { type: "session.research-card.propose" }
  | { type: "session.research-card.update" }
  | { type: "session.research-card.review" }
>;

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

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const allFlag = Flag.boolean("all").pipe(
  Flag.withDescription("Include inactive research cards."),
  Flag.withDefault(false),
);

const sessionFlag = Flag.string("session").pipe(
  Flag.withDescription("Session id."),
  Flag.withSchema(SessionId),
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

const artifactsJsonFlag = Flag.string("artifacts-json").pipe(
  Flag.withDescription("JSON array of artifact references."),
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

const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeArtifactsJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(ResearchCardArtifactReference)),
);

const parsePreviewJson = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => Effect.void,
    onSome: (raw) =>
      decodeUnknownJson(raw).pipe(
        Effect.mapError(
          (cause) =>
            new AgentCliError({
              message: `Invalid --preview-json: ${String(cause)}`,
            }),
        ),
      ),
  });

const parseArtifactsJson = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => Effect.succeed([]),
    onSome: (raw) =>
      decodeArtifactsJson(raw).pipe(
        Effect.mapError(
          (cause) =>
            new AgentCliError({
              message: `Invalid --artifacts-json: ${String(cause)}`,
            }),
        ),
      ),
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
  ) => Effect.Effect<unknown, AgentCliError, HttpClient.HttpClient>,
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

const findCard = (session: OrchestrationSession, cardId: ResearchCardId) => {
  const card = session.researchCards.find((candidate) => candidate.id === cardId);
  if (!card) {
    return Effect.fail(new AgentCliError({ message: `No research card found for '${cardId}'.` }));
  }
  return Effect.succeed(card);
};

const isActiveCard = (card: OrchestrationResearchCard) =>
  card.status === "proposed" || card.status === "changes-requested";

const relevantCards = (session: OrchestrationSession, includeAll: boolean) =>
  includeAll ? session.researchCards : session.researchCards.filter(isActiveCard);

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
    activeCardIds: session.researchCards.filter(isActiveCard).map((card) => card.id),
    activeCardCount: session.researchCards.filter(isActiveCard).length,
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
    id: ResearchCardId.make(crypto.randomUUID()),
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
  ) => Effect.Effect<unknown, AgentCliError, HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const output = yield* runLiveWrite(flags, run);
    yield* Console.log(formatOutput(output, flags.json));
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
        const session = yield* findSession(snapshot, flags.session);
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
        const session = yield* findSession(snapshot, flags.session);
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
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Propose a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* findSession(snapshot, flags.session);
        const preview = yield* parsePreviewJson(flags.previewJson);
        const artifacts = yield* parseArtifactsJson(flags.artifactsJson);
        const card = yield* makeCard({
          session,
          title: flags.title,
          type: Option.getOrElse(flags.type, () => "markdown" as const),
          preview,
          artifacts,
        });
        yield* dispatch({
          type: "session.research-card.propose",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: flags.session,
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
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Update a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* findSession(snapshot, flags.session);
        const existing = yield* findCard(session, flags.cardId);
        const preview = yield* parsePreviewJson(flags.previewJson);
        const artifacts = yield* parseArtifactsJson(flags.artifactsJson);
        const card = yield* updateCard({
          card: existing,
          ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}),
          ...(Option.isSome(flags.status) ? { status: flags.status.value } : {}),
          preview,
          replacePreview: Option.isSome(flags.previewJson),
          ...(Option.isSome(flags.artifactsJson) ? { artifacts } : {}),
        });
        yield* dispatch({
          type: "session.research-card.update",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: flags.session,
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
  json: jsonFlag,
}).pipe(
  Command.withDescription("Attach a review request to a research card."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* findSession(snapshot, flags.session);
        const existing = yield* findCard(session, flags.cardId);
        const now = DateTime.formatIso(yield* DateTime.now);
        const card = {
          ...existing,
          review: {
            prompt: Option.getOrElse(flags.note, () => "Review this research card."),
            actions: [
              { id: "accept", label: "Accept" },
              { id: "changes-requested", label: "Request changes" },
              { id: "reject", label: "Reject" },
            ],
          },
          updatedAt: now,
        } satisfies OrchestrationResearchCard;
        yield* dispatch({
          type: "session.research-card.update",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: flags.session,
          cardId: flags.cardId,
          researchCard: card,
          createdAt: now,
        });
        return { card: compactCard(card) };
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
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Supersede a research card with a new proposal."),
  Command.withHandler((flags) =>
    runWriteCommand(flags, (snapshot, dispatch) =>
      Effect.gen(function* () {
        const session = yield* findSession(snapshot, flags.session);
        const oldCard = yield* findCard(session, flags.oldCardId);
        const preview = yield* parsePreviewJson(flags.previewJson);
        const artifacts = yield* parseArtifactsJson(flags.artifactsJson);
        const rejectedOldCard = yield* updateCard({
          card: oldCard,
          status: "rejected",
          replacePreview: false,
        });
        const newCard = yield* makeCard({
          session,
          title: flags.title,
          type: Option.getOrElse(flags.type, () => oldCard.type),
          preview,
          artifacts,
        });
        yield* dispatch({
          type: "session.research-card.update",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: flags.session,
          cardId: flags.oldCardId,
          researchCard: rejectedOldCard,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        yield* dispatch({
          type: "session.research-card.propose",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: flags.session,
          researchCard: newCard,
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
        const session = yield* findSession(snapshot, flags.session);
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
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show compact context for a project."),
  Command.withHandler((flags) =>
    runReadCommand(flags, (snapshot, source) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const projectInput = flags.project.trim();
        const projectPath = projectInput.length > 0 ? path.resolve(projectInput) : projectInput;
        const project = snapshot.projects.find(
          (candidate) =>
            candidate.deletedAt === null &&
            (candidate.id === projectInput ||
              candidate.workspaceRoot === projectInput ||
              candidate.workspaceRoot === projectPath),
        );
        if (!project) {
          return yield* new AgentCliError({
            message: `No active project found for '${flags.project}'.`,
          });
        }
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
  Command.withSubcommands([contextSessionCommand, contextProjectCommand, contextSummaryCommand]),
);
