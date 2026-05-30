import * as React from "react";
import type { SidebarProjectSortOrder, SidebarSessionSortOrder } from "@t3tools/contracts/settings";
import {
  getSessionSortTimestamp,
  sortSessions,
  toSortableTimestamp,
  type SessionSortInput,
} from "../lib/sessionSort";
import type { SidebarSessionSummary, Session } from "../types";
import { cn } from "../lib/utils";
import { isLatestTurnSettled } from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-session-item], [data-session-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
// Visible sidebar rows are prewarmed into the session-detail cache so opening a
// nearby session usually reuses an already-hot subscription.
export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;
export type SidebarNewSessionEnvMode = "local" | "worktree";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export type SessionTraversalDirection = "previous" | "next";

export interface SessionStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<SessionStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type SessionStatusInput = Pick<
  SidebarSessionSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
> & {
  lastVisitedAt?: string | undefined;
};

export interface SessionJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createSessionJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): SessionJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useSessionJumpHintVisibility(): {
  showSessionJumpHints: boolean;
  updateSessionJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showSessionJumpHints, setShowSessionJumpHints] = React.useState(false);
  const controllerRef = React.useRef<SessionJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createSessionJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowSessionJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateSessionJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showSessionJumpHints,
    updateSessionJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(session: SessionStatusInput): boolean {
  if (!session.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(session.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!session.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(session.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearSessionSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewSessionEnvMode(input: {
  requestedEnvMode?: SidebarNewSessionEnvMode;
  defaultEnvMode: SidebarNewSessionEnvMode;
}): SidebarNewSessionEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveSidebarNewSessionSeedContext(input: {
  projectId: string;
  defaultEnvMode: SidebarNewSessionEnvMode;
  activeSession?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
  } | null;
  activeDraftSession?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
    envMode: SidebarNewSessionEnvMode;
  } | null;
}): {
  branch?: string | null;
  worktreePath?: string | null;
  envMode: SidebarNewSessionEnvMode;
} {
  if (input.defaultEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  if (input.activeDraftSession?.projectId === input.projectId) {
    return {
      branch: input.activeDraftSession.branch,
      worktreePath: input.activeDraftSession.worktreePath,
      envMode: input.activeDraftSession.envMode,
    };
  }

  if (input.activeSession?.projectId === input.projectId) {
    return {
      branch: input.activeSession.branch,
      worktreePath: input.activeSession.worktreePath,
      envMode: input.activeSession.worktreePath ? "worktree" : "local",
    };
  }

  return {
    envMode: input.defaultEnvMode,
  };
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarSessionIds<TSessionId>(
  renderedProjects: readonly {
    shouldShowSessionPanel?: boolean;
    renderedSessionIds: readonly TSessionId[];
  }[],
): TSessionId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowSessionPanel === false ? [] : renderedProject.renderedSessionIds,
  );
}

export function getSidebarSessionIdsToPrewarm<TSessionId>(
  visibleSessionIds: readonly TSessionId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TSessionId[] {
  return visibleSessionIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentSessionId<T>(input: {
  sessionIds: readonly T[];
  currentSessionId: T | null;
  direction: SessionTraversalDirection;
}): T | null {
  const { currentSessionId, direction, sessionIds } = input;

  if (sessionIds.length === 0) {
    return null;
  }

  if (currentSessionId === null) {
    return direction === "previous" ? (sessionIds.at(-1) ?? null) : (sessionIds[0] ?? null);
  }

  const currentIndex = sessionIds.indexOf(currentSessionId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (sessionIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < sessionIds.length - 1 ? (sessionIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveSessionRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-6 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:h-7";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-accent text-sidebar-accent-foreground font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-accent text-sidebar-accent-foreground font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );
  }

  return cn(
    baseClassName,
    "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );
}

export function resolveSessionStatusPill(input: {
  session: SessionStatusInput;
}): SessionStatusPill | null {
  const { session } = input;

  if (session.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (session.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (session.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (session.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !session.hasPendingUserInput &&
    session.interactionMode === "plan" &&
    isLatestTurnSettled(session.latestTurn, session.session) &&
    session.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(session)) {
    return {
      label: "Completed",
      colorClass: "text-zinc-600 dark:text-zinc-300/90",
      dotClass: "bg-zinc-500 dark:bg-zinc-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<SessionStatusPill | null>,
): SessionStatusPill | null {
  let highestPriorityStatus: SessionStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleSessionsForProject<T extends Pick<Session, "id">>(input: {
  sessions: readonly T[];
  activeSessionId: T["id"] | undefined;
  isSessionListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenSessions: boolean;
  visibleSessions: T[];
  hiddenSessions: T[];
} {
  const { activeSessionId, isSessionListExpanded, previewLimit, sessions } = input;
  const hasHiddenSessions = sessions.length > previewLimit;

  if (!hasHiddenSessions || isSessionListExpanded) {
    return {
      hasHiddenSessions,
      hiddenSessions: [],
      visibleSessions: [...sessions],
    };
  }

  const previewSessions = sessions.slice(0, previewLimit);
  if (!activeSessionId || previewSessions.some((session) => session.id === activeSessionId)) {
    return {
      hasHiddenSessions: true,
      hiddenSessions: sessions.slice(previewLimit),
      visibleSessions: previewSessions,
    };
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  if (!activeSession) {
    return {
      hasHiddenSessions: true,
      hiddenSessions: sessions.slice(previewLimit),
      visibleSessions: previewSessions,
    };
  }

  const visibleSessionIds = new Set(
    [...previewSessions, activeSession].map((session) => session.id),
  );

  return {
    hasHiddenSessions: true,
    hiddenSessions: sessions.filter((session) => !visibleSessionIds.has(session.id)),
    visibleSessions: sessions.filter((session) => visibleSessionIds.has(session.id)),
  };
}

export function getFallbackSessionIdAfterDelete<
  T extends Pick<Session, "id" | "projectId" | "createdAt" | "updatedAt"> & SessionSortInput,
>(input: {
  sessions: readonly T[];
  deletedSessionId: T["id"];
  sortOrder: SidebarSessionSortOrder;
  deletedSessionIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedSessionId, deletedSessionIds, sortOrder, sessions } = input;
  const deletedSession = sessions.find((session) => session.id === deletedSessionId);
  if (!deletedSession) {
    return null;
  }

  return (
    sortSessions(
      sessions.filter(
        (session) =>
          session.projectId === deletedSession.projectId &&
          session.id !== deletedSessionId &&
          !deletedSessionIds?.has(session.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectSessions: readonly SessionSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectSessions.length > 0) {
    return projectSessions.reduce(
      (latest, session) => Math.max(latest, getSessionSortTimestamp(session, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TSession extends Pick<Session, "projectId" | "createdAt" | "updatedAt"> & SessionSortInput,
>(
  projects: readonly TProject[],
  sessions: readonly TSession[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const sessionsByProjectId = new Map<string, TSession[]>();
  for (const session of sessions) {
    const existing = sessionsByProjectId.get(session.projectId) ?? [];
    existing.push(session);
    sessionsByProjectId.set(session.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      sessionsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      sessionsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
