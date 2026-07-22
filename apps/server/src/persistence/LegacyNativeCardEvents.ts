import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationAggregateKind,
  OrchestrationEvent,
  OrchestrationEventMetadata,
  ProjectId,
  SessionId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * Persistence-only compatibility for native research-card events written by
 * Lincei before Vitrine became the owner of research records. These events
 * remain durable, but are never exposed through the current orchestration API
 * or applied to current projections.
 */
export const LegacyNativeCardEventType = Schema.Literals([
  "session.research-card-proposed",
  "session.research-card-updated",
  "session.research-card-reviewed",
  "session.research-card-lifecycle-updated",
  "session.research-card-superseded",
]);
export type LegacyNativeCardEventType = typeof LegacyNativeCardEventType.Type;

export const LegacyNativeCardEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  type: LegacyNativeCardEventType,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, SessionId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  payload: Schema.Unknown,
  metadata: OrchestrationEventMetadata,
});
export type LegacyNativeCardEvent = typeof LegacyNativeCardEvent.Type;

export const PersistedOrchestrationEvent = Schema.Union([
  OrchestrationEvent,
  LegacyNativeCardEvent,
]);
export type PersistedOrchestrationEvent = typeof PersistedOrchestrationEvent.Type;

const legacyNativeCardEventTypes: ReadonlySet<string> = new Set(LegacyNativeCardEventType.literals);

export function isLegacyNativeCardEvent(
  event: PersistedOrchestrationEvent,
): event is LegacyNativeCardEvent {
  return legacyNativeCardEventTypes.has(event.type);
}

export function isCurrentOrchestrationEvent(
  event: PersistedOrchestrationEvent,
): event is OrchestrationEvent {
  return !isLegacyNativeCardEvent(event);
}
