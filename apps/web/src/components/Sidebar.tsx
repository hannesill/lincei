import {
  ArchiveIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  CloudIcon,
  FolderPlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveSessionPr,
  terminalStatusFromRunningIds,
  SessionStatusLabel,
} from "./SessionStatusIndicators";
import { ProjectFavicon } from "./ProjectFavicon";
import { autoAnimate } from "@formkit/auto-animate";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type ContextMenuItem,
  type DesktopUpdateState,
  ProjectId,
  type ScopedSessionRef,
  type SidebarProjectGroupingMode,
  type SessionEnvMode,
  SessionId,
} from "@t3tools/contracts";
import {
  parseScopedSessionKey,
  scopedProjectKey,
  scopedSessionKey,
  scopeProjectRef,
  scopeSessionRef,
} from "@t3tools/client-runtime";
import { Link, useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import {
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  type SidebarProjectSortOrder,
  type SidebarSessionPreviewCount,
  type SidebarSessionSortOrder,
} from "@t3tools/contracts/settings";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { isElectron } from "../env";
import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isMacPlatform, newCommandId } from "../lib/utils";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarSessionsForProjectRefs,
  selectSidebarSessionsAcrossEnvironments,
  selectSessionByRef,
  useStore,
} from "../store";
import { selectSessionTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowSessionJumpHintsForModifiers,
  sessionJumpCommandForIndex,
  sessionJumpIndexFromCommand,
  sessionTraversalDirectionFromCommand,
} from "../shortcuts";
import { useModelPickerOpen } from "../modelPickerOpenState";
import { useShortcutModifierState } from "../shortcutModifierState";
import { useGitStatus } from "../lib/gitStatusState";
import { readLocalApi } from "../localApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewSessionHandler } from "../hooks/useHandleNewSession";
import { retainSessionDetailSubscription } from "../environments/runtime/service";

import { useSessionActions } from "../hooks/useSessionActions";
import {
  buildSessionRouteParams,
  resolveSessionRouteRef,
  resolveSessionRouteTarget,
} from "../sessionRoutes";
import { stackedSessionToast, toastManager } from "./ui/toast";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { Kbd } from "./ui/kbd";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "./ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { useSessionSelectionStore } from "../sessionSelectionStore";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  getSidebarSessionIdsToPrewarm,
  resolveAdjacentSessionId,
  isContextMenuPointerDown,
  resolveProjectStatusIndicator,
  resolveSidebarNewSessionSeedContext,
  resolveSidebarNewSessionEnvMode,
  resolveSessionRowClassName,
  resolveSessionStatusPill,
  orderItemsByPreferredIds,
  shouldClearSessionSelectionOnMouseDown,
  sortProjectsForSidebar,
  useSessionJumpHintVisibility,
  SessionStatusPill,
} from "./Sidebar.logic";
import { sortSessions } from "../lib/sessionSort";
import { SidebarUpdatePill } from "./sidebar/SidebarUpdatePill";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { CommandDialogTrigger } from "./ui/command";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useServerShortcuts } from "../rpc/serverState";
import {
  derivePhysicalProjectKey,
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import type { SidebarSessionSummary } from "../types";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { SidebarProviderUpdatePill } from "./sidebar/SidebarProviderUpdatePill";
import { useDesktopTitlebarLayout } from "./sidebar/titlebarSidebarLayout";
const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarSessionSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();
const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};
const SIDEBAR_CHROME_TRIGGER_CLASS =
  "size-6 rounded-md p-0 before:rounded-[calc(var(--radius-md)-1px)] hover:bg-sidebar-accent/70 data-[pressed]:bg-sidebar-accent/70 [&_svg]:size-4";

function clampSidebarSessionPreviewCount(value: number): SidebarSessionPreviewCount {
  return Math.min(
    MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
    Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, value),
  ) as SidebarSessionPreviewCount;
}

function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.name;
  }

  return member.environmentLabel ? `${member.environmentLabel} — ${member.cwd}` : member.cwd;
}

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Studies from the same repository share one sidebar row.";
    case "repository_path":
      return "Studies group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every study path gets its own sidebar row.";
  }
}

