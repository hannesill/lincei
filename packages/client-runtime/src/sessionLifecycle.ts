import type {
  OrchestrationLatestTurn,
  OrchestrationProviderRuntimeStatus,
} from "@t3tools/contracts";

export type ChangeRequestStateLike = "open" | "closed" | "merged";

interface SessionLifecycleRuntime {
  readonly status: string;
  readonly orchestrationStatus?: OrchestrationProviderRuntimeStatus;
  readonly updatedAt: string;
}

export interface SessionLifecycleShell {
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly session: SessionLifecycleRuntime | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly settledOverride: "settled" | "active" | null;
  readonly settledAt: string | null;
  readonly snoozedUntil: string | null;
  readonly snoozedAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
export const QUEUED_SESSION_TURN_START_GRACE_MS = 2 * 60 * 1_000;

function runtimeStatus(
  runtime: SessionLifecycleRuntime | null,
): OrchestrationProviderRuntimeStatus | string | null {
  return runtime?.orchestrationStatus ?? runtime?.status ?? null;
}

export function latestSessionActivityAt(
  shell: Pick<SessionLifecycleShell, "latestUserMessageAt" | "latestTurn">,
): string | null {
  const candidates = [
    shell.latestUserMessageAt,
    shell.latestTurn?.requestedAt,
    shell.latestTurn?.startedAt,
    shell.latestTurn?.completedAt,
  ];
  let latest: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    const timestamp = Date.parse(candidate);
    if (timestamp > latestTimestamp) {
      latest = candidate;
      latestTimestamp = timestamp;
    }
  }

  return latest;
}

export function hasQueuedSessionTurnStart(
  shell: Pick<SessionLifecycleShell, "latestUserMessageAt" | "latestTurn" | "session">,
  options: { readonly now: string },
): boolean {
  if (shell.latestUserMessageAt === null || runtimeStatus(shell.session) === "error") {
    return false;
  }
  const messageAt = Date.parse(shell.latestUserMessageAt);
  const now = Date.parse(options.now);
  if (!Number.isFinite(messageAt) || !Number.isFinite(now)) {
    return false;
  }
  if (Math.abs(now - messageAt) > QUEUED_SESSION_TURN_START_GRACE_MS) {
    return false;
  }
  if (shell.latestTurn === null) {
    return true;
  }
  return [
    shell.latestTurn.requestedAt,
    shell.latestTurn.startedAt,
    shell.latestTurn.completedAt,
  ].every((candidate) => candidate === null || Date.parse(candidate) < messageAt);
}

export function canSettleSession(
  shell: Pick<
    SessionLifecycleShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "session" | "latestUserMessageAt" | "latestTurn"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  const status = runtimeStatus(shell.session);
  if (status === "starting" || status === "running") {
    return false;
  }
  return !hasQueuedSessionTurnStart(shell, options);
}

export type SessionSnoozeShell = Pick<
  SessionLifecycleShell,
  | "updatedAt"
  | "snoozedUntil"
  | "snoozedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "session"
  | "latestTurn"
>;

export function sessionRaisedHandWhileSnoozed(shell: SessionSnoozeShell): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return true;
  }
  if (
    runtimeStatus(shell.session) === "error" &&
    (shell.snoozedAt === null ||
      Date.parse(shell.session?.updatedAt ?? "") > Date.parse(shell.snoozedAt))
  ) {
    return true;
  }
  return (
    shell.snoozedAt !== null &&
    shell.latestTurn?.state === "completed" &&
    shell.latestTurn.completedAt !== null &&
    Date.parse(shell.latestTurn.completedAt) > Date.parse(shell.snoozedAt)
  );
}

export function canSnoozeSession(
  shell: Pick<
    SessionLifecycleShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn" | "session"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  return !hasQueuedSessionTurnStart(shell, options);
}

export function effectiveSessionSnoozed(
  shell: SessionSnoozeShell,
  options: { readonly now: string },
): boolean {
  if (shell.snoozedUntil === null) {
    return false;
  }
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (!Number.isFinite(wakeAtMs) || wakeAtMs <= Date.parse(options.now)) {
    return false;
  }
  return !sessionRaisedHandWhileSnoozed(shell);
}

export function sessionWokeAt(
  shell: SessionSnoozeShell,
  options: { readonly now: string },
): string | null {
  if (shell.snoozedUntil === null) {
    return null;
  }
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (!Number.isFinite(wakeAtMs)) {
    return null;
  }
  if (sessionRaisedHandWhileSnoozed(shell)) {
    if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
      return shell.updatedAt;
    }
    if (
      shell.snoozedAt !== null &&
      shell.latestTurn?.state === "completed" &&
      shell.latestTurn.completedAt !== null &&
      Date.parse(shell.latestTurn.completedAt) > Date.parse(shell.snoozedAt)
    ) {
      return shell.latestTurn.completedAt;
    }
    return shell.session?.updatedAt ?? shell.updatedAt;
  }
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

/**
 * Resolve the server-backed settled lifecycle. Active work wins over every
 * manual or derived settle. Past those blockers, explicit overrides win, then
 * a merged/closed change request settles immediately at the final upstream
 * cutoff, and inactivity supplies the remaining automatic path.
 */
export function effectiveSessionSettled(
  shell: SessionLifecycleShell,
  options: {
    readonly now: string;
    readonly autoSettleAfterDays: number | null;
    readonly changeRequestState?: ChangeRequestStateLike | null;
  },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) {
    return false;
  }
  const status = runtimeStatus(shell.session);
  if (status === "starting" || status === "running") {
    return false;
  }
  if (hasQueuedSessionTurnStart(shell, { now: options.now })) {
    const serverAdjudicated =
      shell.settledOverride === "settled" &&
      shell.settledAt !== null &&
      shell.latestUserMessageAt !== null &&
      Date.parse(shell.settledAt) >= Date.parse(shell.latestUserMessageAt);
    if (!serverAdjudicated) {
      return false;
    }
  }

  if (shell.settledOverride === "settled") {
    return true;
  }
  if (shell.settledOverride === "active") {
    return false;
  }
  if (options.changeRequestState === "merged" || options.changeRequestState === "closed") {
    return true;
  }
  if (options.autoSettleAfterDays === null) {
    return false;
  }

  const lastActivityAt = latestSessionActivityAt(shell);
  return (
    lastActivityAt !== null &&
    Date.parse(lastActivityAt) < Date.parse(options.now) - options.autoSettleAfterDays * DAY_MS
  );
}
