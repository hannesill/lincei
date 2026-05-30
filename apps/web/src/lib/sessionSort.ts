import type { ProjectId } from "@t3tools/contracts";
import type { SidebarProjectSortOrder, SidebarSessionSortOrder } from "@t3tools/contracts/settings";
import type { Session } from "../types";

export type SessionSortInput = Pick<Session, "createdAt" | "updatedAt"> & {
  latestUserMessageAt?: string | null;
  messages?: Pick<Session["messages"][number], "createdAt" | "role">[];
};

export function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getFirstSortableTimestamp(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    const timestamp = toSortableTimestamp(value ?? undefined);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function getLatestUserMessageTimestamp(session: SessionSortInput): number {
  if (session.latestUserMessageAt) {
    return toSortableTimestamp(session.latestUserMessageAt) ?? Number.NEGATIVE_INFINITY;
  }

  let latestUserMessageTimestamp: number | null = null;

  for (const message of session.messages ?? []) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return (
    getFirstSortableTimestamp(session.updatedAt, session.createdAt) ?? Number.NEGATIVE_INFINITY
  );
}

export function getSessionSortTimestamp(
  session: SessionSortInput,
  sortOrder: SidebarSessionSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return (
      getFirstSortableTimestamp(session.createdAt, session.updatedAt) ?? Number.NEGATIVE_INFINITY
    );
  }
  return getLatestUserMessageTimestamp(session);
}

export function sortSessions<T extends Pick<Session, "id"> & SessionSortInput>(
  sessions: readonly T[],
  sortOrder: SidebarSessionSortOrder,
): T[] {
  return sessions.toSorted((left, right) => {
    const rightTimestamp = getSessionSortTimestamp(right, sortOrder);
    const leftTimestamp = getSessionSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getLatestSessionForProject<
  T extends Pick<Session, "id" | "projectId" | "archivedAt"> & SessionSortInput,
>(sessions: readonly T[], projectId: ProjectId, sortOrder: SidebarSessionSortOrder): T | null {
  return (
    sortSessions(
      sessions.filter((session) => session.projectId === projectId && session.archivedAt === null),
      sortOrder,
    )[0] ?? null
  );
}