function buildSessionJumpLabelMap(input: {
  shortcuts: ReturnType<typeof useServerShortcuts>;
  platform: string;
  terminalOpen: boolean;
  sessionJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof sessionJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.sessionJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<string, string>();
  for (const [sessionKey, command] of input.sessionJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.shortcuts, command, shortcutLabelOptions);
    if (label) {
      mapping.set(sessionKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

interface SidebarSessionRowProps {
  session: SidebarSessionSummary;
  projectCwd: string | null;
  orderedProjectSessionKeys: readonly string[];
  isActive: boolean;
  jumpLabel: string | null;
  appSettingsConfirmSessionArchive: boolean;
  renamingSessionKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveSessionKey: string | null;
  setConfirmingArchiveSessionKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  handleSessionClick: (
    event: React.MouseEvent,
    sessionRef: ScopedSessionRef,
    orderedProjectSessionKeys: readonly string[],
  ) => void;
  navigateToSession: (sessionRef: ScopedSessionRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleSessionContextMenu: (
    sessionRef: ScopedSessionRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    sessionRef: ScopedSessionRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveSession: (sessionRef: ScopedSessionRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
}

const SidebarSessionRow = memo(function SidebarSessionRow(props: SidebarSessionRowProps) {
  const {
    orderedProjectSessionKeys,
    isActive,
    jumpLabel,
    appSettingsConfirmSessionArchive,
    renamingSessionKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveSessionKey,
    setConfirmingArchiveSessionKey,
    confirmArchiveButtonRefs,
    handleSessionClick,
    navigateToSession,
    handleMultiSelectContextMenu,
    handleSessionContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveSession,
    openPrLink,
    session,
  } = props;
  const sessionRef = scopeSessionRef(session.environmentId, session.id);
  const sessionKey = scopedSessionKey(sessionRef);
  const lastVisitedAt = useUiStateStore((state) => state.sessionLastVisitedAtById[sessionKey]);
  const isSelected = useSessionSelectionStore((state) => state.selectedSessionKeys.has(sessionKey));
  const runningTerminalIds = useTerminalStateStore(
    (state) =>
      selectSessionTerminalState(state.terminalStateBySessionKey, sessionRef).runningTerminalIds,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteSession =
    primaryEnvironmentId !== null && session.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = useSavedEnvironmentRuntimeStore(
    (s) => s.byId[session.environmentId]?.descriptor?.label ?? null,
  );
  const remoteEnvSavedLabel = useSavedEnvironmentRegistryStore(
    (s) => s.byId[session.environmentId]?.label ?? null,
  );
  const sessionEnvironmentLabel = isRemoteSession
    ? (remoteEnvLabel ?? remoteEnvSavedLabel ?? "Remote")
    : null;
  // For grouped projects, the session may belong to a different environment
  // than the representative project.  Look up the session's own project cwd
  // so git status (and thus PR detection) queries the correct path.
  const sessionProjectCwd = useStore(
    useMemo(
      () => (state: import("../store").AppState) =>
        selectProjectByRef(state, scopeProjectRef(session.environmentId, session.projectId))?.cwd ??
        null,
      [session.environmentId, session.projectId],
    ),
  );
  const gitCwd = session.worktreePath ?? sessionProjectCwd ?? props.projectCwd;
  const gitStatus = useGitStatus({
    environmentId: session.environmentId,
    cwd: session.branch != null ? gitCwd : null,
  });
  const isHighlighted = isActive || isSelected;
  const isSessionRunning =
    session.session?.status === "running" && session.session.activeTurnId != null;
  const sessionStatus = resolveSessionStatusPill({
    session: {
      ...session,
      lastVisitedAt,
    },
  });
  const pr = resolveSessionPr(session.branch, gitStatus.data);
  const prStatus = prStatusIndicator(pr, gitStatus.data?.sourceControlProvider);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const isConfirmingArchive = confirmingArchiveSessionKey === sessionKey && !isSessionRunning;
  const sessionMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : !isSessionRunning
      ? "pointer-events-none transition-opacity duration-150 max-sm:pr-6 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0"
      : "pointer-events-none";
  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveSessionKey((current) => (current === sessionKey ? null : current));
  }, [setConfirmingArchiveSessionKey, sessionKey]);
  const handleMouseLeave = useCallback(() => {
    clearConfirmingArchive();
  }, [clearConfirmingArchive]);
  const handleBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLLIElement>) => {
      const currentTarget = event.currentTarget;
      requestAnimationFrame(() => {
        if (currentTarget.contains(document.activeElement)) {
          return;
        }
        clearConfirmingArchive();
      });
    },
    [clearConfirmingArchive],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      handleSessionClick(event, sessionRef, orderedProjectSessionKeys);
    },
    [handleSessionClick, orderedProjectSessionKeys, sessionRef],
  );
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToSession(sessionRef);
    },
    [navigateToSession, sessionRef],
  );
  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const hasSelection = useSessionSelectionStore.getState().hasSelection();
      if (hasSelection && isSelected) {
        void handleMultiSelectContextMenu({
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      if (hasSelection) {
        clearSelection();
      }
      void handleSessionContextMenu(sessionRef, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [
      clearSelection,
      handleMultiSelectContextMenu,
      handleSessionContextMenu,
      isSelected,
      sessionRef,
    ],
  );
  const handlePrClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!prStatus) return;
      openPrLink(event, prStatus.url);
    },
    [openPrLink, prStatus],
  );
  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );
  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );
  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(sessionRef, renamingTitle, session.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, session.title, sessionRef],
  );
  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(sessionRef, renamingTitle, session.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, session.title, sessionRef]);
  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);
  const handleConfirmArchiveRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) {
        confirmArchiveButtonRefs.current.set(sessionKey, element);
      } else {
        confirmArchiveButtonRefs.current.delete(sessionKey);
      }
    },
    [confirmArchiveButtonRefs, sessionKey],
  );
  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const handleConfirmArchiveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmingArchive();
      void attemptArchiveSession(sessionRef);
    },
    [attemptArchiveSession, clearConfirmingArchive, sessionRef],
  );
  const handleStartArchiveConfirmation = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setConfirmingArchiveSessionKey(sessionKey);
      requestAnimationFrame(() => {
        confirmArchiveButtonRefs.current.get(sessionKey)?.focus();
      });
    },
    [confirmArchiveButtonRefs, setConfirmingArchiveSessionKey, sessionKey],
  );
  const handleArchiveImmediateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void attemptArchiveSession(sessionRef);
    },
    [attemptArchiveSession, sessionRef],
  );
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem
      className="w-full"
      data-session-item
      onMouseLeave={handleMouseLeave}
      onBlurCapture={handleBlurCapture}
    >
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        data-testid={`session-row-${session.id}`}
        className={`${resolveSessionRowClassName({
          isActive,
          isSelected,
        })} relative isolate`}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={handlePrClick}
                  >
                    <ChangeRequestStatusIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {sessionStatus && <SessionStatusLabel status={sessionStatus} />}
          {renamingSessionKey === sessionKey ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 truncate text-base sm:text-xs bg-transparent outline-none border border-ring rounded px-0.5"
              value={renamingTitle}
              onChange={handleRenameInputChange}
              onKeyDown={handleRenameInputKeyDown}
              onBlur={handleRenameInputBlur}
              onClick={handleRenameInputClick}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    data-testid={`session-title-${session.id}`}
                  >
                    {session.title}
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
                {session.title}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {terminalStatus && (
            <span
              role="img"
              aria-label={terminalStatus.label}
              title={terminalStatus.label}
              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
            >
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          )}
          <div
            className={`flex min-w-12 justify-end ${
              isRemoteSession ? "max-sm:min-w-24" : "max-sm:min-w-20"
            }`}
          >
            {isConfirmingArchive ? (
              <button
                ref={handleConfirmArchiveRef}
                type="button"
                data-session-selection-safe
                data-testid={`session-archive-confirm-${session.id}`}
                aria-label={`Confirm archive ${session.title}`}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-md bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleConfirmArchiveClick}
              >
                Confirm
              </button>
            ) : !isSessionRunning ? (
              appSettingsConfirmSessionArchive ? (
                <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                  <button
                    type="button"
                    data-session-selection-safe
                    data-testid={`session-archive-${session.id}`}
                    aria-label={`Archive ${session.title}`}
                    className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={stopPropagationOnPointerDown}
                    onClick={handleStartArchiveConfirmation}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                        <button
                          type="button"
                          data-session-selection-safe
                          data-testid={`session-archive-${session.id}`}
                          aria-label={`Archive ${session.title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={stopPropagationOnPointerDown}
                          onClick={handleArchiveImmediateClick}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      </div>
                    }
                  />
                  <TooltipPopup side="top">Archive</TooltipPopup>
                </Tooltip>
              )
            ) : null}
            <span className={sessionMetaClassName}>
              <span className="inline-flex items-center gap-1">
                {isRemoteSession && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={sessionEnvironmentLabel ?? "Remote"}
                          className="inline-flex h-5 items-center justify-center"
                        />
                      }
                    >
                      <CloudIcon className="block size-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{sessionEnvironmentLabel}</TooltipPopup>
                  </Tooltip>
                )}
                {jumpLabel ? (
                  <span
                    className="inline-flex h-5 items-center rounded-md border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
                    title={jumpLabel}
                  >
                    {jumpLabel}
                  </span>
                ) : (
                  <span
                    className={`text-[10px] ${
                      isHighlighted
                        ? "text-foreground/72 dark:text-foreground/82"
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {formatRelativeTimeLabel(
                      session.latestUserMessageAt ?? session.updatedAt ?? session.createdAt,
                    )}
                  </span>
                )}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

interface SidebarProjectSessionListProps {
  projectKey: string;
  projectExpanded: boolean;
  hasOverflowingSessions: boolean;
  hiddenSessionStatus: SessionStatusPill | null;
  orderedProjectSessionKeys: readonly string[];
  renderedSessions: readonly SidebarSessionSummary[];
  showEmptySessionState: boolean;
  shouldShowSessionPanel: boolean;
  isSessionListExpanded: boolean;
  projectCwd: string;
  activeRouteSessionKey: string | null;
  sessionJumpLabelByKey: ReadonlyMap<string, string>;
  appSettingsConfirmSessionArchive: boolean;
  renamingSessionKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveSessionKey: string | null;
  setConfirmingArchiveSessionKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  attachSessionListAutoAnimateRef: (node: HTMLElement | null) => void;
  handleSessionClick: (
    event: React.MouseEvent,
    sessionRef: ScopedSessionRef,
    orderedProjectSessionKeys: readonly string[],
  ) => void;
  navigateToSession: (sessionRef: ScopedSessionRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleSessionContextMenu: (
    sessionRef: ScopedSessionRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    sessionRef: ScopedSessionRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveSession: (sessionRef: ScopedSessionRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
  expandSessionListForProject: (projectKey: string) => void;
  collapseSessionListForProject: (projectKey: string) => void;
}

const SidebarProjectSessionList = memo(function SidebarProjectSessionList(
  props: SidebarProjectSessionListProps,
) {
  const {
    projectKey,
    projectExpanded,
    hasOverflowingSessions,
    hiddenSessionStatus,
    orderedProjectSessionKeys,
    renderedSessions,
    showEmptySessionState,
    shouldShowSessionPanel,
    isSessionListExpanded,
    projectCwd,
    activeRouteSessionKey,
    sessionJumpLabelByKey,
    appSettingsConfirmSessionArchive,
    renamingSessionKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveSessionKey,
    setConfirmingArchiveSessionKey,
    confirmArchiveButtonRefs,
    attachSessionListAutoAnimateRef,
    handleSessionClick,
    navigateToSession,
    handleMultiSelectContextMenu,
    handleSessionContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveSession,
    openPrLink,
    expandSessionListForProject,
    collapseSessionListForProject,
  } = props;
  const showMoreButtonRender = useMemo(() => <button type="button" />, []);
  const showLessButtonRender = useMemo(() => <button type="button" />, []);

  return (
    <SidebarMenuSub
      ref={attachSessionListAutoAnimateRef}
      className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
    >
      {shouldShowSessionPanel && showEmptySessionState ? (
        <SidebarMenuSubItem className="w-full" data-session-selection-safe>
          <div
            data-session-selection-safe
            className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
          >
            <span>No sessions yet</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowSessionPanel &&
        renderedSessions.map((session) => {
          const sessionKey = scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
          return (
            <SidebarSessionRow
              key={sessionKey}
              session={session}
              projectCwd={projectCwd}
              orderedProjectSessionKeys={orderedProjectSessionKeys}
              isActive={activeRouteSessionKey === sessionKey}
              jumpLabel={sessionJumpLabelByKey.get(sessionKey) ?? null}
              appSettingsConfirmSessionArchive={appSettingsConfirmSessionArchive}
              renamingSessionKey={renamingSessionKey}
              renamingTitle={renamingTitle}
              setRenamingTitle={setRenamingTitle}
              renamingInputRef={renamingInputRef}
              renamingCommittedRef={renamingCommittedRef}
              confirmingArchiveSessionKey={confirmingArchiveSessionKey}
              setConfirmingArchiveSessionKey={setConfirmingArchiveSessionKey}
              confirmArchiveButtonRefs={confirmArchiveButtonRefs}
              handleSessionClick={handleSessionClick}
              navigateToSession={navigateToSession}
              handleMultiSelectContextMenu={handleMultiSelectContextMenu}
              handleSessionContextMenu={handleSessionContextMenu}
              clearSelection={clearSelection}
              commitRename={commitRename}
              cancelRename={cancelRename}
              attemptArchiveSession={attemptArchiveSession}
              openPrLink={openPrLink}
            />
          );
        })}

      {projectExpanded && hasOverflowingSessions && !isSessionListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showMoreButtonRender}
            data-session-selection-safe
            size="sm"
            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => {
              expandSessionListForProject(projectKey);
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {hiddenSessionStatus && <SessionStatusLabel status={hiddenSessionStatus} compact />}
              <span>Show more</span>
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && hasOverflowingSessions && isSessionListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showLessButtonRender}
            data-session-selection-safe
            size="sm"
            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => {
              collapseSessionListForProject(projectKey);
            }}
          >
            <span>Show less</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
    </SidebarMenuSub>
  );
});

interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isSessionListExpanded: boolean;
  activeRouteSessionKey: string | null;
  newSessionShortcutLabel: string | null;
  handleNewSession: ReturnType<typeof useNewSessionHandler>["handleNewSession"];
  archiveSession: ReturnType<typeof useSessionActions>["archiveSession"];
  deleteSession: ReturnType<typeof useSessionActions>["deleteSession"];
  sessionJumpLabelByKey: ReadonlyMap<string, string>;
  attachSessionListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandSessionListForProject: (projectKey: string) => void;
  collapseSessionListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
}

const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const {
    project,
    isSessionListExpanded,
    activeRouteSessionKey,
    newSessionShortcutLabel,
    handleNewSession,
    archiveSession,
    deleteSession,
    sessionJumpLabelByKey,
    attachSessionListAutoAnimateRef,
    expandSessionListForProject,
    collapseSessionListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
  } = props;
  const sessionSortOrder = useSettings<SidebarSessionSortOrder>(
    (settings) => settings.sidebarSessionSortOrder,
  );
  const appSettingsConfirmSessionDelete = useSettings<boolean>(
    (settings) => settings.confirmSessionDelete,
  );
  const appSettingsConfirmSessionArchive = useSettings<boolean>(
    (settings) => settings.confirmSessionArchive,
  );
  const defaultSessionEnvMode = useSettings<SessionEnvMode>(
    (settings) => settings.defaultSessionEnvMode,
  );
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const { updateSettings } = useUpdateSettings();
  const sidebarSessionPreviewCount = useSettings<SidebarSessionPreviewCount>(
    (settings) => settings.sidebarSessionPreviewCount,
  );
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markSessionUnread = useUiStateStore((state) => state.markSessionUnread);
  const toggleProject = useUiStateStore((state) => state.toggleProject);
  const toggleSessionSelection = useSessionSelectionStore((state) => state.toggleSession);
  const rangeSelectTo = useSessionSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useSessionSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useSessionSelectionStore((state) => state.setAnchor);
  const { copyToClipboard: copySessionIdToClipboard } = useCopyToClipboard<{
    sessionId: SessionId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Session ID copied",
        description: ctx.sessionId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Failed to copy session ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);
  const sidebarSessions = useStore(
    useShallow(
      useMemo(
        () => (state: import("../store").AppState) =>
          selectSidebarSessionsForProjectRefs(state, project.memberProjectRefs),
        [project.memberProjectRefs],
      ),
    ),
  );
  const sidebarSessionByKey = useMemo(
    () =>
      new Map(
        sidebarSessions.map(
          (session) =>
            [
              scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
              session,
            ] as const,
        ),
      ),
    [sidebarSessions],
  );
  // Keep a ref so callbacks can read the latest map without appearing in
  // dependency arrays (avoids invalidating every session-row memo on each
  // session-list change).
  const sidebarSessionByKeyRef = useRef(sidebarSessionByKey);
  sidebarSessionByKeyRef.current = sidebarSessionByKey;
  const projectSessions = sidebarSessions;
  const projectExpanded = useUiStateStore(
    (state) => state.projectExpandedById[project.projectKey] ?? true,
  );
  const sessionLastVisitedAts = useUiStateStore(
    useShallow((state) =>
      projectSessions.map(
        (session) =>
          state.sessionLastVisitedAtById[
            scopedSessionKey(scopeSessionRef(session.environmentId, session.id))
          ] ?? null,
      ),
    ),
  );
  const [renamingSessionKey, setRenamingSessionKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveSessionKey, setConfirmingArchiveSessionKey] = useState<string | null>(
    null,
  );
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const memberProjectByScopedKey = useMemo(
    () =>
      new Map(
        project.memberProjects.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          member,
        ]),
      ),
    [project.memberProjects],
  );
  const memberSessionCountByPhysicalKey = useMemo(() => {
    const counts = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const session of projectSessions) {
      const member = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId)),
      );
      if (!member) {
        continue;
      }
      counts.set(member.physicalProjectKey, (counts.get(member.physicalProjectKey) ?? 0) + 1);
    }
    return counts;
  }, [memberProjectByScopedKey, project.memberProjects, projectSessions]);

  const { projectStatus, visibleProjectSessions, orderedProjectSessionKeys } = useMemo(() => {
    const lastVisitedAtBySessionKey = new Map(
      projectSessions.map((session, index) => [
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
        sessionLastVisitedAts[index] ?? null,
      ]),
    );
    const resolveProjectSessionStatus = (session: SidebarSessionSummary) => {
      const lastVisitedAt = lastVisitedAtBySessionKey.get(
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      );
      return resolveSessionStatusPill({
        session: {
          ...session,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const visibleProjectSessions = sortSessions(
      projectSessions.filter((session) => session.archivedAt === null),
      sessionSortOrder,
    );
    const projectStatus = resolveProjectStatusIndicator(
      visibleProjectSessions.map((session) => resolveProjectSessionStatus(session)),
    );
    return {
      orderedProjectSessionKeys: visibleProjectSessions.map((session) =>
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      ),
      projectStatus,
      visibleProjectSessions,
    };
  }, [projectSessions, sessionLastVisitedAts, sessionSortOrder]);

  const pinnedCollapsedSession = useMemo(() => {
    const activeSessionKey = activeRouteSessionKey ?? undefined;
    if (!activeSessionKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectSessions.find(
        (session) =>
          scopedSessionKey(scopeSessionRef(session.environmentId, session.id)) === activeSessionKey,
      ) ?? null
    );
  }, [activeRouteSessionKey, projectExpanded, visibleProjectSessions]);

  const {
    hasOverflowingSessions,
    hiddenSessionStatus,
    renderedSessions,
    showEmptySessionState,
    shouldShowSessionPanel,
  } = useMemo(() => {
    const lastVisitedAtBySessionKey = new Map(
      projectSessions.map((session, index) => [
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
        sessionLastVisitedAts[index] ?? null,
      ]),
    );
    const resolveProjectSessionStatus = (session: SidebarSessionSummary) => {
      const lastVisitedAt = lastVisitedAtBySessionKey.get(
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      );
      return resolveSessionStatusPill({
        session: {
          ...session,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const hasOverflowingSessions = visibleProjectSessions.length > sidebarSessionPreviewCount;
    const previewSessions =
      isSessionListExpanded || !hasOverflowingSessions
        ? visibleProjectSessions
        : visibleProjectSessions.slice(0, sidebarSessionPreviewCount);
    const visibleSessionKeys = new Set(
      [...previewSessions, ...(pinnedCollapsedSession ? [pinnedCollapsedSession] : [])].map(
        (session) => scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      ),
    );
    const renderedSessions = pinnedCollapsedSession
      ? [pinnedCollapsedSession]
      : visibleProjectSessions.filter((session) =>
          visibleSessionKeys.has(
            scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
          ),
        );
    const hiddenSessions = visibleProjectSessions.filter(
      (session) =>
        !visibleSessionKeys.has(
          scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
        ),
    );
    return {
      hasOverflowingSessions,
      hiddenSessionStatus: resolveProjectStatusIndicator(
        hiddenSessions.map((session) => resolveProjectSessionStatus(session)),
      ),
      renderedSessions,
      showEmptySessionState: projectExpanded && visibleProjectSessions.length === 0,
      shouldShowSessionPanel: projectExpanded || pinnedCollapsedSession !== null,
    };
  }, [
    isSessionListExpanded,
    pinnedCollapsedSession,
    projectExpanded,
    projectSessions,
    sidebarSessionPreviewCount,
    sessionLastVisitedAts,
    visibleProjectSessions,
  ]);

  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (useSessionSelectionStore.getState().hasSelection()) {
        clearSelection();
      }
      toggleProject(project.projectKey);
    },
    [
      clearSelection,
      dragInProgressRef,
      project.projectKey,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
      toggleProject,
    ],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      toggleProject(project.projectKey);
    },
    [dragInProgressRef, project.projectKey, toggleProject],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.name);
  }, []);

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember, options: { force?: boolean } = {}): Promise<void> => {
      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const draftStore = useComposerDraftStore.getState();
      const projectDraftSession = draftStore.getDraftSessionByProjectRef(memberProjectRef);
      if (projectDraftSession) {
        draftStore.clearDraftSession(projectDraftSession.draftId);
      }
      draftStore.clearProjectDraftSessionId(memberProjectRef);

      const projectApi = readEnvironmentApi(member.environmentId);
      if (!projectApi) {
        throw new Error("Study API unavailable.");
      }

      await projectApi.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: member.id,
        ...(options.force === true ? { force: true } : {}),
      });
    },
    [],
  );

  const handleRemoveProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const memberSessionCount =
        memberSessionCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
      if (memberSessionCount > 0) {
        const warningToastId = toastManager.add(
          stackedSessionToast({
            type: "warning",
            title: "Study is not empty",
            description: "Delete all sessions in this study before removing it.",
            actionVariant: "destructive",
            actionProps: {
              children: "Delete anyway",
              onClick: () => {
                void (async () => {
                  toastManager.close(warningToastId);
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 180);
                  });

                  const latestProjectSessions = selectSidebarSessionsForProjectRefs(
                    useStore.getState(),
                    [memberProjectRef],
                  );
                  const confirmed = await api.dialogs.confirm(
                    latestProjectSessions.length > 0
                      ? [
                          `Remove study "${member.name}" and delete its ${latestProjectSessions.length} session${
                            latestProjectSessions.length === 1 ? "" : "s"
                          }?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This permanently clears conversation history for those sessions.",
                          "This removes only this study entry.",
                          "This action cannot be undone.",
                        ].join("\n")
                      : [
                          `Remove study "${member.name}"?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This removes only this study entry.",
                        ].join("\n"),
                  );
                  if (!confirmed) {
                    return;
                  }

                  await removeProject(member, { force: true });
                })().catch((error) => {
                  const message =
                    error instanceof Error ? error.message : "Unknown error removing study.";
                  console.error("Failed to remove study", {
                    projectId: member.id,
                    environmentId: member.environmentId,
                    error,
                  });
                  toastManager.add(
                    stackedSessionToast({
                      type: "error",
                      title: `Failed to remove "${member.name}"`,
                      description: message,
                    }),
                  );
                });
              },
            },
          }),
        );
        return;
      }

      const message = [
        `Remove study "${member.name}"?`,
        `Path: ${member.cwd}`,
        ...(member.environmentLabel ? [`Environment: ${member.environmentLabel}`] : []),
        "This removes only this study entry.",
      ].join("\n");
      const confirmed = await api.dialogs.confirm(message);
      if (!confirmed) {
        return;
      }

      try {
        await removeProject(member);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing study.";
        console.error("Failed to remove study", {
          projectId: member.id,
          environmentId: member.environmentId,
          error,
        });
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: `Failed to remove "${member.name}"`,
            description: message,
          }),
        );
      }
    },
    [memberSessionCountByPhysicalKey, removeProject],
  );

  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>();
        const makeLeaf = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          member: SidebarProjectGroupMember,
          options?: {
            destructive?: boolean;
            disabled?: boolean;
          },
        ): ContextMenuItem<string> => {
          const id = `${action}:${member.physicalProjectKey}`;
          actionHandlers.set(id, () => {
            switch (action) {
              case "rename":
                openProjectRenameDialog(member);
                return;
              case "grouping":
                openProjectGroupingDialog(member);
                return;
              case "copy-path":
                copyPathToClipboard(member.cwd, { path: member.cwd });
                return;
              case "delete":
                return handleRemoveProject(member);
            }
          });

          return {
            id,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            ...(options?.destructive ? { destructive: true } : {}),
            ...(options?.disabled ? { disabled: true } : {}),
          };
        };

        const buildTargetedItem = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          label: string,
          options?: {
            destructive?: boolean;
            isDisabled?: (member: SidebarProjectGroupMember) => boolean;
          },
        ): ContextMenuItem<string> => {
          if (project.memberProjects.length === 1) {
            const singleMember = project.memberProjects[0]!;
            return {
              ...makeLeaf(action, singleMember, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(singleMember) ? { disabled: true } : {}),
              }),
              label,
            };
          }

          return {
            id: `${action}:submenu`,
            label,
            children: project.memberProjects.map((member) =>
              makeLeaf(action, member, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(member) ? { disabled: true } : {}),
              }),
            ),
          };
        };

        const clicked = await api.contextMenu.show(
          [
            buildTargetedItem("rename", "Rename study"),
            buildTargetedItem("grouping", "Study grouping…"),
            buildTargetedItem("copy-path", "Copy Study Path"),
            buildTargetedItem("delete", "Remove study", {
              destructive: true,
            }),
          ],
          {
            x: event.clientX,
            y: event.clientY,
          },
        );

        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [
      copyPathToClipboard,
      handleRemoveProject,
      openProjectGroupingDialog,
      openProjectRenameDialog,
      project.groupedProjectCount,
      project.memberProjects,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const navigateToSession = useCallback(
    (sessionRef: ScopedSessionRef) => {
      if (useSessionSelectionStore.getState().selectedSessionKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedSessionKey(sessionRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$sessionId",
        params: buildSessionRouteParams(sessionRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const handleSessionClick = useCallback(
    (
      event: React.MouseEvent,
      sessionRef: ScopedSessionRef,
      orderedProjectSessionKeys: readonly string[],
    ) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const sessionKey = scopedSessionKey(sessionRef);
      const currentSelectionCount = useSessionSelectionStore.getState().selectedSessionKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleSessionSelection(sessionKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(sessionKey, orderedProjectSessionKeys);
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(sessionKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$sessionId",
        params: buildSessionRouteParams(sessionRef),
      });
    },
    [
      clearSelection,
      isMobile,
      rangeSelectTo,
      router,
      setOpenMobile,
      setSelectionAnchor,
      toggleSessionSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const sessionKeys = [...useSessionSelectionStore.getState().selectedSessionKeys];
      if (sessionKeys.length === 0) return;
      const count = sessionKeys.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const sessionKey of sessionKeys) {
          const session = sidebarSessionByKeyRef.current.get(sessionKey);
          markSessionUnread(sessionKey, session?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmSessionDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} session${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these sessions.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedSessionKeys = new Set(sessionKeys);
      for (const sessionKey of sessionKeys) {
        const session = sidebarSessionByKeyRef.current.get(sessionKey);
        if (!session) continue;
        await deleteSession(scopeSessionRef(session.environmentId, session.id), {
          deletedSessionKeys,
        });
      }
      removeFromSelection(sessionKeys);
    },
    [
      appSettingsConfirmSessionDelete,
      clearSelection,
      deleteSession,
      markSessionUnread,
      removeFromSelection,
    ],
  );

  const createSessionForProjectMember = useCallback(
    (member: SidebarProjectGroupMember) => {
      const currentRouteParams =
        router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRouteTarget = resolveSessionRouteTarget(currentRouteParams);
      const currentActiveSession =
        currentRouteTarget?.kind === "server"
          ? (selectSessionByRef(useStore.getState(), currentRouteTarget.sessionRef) ?? null)
          : null;
      const draftStore = useComposerDraftStore.getState();
      const currentActiveDraftSession =
        currentRouteTarget?.kind === "server"
          ? (draftStore.getDraftSession(currentRouteTarget.sessionRef) ?? null)
          : currentRouteTarget?.kind === "draft"
            ? (draftStore.getDraftSession(currentRouteTarget.draftId) ?? null)
            : null;
      const seedContext = resolveSidebarNewSessionSeedContext({
        projectId: member.id,
        defaultEnvMode: resolveSidebarNewSessionEnvMode({
          defaultEnvMode: defaultSessionEnvMode,
        }),
        activeSession:
          currentActiveSession && currentActiveSession.projectId === member.id
            ? {
                projectId: currentActiveSession.projectId,
                branch: currentActiveSession.branch,
                worktreePath: currentActiveSession.worktreePath,
              }
            : null,
        activeDraftSession:
          currentActiveDraftSession && currentActiveDraftSession.projectId === member.id
            ? {
                projectId: currentActiveDraftSession.projectId,
                branch: currentActiveDraftSession.branch,
                worktreePath: currentActiveDraftSession.worktreePath,
                envMode: currentActiveDraftSession.envMode,
              }
            : null,
      });
      if (isMobile) {
        setOpenMobile(false);
      }
      void handleNewSession(scopeProjectRef(member.environmentId, member.id), {
        ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
        ...(seedContext.worktreePath !== undefined
          ? { worktreePath: seedContext.worktreePath }
          : {}),
        envMode: seedContext.envMode,
      });
    },
    [defaultSessionEnvMode, handleNewSession, isMobile, router, setOpenMobile],
  );

  const handleCreateSessionClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (project.memberProjects.length === 1) {
        createSessionForProjectMember(project.memberProjects[0]!);
        return;
      }

      void (async () => {
        const api = readLocalApi();
        if (!api) {
          return;
        }
        const clicked = await api.contextMenu.show(
          project.memberProjects.map((member) => ({
            id: member.physicalProjectKey,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
          })),
          {
            x: event.clientX,
            y: event.clientY,
          },
        );
        if (!clicked) {
          return;
        }
        const targetMember = project.memberProjects.find(
          (member) => member.physicalProjectKey === clicked,
        );
        if (!targetMember) {
          return;
        }
        createSessionForProjectMember(targetMember);
      })();
    },
    [createSessionForProjectMember, project.groupedProjectCount, project.memberProjects],
  );

  const attemptArchiveSession = useCallback(
    async (sessionRef: ScopedSessionRef) => {
      try {
        await archiveSession(sessionRef);
      } catch (error) {
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Failed to archive session",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [archiveSession],
  );

  const cancelRename = useCallback(() => {
    setRenamingSessionKey(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (sessionRef: ScopedSessionRef, newTitle: string, originalTitle: string) => {
      const sessionKey = scopedSessionKey(sessionRef);
      const finishRename = () => {
        setRenamingSessionKey((current) => {
          if (current !== sessionKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Session title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readEnvironmentApi(sessionRef.environmentId);
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "session.meta.update",
          commandId: newCommandId(),
          sessionId: sessionRef.sessionId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Failed to rename session",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [],
  );

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Study title cannot be empty",
      });
      return;
    }

    if (trimmed === projectRenameTarget.name) {
      closeProjectRenameDialog();
      return;
    }

    const api = readEnvironmentApi(projectRenameTarget.environmentId);
    if (!api) {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Failed to rename study",
          description: "Study API unavailable.",
        }),
      );
      return;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: projectRenameTarget.id,
        title: trimmed,
      });
      closeProjectRenameDialog();
    } catch (error) {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Failed to rename study",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle]);

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const handleSessionContextMenu = useCallback(
    async (sessionRef: ScopedSessionRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const sessionKey = scopedSessionKey(sessionRef);
      const session = sidebarSessionByKeyRef.current.get(sessionKey) ?? null;
      if (!session) return;
      const sessionProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId)),
      );
      const sessionWorkspacePath =
        session.worktreePath ?? sessionProject?.cwd ?? project.cwd ?? null;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename session" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-session-id", label: "Copy Session ID" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "rename") {
        setRenamingSessionKey(sessionKey);
        setRenamingTitle(session.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markSessionUnread(sessionKey, session.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
        if (!sessionWorkspacePath) {
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Path unavailable",
              description: "This session does not have a workspace path to copy.",
            }),
          );
          return;
        }
        copyPathToClipboard(sessionWorkspacePath, { path: sessionWorkspacePath });
        return;
      }
      if (clicked === "copy-session-id") {
        copySessionIdToClipboard(session.id, { sessionId: session.id });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettingsConfirmSessionDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete session "${session.title}"?`,
            "This permanently clears conversation history for this session.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteSession(sessionRef);
    },
    [
      appSettingsConfirmSessionDelete,
      copyPathToClipboard,
      copySessionIdToClipboard,
      deleteSession,
      markSessionUnread,
      memberProjectByScopedKey,
      project.cwd,
    ],
  );

  return (
    <>
      <div className="group/project-header relative">
        <SidebarMenuButton
          ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
          size="sm"
          className={`gap-2 px-2 py-1.5 pr-8 text-left hover:bg-sidebar-accent group-hover/project-header:bg-sidebar-accent group-hover/project-header:text-sidebar-accent-foreground max-sm:pr-14 ${
            isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
          }`}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
          onPointerDownCapture={handleProjectButtonPointerDownCapture}
          onClick={handleProjectButtonClick}
          onKeyDown={handleProjectButtonKeyDown}
          onContextMenu={handleProjectButtonContextMenu}
        >
          {!projectExpanded && projectStatus ? (
            <span
              aria-hidden="true"
              title={projectStatus.label}
              className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
            >
              <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                <span
                  className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                    projectStatus.pulse ? "animate-pulse" : ""
                  }`}
                />
              </span>
              <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
            </span>
          ) : (
            <ChevronRightIcon
              className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                projectExpanded ? "rotate-90" : ""
              }`}
            />
          )}
          <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground/90">
              {project.displayName}
            </span>
            {project.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {project.groupedProjectCount} projects
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
        {/* Environment badge – visible by default, crossfades with the
            "new session" button on hover using the same pointer-events +
            opacity pattern as the session row archive/timestamp swap. */}
        {project.environmentPresence === "remote-only" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={
                    project.environmentPresence === "remote-only"
                      ? "Remote project"
                      : "Available in multiple environments"
                  }
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-opacity duration-150 max-sm:right-7 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100"
                />
              }
            >
              <CloudIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Remote environment: {project.remoteEnvironmentLabels.join(", ")}
            </TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="pointer-events-none absolute top-1 right-1.5 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
                <button
                  type="button"
                  aria-label={`Create new session in ${project.displayName}`}
                  data-testid="new-session-button"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={handleCreateSessionClick}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              </div>
            }
          />
          <TooltipPopup side="top">
            {newSessionShortcutLabel ? `New session (${newSessionShortcutLabel})` : "New session"}
          </TooltipPopup>
        </Tooltip>
      </div>

      <SidebarProjectSessionList
        projectKey={project.projectKey}
        projectExpanded={projectExpanded}
        hasOverflowingSessions={hasOverflowingSessions}
        hiddenSessionStatus={hiddenSessionStatus}
        orderedProjectSessionKeys={orderedProjectSessionKeys}
        renderedSessions={renderedSessions}
        showEmptySessionState={showEmptySessionState}
        shouldShowSessionPanel={shouldShowSessionPanel}
        isSessionListExpanded={isSessionListExpanded}
        projectCwd={project.cwd}
        activeRouteSessionKey={activeRouteSessionKey}
        sessionJumpLabelByKey={sessionJumpLabelByKey}
        appSettingsConfirmSessionArchive={appSettingsConfirmSessionArchive}
        renamingSessionKey={renamingSessionKey}
        renamingTitle={renamingTitle}
        setRenamingTitle={setRenamingTitle}
        renamingInputRef={renamingInputRef}
        renamingCommittedRef={renamingCommittedRef}
        confirmingArchiveSessionKey={confirmingArchiveSessionKey}
        setConfirmingArchiveSessionKey={setConfirmingArchiveSessionKey}
        confirmArchiveButtonRefs={confirmArchiveButtonRefs}
        attachSessionListAutoAnimateRef={attachSessionListAutoAnimateRef}
        handleSessionClick={handleSessionClick}
        navigateToSession={navigateToSession}
        handleMultiSelectContextMenu={handleMultiSelectContextMenu}
        handleSessionContextMenu={handleSessionContextMenu}
        clearSelection={clearSelection}
        commitRename={commitRename}
        cancelRename={cancelRename}
        attemptArchiveSession={attemptArchiveSession}
        openPrLink={openPrLink}
        expandSessionListForProject={expandSessionListForProject}
        collapseSessionListForProject={collapseSessionListForProject}
      />

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename study</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? `Update the title for ${projectRenameTarget.cwd}.`
                : "Update the study title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Study title</span>
              <Input
                aria-label="Study title"
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
            {projectRenameTarget?.environmentLabel ? (
              <p className="text-xs text-muted-foreground">
                Environment: {projectRenameTarget.environmentLabel}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitProjectRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Study grouping</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? `Choose how ${projectGroupingTarget.cwd} should be grouped in the sidebar.`
                : "Choose how this study should be grouped in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Grouping rule</span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label="Study grouping rule">
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? `Use global default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[projectGroupingSelection]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    Use global default
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {PROJECT_GROUPING_MODE_LABELS.separate}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? projectGroupingModeDescription(projectGroupingSettings.sidebarProjectGroupingMode)
                : projectGroupingModeDescription(projectGroupingSelection)}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              Cancel
            </Button>
            <Button onClick={saveProjectGroupingPreference}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

const SidebarProjectListRow = memo(function SidebarProjectListRow(props: SidebarProjectItemProps) {
  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarProjectItem {...props} />
    </SidebarMenuItem>
  );
});

