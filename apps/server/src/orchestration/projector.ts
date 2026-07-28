import type { OrchestrationEvent, OrchestrationReadModel, SessionId } from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationProviderRuntime,
  OrchestrationSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ProjectPurgedPayload,
  SessionActivityAppendedPayload,
  SessionArchivedPayload,
  SessionCreatedPayload,
  SessionDeletedPayload,
  SessionInteractionModeSetPayload,
  SessionMetaUpdatedPayload,
  SessionProposedPlanUpsertedPayload,
  SessionRuntimeModeSetPayload,
  SessionSettledPayload,
  SessionUnarchivedPayload,
  SessionUnsettledPayload,
  SessionRevertedPayload,
  ProviderRuntimeSetPayload,
  SessionTurnStartRequestedPayload,
  SessionTurnDiffCompletedPayload,
} from "./Schemas.ts";

type SessionPatch = Partial<Omit<OrchestrationSession, "id" | "projectId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function updateSession(
  sessions: ReadonlyArray<OrchestrationSession>,
  sessionId: SessionId,
  patch: SessionPatch,
): OrchestrationSession[] {
  return sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
}

function decodeForEvent<A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(toProjectorDecodeError(`${eventType}:${field}`)),
  );
}

function retainSessionMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainSessionActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationSession["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationSession["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainSessionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationSession["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationSession["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareSessionActivities(
  left: OrchestrationSession["activities"][number],
  right: OrchestrationSession["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    sessions: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "project.purged":
      return decodeForEvent(ProjectPurgedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.filter((project) => project.id !== payload.projectId),
          sessions: nextBase.sessions.filter((session) => session.projectId !== payload.projectId),
        })),
      );

    case "session.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          SessionCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          {
            id: payload.sessionId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            workflowId: payload.workflowId ?? null,
            workflowVersion: payload.workflowVersion ?? null,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            deletedAt: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "session",
        );
        const existing = nextBase.sessions.find((entry) => entry.id === session.id);
        return {
          ...nextBase,
          sessions: existing
            ? nextBase.sessions.map((entry) => (entry.id === session.id ? session : entry))
            : [...nextBase.sessions, session],
        };
      });

    case "session.deleted":
      return decodeForEvent(SessionDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "session.archived":
      return decodeForEvent(SessionArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            archivedAt: payload.archivedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.unarchived":
      return decodeForEvent(SessionUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.settled":
      return decodeForEvent(SessionSettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            settledOverride: "settled",
            settledAt: payload.settledAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.unsettled":
      return decodeForEvent(SessionUnsettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            settledOverride: payload.reason === "user" ? "active" : null,
            settledAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.meta-updated":
      return decodeForEvent(SessionMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.runtime-mode-set":
      return decodeForEvent(
        SessionRuntimeModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.interaction-mode-set":
      return decodeForEvent(
        SessionInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "session.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const targetSession = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
        if (!targetSession) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = targetSession.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? targetSession.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...targetSession.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "session.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ProviderRuntimeSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const targetSession = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
        if (!targetSession) {
          return nextBase;
        }

        const providerRuntime: OrchestrationProviderRuntime = yield* decodeForEvent(
          OrchestrationProviderRuntime,
          payload.session,
          event.type,
          "session",
        );

        return {
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            session: providerRuntime,
            latestTurn:
              providerRuntime.status === "running" && providerRuntime.activeTurnId !== null
                ? {
                    turnId: providerRuntime.activeTurnId,
                    state: "running",
                    requestedAt:
                      targetSession.latestTurn?.turnId === providerRuntime.activeTurnId
                        ? targetSession.latestTurn.requestedAt
                        : providerRuntime.updatedAt,
                    startedAt:
                      targetSession.latestTurn?.turnId === providerRuntime.activeTurnId
                        ? (targetSession.latestTurn.startedAt ?? providerRuntime.updatedAt)
                        : providerRuntime.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      targetSession.latestTurn?.turnId === providerRuntime.activeTurnId
                        ? targetSession.latestTurn.assistantMessageId
                        : null,
                  }
                : targetSession.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "session.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          SessionProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const session = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
        if (!session) {
          return nextBase;
        }

        const proposedPlans = [
          ...session.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "session.turn-start-requested":
      return decodeForEvent(
        SessionTurnStartRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            ...(payload.workflowId !== undefined ? { workflowId: payload.workflowId } : {}),
            ...(payload.workflowVersion !== undefined
              ? { workflowVersion: payload.workflowVersion }
              : {}),
            updatedAt: payload.createdAt,
          }),
        })),
      );

    case "session.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          SessionTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const session = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
        if (!session) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = session.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...session.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);

        return {
          ...nextBase,
          sessions: updateSession(nextBase.sessions, payload.sessionId, {
            checkpoints,
            latestTurn: {
              turnId: payload.turnId,
              state: checkpointStatusToLatestTurnState(payload.status),
              requestedAt:
                session.latestTurn?.turnId === payload.turnId
                  ? session.latestTurn.requestedAt
                  : payload.completedAt,
              startedAt:
                session.latestTurn?.turnId === payload.turnId
                  ? (session.latestTurn.startedAt ?? payload.completedAt)
                  : payload.completedAt,
              completedAt: payload.completedAt,
              assistantMessageId: payload.assistantMessageId,
            },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "session.reverted":
      return decodeForEvent(SessionRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const session = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
          if (!session) {
            return nextBase;
          }

          const checkpoints = session.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainSessionMessagesAfterRevert(
            session.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainSessionProposedPlansAfterRevert(
            session.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainSessionActivitiesAfterRevert(
            session.activities,
            retainedTurnIds,
          );

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            sessions: updateSession(nextBase.sessions, payload.sessionId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "session.activity-appended":
      return decodeForEvent(
        SessionActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const session = nextBase.sessions.find((entry) => entry.id === payload.sessionId);
          if (!session) {
            return nextBase;
          }

          const activities = [
            ...session.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareSessionActivities)
            .slice(-500);

          return {
            ...nextBase,
            sessions: updateSession(nextBase.sessions, payload.sessionId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
