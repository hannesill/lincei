import {
  ApprovalRequestId,
  type ChatAttachment,
  type OrchestrationEvent,
  SessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  isLegacyNativeCardEvent,
  type PersistedOrchestrationEvent,
} from "../../persistence/LegacyNativeCardEvents.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionSessionActivityRepository } from "../../persistence/Services/ProjectionSessionActivities.ts";
import { type ProjectionSessionActivity } from "../../persistence/Services/ProjectionSessionActivities.ts";
import {
  type ProjectionSessionMessage,
  ProjectionSessionMessageRepository,
} from "../../persistence/Services/ProjectionSessionMessages.ts";
import {
  type ProjectionSessionProposedPlan,
  ProjectionSessionProposedPlanRepository,
} from "../../persistence/Services/ProjectionSessionProposedPlans.ts";
import { ProjectionProviderRuntimeRepository } from "../../persistence/Services/ProjectionProviderRuntimes.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionSessionRepository } from "../../persistence/Services/ProjectionSessions.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionSessionActivityRepositoryLive } from "../../persistence/Layers/ProjectionSessionActivities.ts";
import { ProjectionSessionMessageRepositoryLive } from "../../persistence/Layers/ProjectionSessionMessages.ts";
import { ProjectionSessionProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionSessionProposedPlans.ts";
import { ProjectionProviderRuntimeRepositoryLive } from "../../persistence/Layers/ProjectionProviderRuntimes.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionSessionRepositoryLive } from "../../persistence/Layers/ProjectionSessions.ts";
import { ServerConfig } from "../../config.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseSessionSegmentFromAttachmentId,
  toSafeSessionAttachmentSegment,
} from "../../attachmentStore.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  sessions: "projection.sessions",
  sessionMessages: "projection.session-messages",
  sessionProposedPlans: "projection.session-proposed-plans",
  sessionActivities: "projection.session-activities",
  providerRuntimes: "projection.session-sessions",
  sessionTurns: "projection.session-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
} as const;

type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

interface AttachmentSideEffects {
  readonly deletedSessionIds: Set<string>;
  readonly prunedSessionRelativePaths: Map<string, Set<string>>;
}

const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : null;
}

function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request")
  );
}

function derivePendingUserInputCountFromActivities(
  activities: ReadonlyArray<ProjectionSessionActivity>,
): number {
  const openRequestIds = new Set<string>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.activityId.localeCompare(right.activityId),
  );

  for (const activity of ordered) {
    const requestId = extractActivityRequestId(activity.payload);
    if (requestId === null) {
      continue;
    }
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;

    if (activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      detail !== null &&
      (detail.includes("stale pending user-input request") ||
        detail.includes("unknown pending user-input request"))
    ) {
      openRequestIds.delete(requestId);
    }
  }

  return openRequestIds.size;
}

function deriveHasActionableProposedPlan(input: {
  readonly latestTurnId: string | null;
  readonly proposedPlans: ReadonlyArray<ProjectionSessionProposedPlan>;
}): boolean {
  const sorted = [...input.proposedPlans].toSorted(
    (left, right) =>
      left.updatedAt.localeCompare(right.updatedAt) || left.planId.localeCompare(right.planId),
  );

  let latestForTurn: ProjectionSessionProposedPlan | null = null;
  if (input.latestTurnId !== null) {
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const plan = sorted[index];
      if (plan?.turnId === input.latestTurnId) {
        latestForTurn = plan;
        break;
      }
    }
  }
  if (latestForTurn !== null) {
    return latestForTurn.implementedAt === null;
  }

  const latestPlan = sorted.at(-1) ?? null;
  return latestPlan !== null && latestPlan.implementedAt === null;
}

