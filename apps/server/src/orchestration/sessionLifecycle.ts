import type { OrchestrationSession } from "@t3tools/contracts";

// Provider adoption normally takes seconds. A newer user message that still
// has no matching turn after this window is stale/failed history, not work
// that should remain permanently unsettleable or unsnoozable.
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

export function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request")
  );
}

export function isStalePendingUserInputFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  return (
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

/**
 * Reconstruct blocked-on-user work from retained activities. These clearing
 * rules are shared with the projection pending counters so command invariants
 * and shell visibility cannot disagree.
 */
export function hasOpenBlockingRequest(session: Pick<OrchestrationSession, "activities">): boolean {
  const pendingApprovalIds = new Set<string>();
  const pendingUserInputIds = new Set<string>();

  for (const activity of session.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) {
      continue;
    }

    const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
    switch (activity.kind) {
      case "approval.requested":
        pendingApprovalIds.add(requestId);
        break;
      case "approval.resolved":
        pendingApprovalIds.delete(requestId);
        break;
      case "provider.approval.respond.failed":
        if (isStalePendingApprovalFailureDetail(detail)) {
          pendingApprovalIds.delete(requestId);
        }
        break;
      case "user-input.requested":
        pendingUserInputIds.add(requestId);
        break;
      case "user-input.resolved":
        pendingUserInputIds.delete(requestId);
        break;
      case "provider.user-input.respond.failed":
        if (isStalePendingUserInputFailureDetail(detail)) {
          pendingUserInputIds.delete(requestId);
        }
        break;
    }
  }

  return pendingApprovalIds.size > 0 || pendingUserInputIds.size > 0;
}

/**
 * Detect a user message whose turn has not yet been adopted. The absolute age
 * bound handles client clocks on either side of the server clock.
 */
export function hasQueuedTurnStart(
  session: Pick<OrchestrationSession, "messages" | "latestTurn" | "session">,
  occurredAt: string,
): boolean {
  if (session.session?.status === "error") {
    return false;
  }

  const latestUserMessageAtMs = session.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(latestUserMessageAtMs)) {
    return false;
  }

  const latestTurnAtMs =
    session.latestTurn === null
      ? Number.NEGATIVE_INFINITY
      : Math.max(
          ...[
            session.latestTurn.requestedAt,
            session.latestTurn.startedAt,
            session.latestTurn.completedAt,
          ].map((candidate) =>
            candidate === null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
          ),
        );
  const queuedAgeMs = Date.parse(occurredAt) - latestUserMessageAtMs;

  return (
    Number.isFinite(queuedAgeMs) &&
    latestUserMessageAtMs > latestTurnAtMs &&
    Math.abs(queuedAgeMs) <= QUEUED_TURN_START_GRACE_MS
  );
}
