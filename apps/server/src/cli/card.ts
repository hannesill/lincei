import {
  CommandId,
  OrchestrationReadModel,
  ResearchCardId,
  SessionId,
  type ClientOrchestrationCommand,
  type OrchestrationResearchCard,
  type ResearchCardArtifactReference,
  type ResearchCardLifecycleStatus,
  type ResearchCardType,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import {
  clearPersistedServerRuntimeState,
  readPersistedServerRuntimeState,
} from "../serverRuntimeState.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

type CardCliDispatchCommand = Extract<
  ClientOrchestrationCommand,
  {
    type:
      | "session.research-card.propose"
      | "session.research-card.update"
      | "session.research-card.review"
      | "session.research-card.lifecycle"
      | "session.research-card.supersede";
  }
>;

type CardCommandExecutionMode = "live" | "offline";

class CardCommandError extends Data.TaggedError("CardCommandError")<{
  readonly message: string;
}> {}

const CardCliRuntimeLive = Layer.mergeAll(
  WorkspacePathsLive,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolverLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const CARD_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);
const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const withCardCliSessionToken = <A, E, R>(
  authControlPlane: AuthControlPlaneShape,
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    authControlPlane.issueSession({
      role: "owner",
      label: "t3 card cli",
    }),
    (issued) => run(issued.token),
    (issued) => authControlPlane.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const runLiveServerRequest = <A, E extends Error, R>(
  request: HttpClientRequest.HttpClientRequest,
  handle: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.execute(request);
    return yield* handle(response);
  }).pipe(Effect.timeout(CARD_CLI_LIVE_SERVER_TIMEOUT));

const readErrorMessageFromResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationHttpErrorResponse)(response).pipe(
    Effect.map((body) => body.error),
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((body) =>
      typeof body === "string" && body.trim().length > 0
        ? body
        : `Server request failed with status ${response.status}.`,
    ),
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
            (cause) =>
              new CardCommandError({
                message: `Invalid orchestration snapshot response: ${String(cause)}`,
              }),
          ),
        ),
      orElse: (response) =>
        readErrorMessageFromResponse(response).pipe(
          Effect.flatMap((message) => Effect.fail(new CardCommandError({ message }))),
        ),
    }),
  );

const dispatchLiveOrchestrationCommand = (
  origin: string,
  bearerToken: string,
  command: CardCliDispatchCommand,
) =>
  HttpClientRequest.post(`${origin}/api/orchestration/dispatch`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.bodyJson(command),
    Effect.flatMap((request) =>
      runLiveServerRequest(
        request,
        HttpClientResponse.matchStatus({
          "2xx": () => Effect.void,
          orElse: (response) =>
            readErrorMessageFromResponse(response).pipe(
              Effect.flatMap((message) => Effect.fail(new CardCommandError({ message }))),
            ),
        }),
      ),
    ),
  );

const getOfflineSnapshot = Effect.fn("getOfflineSnapshot")(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  return yield* projectionSnapshotQuery.getSnapshot();
});

const tryResolveLiveCardExecutionMode = Effect.fn("tryResolveLiveCardExecutionMode")(function* (
  authControlPlane: AuthControlPlaneShape,
  config: ServerConfigShape,
) {
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return Option.none<{ readonly origin: string }>();
  }

  const attempt = withCardCliSessionToken(authControlPlane, (token) =>
    fetchLiveOrchestrationSnapshot(runtimeState.value.origin, token).pipe(
      Effect.as({
        origin: runtimeState.value.origin,
      }),
    ),
  );

  const attempted = yield* Effect.exit(attempt);
  if (Exit.isSuccess(attempted)) {
    return Option.some(attempted.value);
  }

  yield* clearPersistedServerRuntimeState(config.serverRuntimeStatePath);
  return Option.none<{ readonly origin: string }>();
});