function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionSessionMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionSessionMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionSessionActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionSessionActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionSessionProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionSessionProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function collectSessionAttachmentRelativePaths(
  sessionId: string,
  messages: ReadonlyArray<ProjectionSessionMessage>,
): Set<string> {
  const sessionSegment = toSafeSessionAttachmentSegment(sessionId);
  if (!sessionSegment) {
    return new Set();
  }
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== "image") {
        continue;
      }
      const attachmentSessionSegment = parseSessionSegmentFromAttachmentId(attachment.id);
      if (!attachmentSessionSegment || attachmentSessionSegment !== sessionSegment) {
        continue;
      }
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (
  sideEffects: AttachmentSideEffects,
) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const readAttachmentRootEntries = fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const removeDeletedSessionAttachmentEntry = Effect.fn("removeDeletedSessionAttachmentEntry")(
    function* (sessionSegment: string, entry: string) {
      const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) {
        return;
      }
      const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
      if (!attachmentId) {
        return;
      }
      const attachmentSessionSegment = parseSessionSegmentFromAttachmentId(attachmentId);
      if (!attachmentSessionSegment || attachmentSessionSegment !== sessionSegment) {
        return;
      }
      yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), {
        force: true,
      });
    },
  );

  const deleteSessionAttachments = Effect.fn("deleteSessionAttachments")(function* (
    sessionId: string,
  ) {
    const sessionSegment = toSafeSessionAttachmentSegment(sessionId);
    if (!sessionSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe session id", {
        sessionId,
      });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => removeDeletedSessionAttachmentEntry(sessionSegment, entry),
      {
        concurrency: 1,
      },
    );
  });

  const pruneSessionAttachmentEntry = Effect.fn("pruneSessionAttachmentEntry")(function* (
    sessionSegment: string,
    keptSessionRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) {
      return;
    }
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) {
      return;
    }
    const attachmentSessionSegment = parseSessionSegmentFromAttachmentId(attachmentId);
    if (!attachmentSessionSegment || attachmentSessionSegment !== sessionSegment) {
      return;
    }

    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem
      .stat(absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return;
    }

    if (!keptSessionRelativePaths.has(relativePath)) {
      yield* fileSystem.remove(absolutePath, { force: true });
    }
  });

  const pruneSessionAttachments = Effect.fn("pruneSessionAttachments")(function* (
    sessionId: string,
    keptSessionRelativePaths: Set<string>,
  ) {
    if (sideEffects.deletedSessionIds.has(sessionId)) {
      return;
    }

    const sessionSegment = toSafeSessionAttachmentSegment(sessionId);
    if (!sessionSegment) {
      yield* Effect.logWarning("skipping attachment prune for unsafe session id", { sessionId });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => pruneSessionAttachmentEntry(sessionSegment, keptSessionRelativePaths, entry),
      { concurrency: 1 },
    );
  });

  yield* Effect.forEach(sideEffects.deletedSessionIds, deleteSessionAttachments, {
    concurrency: 1,
  });

  yield* Effect.forEach(
    sideEffects.prunedSessionRelativePaths.entries(),
    ([sessionId, keptSessionRelativePaths]) =>
      pruneSessionAttachments(sessionId, keptSessionRelativePaths),
    { concurrency: 1 },
  );
});

