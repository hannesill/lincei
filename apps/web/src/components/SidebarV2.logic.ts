import {
  canSettleSession,
  canSnoozeSession,
  effectiveSessionSettled,
  effectiveSessionSnoozed,
  sessionWokeAt,
  type ChangeRequestStateLike,
  type SessionLifecycleShell,
} from "@t3tools/client-runtime";
import { scopeProjectRef, scopeSessionRef, scopedSessionKey } from "@t3tools/client-runtime";
import type {
  CommandId,
  DispatchableClientOrchestrationCommand,
  ProjectId,
  ScopedProjectRef,
  ScopedSessionRef,
  SessionEnvMode,
} from "@t3tools/contracts";

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

export function resolveRoutedSessionWakeAcknowledgementAt(input: {
  routeSessionKey: string | null;
  session: SidebarSessionSummary | null | undefined;
  lastVisitedAt: string | null | undefined;
  now: string;
}): string | null {
  if (
    input.routeSessionKey === null ||
    !input.session ||
    sidebarV2SessionRowKey(input.session) !== input.routeSessionKey
  ) {
    return null;
  }
  const wokeAt = sessionWokeAt(toSessionLifecycleShell(input.session), { now: input.now });
  if (wokeAt === null) return null;

  const wokeAtMs = Date.parse(wokeAt);
  if (!Number.isFinite(wokeAtMs)) return null;
  const lastVisitedAtMs =
    input.lastVisitedAt === null || input.lastVisitedAt === undefined
      ? Number.NaN
      : Date.parse(input.lastVisitedAt);
  if (Number.isFinite(lastVisitedAtMs) && lastVisitedAtMs >= wokeAtMs) return null;
  return wokeAt;
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

export function pageSessionsWithRouteRetention(input: {
  sessions: ReadonlyArray<SidebarSessionSummary>;
  visibleCount: number;
  routeSessionRef: ScopedSessionRef | null;
}): SidebarSessionSummary[] {
  const visible = input.sessions.slice(0, Math.max(0, input.visibleCount));
  if (!input.routeSessionRef) return visible;
  const routeSession = input.sessions.find(
    (session) =>
      session.environmentId === input.routeSessionRef?.environmentId &&
      session.id === input.routeSessionRef.sessionId,
  );
  if (
    !routeSession ||
    visible.some(
      (session) =>
        session.environmentId === routeSession.environmentId && session.id === routeSession.id,
    )
  ) {
    return visible;
  }
  return [...visible, routeSession];
}

export function sessionsRequiringChangeRequestObservation(input: {
  active: ReadonlyArray<SidebarSessionSummary>;
  visibleSnoozed: ReadonlyArray<SidebarSessionSummary>;
  visibleSettled: ReadonlyArray<SidebarSessionSummary>;
}): SidebarSessionSummary[] {
  const result = new Map<string, SidebarSessionSummary>();
  for (const session of [...input.active, ...input.visibleSnoozed, ...input.visibleSettled]) {
    if (session.archivedAt !== null || session.branch === null) continue;
    result.set(sidebarV2SessionRowKey(session), session);
  }
  return [...result.values()];
}

export function sidebarV2SessionRowKey(session: SidebarSessionSummary): string {
  return scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
}

export interface SidebarV2ProjectDeleteRouteSnapshot {
  routeKey: string | null;
  projectRef: ScopedProjectRef | null;
}

type SidebarV2RouteParams = Partial<
  Record<"environmentId" | "sessionId" | "draftId", string | undefined>
>;

interface SidebarV2RouteMatchLike {
  params: SidebarV2RouteParams;
}

export function latestSidebarV2RouteParams(input: {
  matches: readonly SidebarV2RouteMatchLike[];
  pendingMatches?: readonly SidebarV2RouteMatchLike[] | null | undefined;
}): SidebarV2RouteParams {
  const latestMatches =
    input.pendingMatches && input.pendingMatches.length > 0 ? input.pendingMatches : input.matches;
  return latestMatches[latestMatches.length - 1]?.params ?? {};
}

type SidebarV2ProjectIdentity = Pick<SidebarSessionSummary, "environmentId" | "projectId">;

export function sidebarV2DraftSessionKeysForProject(
  draftsBySessionKey: Readonly<Record<string, SidebarV2ProjectIdentity>>,
  projectRef: ScopedProjectRef,
): string[] {
  return Object.entries(draftsBySessionKey)
    .filter(
      ([, draft]) =>
        draft.environmentId === projectRef.environmentId &&
        draft.projectId === projectRef.projectId,
    )
    .map(([sessionKey]) => sessionKey);
}

export function resolveSidebarV2ServerRouteProjectRef(input: {
  detailSession?: SidebarV2ProjectIdentity | null | undefined;
  sidebarSession?: SidebarV2ProjectIdentity | null | undefined;
}): ScopedProjectRef | null {
  const session = input.detailSession ?? input.sidebarSession;
  return session ? scopeProjectRef(session.environmentId, session.projectId) : null;
}

export function shouldNavigateAfterSidebarV2ProjectDelete(input: {
  deletedProjectRef: ScopedProjectRef;
  routeBeforeDelete: SidebarV2ProjectDeleteRouteSnapshot;
  routeAfterDelete: SidebarV2ProjectDeleteRouteSnapshot;
}): boolean {
  const routeProjectBefore = input.routeBeforeDelete.projectRef;
  const routeProjectAfter = input.routeAfterDelete.projectRef;
  return (
    input.routeBeforeDelete.routeKey !== null &&
    input.routeBeforeDelete.routeKey === input.routeAfterDelete.routeKey &&
    routeProjectBefore !== null &&
    routeProjectBefore.environmentId === input.deletedProjectRef.environmentId &&
    routeProjectBefore.projectId === input.deletedProjectRef.projectId &&
    routeProjectAfter !== null &&
    routeProjectAfter.environmentId === input.deletedProjectRef.environmentId &&
    routeProjectAfter.projectId === input.deletedProjectRef.projectId
  );
}

export function sidebarV2ProjectDeleteConfirmation(input: { name: string; cwd: string }): string {
  return [
    `Remove project "${input.name}"?`,
    `Path: ${input.cwd}`,
    "This permanently deletes all sessions for this project, including archived sessions.",
    "This action cannot be undone.",
  ].join("\n");
}

type SidebarV2ProjectDeleteCommand = Extract<
  DispatchableClientOrchestrationCommand,
  { type: "project.delete" }
>;

export function buildSidebarV2ProjectDeleteCommand(input: {
  commandId: CommandId;
  projectId: ProjectId;
}): SidebarV2ProjectDeleteCommand {
  return {
    type: "project.delete",
    commandId: input.commandId,
    projectId: input.projectId,
    force: true,
  };
}

export async function completeSidebarV2ProjectDelete<T>(input: {
  dispatchDelete: () => Promise<unknown>;
  readRouteAfterDelete: () => T;
  cleanupDrafts: () => void;
}): Promise<T> {
  await input.dispatchDelete();
  try {
    return input.readRouteAfterDelete();
  } finally {
    input.cleanupDrafts();
  }
}

export function resolveSidebarV2NewSessionOptions(defaultSessionEnvMode: SessionEnvMode): {
  envMode: SessionEnvMode;
  branch: null;
  worktreePath: null;
} {
  return {
    envMode: defaultSessionEnvMode,
    branch: null,
    worktreePath: null,
  };
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