function LinceiLabsWordmark() {
  return (
    <span
      aria-label="Lincei"
      className="shrink-0 text-[18px] font-medium leading-none tracking-normal text-foreground"
      style={{ fontFamily: "Baskerville, Palatino, Georgia, 'Times New Roman', serif" }}
    >
      Lincei
    </span>
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function ProjectSortMenu({
  projectSortOrder,
  sessionSortOrder,
  projectGroupingMode,
  sessionPreviewCount,
  onProjectSortOrderChange,
  onSessionSortOrderChange,
  onProjectGroupingModeChange,
  onSessionPreviewCountChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  sessionSortOrder: SidebarSessionSortOrder;
  projectGroupingMode: SidebarProjectGroupingMode;
  sessionPreviewCount: SidebarSessionPreviewCount;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onSessionSortOrderChange: (sortOrder: SidebarSessionSortOrder) => void;
  onProjectGroupingModeChange: (mode: SidebarProjectGroupingMode) => void;
  onSessionPreviewCountChange: (count: SidebarSessionPreviewCount) => void;
}) {
  const handleSessionPreviewCountChange = useCallback(
    (nextValue: number | null) => {
      if (nextValue === null) {
        return;
      }

      const clampedValue = clampSidebarSessionPreviewCount(nextValue);
      if (clampedValue !== sessionPreviewCount) {
        onSessionPreviewCountChange(clampedValue);
      }
    },
    [onSessionPreviewCountChange, sessionPreviewCount],
  );

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sidebar options</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort sessions
          </div>
          <MenuRadioGroup
            value={sessionSortOrder}
            onValueChange={(value) => {
              onSessionSortOrderChange(value as SidebarSessionSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarSessionSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 text-muted-foreground sm:text-xs font-medium">
            Visible sessions
          </div>
          <div className="px-2 py-1">
            <NumberField
              aria-label="Visible session count"
              className="w-28 gap-0"
              max={MAX_SIDEBAR_THREAD_PREVIEW_COUNT}
              min={MIN_SIDEBAR_THREAD_PREVIEW_COUNT}
              onValueChange={handleSessionPreviewCountChange}
              size="sm"
              step={1}
              value={sessionPreviewCount}
            >
              <NumberFieldGroup className="h-7 rounded-md sm:h-6.5">
                <NumberFieldDecrement
                  aria-label="Decrease visible session count"
                  className="px-2 sm:px-2 [&_svg]:size-3.5"
                />
                <NumberFieldInput
                  aria-label="Visible session count"
                  className="h-7 w-9 grow-0 px-0 text-xs leading-7 sm:h-6.5 sm:leading-6.5"
                  inputMode="numeric"
                  onKeyDownCapture={(event) => {
                    event.stopPropagation();
                  }}
                />
                <NumberFieldIncrement
                  aria-label="Increase visible session count"
                  className="px-2 sm:px-2 [&_svg]:size-3.5"
                />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 font-medium text-muted-foreground sm:text-xs">
            Group projects
          </div>
          <MenuRadioGroup
            value={projectGroupingMode}
            onValueChange={(value) => {
              if (value === "repository" || value === "repository_path" || value === "separate") {
                onProjectGroupingModeChange(value);
              }
            }}
          >
            {(
              Object.entries(PROJECT_GROUPING_MODE_LABELS) as Array<
                [SidebarProjectGroupingMode, string]
              >
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const { hasMacTitlebarControls } = useDesktopTitlebarLayout();
  const sidebarHeaderClassName = "h-[52px] flex-row items-center gap-2 px-3 py-0";
  const wordmark = (
    <div className="relative flex h-full w-full min-w-0 items-center justify-center">
      <SidebarTrigger className="absolute left-0 size-7 shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to sessions"
              className={`absolute top-1/2 flex min-w-0 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2 ${
                hasMacTitlebarControls
                  ? "left-[calc(50%+1rem)] max-w-[min(11rem,calc(100%-6rem))]"
                  : "left-[calc(50%+0.25rem)] max-w-[min(11rem,calc(100%-4rem))]"
              }`}
              to="/"
            >
              <LinceiLabsWordmark />
              <span className="rounded-sm bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </Link>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="absolute -right-1 hidden md:inline-flex">
              <SidebarTrigger className={`shrink-0 ${SIDEBAR_CHROME_TRIGGER_CLASS}`} />
            </span>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Hide sidebar
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return isElectron ? (
    <SidebarHeader
      className={`drag-region ${sidebarHeaderClassName} wco:h-[env(titlebar-area-height)]`}
    >
      {wordmark}
    </SidebarHeader>
  ) : (
    <SidebarHeader className={sidebarHeaderClassName}>{wordmark}</SidebarHeader>
  );
});

const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={handleSettingsClick}
          >
            <SettingsIcon className="size-3.5" />
            <span className="text-xs">Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});

interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  handleDesktopUpdateButtonClick: () => void;
  projectSortOrder: SidebarProjectSortOrder;
  sessionSortOrder: SidebarSessionSortOrder;
  projectGroupingMode: SidebarProjectGroupingMode;
  sessionPreviewCount: SidebarSessionPreviewCount;
  updateSettings: ReturnType<typeof useUpdateSettings>["updateSettings"];
  openAddProject: () => void;
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewSession: ReturnType<typeof useNewSessionHandler>["handleNewSession"];
  archiveSession: ReturnType<typeof useSessionActions>["archiveSession"];
  deleteSession: ReturnType<typeof useSessionActions>["deleteSession"];
  sortedProjects: readonly SidebarProjectSnapshot[];
  expandedSessionListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeSessionKey: string | null;
  newSessionShortcutLabel: string | null;
  commandPaletteShortcutLabel: string | null;
  sessionJumpLabelByKey: ReadonlyMap<string, string>;
  attachSessionListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandSessionListForProject: (projectKey: string) => void;
  collapseSessionListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectsLength: number;
}

const SidebarProjectsContent = memo(function SidebarProjectsContent(
  props: SidebarProjectsContentProps,
) {
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    handleDesktopUpdateButtonClick,
    projectSortOrder,
    sessionSortOrder,
    projectGroupingMode,
    sessionPreviewCount,
    updateSettings,
    openAddProject,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewSession,
    archiveSession,
    deleteSession,
    sortedProjects,
    expandedSessionListsByProject,
    activeRouteProjectKey,
    routeSessionKey,
    newSessionShortcutLabel,
    commandPaletteShortcutLabel,
    sessionJumpLabelByKey,
    attachSessionListAutoAnimateRef,
    expandSessionListForProject,
    collapseSessionListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
    projectsLength,
  } = props;

  const handleProjectSortOrderChange = useCallback(
    (sortOrder: SidebarProjectSortOrder) => {
      updateSettings({ sidebarProjectSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleSessionSortOrderChange = useCallback(
    (sortOrder: SidebarSessionSortOrder) => {
      updateSettings({ sidebarSessionSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleProjectGroupingModeChange = useCallback(
    (groupingMode: SidebarProjectGroupingMode) => {
      updateSettings({ sidebarProjectGroupingMode: groupingMode });
    },
    [updateSettings],
  );
  const handleSessionPreviewCountChange = useCallback(
    (count: SidebarSessionPreviewCount) => {
      updateSettings({ sidebarSessionPreviewCount: count });
    },
    [updateSettings],
  );

  return (
    <SidebarContent className="gap-0">
      <SidebarGroup className="px-2 pt-2 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <CommandDialogTrigger
              render={
                <SidebarMenuButton
                  size="sm"
                  className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
                  data-testid="command-palette-trigger"
                />
              }
            >
              <SearchIcon className="size-3.5" />
              <span className="flex-1 truncate text-left text-xs">Search</span>
              {commandPaletteShortcutLabel ? (
                <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-[10px]">
                  {commandPaletteShortcutLabel}
                </Kbd>
              ) : null}
            </CommandDialogTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
        <SidebarGroup className="px-2 pt-2 pb-0">
          <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
            <TriangleAlertIcon />
            <AlertTitle>Intel build on Apple Silicon</AlertTitle>
            <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
            {desktopUpdateButtonAction !== "none" ? (
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={desktopUpdateButtonDisabled}
                  onClick={handleDesktopUpdateButtonClick}
                >
                  {desktopUpdateButtonAction === "download"
                    ? "Download ARM build"
                    : "Install ARM build"}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </SidebarGroup>
      ) : null}
      <SidebarGroup className="px-2 py-2">
        <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Studies
          </span>
          <div className="flex items-center gap-1">
            <ProjectSortMenu
              projectSortOrder={projectSortOrder}
              sessionSortOrder={sessionSortOrder}
              projectGroupingMode={projectGroupingMode}
              sessionPreviewCount={sessionPreviewCount}
              onProjectSortOrderChange={handleProjectSortOrderChange}
              onSessionSortOrderChange={handleSessionSortOrderChange}
              onProjectGroupingModeChange={handleProjectGroupingModeChange}
              onSessionPreviewCountChange={handleSessionPreviewCountChange}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add study"
                    data-testid="sidebar-add-project-trigger"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={openAddProject}
                  />
                }
              >
                <FolderPlusIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">Add study</TooltipPopup>
            </Tooltip>
          </div>
        </div>

        {isManualProjectSorting ? (
          <DndContext
            sensors={projectDnDSensors}
            collisionDetection={projectCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <SidebarMenu>
              <SortableContext
                items={sortedProjects.map((project) => project.projectKey)}
                strategy={verticalListSortingStrategy}
              >
                {sortedProjects.map((project) => (
                  <SortableProjectItem key={project.projectKey} projectId={project.projectKey}>
                    {(dragHandleProps) => (
                      <SidebarProjectItem
                        project={project}
                        isSessionListExpanded={expandedSessionListsByProject.has(
                          project.projectKey,
                        )}
                        activeRouteSessionKey={
                          activeRouteProjectKey === project.projectKey ? routeSessionKey : null
                        }
                        newSessionShortcutLabel={newSessionShortcutLabel}
                        handleNewSession={handleNewSession}
                        archiveSession={archiveSession}
                        deleteSession={deleteSession}
                        sessionJumpLabelByKey={sessionJumpLabelByKey}
                        attachSessionListAutoAnimateRef={attachSessionListAutoAnimateRef}
                        expandSessionListForProject={expandSessionListForProject}
                        collapseSessionListForProject={collapseSessionListForProject}
                        dragInProgressRef={dragInProgressRef}
                        suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                        suppressProjectClickForContextMenuRef={
                          suppressProjectClickForContextMenuRef
                        }
                        isManualProjectSorting={isManualProjectSorting}
                        dragHandleProps={dragHandleProps}
                      />
                    )}
                  </SortableProjectItem>
                ))}
              </SortableContext>
            </SidebarMenu>
          </DndContext>
        ) : (
          <SidebarMenu ref={attachProjectListAutoAnimateRef}>
            {sortedProjects.map((project) => (
              <SidebarProjectListRow
                key={project.projectKey}
                project={project}
                isSessionListExpanded={expandedSessionListsByProject.has(project.projectKey)}
                activeRouteSessionKey={
                  activeRouteProjectKey === project.projectKey ? routeSessionKey : null
                }
                newSessionShortcutLabel={newSessionShortcutLabel}
                handleNewSession={handleNewSession}
                archiveSession={archiveSession}
                deleteSession={deleteSession}
                sessionJumpLabelByKey={sessionJumpLabelByKey}
                attachSessionListAutoAnimateRef={attachSessionListAutoAnimateRef}
                expandSessionListForProject={expandSessionListForProject}
                collapseSessionListForProject={collapseSessionListForProject}
                dragInProgressRef={dragInProgressRef}
                suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                isManualProjectSorting={isManualProjectSorting}
                dragHandleProps={null}
              />
            ))}
          </SidebarMenu>
        )}

        {projectsLength === 0 && (
          <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
            No projects yet
          </div>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
});

export default function Sidebar() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarSessions = useStore(useShallow(selectSidebarSessionsAcrossEnvironments));
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const sidebarSessionSortOrder = useSettings((s) => s.sidebarSessionSortOrder);
  const sidebarProjectSortOrder = useSettings((s) => s.sidebarProjectSortOrder);
  const sidebarProjectGroupingMode = useSettings((s) => s.sidebarProjectGroupingMode);
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const sidebarSessionPreviewCount = useSettings((s) => s.sidebarSessionPreviewCount);
  const { updateSettings } = useUpdateSettings();
  const { handleNewSession } = useNewSessionHandler();
  const { archiveSession, deleteSession } = useSessionActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeSessionRef = useParams({
    strict: false,
    select: (params) => resolveSessionRouteRef(params),
  });
  const routeSessionKey = routeSessionRef ? scopedSessionKey(routeSessionRef) : null;
  const shortcuts = useServerShortcuts();
  const openAddProjectCommandPalette = useCommandPaletteStore((store) => store.openAddProject);
  const [expandedSessionListsByProject, setExpandedSessionListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const { showSessionJumpHints, updateSessionJumpHintsVisibility } = useSessionJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const clearSelection = useSessionSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useSessionSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const modelPickerOpen = useModelPickerOpen();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    return buildPhysicalToLogicalProjectKeyMap({
      projects: orderedProjects,
      settings: projectGroupingSettings,
    });
  }, [orderedProjects, projectGroupingSettings]);
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => {
        const rt = savedEnvironmentRuntimeById[environmentId];
        const saved = savedEnvironmentRegistry[environmentId];
        return rt?.descriptor?.label ?? saved?.label ?? null;
      },
    });
  }, [
    orderedProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarSessionByKey = useMemo(
    () =>
      new Map(
        sidebarSessions.map(
          (session) =>
            [
              scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
              session,
            ] as const,
        ),
      ),
    [sidebarSessions],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  const activeRouteProjectKey = useMemo(() => {
    if (!routeSessionKey) {
      return null;
    }
    const activeSession = sidebarSessionByKey.get(routeSessionKey);
    if (!activeSession) return null;
    const physicalKey =
      projectPhysicalKeyByScopedRef.get(
        scopedProjectKey(scopeProjectRef(activeSession.environmentId, activeSession.projectId)),
      ) ?? scopedProjectKey(scopeProjectRef(activeSession.environmentId, activeSession.projectId));
    return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
  }, [routeSessionKey, sidebarSessionByKey, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);

  // Group sessions by logical project key so all sessions from grouped projects
  // are displayed together.
  const sessionsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarSessionSummary[]>();
    for (const session of sidebarSessions) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(session);
      } else {
        next.set(logicalKey, [session]);
      }
    }
    return next;
  }, [sidebarSessions, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeSessionRef
        ? selectSessionTerminalState(
            useTerminalStateStore.getState().terminalStateBySessionKey,
            routeSessionRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeSessionRef],
  );
  const newSessionShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );
  const newSessionShortcutLabel =
    shortcutLabelForCommand(shortcuts, "chat.newLocal", newSessionShortcutLabelOptions) ??
    shortcutLabelForCommand(shortcuts, "chat.new", newSessionShortcutLabelOptions);

  const navigateToSession = useCallback(
    (sessionRef: ScopedSessionRef) => {
      if (useSessionSelectionStore.getState().selectedSessionKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedSessionKey(sessionRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$environmentId/$sessionId",
        params: buildSessionRouteParams(sessionRef),
      });
    },
    [clearSelection, isMobile, navigate, setOpenMobile, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.projectKey === active.id);
      const overProject = sidebarProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      reorderProjects(activeMemberKeys, overMemberKeys);
    },
    [sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedSessionListsRef = useRef(new WeakSet<HTMLElement>());
  const attachSessionListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedSessionListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedSessionListsRef.current.add(node);
  }, []);

  const visibleSessions = useMemo(
    () => sidebarSessions.filter((session) => session.archivedAt === null),
    [sidebarSessions],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableSessions = visibleSessions.map((session) => {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId));
      return {
        ...session,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableSessions,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectByKey,
    sidebarProjects,
    visibleSessions,
  ]);
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const visibleSidebarSessionKeys = useMemo(
    () =>
      sortedProjects.flatMap((project) => {
        const projectSessions = sortSessions(
          (sessionsByProjectKey.get(project.projectKey) ?? []).filter(
            (session) => session.archivedAt === null,
          ),
          sidebarSessionSortOrder,
        );
        const projectExpanded = projectExpandedById[project.projectKey] ?? true;
        const activeSessionKey = routeSessionKey ?? undefined;
        const pinnedCollapsedSession =
          !projectExpanded && activeSessionKey
            ? (projectSessions.find(
                (session) =>
                  scopedSessionKey(scopeSessionRef(session.environmentId, session.id)) ===
                  activeSessionKey,
              ) ?? null)
            : null;
        const shouldShowSessionPanel = projectExpanded || pinnedCollapsedSession !== null;
        if (!shouldShowSessionPanel) {
          return [];
        }
        const isSessionListExpanded = expandedSessionListsByProject.has(project.projectKey);
        const hasOverflowingSessions = projectSessions.length > sidebarSessionPreviewCount;
        const previewSessions =
          isSessionListExpanded || !hasOverflowingSessions
            ? projectSessions
            : projectSessions.slice(0, sidebarSessionPreviewCount);
        const renderedSessions = pinnedCollapsedSession
          ? [pinnedCollapsedSession]
          : previewSessions;
        return renderedSessions.map((session) =>
          scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
        );
      }),
    [
      sidebarSessionSortOrder,
      sidebarSessionPreviewCount,
      expandedSessionListsByProject,
      projectExpandedById,
      routeSessionKey,
      sortedProjects,
      sessionsByProjectKey,
    ],
  );
  const sessionJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof sessionJumpCommandForIndex>>>();
    for (const [visibleSessionIndex, sessionKey] of visibleSidebarSessionKeys.entries()) {
      const jumpCommand = sessionJumpCommandForIndex(visibleSessionIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(sessionKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarSessionKeys]);
  const sessionJumpSessionKeys = useMemo(
    () => [...sessionJumpCommandByKey.keys()],
    [sessionJumpCommandByKey],
  );
  const sidebarShortcutContext = useMemo(
    () => ({
      terminalFocus: false,
      terminalOpen: routeSessionRef
        ? selectSessionTerminalState(
            useTerminalStateStore.getState().terminalStateBySessionKey,
            routeSessionRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeSessionRef],
  );
  const sessionJumpLabelByKey = useMemo(
    () =>
      buildSessionJumpLabelMap({
        shortcuts,
        platform,
        terminalOpen: sidebarShortcutContext.terminalOpen,
        sessionJumpCommandByKey,
      }),
    [shortcuts, platform, sidebarShortcutContext.terminalOpen, sessionJumpCommandByKey],
  );
  const shouldShowSessionJumpHintsNow = shouldShowSessionJumpHintsForModifiers(
    shortcutModifiers,
    shortcuts,
    {
      platform,
      context: sidebarShortcutContext,
    },
  );
  const visibleSessionJumpLabelByKey = showSessionJumpHints
    ? sessionJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;
  const orderedSidebarSessionKeys = visibleSidebarSessionKeys;
  const prewarmedSidebarSessionKeys = useMemo(
    () => getSidebarSessionIdsToPrewarm(visibleSidebarSessionKeys),
    [visibleSidebarSessionKeys],
  );
  const prewarmedSidebarSessionRefs = useMemo(
    () =>
      prewarmedSidebarSessionKeys.flatMap((sessionKey) => {
        const ref = parseScopedSessionKey(sessionKey);
        return ref ? [ref] : [];
      }),
    [prewarmedSidebarSessionKeys],
  );

  useEffect(() => {
    const releases = prewarmedSidebarSessionRefs.map((ref) =>
      retainSessionDetailSubscription(ref.environmentId, ref.sessionId),
    );

    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [prewarmedSidebarSessionRefs]);

  useEffect(() => {
    updateSessionJumpHintsVisibility(shouldShowSessionJumpHintsNow);
  }, [shouldShowSessionJumpHintsNow, updateSessionJumpHintsVisibility]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcutContext = getCurrentSidebarShortcutContext();

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, shortcuts, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = sessionTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetSessionKey = resolveAdjacentSessionId({
          sessionIds: orderedSidebarSessionKeys,
          currentSessionId: routeSessionKey,
          direction: traversalDirection,
        });
        if (!targetSessionKey) {
          return;
        }
        const targetSession = sidebarSessionByKey.get(targetSessionKey);
        if (!targetSession) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToSession(scopeSessionRef(targetSession.environmentId, targetSession.id));
        return;
      }

      const jumpIndex = sessionJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetSessionKey = sessionJumpSessionKeys[jumpIndex];
      if (!targetSessionKey) {
        return;
      }
      const targetSession = sidebarSessionByKey.get(targetSessionKey);
      if (!targetSession) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToSession(scopeSessionRef(targetSession.environmentId, targetSession.id));
    };

    window.addEventListener("keydown", onWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    getCurrentSidebarShortcutContext,
    shortcuts,
    navigateToSession,
    orderedSidebarSessionKeys,
    platform,
    routeSessionKey,
    sidebarSessionByKey,
    sessionJumpSessionKeys,
  ]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!useSessionSelectionStore.getState().hasSelection()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearSessionSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const commandPaletteShortcutLabel = shortcutLabelForCommand(
    shortcuts,
    "commandPalette.toggle",
    newSessionShortcutLabelOptions,
  );
  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedSessionToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandSessionListForProject = useCallback((projectKey: string) => {
    setExpandedSessionListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseSessionListForProject = useCallback((projectKey: string) => {
    setExpandedSessionListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarProjectsContent
            showArm64IntelBuildWarning={showArm64IntelBuildWarning}
            arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
            desktopUpdateButtonAction={desktopUpdateButtonAction}
            desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
            handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
            projectSortOrder={sidebarProjectSortOrder}
            sessionSortOrder={sidebarSessionSortOrder}
            projectGroupingMode={sidebarProjectGroupingMode}
            sessionPreviewCount={sidebarSessionPreviewCount}
            updateSettings={updateSettings}
            openAddProject={openAddProjectCommandPalette}
            isManualProjectSorting={isManualProjectSorting}
            projectDnDSensors={projectDnDSensors}
            projectCollisionDetection={projectCollisionDetection}
            handleProjectDragStart={handleProjectDragStart}
            handleProjectDragEnd={handleProjectDragEnd}
            handleProjectDragCancel={handleProjectDragCancel}
            handleNewSession={handleNewSession}
            archiveSession={archiveSession}
            deleteSession={deleteSession}
            sortedProjects={sortedProjects}
            expandedSessionListsByProject={expandedSessionListsByProject}
            activeRouteProjectKey={activeRouteProjectKey}
            routeSessionKey={routeSessionKey}
            newSessionShortcutLabel={newSessionShortcutLabel}
            commandPaletteShortcutLabel={commandPaletteShortcutLabel}
            sessionJumpLabelByKey={visibleSessionJumpLabelByKey}
            attachSessionListAutoAnimateRef={attachSessionListAutoAnimateRef}
            expandSessionListForProject={expandSessionListForProject}
            collapseSessionListForProject={collapseSessionListForProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
            projectsLength={projects.length}
          />

          <SidebarSeparator />
          <SidebarChromeFooter />
        </>
      )}
    </>
  );
}
