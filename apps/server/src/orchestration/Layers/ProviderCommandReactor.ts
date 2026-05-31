import {
  type ChatAttachment,
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationEvent,
  ProviderDriverKind,
  type ProjectId,
  type OrchestrationProviderRuntime,
  SessionId,
  type ProviderSession,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveSessionWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "session.runtime-mode-set"
      | "session.turn-start-requested"
      | "session.turn-interrupt-requested"
      | "session.approval-response-requested"
      | "session.user-input-response-requested"
      | "session.session-stop-requested";
  }
>;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationProviderRuntime["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const DEFAULT_THREAD_TITLE = "New session";

export function providerErrorLabel(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

export function providerErrorLabelFromInstanceHint(input: {
  readonly instanceId?: string | undefined;
  readonly modelSelectionInstanceId?: string | undefined;
  readonly sessionProvider?: string | undefined;
}): string {
  return providerErrorLabel(
    input.instanceId ?? input.modelSelectionInstanceId ?? input.sessionProvider,
  );
}

function canReplaceSessionTitle(currentTitle: string, titleSeed?: string): boolean {
  const trimmedCurrentTitle = currentTitle.trim();
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) {
    return true;
  }

  const trimmedTitleSeed = titleSeed?.trim();
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false;
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return isProviderAdapterRequestError(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const gitWorkflow = yield* GitWorkflowService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const sessionModelSelections = new Map<string, ModelSelection>();

  const appendProviderFailureActivity = (input: {
    readonly sessionId: SessionId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("provider-failure-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "session.activity.append",
          commandId,
          sessionId: input.sessionId,
          activity: {
            id: eventId,
            tone: "error",
            kind: input.kind,
            summary: input.summary,
            payload: {
              detail: input.detail,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const formatFailureDetail = (cause: Cause.Cause<unknown>): string => {
    const failReason = cause.reasons.find(Cause.isFailReason);
    const providerError = isProviderAdapterRequestError(failReason?.error)
      ? failReason.error
      : undefined;
    if (providerError) {
      return providerError.detail;
    }
    return Cause.pretty(cause);
  };

  const setProviderRuntime = (input: {
    readonly sessionId: SessionId;
    readonly session: OrchestrationProviderRuntime;
    readonly createdAt: string;
  }) =>
    serverCommandId("provider-session-set").pipe(
      Effect.flatMap((commandId) =>
        orchestrationEngine.dispatch({
          type: "session.session.set",
          commandId,
          sessionId: input.sessionId,
          session: input.session,
          createdAt: input.createdAt,
        }),
      ),
    );

  const setProviderRuntimeErrorOnTurnStartFailure = Effect.fnUntraced(function* (input: {
    readonly sessionId: SessionId;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const targetSession = yield* resolveSession(input.sessionId);
    const providerRuntime = targetSession?.session;
    if (!providerRuntime) {
      return;
    }
    yield* setProviderRuntime({
      sessionId: input.sessionId,
      session: {
        ...providerRuntime,
        status: providerRuntime.status === "stopped" ? "stopped" : "ready",
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    return yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveSession = Effect.fnUntraced(function* (sessionId: SessionId) {
    return yield* projectionSnapshotQuery
      .getSessionDetailById(sessionId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const ensureSessionForSession = Effect.fn("ensureSessionForSession")(function* (
    sessionId: SessionId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
    },
  ) {
    const session = yield* resolveSession(sessionId);
    if (!session) {
      return yield* Effect.die(new Error(`Session '${sessionId}' was not found in read model.`));
    }

    const desiredRuntimeMode = session.runtimeMode;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (sessionId: SessionId) =>
      providerService
        .listSessions()
        .pipe(
          Effect.map((sessions) => sessions.find((session) => session.sessionId === sessionId)),
        );

    const activeSession = yield* resolveActiveSession(sessionId);
    const activeProviderRuntime =
      session.session !== null && session.session.status !== "stopped" && activeSession
        ? session.session
        : null;
    if (
      activeProviderRuntime !== null &&
      activeSession !== undefined &&
      (activeProviderRuntime.providerInstanceId === undefined ||
        activeSession.providerInstanceId === undefined)
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeProviderRuntime.providerName ?? undefined),
        method: "session.turn.start",
        detail: `Session '${sessionId}' has an active provider session without a provider instance id.`,
      });
    }
    const currentInstanceId =
      activeProviderRuntime !== null &&
      activeSession !== undefined &&
      activeSession.providerInstanceId !== undefined
        ? activeSession.providerInstanceId
        : session.modelSelection.instanceId;
    const desiredModelSelection = requestedModelSelection ?? session.modelSelection;
    const desiredInstanceId = desiredModelSelection.instanceId;
    const currentInfo = yield* providerService.getInstanceInfo(currentInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(currentInstanceId),
              modelSelectionInstanceId: String(session.modelSelection.instanceId),
              sessionProvider: session.session?.providerName ?? undefined,
            }),
            method: "session.turn.start",
            detail: `Session '${sessionId}' references unknown provider instance '${currentInstanceId}'. The instance is not configured in this build.`,
          }),
      ),
    );
    const desiredInfo = yield* providerService.getInstanceInfo(desiredInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(desiredModelSelection.instanceId),
            }),
            method: "session.turn.start",
            detail: `Requested provider instance '${desiredInstanceId}' is not configured in this build.`,
          }),
      ),
    );
    const desiredDriverKind = desiredInfo.driverKind;
    if (!isProviderDriverKind(desiredDriverKind)) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(String(desiredDriverKind)),
        method: "session.turn.start",
        detail: `Requested provider instance '${desiredInstanceId}' uses unknown provider driver '${desiredDriverKind}'. The driver is not installed in this build.`,
      });
    }
    const preferredProvider: ProviderDriverKind = desiredDriverKind;
    if (
      session.session !== null &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId !== currentInstanceId
    ) {
      if (currentInfo.driverKind !== desiredInfo.driverKind) {
        return yield* new ProviderAdapterRequestError({
          provider: preferredProvider,
          method: "session.turn.start",
          detail: `Session '${sessionId}' is bound to driver '${currentInfo.driverKind}' and cannot switch to '${desiredInfo.driverKind}'.`,
        });
      }
      if (
        currentInfo.continuationIdentity.continuationKey !==
        desiredInfo.continuationIdentity.continuationKey
      ) {
        return yield* new ProviderAdapterRequestError({
          provider: preferredProvider,
          method: "session.turn.start",
          detail: `Session '${sessionId}' cannot switch from instance '${currentInstanceId}' to '${desiredInstanceId}' because their provider resume state is incompatible.`,
        });
      }
    }
    const project = yield* resolveProject(session.projectId);
    const effectiveCwd = resolveSessionWorkspaceCwd({
      session,
      projects: project ? [project] : [],
    });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderDriverKind;
    }) =>
      providerService.startSession(sessionId, {
        sessionId,
        ...(preferredProvider ? { provider: preferredProvider } : {}),
        providerInstanceId: desiredInstanceId,
        projectId: session.projectId,
        ...(project?.workspaceRoot ? { workspaceRoot: project.workspaceRoot } : {}),
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        modelSelection: desiredModelSelection,
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    const bindSessionToSession = (session: ProviderSession) =>
      Effect.gen(function* () {
        if (session.providerInstanceId === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: providerErrorLabel(session.provider),
            method: "session.turn.start",
            detail: `Provider session '${session.sessionId}' started without a provider instance id.`,
          });
        }
        yield* setProviderRuntime({
          sessionId,
          session: {
            sessionId,
            status: mapProviderSessionStatusToOrchestrationStatus(session.status),
            providerName: session.provider,
            providerInstanceId: session.providerInstanceId,
            runtimeMode: desiredRuntimeMode,
            // Provider turn ids are not orchestration turn ids.
            activeTurnId: null,
            lastError: session.lastError ?? null,
            updatedAt: session.updatedAt,
          },
          createdAt,
        });
      });

    const existingSessionSessionId =
      session.session && session.session.status !== "stopped" && activeSession ? session.id : null;
    if (existingSessionSessionId) {
      const runtimeModeChanged = session.runtimeMode !== session.session?.runtimeMode;
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const sessionModelSwitch = (yield* providerService.getCapabilities(desiredInstanceId))
        .sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      const instanceChanged =
        requestedModelSelection !== undefined &&
        activeSession?.providerInstanceId !== requestedModelSelection.instanceId;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = sessionModelSelections.get(sessionId);
      const shouldRestartForModelSelectionChange =
        preferredProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !instanceChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        return existingSessionSessionId;
      }

      const resumeCursor = shouldRestartForModelChange
        ? undefined
        : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        sessionId,
        existingSessionSessionId,
        currentProvider: activeSession?.provider,
        currentInstanceId,
        desiredInstanceId,
        desiredProvider: desiredModelSelection.instanceId,
        currentRuntimeMode: session.session?.runtimeMode,
        desiredRuntimeMode: session.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        modelChanged,
        instanceChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        sessionId,
        previousSessionId: existingSessionSessionId,
        restartedSessionSessionId: restartedSession.sessionId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToSession(restartedSession);
      return restartedSession.sessionId;
    }

    const startedSession = yield* startProviderSession(undefined);
    yield* bindSessionToSession(startedSession);
    return startedSession.sessionId;
  });

  const buildSendTurnRequestForSession = Effect.fnUntraced(function* (input: {
    readonly sessionId: SessionId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly createdAt: string;
  }) {
    const session = yield* resolveSession(input.sessionId);
    if (!session) {
      return yield* Effect.die(
        new Error(`Session '${input.sessionId}' was not found in read model.`),
      );
    }
    yield* ensureSessionForSession(
      input.sessionId,
      input.createdAt,
      input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {},
    );
    if (input.modelSelection !== undefined) {
      sessionModelSelections.set(input.sessionId, input.modelSelection);
    }
    const normalizedInput = toNonEmptyProviderInput(input.messageText);
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.sessionId === input.sessionId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : activeSession.providerInstanceId === undefined
          ? yield* new ProviderAdapterRequestError({
              provider: providerErrorLabel(activeSession.provider),
              method: "session.turn.start",
              detail: `Active provider session '${activeSession.sessionId}' is missing a provider instance id.`,
            })
          : (yield* providerService.getCapabilities(activeSession.providerInstanceId))
              .sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? sessionModelSelections.get(input.sessionId) ?? session.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported" && input.modelSelection === undefined
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    return {
      sessionId: input.sessionId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    };
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn(
    "maybeGenerateAndRenameWorktreeBranchForFirstTurn",
  )(function* (input: {
    readonly sessionId: SessionId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* serverSettingsService.getSettings;

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* gitWorkflow.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "session.meta.update",
        commandId: yield* serverCommandId("worktree-branch-rename"),
        sessionId: input.sessionId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
      yield* vcsStatusBroadcaster.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          sessionId: input.sessionId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateSessionTitleForFirstTurn = Effect.fn("maybeGenerateSessionTitleForFirstTurn")(
    function* (input: {
      readonly sessionId: SessionId;
      readonly cwd: string;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly titleSeed?: string;
    }) {
      const attachments = input.attachments ?? [];
      yield* Effect.gen(function* () {
        const { textGenerationModelSelection: modelSelection } =
          yield* serverSettingsService.getSettings;

        const generated = yield* textGeneration.generateSessionTitle({
          cwd: input.cwd,
          message: input.messageText,
          ...(attachments.length > 0 ? { attachments } : {}),
          modelSelection,
        });
        if (!generated) return;

        const session = yield* resolveSession(input.sessionId);
        if (!session) return;
        if (!canReplaceSessionTitle(session.title, input.titleSeed)) {
          return;
        }

        yield* orchestrationEngine.dispatch({
          type: "session.meta.update",
          commandId: yield* serverCommandId("session-title-rename"),
          sessionId: input.sessionId,
          title: generated.title,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to generate or rename session title", {
            sessionId: input.sessionId,
            cwd: input.cwd,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  );

  const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "session.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const session = yield* resolveSession(event.payload.sessionId);
    if (!session) {
      return;
    }

    const message = session.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        sessionId: event.payload.sessionId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const isFirstUserMessageTurn =
      session.messages.filter((entry) => entry.role === "user").length === 1;
    if (isFirstUserMessageTurn) {
      const project = yield* resolveProject(session.projectId);
      const generationCwd =
        resolveSessionWorkspaceCwd({
          session,
          projects: project ? [project] : [],
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        sessionId: event.payload.sessionId,
        branch: session.branch,
        worktreePath: session.worktreePath,
        ...generationInput,
      }).pipe(Effect.forkScoped);

      if (canReplaceSessionTitle(session.title, event.payload.titleSeed)) {
        yield* maybeGenerateSessionTitleForFirstTurn({
          sessionId: event.payload.sessionId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    const handleTurnStartFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      const detail = formatFailureDetail(cause);
      return setProviderRuntimeErrorOnTurnStartFailure({
        sessionId: event.payload.sessionId,
        detail,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.flatMap(() =>
          appendProviderFailureActivity({
            sessionId: event.payload.sessionId,
            kind: "provider.turn.start.failed",
            summary: "Provider turn start failed",
            detail,
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
        Effect.asVoid,
      );
    };

    const recoverTurnStartFailure = (cause: Cause.Cause<unknown>) =>
      handleTurnStartFailure(cause).pipe(
        Effect.catchCause((recoveryCause) =>
          Effect.logWarning("provider command reactor failed to recover turn start failure", {
            eventType: event.type,
            sessionId: event.payload.sessionId,
            cause: Cause.pretty(recoveryCause),
            originalCause: Cause.pretty(cause),
          }),
        ),
      );

    const sendTurnRequest = yield* buildSendTurnRequestForSession({
      sessionId: event.payload.sessionId,
      messageText: message.text,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => handleTurnStartFailure(cause).pipe(Effect.as(Option.none()))),
    );

    if (Option.isNone(sendTurnRequest)) {
      return;
    }

    yield* providerService
      .sendTurn(sendTurnRequest.value)
      .pipe(Effect.catchCause(recoverTurnStartFailure), Effect.forkScoped);
  });

  const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "session.turn-interrupt-requested" }>,
  ) {
    const session = yield* resolveSession(event.payload.sessionId);
    if (!session) {
      return;
    }
    const hasSession = session.session && session.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        sessionId: event.payload.sessionId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this session.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService.interruptTurn({ sessionId: event.payload.sessionId });
  });

  const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "session.approval-response-requested" }>,
  ) {
    const session = yield* resolveSession(event.payload.sessionId);
    if (!session) {
      return;
    }
    const hasSession = session.session && session.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        sessionId: event.payload.sessionId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this session.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        sessionId: event.payload.sessionId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            sessionId: event.payload.sessionId,
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            detail: isUnknownPendingApprovalRequestError(cause)
              ? stalePendingRequestDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(
    function* (
      event: Extract<ProviderIntentEvent, { type: "session.user-input-response-requested" }>,
    ) {
      const session = yield* resolveSession(event.payload.sessionId);
      if (!session) {
        return;
      }
      const hasSession = session.session && session.session.status !== "stopped";
      if (!hasSession) {
        return yield* appendProviderFailureActivity({
          sessionId: event.payload.sessionId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: "No active provider session is bound to this session.",
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        });
      }

      yield* providerService
        .respondToUserInput({
          sessionId: event.payload.sessionId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
        })
        .pipe(
          Effect.catchCause((cause) =>
            appendProviderFailureActivity({
              sessionId: event.payload.sessionId,
              kind: "provider.user-input.respond.failed",
              summary: "Provider user input response failed",
              detail: isUnknownPendingUserInputRequestError(cause)
                ? stalePendingRequestDetail("user-input", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            }),
          ),
        );
    },
  );

  const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "session.session-stop-requested" }>,
  ) {
    const session = yield* resolveSession(event.payload.sessionId);
    if (!session) {
      return;
    }

    const now = event.payload.createdAt;
    if (session.session && session.session.status !== "stopped") {
      yield* providerService.stopSession({ sessionId: session.id });
    }

    yield* setProviderRuntime({
      sessionId: session.id,
      session: {
        sessionId: session.id,
        status: "stopped",
        providerName: session.session?.providerName ?? null,
        ...(session.session?.providerInstanceId !== undefined
          ? { providerInstanceId: session.session.providerInstanceId }
          : {}),
        runtimeMode: session.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: session.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: ProviderIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.session_id": event.payload.sessionId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });
    switch (event.type) {
      case "session.runtime-mode-set": {
        const session = yield* resolveSession(event.payload.sessionId);
        if (!session?.session || session.session.status === "stopped") {
          return;
        }
        const cachedModelSelection = sessionModelSelections.get(event.payload.sessionId);
        yield* ensureSessionForSession(
          event.payload.sessionId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
        );
        return;
      }
      case "session.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
      case "session.turn-interrupt-requested":
        yield* processTurnInterruptRequested(event);
        return;
      case "session.approval-response-requested":
        yield* processApprovalResponseRequested(event);
        return;
      case "session.user-input-response-requested":
        yield* processUserInputResponseRequested(event);
        return;
      case "session.session-stop-requested":
        yield* processSessionStopRequested(event);
        return;
    }
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        event.type === "session.runtime-mode-set" ||
        event.type === "session.turn-start-requested" ||
        event.type === "session.turn-interrupt-requested" ||
        event.type === "session.approval-response-requested" ||
        event.type === "session.user-input-response-requested" ||
        event.type === "session.session-stop-requested"
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
