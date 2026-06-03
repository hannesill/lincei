import {
  EventId,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  type ResearchCardLifecycleStatus,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  listSessionsByProjectId,
  requireProject,
  requireProjectAbsent,
  requireResearchCard,
  requireResearchCardAbsent,
  requireSession,
  requireSessionArchived,
  requireSessionAbsent,
  requireSessionNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

function lifecycleActionToStatus(
  action: Extract<OrchestrationCommand, { type: "session.research-card.lifecycle" }>["action"],
): ResearchCardLifecycleStatus {
  switch (action) {
    case "request_review":
      return "review-requested";
    case "withdraw":
      return "withdrawn";
    case "dismiss":
      return "dismissed";
  }
}

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeSessions = listSessionsByProjectId(readModel, command.projectId).filter(
        (session) => session.deletedAt === null,
      );
      if (activeSessions.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeSessions.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeSessions.map(
              (session): Extract<OrchestrationCommand, { type: "session.delete" }> => ({
                type: "session.delete",
                commandId: command.commandId,
                sessionId: session.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "project.purge": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const sessionIds = listSessionsByProjectId(readModel, command.projectId).map(
        (session) => session.id,
      );
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.purged" as const,
        payload: {
          projectId: command.projectId,
          sessionIds,
          purgedAt: command.createdAt,
        },
      };
    }

    case "session.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireSessionAbsent({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.created",
        payload: {
          sessionId: command.sessionId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "session.delete": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.deleted",
        payload: {
          sessionId: command.sessionId,
          deletedAt: occurredAt,
        },
      };
    }

    case "session.archive": {
      yield* requireSessionNotArchived({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.archived",
        payload: {
          sessionId: command.sessionId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "session.unarchive": {
      yield* requireSessionArchived({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.unarchived",
        payload: {
          sessionId: command.sessionId,
          updatedAt: occurredAt,
        },
      };
    }

    case "session.meta.update": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.meta-updated",
        payload: {
          sessionId: command.sessionId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "session.runtime-mode.set": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.runtime-mode-set",
        payload: {
          sessionId: command.sessionId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "session.interaction-mode.set": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "session.interaction-mode-set",
        payload: {
          sessionId: command.sessionId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "session.turn.start": {
      const targetSession = yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceSession = sourceProposedPlan
        ? yield* requireSession({
            readModel,
            command,
            sessionId: sourceProposedPlan.sessionId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceSession
          ? sourceSession.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on session '${sourceProposedPlan.sessionId}'.`,
        });
      }
      if (sourceSession && sourceSession.projectId !== targetSession.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to session '${sourceSession.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.message-sent",
        payload: {
          sessionId: command.sessionId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "session.turn-start-requested",
        payload: {
          sessionId: command.sessionId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetSession.runtimeMode,
          interactionMode: targetSession.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "session.turn.interrupt": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.turn-interrupt-requested",
        payload: {
          sessionId: command.sessionId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "session.approval.respond": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "session.approval-response-requested",
        payload: {
          sessionId: command.sessionId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "session.user-input.respond": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "session.user-input-response-requested",
        payload: {
          sessionId: command.sessionId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "session.checkpoint.revert": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.checkpoint-revert-requested",
        payload: {
          sessionId: command.sessionId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "session.session.stop": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.session-stop-requested",
        payload: {
          sessionId: command.sessionId,
          createdAt: command.createdAt,
        },
      };
    }

    case "session.session.set": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "session.session-set",
        payload: {
          sessionId: command.sessionId,
          session: command.session,
        },
      };
    }

    case "session.message.assistant.delta": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.message-sent",
        payload: {
          sessionId: command.sessionId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "session.message.assistant.complete": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.message-sent",
        payload: {
          sessionId: command.sessionId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "session.message.append": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.message-sent",
        payload: {
          sessionId: command.sessionId,
          messageId: command.messageId,
          role: command.role,
          text: command.text,
          ...(command.attachments !== undefined ? { attachments: command.attachments } : {}),
          turnId: command.turnId,
          streaming: command.streaming,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "session.proposed-plan.upsert": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.proposed-plan-upserted",
        payload: {
          sessionId: command.sessionId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "session.research-card.propose": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      yield* requireResearchCardAbsent({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.researchCard.id,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.research-card-proposed",
        payload: {
          sessionId: command.sessionId,
          researchCard: command.researchCard,
          ...(command.studyRecord !== undefined ? { studyRecord: command.studyRecord } : {}),
        },
      };
    }

    case "session.research-card.update": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      yield* requireResearchCard({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.cardId,
      });
      if (command.researchCard.id !== command.cardId) {
        return yield* invariantError(
          command.type,
          `Research card update id '${command.researchCard.id}' must match target card '${command.cardId}'.`,
        );
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.research-card-updated",
        payload: {
          sessionId: command.sessionId,
          cardId: command.cardId,
          researchCard: command.researchCard,
          ...(command.studyRecord !== undefined ? { studyRecord: command.studyRecord } : {}),
        },
      };
    }

    case "session.research-card.review": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      yield* requireResearchCard({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.cardId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.research-card-reviewed",
        payload: {
          sessionId: command.sessionId,
          cardId: command.cardId,
          response: command.response,
          ...(command.studyRecord !== undefined ? { studyRecord: command.studyRecord } : {}),
        },
      };
    }

    case "session.research-card.lifecycle": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      yield* requireResearchCard({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.cardId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.research-card-lifecycle-updated",
        payload: {
          sessionId: command.sessionId,
          cardId: command.cardId,
          status: lifecycleActionToStatus(command.action),
          action: command.action,
          ...(command.note !== undefined ? { note: command.note } : {}),
          ...(command.studyRecord !== undefined ? { studyRecord: command.studyRecord } : {}),
          updatedAt: command.createdAt,
        },
      };
    }

    case "session.research-card.supersede": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      yield* requireResearchCard({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.cardId,
      });
      if (command.replacementCard.id === command.cardId) {
        return yield* invariantError(
          command.type,
          "Replacement research card id must be different from the superseded card id.",
        );
      }
      yield* requireResearchCardAbsent({
        readModel,
        command,
        sessionId: command.sessionId,
        cardId: command.replacementCard.id,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.research-card-superseded",
        payload: {
          sessionId: command.sessionId,
          cardId: command.cardId,
          replacementCard: command.replacementCard,
          ...(command.studyRecord !== undefined ? { studyRecord: command.studyRecord } : {}),
          supersededAt: command.createdAt,
        },
      };
    }

    case "session.turn.diff.complete": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.turn-diff-completed",
        payload: {
          sessionId: command.sessionId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "session.revert.complete": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "session.reverted",
        payload: {
          sessionId: command.sessionId,
          turnCount: command.turnCount,
        },
      };
    }

    case "session.activity.append": {
      yield* requireSession({
        readModel,
        command,
        sessionId: command.sessionId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...(yield* withEventBase({
          aggregateKind: "session",
          aggregateId: command.sessionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "session.activity-appended",
        payload: {
          sessionId: command.sessionId,
          activity: command.activity,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
