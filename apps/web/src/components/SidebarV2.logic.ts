import {
  canSettleSession,
  canSnoozeSession,
  effectiveSessionSettled,
  effectiveSessionSnoozed,
  type ChangeRequestStateLike,
  type SessionLifecycleShell,
} from "@t3tools/client-runtime";
import { scopeSessionRef, scopedSessionKey } from "@t3tools/client-runtime";
import type { ScopedSessionRef, SessionEnvMode } from "@t3tools/contracts";

import { sortSessionsForSidebarV2, sortSettledSessionsForSidebarV2 } from "./Sidebar.logic";
import type { SidebarSessionSummary } from "../types";

export type SidebarV2Section = "active" | "snoozed" | "settled";

export interface SidebarV2Partition {
  active: SidebarSessionSummary[];
  snoozed: SidebarSessionSummary[];
  settled: SidebarSessionSummary[];
}

export type ParkedSessionComposerState = "snoozed" | "settled";

export function toSessionLifecycleShell(session: SidebarSessionSummary): SessionLifecycleShell {
  return {
    ...session,
    updatedAt: session.updatedAt ?? session.createdAt,
  };
}

export function partitionSidebarV2Sessions(input: {
  sessions: ReadonlyArray<SidebarSessionSummary>;
  now: string;
  autoSettleAfterDays: number | null;
  changeRequestStateBySessionKey?: ReadonlyMap<string, ChangeRequestStateLike | null>;
  settlementSupported: (session: SidebarSessionSummary) => boolean;
  snoozeSupported: (session: SidebarSessionSummary) => boolean;
}): SidebarV2Partition {
  const active: SidebarSessionSummary[] = [];
  const snoozed: SidebarSessionSummary[] = [];
  const settled: SidebarSessionSummary[] = [];

  for (const session of input.sessions) {
    if (session.archivedAt !== null) continue;
    const shell = toSessionLifecycleShell(session);
    if (
      input.snoozeSupported(session) &&
      effectiveSessionSnoozed(shell, {
        now: input.now,
      })
    ) {
      snoozed.push(session);
      continue;
    }
    const sessionKey = scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
    if (
      input.settlementSupported(session) &&
      effectiveSessionSettled(shell, {
        now: input.now,
        autoSettleAfterDays: input.autoSettleAfterDays,
        changeRequestState: input.changeRequestStateBySessionKey?.get(sessionKey) ?? null,
      })
    ) {
      settled.push(session);
      continue;
    }
    active.push(session);
  }

  return {
    active: sortSessionsForSidebarV2(active),
    snoozed: sortSessionsForSidebarV2(snoozed),
    settled: sortSettledSessionsForSidebarV2(settled),
  };
}

export function resolveParkedSessionComposerState(input: {
  session: SidebarSessionSummary | null | undefined;
  now: string;
  autoSettleAfterDays: number | null;
  changeRequestState?: ChangeRequestStateLike | null;
  settlementSupported: boolean;
  snoozeSupported: boolean;
}): ParkedSessionComposerState | null {
  if (!input.session || input.session.archivedAt !== null) return null;
  const shell = toSessionLifecycleShell(input.session);
  if (input.snoozeSupported && effectiveSessionSnoozed(shell, { now: input.now })) {
    return "snoozed";
  }
  if (
    input.settlementSupported &&
    effectiveSessionSettled(shell, {
      now: input.now,
      autoSettleAfterDays: input.autoSettleAfterDays,
      changeRequestState: input.changeRequestState ?? null,
    })
  ) {
    return "settled";
  }
  return null;
}

export function parkedSessionsVisibleWhenCollapsed(input: {
  sessions: ReadonlyArray<SidebarSessionSummary>;
  expanded: boolean;
  routeSessionRef: ScopedSessionRef | null;
}): SidebarSessionSummary[] {
  if (input.expanded) return [...input.sessions];
  if (!input.routeSessionRef) return [];
  return input.sessions.filter(
    (session) =>
      session.environmentId === input.routeSessionRef?.environmentId &&
      session.id === input.routeSessionRef.sessionId,
  );
}

export function resolveSidebarV2NewSessionOptions(defaultSessionEnvMode: SessionEnvMode): {
  envMode: SessionEnvMode;
} {
  return { envMode: defaultSessionEnvMode };
}

export type SessionLifecycleAction = "settle" | "unsettle" | "snooze" | "unsnooze";

export function canDispatchSessionLifecycleAction(input: {
  action: SessionLifecycleAction;
  session: SidebarSessionSummary;
  now: string;
  settlementSupported: boolean;
  snoozeSupported: boolean;
}): boolean {
  const shell = toSessionLifecycleShell(input.session);
  switch (input.action) {
    case "settle":
      return input.settlementSupported && canSettleSession(shell, { now: input.now });
    case "unsettle":
      return input.settlementSupported;
    case "snooze":
      return input.snoozeSupported && canSnoozeSession(shell, { now: input.now });
    case "unsnooze":
      return input.snoozeSupported;
  }
}
