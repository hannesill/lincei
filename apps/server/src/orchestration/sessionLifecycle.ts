import type { OrchestrationSession } from "@t3tools/contracts";

// Provider adoption normally takes seconds. A newer user message that still
// has no matching turn after this window is stale/failed history, not work
// that should remain permanently unsettleable or unsnoozable.
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

export function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  const normalizedDetail = detail.toLowerCase();
  return (
    normalizedDetail.includes("stale pending approval request") ||
    normalizedDetail.includes("unknown pending approval request") ||
    normalizedDetail.includes("unknown pending permission request")
  );
}

export function isStalePendingUserInputFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  const normalizedDetail = detail.toLowerCase();
  return (
    normalizedDetail.includes("stale pending user-input request") ||
    normalizedDetail.includes("unknown pending user-input request") ||
    normalizedDetail.includes("unknown pending user input request") ||
    normalizedDetail.includes("unknown pending codex user input request")
  );
}

interface RequestLifecycleActivity {
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt?: string;
  readonly eventOccurredAt?: string | null;
}

export interface PendingRequestCounts {
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly pendingRequestRaisedAt: string | null;
}

export function extractLifecycleRequestId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : null;
}

function extractFailureDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const detail = (payload as Record<string, unknown>).detail;
  return typeof detail === "string" ? detail : null;
}

/**
 * Reconstruct blocked-on-user work from a sequence-ordered durable activity
 * stream. Request identity, rather than timestamps, determines transitions.
 */
export function derivePendingRequestCounts(
  activities: ReadonlyArray<RequestLifecycleActivity>,
): PendingRequestCounts {
  const pendingApprovalIds = new Map<string, string | null>();
  const pendingUserInputIds = new Map<string, string | null>();

  for (const activity of activities) {
    const requestId = extractLifecycleRequestId(activity.payload);
    if (requestId === null) {
      continue;
    }

    const detail = extractFailureDetail(activity.payload);
    const raisedAt = activity.eventOccurredAt ?? activity.createdAt ?? null;
    switch (activity.kind) {
      case "approval.requested":
        pendingApprovalIds.set(requestId, raisedAt);
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
        pendingUserInputIds.set(requestId, raisedAt);
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

  const pendingRequestRaisedAt = [
    ...pendingApprovalIds.values(),
    ...pendingUserInputIds.values(),
  ].reduce<string | null>(
    (latest, raisedAt) =>
      raisedAt !== null && (latest === null || raisedAt > latest) ? raisedAt : latest,
    null,
  );

  return {
    pendingApprovalCount: pendingApprovalIds.size,
    pendingUserInputCount: pendingUserInputIds.size,
    pendingRequestRaisedAt,
  };
}

/**
 * Advance the uncapped in-memory summary for a newly appended activity. The
 * durable projection remains authoritative and is rehydrated after commit.
 */
export function advancePendingRequestCounts(
  counts: PendingRequestCounts,
  activity: RequestLifecycleActivity,
): PendingRequestCounts {
  const requestId = extractLifecycleRequestId(activity.payload);
  if (requestId === null) {
    return counts;
  }
  const detail = extractFailureDetail(activity.payload);
  const raisedAt = activity.eventOccurredAt ?? activity.createdAt ?? null;
  const latestRaisedAt =
    raisedAt !== null &&
    (counts.pendingRequestRaisedAt === null || raisedAt > counts.pendingRequestRaisedAt)
      ? raisedAt
      : counts.pendingRequestRaisedAt;
  const clearRaisedAtIfResolved = (pendingApprovalCount: number, pendingUserInputCount: number) =>
    pendingApprovalCount === 0 && pendingUserInputCount === 0
      ? null
      : counts.pendingRequestRaisedAt;

  switch (activity.kind) {
    case "approval.requested":
      return {
        ...counts,
        pendingApprovalCount: counts.pendingApprovalCount + 1,
        pendingRequestRaisedAt: latestRaisedAt,
      };
    case "approval.resolved": {
      const pendingApprovalCount = Math.max(0, counts.pendingApprovalCount - 1);
      return {
        ...counts,
        pendingApprovalCount,
        pendingRequestRaisedAt: clearRaisedAtIfResolved(
          pendingApprovalCount,
          counts.pendingUserInputCount,
        ),
      };
    }
    case "provider.approval.respond.failed":
      if (!isStalePendingApprovalFailureDetail(detail)) {
        return counts;
      }
      {
        const pendingApprovalCount = Math.max(0, counts.pendingApprovalCount - 1);
        return {
          ...counts,
          pendingApprovalCount,
          pendingRequestRaisedAt: clearRaisedAtIfResolved(
            pendingApprovalCount,
            counts.pendingUserInputCount,
          ),
        };
      }
    case "user-input.requested":
      return {
        ...counts,
        pendingUserInputCount: counts.pendingUserInputCount + 1,
        pendingRequestRaisedAt: latestRaisedAt,
      };
    case "user-input.resolved": {
      const pendingUserInputCount = Math.max(0, counts.pendingUserInputCount - 1);
      return {
        ...counts,
        pendingUserInputCount,
        pendingRequestRaisedAt: clearRaisedAtIfResolved(
          counts.pendingApprovalCount,
          pendingUserInputCount,
        ),
      };
    }
    case "provider.user-input.respond.failed":
      if (!isStalePendingUserInputFailureDetail(detail)) {
        return counts;
      }
      {
        const pendingUserInputCount = Math.max(0, counts.pendingUserInputCount - 1);
        return {
          ...counts,
          pendingUserInputCount,
          pendingRequestRaisedAt: clearRaisedAtIfResolved(
            counts.pendingApprovalCount,
            pendingUserInputCount,
          ),
        };
      }
    default:
      return counts;
  }
}

export function hasOpenBlockingRequest(
  session: Pick<OrchestrationSession, "pendingApprovalCount" | "pendingUserInputCount">,
): boolean {
  return (session.pendingApprovalCount ?? 0) > 0 || (session.pendingUserInputCount ?? 0) > 0;
}

/**
 * Detect a user message whose turn has not yet been adopted. The absolute age
 * bound handles client clocks on either side of the server clock.
 */
export function hasQueuedTurnStart(
  session: Pick<OrchestrationSession, "latestUserMessageAt" | "latestTurn" | "session">,
  occurredAt: string,
): boolean {
  if (session.session?.status === "error") {
    return false;
  }

  const latestUserMessageAtMs =
    session.latestUserMessageAt == null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(session.latestUserMessageAt);
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