const runCardCommand = Effect.fn("runCardCommand")(function* (
  flags: CliAuthLocationFlags,
  run: (input: {
    readonly snapshot: OrchestrationReadModel;
    readonly dispatch: (
      command: CardCliDispatchCommand,
    ) => Effect.Effect<void, Error, HttpClient.HttpClient>;
    readonly mode: CardCommandExecutionMode;
  }) => Effect.Effect<string, Error, HttpClient.HttpClient | Path.Path>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;

  return yield* Effect.gen(function* () {
    const authControlPlane = yield* AuthControlPlane;
    const liveMode = yield* tryResolveLiveCardExecutionMode(authControlPlane, config);

    if (Option.isSome(liveMode)) {
      return yield* withCardCliSessionToken(authControlPlane, (token) =>
        Effect.gen(function* () {
          const snapshot = yield* fetchLiveOrchestrationSnapshot(liveMode.value.origin, token);
          const output = yield* run({
            snapshot,
            dispatch: (command) =>
              dispatchLiveOrchestrationCommand(liveMode.value.origin, token, command),
            mode: "live",
          });
          yield* Console.log(output);
        }),
      );
    }

    const offlineRuntimeLayer = CardCliRuntimeLive.pipe(
      Layer.provide(Layer.succeed(ServerConfig, config)),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
    );

    return yield* Effect.gen(function* () {
      const snapshot = yield* getOfflineSnapshot();
      const orchestrationEngine = yield* OrchestrationEngineService;
      const output = yield* run({
        snapshot,
        dispatch: (command) => orchestrationEngine.dispatch(command).pipe(Effect.asVoid),
        mode: "offline",
      });
      yield* Console.log(output);
    }).pipe(Effect.provide(offlineRuntimeLayer));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(AuthControlPlaneRuntimeLive).pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(ServerConfig, config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      ),
    ),
  );
});

const findSession = (snapshot: OrchestrationReadModel, sessionId: string) => {
  const trimmed = sessionId.trim();
  return snapshot.sessions.find((session) => session.id === trimmed && session.deletedAt === null);
};

const requireSession = Effect.fn("requireSession")(function* (
  snapshot: OrchestrationReadModel,
  sessionId: string,
) {
  const session = findSession(snapshot, sessionId);
  if (!session) {
    return yield* new CardCommandError({ message: `Session '${sessionId}' was not found.` });
  }
  return session;
});

const requireCard = Effect.fn("requireCard")(function* (
  snapshot: OrchestrationReadModel,
  sessionId: string,
  cardId: string,
) {
  const session = yield* requireSession(snapshot, sessionId);
  const card = session.researchCards.find((entry) => entry.id === cardId);
  if (!card) {
    return yield* new CardCommandError({
      message: `Card '${cardId}' was not found in session '${sessionId}'.`,
    });
  }
  return card;
});

function activeCards(cards: ReadonlyArray<OrchestrationResearchCard>) {
  return cards.filter(
    (card) =>
      card.status !== "dismissed" && card.status !== "rejected" && card.status !== "superseded",
  );
}

function formatCards(cards: ReadonlyArray<OrchestrationResearchCard>, json: boolean): string {
  if (json) {
    return JSON.stringify({ cards }, null, 2);
  }
  if (cards.length === 0) {
    return "No research cards.";
  }
  return cards.map((card) => `${card.id}\t${card.status}\t${card.type}\t${card.title}`).join("\n");
}

function formatCard(card: OrchestrationResearchCard, json: boolean): string {
  if (json) {
    return JSON.stringify({ card }, null, 2);
  }
  return `${card.id}\t${card.status}\t${card.type}\t${card.title}`;
}

