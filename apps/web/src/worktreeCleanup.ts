import type { Session } from "./types";

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function getOrphanedWorktreePathForSession(
  sessions: readonly Session[],
  sessionId: Session["id"],
): string | null {
  const targetSession = sessions.find((session) => session.id === sessionId);
  if (!targetSession) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetSession.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = sessions.some((session) => {
    if (session.id === sessionId) {
      return false;
    }
    return normalizeWorktreePath(session.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}