const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const projectionStateRepository = yield* ProjectionStateRepository;
    const projectionProjectRepository = yield* ProjectionProjectRepository;
    const projectionSessionRepository = yield* ProjectionSessionRepository;
    const projectionSessionMessageRepository = yield* ProjectionSessionMessageRepository;
    const projectionSessionProposedPlanRepository = yield* ProjectionSessionProposedPlanRepository;
    const projectionSessionActivityRepository = yield* ProjectionSessionActivityRepository;
    const projectionProviderRuntimeRepository = yield* ProjectionProviderRuntimeRepository;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;

    const applyProjectsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProjectsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "project.created":
          yield* projectionProjectRepository.upsert({
            projectId: event.payload.projectId,
            title: event.payload.title,
            workspaceRoot: event.payload.workspaceRoot,
            defaultModelSelection: event.payload.defaultModelSelection,
            scripts: event.payload.scripts,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            deletedAt: null,
          });
          return;

        case "project.meta-updated": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.workspaceRoot !== undefined
              ? { workspaceRoot: event.payload.workspaceRoot }
              : {}),
            ...(event.payload.defaultModelSelection !== undefined
              ? { defaultModelSelection: event.payload.defaultModelSelection }
              : {}),
            ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "project.deleted": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        case "project.purged":
          yield* projectionProjectRepository.deleteById({
            projectId: event.payload.projectId,
          });
          return;

        default:
          return;
      }
    });

    const refreshSessionShellSummary = Effect.fn("refreshSessionShellSummary")(function* (
      sessionId: SessionId,
    ) {
      const existingRow = yield* projectionSessionRepository.getById({
        sessionId,
      });
      if (Option.isNone(existingRow)) {
        return;
      }

      const [messages, proposedPlans, activities, pendingApprovals] = yield* Effect.all([
        projectionSessionMessageRepository.listBySessionId({ sessionId }),
        projectionSessionProposedPlanRepository.listBySessionId({ sessionId }),
        projectionSessionActivityRepository.listBySessionId({ sessionId }),
        projectionPendingApprovalRepository.listBySessionId({ sessionId }),
      ]);

      let latestUserMessageAt: string | null = null;
      for (const message of messages) {
        if (
          message.role === "user" &&
          (latestUserMessageAt === null || message.createdAt > latestUserMessageAt)
        ) {
          latestUserMessageAt = message.createdAt;
        }
      }

      const pendingApprovalCount = pendingApprovals.filter(
        (approval) => approval.status === "pending",
      ).length;
      const pendingUserInputCount = derivePendingUserInputCountFromActivities(activities);
      const hasActionableProposedPlan = deriveHasActionableProposedPlan({
        latestTurnId: existingRow.value.latestTurnId,
        proposedPlans,
      });

      yield* projectionSessionRepository.upsert({
        ...existingRow.value,
        latestUserMessageAt,
        pendingApprovalCount,
        pendingUserInputCount,
        hasActionableProposedPlan: hasActionableProposedPlan ? 1 : 0,
      });
    });

    const applySessionsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applySessionsProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "project.purged": {
          for (const sessionId of event.payload.sessionIds) {
            const pendingApprovals = yield* projectionPendingApprovalRepository.listBySessionId({
              sessionId,
            });
            yield* Effect.forEach(
              pendingApprovals,
              (approval) =>
                projectionPendingApprovalRepository.deleteByRequestId({
                  requestId: approval.requestId,
                }),
              { concurrency: 1 },
            );
            yield* projectionSessionMessageRepository.deleteBySessionId({ sessionId });
            yield* projectionSessionProposedPlanRepository.deleteBySessionId({ sessionId });
            yield* projectionSessionActivityRepository.deleteBySessionId({ sessionId });
            yield* projectionProviderRuntimeRepository.deleteBySessionId({ sessionId });
            yield* projectionTurnRepository.deleteBySessionId({ sessionId });
            yield* projectionSessionRepository.deleteById({ sessionId });
            attachmentSideEffects.deletedSessionIds.add(sessionId);
          }
          return;
        }

        case "session.created":
          yield* projectionSessionRepository.upsert({
            sessionId: event.payload.sessionId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            modelSelection: event.payload.modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            workflowId: event.payload.workflowId ?? null,
            workflowVersion: event.payload.workflowVersion ?? null,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            latestTurnId: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            latestUserMessageAt: null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: 0,
            deletedAt: null,
          });
          return;

        case "session.archived": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            archivedAt: event.payload.archivedAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.unarchived": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            archivedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.meta-updated": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.modelSelection !== undefined
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
            ...(event.payload.worktreePath !== undefined
              ? { worktreePath: event.payload.worktreePath }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.runtime-mode-set": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            runtimeMode: event.payload.runtimeMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.interaction-mode-set": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.deleted": {
          attachmentSideEffects.deletedSessionIds.add(event.payload.sessionId);
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        case "session.turn-start-requested": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            ...(event.payload.workflowId !== undefined
              ? { workflowId: event.payload.workflowId }
              : {}),
            ...(event.payload.workflowVersion !== undefined
              ? { workflowVersion: event.payload.workflowVersion }
              : {}),
            updatedAt: event.occurredAt,
          });
          yield* refreshSessionShellSummary(event.payload.sessionId);
          return;
        }

        case "session.message-sent":
        case "session.proposed-plan-upserted":
        case "session.activity-appended":
        case "session.approval-response-requested":
        case "session.user-input-response-requested": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            updatedAt: event.occurredAt,
          });
          yield* refreshSessionShellSummary(event.payload.sessionId);
          return;
        }

        case "session.session-set": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.session.activeTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshSessionShellSummary(event.payload.sessionId);
          return;
        }

        case "session.turn-diff-completed": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.turnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshSessionShellSummary(event.payload.sessionId);
          return;
        }

        case "session.reverted": {
          const existingRow = yield* projectionSessionRepository.getById({
            sessionId: event.payload.sessionId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }

          const retainedTurns = yield* projectionTurnRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          let latestTurnId: ProjectionTurn["turnId"] = null;
          let latestCheckpointTurnCount = -1;
          for (let index = 0; index < retainedTurns.length; index += 1) {
            const turn = retainedTurns[index];
            if (
              !turn ||
              turn.turnId === null ||
              turn.checkpointTurnCount === null ||
              turn.checkpointTurnCount > event.payload.turnCount
            ) {
              continue;
            }
            if (turn.checkpointTurnCount > latestCheckpointTurnCount) {
              latestCheckpointTurnCount = turn.checkpointTurnCount;
              latestTurnId = turn.turnId;
            }
          }

          yield* projectionSessionRepository.upsert({
            ...existingRow.value,
            latestTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshSessionShellSummary(event.payload.sessionId);
          return;
        }

        default:
          return;
      }
    });

    const applySessionMessagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applySessionMessagesProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "session.message-sent": {
          const existingMessage = yield* projectionSessionMessageRepository.getByMessageId({
            messageId: event.payload.messageId,
          });
          const previousMessage = Option.getOrUndefined(existingMessage);
          const nextText = Option.match(existingMessage, {
            onNone: () => event.payload.text,
            onSome: (message) => {
              if (event.payload.streaming) {
                return `${message.text}${event.payload.text}`;
              }
              if (event.payload.text.length === 0) {
                return message.text;
              }
              return event.payload.text;
            },
          });
          const nextAttachments =
            event.payload.attachments !== undefined
              ? yield* materializeAttachmentsForProjection({
                  attachments: event.payload.attachments,
                })
              : previousMessage?.attachments;
          yield* projectionSessionMessageRepository.upsert({
            messageId: event.payload.messageId,
            sessionId: event.payload.sessionId,
            turnId: event.payload.turnId,
            role: event.payload.role,
            text: nextText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            isStreaming: event.payload.streaming,
            createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "session.reverted": {
          const existingRows = yield* projectionSessionMessageRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          const keptRows = retainProjectionMessagesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionSessionMessageRepository.deleteBySessionId({
            sessionId: event.payload.sessionId,
          });
          yield* Effect.forEach(keptRows, projectionSessionMessageRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          attachmentSideEffects.prunedSessionRelativePaths.set(
            event.payload.sessionId,
            collectSessionAttachmentRelativePaths(event.payload.sessionId, keptRows),
          );
          return;
        }

        default:
          return;
      }
    });

    const applySessionProposedPlansProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applySessionProposedPlansProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "session.proposed-plan-upserted":
          yield* projectionSessionProposedPlanRepository.upsert({
            planId: event.payload.proposedPlan.id,
            sessionId: event.payload.sessionId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationSessionId: event.payload.proposedPlan.implementationSessionId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;

        case "session.reverted": {
          const existingRows = yield* projectionSessionProposedPlanRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionSessionProposedPlanRepository.deleteBySessionId({
            sessionId: event.payload.sessionId,
          });
          yield* Effect.forEach(keptRows, projectionSessionProposedPlanRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applySessionActivitiesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applySessionActivitiesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "session.activity-appended":
          yield* projectionSessionActivityRepository.upsert({
            activityId: event.payload.activity.id,
            sessionId: event.payload.sessionId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            ...(event.payload.activity.sequence !== undefined
              ? { sequence: event.payload.activity.sequence }
              : {}),
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "session.reverted": {
          const existingRows = yield* projectionSessionActivityRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const existingTurns = yield* projectionTurnRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionSessionActivityRepository.deleteBySessionId({
            sessionId: event.payload.sessionId,
          });
          yield* Effect.forEach(keptRows, projectionSessionActivityRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyProviderRuntimesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProviderRuntimesProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type !== "session.session-set") {
        return;
      }
      yield* projectionProviderRuntimeRepository.upsert({
        sessionId: event.payload.sessionId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        providerInstanceId: event.payload.session.providerInstanceId ?? null,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

    const applySessionTurnsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applySessionTurnsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "session.turn-start-requested": {
          yield* projectionTurnRepository.replacePendingTurnStart({
            sessionId: event.payload.sessionId,
            messageId: event.payload.messageId,
            sourceProposedPlanSessionId: event.payload.sourceProposedPlan?.sessionId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "session.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (turnId === null || event.payload.session.status !== "running") {
            return;
          }

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            sessionId: event.payload.sessionId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartBySessionId({
            sessionId: event.payload.sessionId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanSessionId:
                existingTurn.value.sourceProposedPlanSessionId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanSessionId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              sessionId: event.payload.sessionId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanSessionId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanSessionId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          yield* projectionTurnRepository.deletePendingTurnStartBySessionId({
            sessionId: event.payload.sessionId,
          });
          return;
        }

        case "session.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            sessionId: event.payload.sessionId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.messageId,
              state: event.payload.streaming
                ? existingTurn.value.state
                : existingTurn.value.state === "interrupted"
                  ? "interrupted"
                  : existingTurn.value.state === "error"
                    ? "error"
                    : "completed",
              completedAt: event.payload.streaming
                ? existingTurn.value.completedAt
                : (existingTurn.value.completedAt ?? event.payload.updatedAt),
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            sessionId: event.payload.sessionId,
            pendingMessageId: null,
            sourceProposedPlanSessionId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.messageId,
            state: event.payload.streaming ? "running" : "completed",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.streaming ? null : event.payload.updatedAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "session.turn-interrupt-requested": {
          if (event.payload.turnId === undefined) {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            sessionId: event.payload.sessionId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: "interrupted",
              completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            sessionId: event.payload.sessionId,
            pendingMessageId: null,
            sourceProposedPlanSessionId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "interrupted",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.createdAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "session.turn-diff-completed": {
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            sessionId: event.payload.sessionId,
            turnId: event.payload.turnId,
          });
          const nextState = event.payload.status === "error" ? "error" : "completed";
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            sessionId: event.payload.sessionId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.assistantMessageId,
              state: nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: event.payload.completedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            sessionId: event.payload.sessionId,
            pendingMessageId: null,
            sourceProposedPlanSessionId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.assistantMessageId,
            state: nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "session.reverted": {
          const existingTurns = yield* projectionTurnRepository.listBySessionId({
            sessionId: event.payload.sessionId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* projectionTurnRepository.deleteBySessionId({
            sessionId: event.payload.sessionId,
          });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                  }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

    const applyPendingApprovalsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingApprovalsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "session.activity-appended": {
          const requestId =
            extractActivityRequestId(event.payload.activity.payload) ??
            event.metadata.requestId ??
            null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId,
          });
          if (event.payload.activity.kind === "approval.resolved") {
            const resolvedDecisionRaw =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null &&
              "decision" in event.payload.activity.payload
                ? (event.payload.activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* projectionPendingApprovalRepository.upsert({
              requestId,
              sessionId: Option.isSome(existingRow)
                ? existingRow.value.sessionId
                : event.payload.sessionId,
              turnId: Option.isSome(existingRow)
                ? existingRow.value.turnId
                : event.payload.activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : event.payload.activity.createdAt,
              resolvedAt: event.payload.activity.createdAt,
            });
            return;
          }
          if (event.payload.activity.kind === "provider.approval.respond.failed") {
            const payload =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null
                ? (event.payload.activity.payload as Record<string, unknown>)
                : null;
            const detail =
              typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
            if (isStalePendingApprovalFailureDetail(detail)) {
              if (Option.isNone(existingRow)) {
                return;
              }
              if (existingRow.value.status === "resolved") {
                return;
              }
              yield* projectionPendingApprovalRepository.upsert({
                requestId,
                sessionId: existingRow.value.sessionId,
                turnId: existingRow.value.turnId,
                status: "resolved",
                decision: null,
                createdAt: existingRow.value.createdAt,
                resolvedAt: event.payload.activity.createdAt,
              });
              return;
            }
            return;
          }
          // Only approval-requested activities should create pending-approval
          // rows.  Other activity kinds that happen to carry a requestId
          // (e.g. user-input.requested / user-input.resolved) must not
          // pollute this projection — they have their own accounting via
          // derivePendingUserInputCountFromActivities.
          if (event.payload.activity.kind !== "approval.requested") {
            return;
          }
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") {
            return;
          }
          yield* projectionPendingApprovalRepository.upsert({
            requestId,
            sessionId: event.payload.sessionId,
            turnId: event.payload.activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.activity.createdAt,
            resolvedAt: null,
          });
          return;
        }

        case "session.approval-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            sessionId: Option.isSome(existingRow)
              ? existingRow.value.sessionId
              : event.payload.sessionId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const projectors: ReadonlyArray<ProjectorDefinition> = [
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.projects,
        apply: applyProjectsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.sessionMessages,
        apply: applySessionMessagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.sessionProposedPlans,
        apply: applySessionProposedPlansProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.sessionActivities,
        apply: applySessionActivitiesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.providerRuntimes,
        apply: applyProviderRuntimesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.sessionTurns,
        apply: applySessionTurnsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
        apply: applyCheckpointsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
        apply: applyPendingApprovalsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.sessions,
        apply: applySessionsProjection,
      },
    ];

    const runProjectorForEvent = Effect.fn("runProjectorForEvent")(function* (
      projector: ProjectorDefinition,
      event: OrchestrationEvent,
    ) {
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedSessionIds: new Set<string>(),
        prunedSessionRelativePaths: new Map<string, Set<string>>(),
      };

      yield* sql.withTransaction(
        projector.apply(event, attachmentSideEffects).pipe(
          Effect.flatMap(() =>
            projectionStateRepository.upsert({
              projector: projector.name,
              lastAppliedSequence: event.sequence,
              updatedAt: event.occurredAt,
            }),
          ),
        ),
      );

      yield* runAttachmentSideEffects(attachmentSideEffects).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to apply projected attachment side-effects", {
            projector: projector.name,
            sequence: event.sequence,
            eventType: event.type,
            cause,
          }),
        ),
      );
    });

    const runProjectorForPersistedEvent = (
      projector: ProjectorDefinition,
      event: PersistedOrchestrationEvent,
    ) =>
      isLegacyNativeCardEvent(event)
        ? projectionStateRepository.upsert({
            projector: projector.name,
            lastAppliedSequence: event.sequence,
            updatedAt: event.occurredAt,
          })
        : runProjectorForEvent(projector, event);

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      projectionStateRepository
        .getByProjector({
          projector: projector.name,
        })
        .pipe(
          Effect.flatMap((stateRow) =>
            Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
              ),
              (event) => runProjectorForPersistedEvent(projector, event),
            ),
          ),
        );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
      Effect.forEach(projectors, (projector) => runProjectorForEvent(projector, event), {
        concurrency: 1,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.forEach(
      projectors,
      bootstrapProjector,
      { concurrency: 1 },
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      Effect.asVoid,
      Effect.tap(() =>
        Effect.logDebug("orchestration projection pipeline bootstrapped").pipe(
          Effect.annotateLogs({ projectors: projectors.length }),
        ),
      ),
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
      ),
    );

    return {
      bootstrap,
      projectEvent,
    } satisfies OrchestrationProjectionPipelineShape;
  },
);

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionSessionRepositoryLive),
  Layer.provideMerge(ProjectionSessionMessageRepositoryLive),
  Layer.provideMerge(ProjectionSessionProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionSessionActivityRepositoryLive),
  Layer.provideMerge(ProjectionProviderRuntimeRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
);