function parseJsonFlag<T>(
  label: string,
  value: Option.Option<string>,
): Effect.Effect<T | undefined, CardCommandError> {
  if (Option.isNone(value)) {
    return Effect.void.pipe(Effect.as(undefined as T | undefined));
  }
  return Effect.try({
    try: () => JSON.parse(value.value) as T,
    catch: (cause) =>
      new CardCommandError({
        message: `${label} must be valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

const normalizeWorkspaceRelativePath = (
  path: Path.Path,
  workspaceRoot: string,
  referencePath: string,
) => {
  const trimmed = referencePath.trim();
  if (trimmed.length === 0 || path.isAbsolute(trimmed)) {
    return null;
  }
  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }
  const resolved = path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return normalized;
};

const parseArtifacts = Effect.fn("parseArtifacts")(function* (
  workspaceRoot: string,
  artifactsJson: Option.Option<string>,
) {
  const artifacts =
    (yield* parseJsonFlag<ResearchCardArtifactReference[]>("artifacts-json", artifactsJson)) ?? [];
  const path = yield* Path.Path;
  const normalizedArtifacts: ResearchCardArtifactReference[] = [];
  for (const artifact of artifacts) {
    if (artifact.path === undefined) {
      normalizedArtifacts.push(artifact);
      continue;
    }
    const normalizedPath = normalizeWorkspaceRelativePath(path, workspaceRoot, artifact.path);
    if (normalizedPath === null) {
      return yield* new CardCommandError({
        message: `Artifact path '${artifact.path}' must be a workspace-relative path.`,
      });
    }
    normalizedArtifacts.push({
      ...artifact,
      path: normalizedPath,
    });
  }
  return normalizedArtifacts;
});

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Print machine-readable JSON."));
const allFlag = Flag.boolean("all").pipe(
  Flag.withDescription("Include dismissed, rejected, and superseded cards."),
);
const sessionFlag = Flag.string("session").pipe(Flag.withDescription("Target session id."));
const typeFlag = Flag.string("type").pipe(
  Flag.withDescription("Research card type."),
  Flag.withDefault("markdown"),
);
const previewJsonFlag = Flag.string("preview-json").pipe(
  Flag.withDescription("JSON preview payload for the card."),
  Flag.optional,
);
const artifactsJsonFlag = Flag.string("artifacts-json").pipe(
  Flag.withDescription("JSON array of artifact references."),
  Flag.optional,
);

const cardListCommand = Command.make("list", {
  ...projectLocationFlags,
  session: sessionFlag,
  all: allFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List research cards for a session."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardList")(function* ({ snapshot }) {
        const session = yield* requireSession(snapshot, flags.session);
        const cards = flags.all ? session.researchCards : activeCards(session.researchCards);
        return formatCards(cards, flags.json);
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
  Command.withDescription("Print research card context for a session."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardContext")(function* ({ snapshot }) {
        const session = yield* requireSession(snapshot, flags.session);
        const cards = flags.all ? session.researchCards : activeCards(session.researchCards);
        if (flags.json) {
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          return JSON.stringify(
            {
              session: {
                id: session.id,
                title: session.title,
                projectId: session.projectId,
              },
              cards,
            },
            null,
            2,
          );
        }
        return [`Session: ${session.title} (${session.id})`, "", formatCards(cards, false)].join(
          "\n",
        );
      }),
    ),
  ),
);

const cardProposeCommand = Command.make("propose", {
  ...projectLocationFlags,
  session: sessionFlag,
  title: Flag.string("title").pipe(Flag.withDescription("Card title.")),
  type: typeFlag,
  previewJson: previewJsonFlag,
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Propose an evidence-backed research card."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardPropose")(function* ({ snapshot, dispatch }) {
        const session = yield* requireSession(snapshot, flags.session);
        const timestamp = yield* nowIso;
        const artifacts = yield* parseArtifacts(
          session.worktreePath ??
            snapshot.projects.find((project) => project.id === session.projectId)?.workspaceRoot ??
            ".",
          flags.artifactsJson,
        );
        const preview = yield* parseJsonFlag<unknown>("preview-json", flags.previewJson);
        const card: OrchestrationResearchCard = {
          id: ResearchCardId.make(crypto.randomUUID()),
          type: flags.type as ResearchCardType,
          status: "proposed",
          title: flags.title,
          ...(preview !== undefined ? { preview } : {}),
          artifacts,
          provenance: [
            {
              sessionId: session.id,
              ...(session.latestTurn?.turnId !== undefined
                ? { turnId: session.latestTurn.turnId }
                : {}),
              timestamp,
            },
          ],
          turnId: session.latestTurn?.turnId ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        yield* dispatch({
          type: "session.research-card.propose",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: session.id,
          researchCard: card,
          createdAt: timestamp,
        });
        return formatCard(card, flags.json);
      }),
    ),
  ),
);

const cardUpdateCommand = Command.make("update", {
  ...projectLocationFlags,
  cardId: Argument.string("card-id"),
  session: sessionFlag,
  title: Flag.string("title").pipe(Flag.withDescription("Updated card title."), Flag.optional),
  status: Flag.string("status").pipe(
    Flag.withDescription("Updated lifecycle status."),
    Flag.optional,
  ),
  previewJson: previewJsonFlag,
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Update an existing research card."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardUpdate")(function* ({ snapshot, dispatch }) {
        const session = yield* requireSession(snapshot, flags.session);
        const current = yield* requireCard(snapshot, flags.session, flags.cardId);
        const timestamp = yield* nowIso;
        const preview = yield* parseJsonFlag<unknown>("preview-json", flags.previewJson);
        const artifactPatch = yield* parseArtifacts(
          session.worktreePath ??
            snapshot.projects.find((project) => project.id === session.projectId)?.workspaceRoot ??
            ".",
          flags.artifactsJson,
        );
        const card: OrchestrationResearchCard = {
          ...current,
          ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}),
          ...(Option.isSome(flags.status)
            ? { status: flags.status.value as ResearchCardLifecycleStatus }
            : {}),
          ...(preview !== undefined ? { preview } : {}),
          ...(Option.isSome(flags.artifactsJson) ? { artifacts: artifactPatch } : {}),
          updatedAt: timestamp,
        };
        yield* dispatch({
          type: "session.research-card.update",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: session.id,
          cardId: current.id,
          researchCard: card,
          createdAt: timestamp,
        });
        return formatCard(card, flags.json);
      }),
    ),
  ),
);

const cardRequestReviewCommand = Command.make("request-review", {
  ...projectLocationFlags,
  cardId: Argument.string("card-id"),
  session: sessionFlag,
  note: Flag.string("note").pipe(Flag.withDescription("Optional review note."), Flag.optional),
  json: jsonFlag,
}).pipe(
  Command.withDescription("Request human review for a research card."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardRequestReview")(function* ({ snapshot, dispatch }) {
        const card = yield* requireCard(snapshot, flags.session, flags.cardId);
        const timestamp = yield* nowIso;
        yield* dispatch({
          type: "session.research-card.lifecycle",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: SessionId.make(flags.session),
          cardId: card.id,
          action: "request_review",
          ...(Option.isSome(flags.note) ? { note: flags.note.value } : {}),
          createdAt: timestamp,
        });
        return formatCard(
          { ...card, status: "review-requested", updatedAt: timestamp },
          flags.json,
        );
      }),
    ),
  ),
);

const cardSupersedeCommand = Command.make("supersede", {
  ...projectLocationFlags,
  cardId: Argument.string("old-card-id"),
  session: sessionFlag,
  title: Flag.string("title").pipe(Flag.withDescription("Replacement card title.")),
  type: typeFlag,
  previewJson: previewJsonFlag,
  artifactsJson: artifactsJsonFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Supersede a research card with a replacement card."),
  Command.withHandler((flags) =>
    runCardCommand(
      flags,
      Effect.fn("cardSupersede")(function* ({ snapshot, dispatch }) {
        const session = yield* requireSession(snapshot, flags.session);
        yield* requireCard(snapshot, flags.session, flags.cardId);
        const timestamp = yield* nowIso;
        const artifacts = yield* parseArtifacts(
          session.worktreePath ??
            snapshot.projects.find((project) => project.id === session.projectId)?.workspaceRoot ??
            ".",
          flags.artifactsJson,
        );
        const preview = yield* parseJsonFlag<unknown>("preview-json", flags.previewJson);
        const replacementCard: OrchestrationResearchCard = {
          id: ResearchCardId.make(crypto.randomUUID()),
          type: flags.type as ResearchCardType,
          status: "proposed",
          title: flags.title,
          ...(preview !== undefined ? { preview } : {}),
          artifacts,
          provenance: [
            {
              sessionId: session.id,
              ...(session.latestTurn?.turnId !== undefined
                ? { turnId: session.latestTurn.turnId }
                : {}),
              timestamp,
            },
          ],
          turnId: session.latestTurn?.turnId ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        yield* dispatch({
          type: "session.research-card.supersede",
          commandId: CommandId.make(crypto.randomUUID()),
          sessionId: session.id,
          cardId: ResearchCardId.make(flags.cardId),
          replacementCard,
          createdAt: timestamp,
        });
        return formatCard(replacementCard, flags.json);
      }),
    ),
  ),
);

export const cardCommand = Command.make("card").pipe(
  Command.withDescription("Manage Lincei research cards."),
  Command.withSubcommands([
    cardProposeCommand,
    cardUpdateCommand,
    cardRequestReviewCommand,
    cardSupersedeCommand,
    cardListCommand,
    cardContextCommand,
  ]),
);
