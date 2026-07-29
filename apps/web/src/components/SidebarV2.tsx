import {
  sessionRaisedHandWhileSnoozed,
  sessionWokeAt,
  scopedProjectKey,
  scopedSessionKey,
  scopeProjectRef,
  scopeSessionRef,
} from "@t3tools/client-runtime";
import type { ChangeRequestState, ScopedProjectRef, ScopedSessionRef } from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderPlusIcon,
  FolderXIcon,
  HandIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { isElectron } from "../env";
import { readEnvironmentApi } from "../environmentApi";
import {
  environmentSupportsSessionSettlement,
  environmentSupportsSessionSnooze,
} from "../environments/capabilities";
import { usePrimaryEnvironmentId } from "../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { useNewSessionHandler } from "../hooks/useHandleNewSession";
import { useNowMinute } from "../hooks/useNowMinute";
import { useSessionActions } from "../hooks/useSessionActions";
import { useSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useGitStatus } from "../lib/gitStatusState";
import { cn, newCommandId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  derivePhysicalProjectKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildSessionRouteParams, resolveSessionRouteTarget } from "../sessionRoutes";
import {
  resolveShortcutCommand,
  sessionJumpCommandForIndex,
  sessionJumpIndexFromCommand,
  sessionTraversalDirectionFromCommand,
  shouldShowSessionJumpHintsForModifiers,
} from "../shortcuts";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarSessionsAcrossEnvironments,
  useStore,
} from "../store";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useModelPickerOpen } from "../modelPickerOpenState";
import { useServerShortcuts } from "../rpc/serverState";
import { useShortcutModifierState } from "../shortcutModifierState";
import type { SidebarSessionSummary } from "../types";
import { useUiStateStore } from "../uiStateStore";
import {
  formatWorkingDurationLabel,
  orderItemsByPreferredIds,
  resolveAdjacentSessionId,
  resolveSidebarV2Status,
  resolveWorkingStartedAt,
  useSessionJumpHintVisibility,
} from "./Sidebar.logic";
import {
  parkedSessionsVisibleWhenCollapsed,
  pageSessionsWithRouteRetention,
  partitionSidebarV2Sessions,
  resolveSidebarV2NewSessionOptions,
  sessionsRequiringChangeRequestObservation,
  sidebarV2SessionRowKey,
  toSessionLifecycleShell,
  type SidebarV2Section,
} from "./SidebarV2.logic";
import { attachSidebarV2ListAnimation } from "./SidebarV2.animation";
import { resolveSnoozePresets, snoozeWakeDescription, snoozeWakeLabel } from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveSessionPr,
  SessionRowTrailingStatus,
  type PrStatusIndicator,
} from "./SessionStatusIndicators";
import { SidebarChromeFooter, SidebarChromeHeader } from "./Sidebar";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { SidebarContent, SidebarGroup, SidebarSeparator, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedSessionToast, toastManager } from "./ui/toast";
import { EMPTY_THREAD_JUMP_LABELS, buildSessionJumpLabelMap } from "./sidebar/sidebarPresentation";

const SETTLED_INITIAL_COUNT = 10;
const SETTLED_PAGE_SIZE = 25;

type ChangeRequestStateLike = Extract<ChangeRequestState, "open" | "closed" | "merged">;

interface ObservedChangeRequest {
  state: ChangeRequestStateLike | null;
  presentation: PrStatusIndicator | null;
}

function projectMemberLabel(
  member: SidebarProjectGroupMember,
  project: SidebarProjectSnapshot,
): string {
  if (project.memberProjects.length === 1) return project.displayName;
  return member.environmentLabel
    ? `${member.name} · ${member.environmentLabel}`
    : `${member.name} · ${member.cwd}`;
}

function projectCwdForSession(
  session: SidebarSessionSummary,
  project: SidebarProjectSnapshot,
): string {
  return (
    project.memberProjects.find(
      (member) => member.environmentId === session.environmentId && member.id === session.projectId,
    )?.cwd ?? project.cwd
  );
}

function observedChangeRequestsEqual(
  left: ObservedChangeRequest | null | undefined,
  right: ObservedChangeRequest | null,
): boolean {
  if (left === right) return true;
  if (!left && !right) return true;
  if (!left || !right || left.state !== right.state) return false;
  const leftPresentation = left.presentation;
  const rightPresentation = right.presentation;
  if (leftPresentation === rightPresentation) return true;
  if (!leftPresentation || !rightPresentation) return false;
  return (
    leftPresentation.label === rightPresentation.label &&
    leftPresentation.colorClass === rightPresentation.colorClass &&
    leftPresentation.tooltip === rightPresentation.tooltip &&
    leftPresentation.url === rightPresentation.url
  );
}

function ProjectActionsMenu({
  project,
  sessions,
  onNewSession,
}: {
  project: SidebarProjectSnapshot;
  sessions: readonly SidebarSessionSummary[];
  onNewSession: (projectRef: ScopedProjectRef) => void;
}) {
  const { copyToClipboard } = useCopyToClipboard();

  const renameProject = useCallback(async (member: SidebarProjectGroupMember) => {
    const title = window.prompt("Rename project", member.name)?.trim();
    if (!title || title === member.name) return;
    const api = readEnvironmentApi(member.environmentId);
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId: member.id,
      title,
    });
  }, []);

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const memberSessions = sessions.filter(
        (session) =>
          session.environmentId === member.environmentId && session.projectId === member.id,
      );
      const localApi = readLocalApi();
      if (!localApi) return;
      const confirmed = await localApi.dialogs.confirm(
        [
          `Remove project "${member.name}"?`,
          `Path: ${member.cwd}`,
          ...(memberSessions.length > 0
            ? [
                `This also permanently deletes ${memberSessions.length} session${
                  memberSessions.length === 1 ? "" : "s"
                }.`,
                "This action cannot be undone.",
              ]
            : ["This removes only this project entry."]),
        ].join("\n"),
      );
      if (!confirmed) return;
      const api = readEnvironmentApi(member.environmentId);
      if (!api) return;
      const memberRef = scopeProjectRef(member.environmentId, member.id);
      const draftStore = useComposerDraftStore.getState();
      const projectDraft = draftStore.getDraftSessionByProjectRef(memberRef);
      if (projectDraft) draftStore.clearDraftSession(projectDraft.draftId);
      draftStore.clearProjectDraftSessionId(memberRef);
      await api.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: member.id,
        ...(memberSessions.length > 0 ? { force: true } : {}),
      });
    },
    [sessions],
  );

  const reportActionError = useCallback((title: string, error: unknown) => {
    toastManager.add(
      stackedSessionToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      }),
    );
  }, []);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
            aria-label={`Actions for ${project.displayName}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="right" className="w-64">
        {project.memberProjects.flatMap((member, index) => [
          ...(index > 0 ? [<MenuSeparator key={`${member.physicalProjectKey}:separator`} />] : []),
          <div
            key={`${member.physicalProjectKey}:label`}
            className="truncate px-2 py-1 text-[10px] font-medium text-muted-foreground"
          >
            {projectMemberLabel(member, project)}
          </div>,
          <MenuItem
            key={`${member.physicalProjectKey}:new`}
            onClick={() => onNewSession(scopeProjectRef(member.environmentId, member.id))}
          >
            <PlusIcon />
            New session
          </MenuItem>,
          <MenuItem
            key={`${member.physicalProjectKey}:copy`}
            onClick={() => copyToClipboard(member.cwd, undefined)}
          >
            <CopyIcon />
            Copy project path
          </MenuItem>,
          <MenuItem
            key={`${member.physicalProjectKey}:rename`}
            onClick={() => {
              void renameProject(member).catch((error) =>
                reportActionError("Could not rename project", error),
              );
            }}
          >
            <PencilIcon />
            Rename project
          </MenuItem>,
          <MenuItem
            key={`${member.physicalProjectKey}:remove`}
            variant="destructive"
            onClick={() => {
              void removeProject(member).catch((error) =>
                reportActionError("Could not remove project", error),
              );
            }}
          >
            <FolderXIcon />
            Remove project
          </MenuItem>,
        ])}
      </MenuPopup>
    </Menu>
  );
}

function WorkingDuration({ session }: { session: SidebarSessionSummary }) {
  const startedAt = resolveWorkingStartedAt(session);
  const [now, setNow] = useState(() => Date.now());
  const working = resolveSidebarV2Status(session) === "working" && startedAt !== null;

  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [working]);

  if (!working || startedAt === null) return null;
  return (
    <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/75">
      {formatWorkingDurationLabel(now - Date.parse(startedAt))}
    </span>
  );
}

function statusDotClass(session: SidebarSessionSummary): string {
  switch (resolveSidebarV2Status(session)) {
    case "approval":
      return "bg-amber-500";
    case "input":
      return "bg-sky-500";
    case "working":
      return "animate-pulse bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "ready":
      return "bg-muted-foreground/35";
  }
}

interface ChangeRequestObserverProps {
  session: SidebarSessionSummary;
  project: SidebarProjectSnapshot;
  onChange: (sessionKey: string, observation: ObservedChangeRequest | null) => void;
}

const SidebarV2ChangeRequestObserver = memo(function SidebarV2ChangeRequestObserver({
  session,
  project,
  onChange,
}: ChangeRequestObserverProps) {
  const sessionKey = scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
  const gitStatus = useGitStatus({
    environmentId: session.environmentId,
    cwd:
      session.branch === null
        ? null
        : (session.worktreePath ?? projectCwdForSession(session, project)),
  });
  const pr = resolveSessionPr(session.branch, gitStatus.data);
  const state =
    pr?.state === "open" || pr?.state === "closed" || pr?.state === "merged" ? pr.state : null;
  const sourceControlProvider = gitStatus.data?.sourceControlProvider;
  const presentation = useMemo(
    () => prStatusIndicator(pr, sourceControlProvider),
    [pr, sourceControlProvider],
  );

  useEffect(() => {
    onChange(sessionKey, { state, presentation });
  }, [onChange, presentation, sessionKey, state]);

  useEffect(
    () => () => {
      onChange(sessionKey, null);
    },
    [onChange, sessionKey],
  );

  return null;
});

interface SessionRowProps {
  session: SidebarSessionSummary;
  project: SidebarProjectSnapshot;
  section: SidebarV2Section;
  isActive: boolean;
  jumpLabel: string | null;
  nowIso: string;
  changeRequest: ObservedChangeRequest | null;
  onNavigate: (sessionRef: ScopedSessionRef) => void;
}

const SidebarV2SessionRow = memo(function SidebarV2SessionRow({
  session,
  project,
  section,
  isActive,
  jumpLabel,
  nowIso,
  changeRequest,
  onNavigate,
}: SessionRowProps) {
  const sessionRef = scopeSessionRef(session.environmentId, session.id);
  const sessionKey = scopedSessionKey(sessionRef);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const lastVisitedAt = useUiStateStore((state) => state.sessionLastVisitedAtById[sessionKey]);
  const projectCwd = projectCwdForSession(session, project);
  const prStatus = changeRequest?.presentation ?? null;
  const shell = toSessionLifecycleShell(session);
  const raisedHand = sessionRaisedHandWhileSnoozed(shell);
  const wokeAt = sessionWokeAt(shell, { now: nowIso });
  const showWoke =
    wokeAt !== null &&
    (lastVisitedAt === undefined ||
      Number.isNaN(Date.parse(lastVisitedAt)) ||
      Date.parse(wokeAt) > Date.parse(lastVisitedAt));
  const settlementSupported = environmentSupportsSessionSettlement(session.environmentId);
  const snoozeSupported = environmentSupportsSessionSnooze(session.environmentId);
  const running = session.session?.status === "running" && session.session.activeTurnId !== null;
  const {
    archiveSession,
    confirmAndDeleteSession,
    settleSession,
    snoozeSession,
    unsettleSession,
    unsnoozeSession,
  } = useSessionActions();

  const handleClick = useCallback(() => onNavigate(sessionRef), [onNavigate, sessionRef]);
  const stopRowClick = useCallback((event: ReactMouseEvent) => event.stopPropagation(), []);
  const snoozePresets = useMemo(() => resolveSnoozePresets(now), [now]);

  return (
    <li
      data-session-item
      data-session-key={sessionKey}
      data-session-section={section}
      className="group/session relative"
    >
      <button
        type="button"
        className={cn(
          "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-hidden transition-[background-color,color,opacity] duration-150",
          "hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:text-foreground",
          section === "settled" && !isActive && "opacity-70 hover:opacity-100",
        )}
        onClick={handleClick}
      >
        <span
          aria-label={resolveSidebarV2Status(session)}
          className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(session))}
        />
        <ProjectFavicon
          environmentId={session.environmentId}
          cwd={projectCwd}
          {...(section === "settled"
            ? { fallbackIcon: MessageSquareIcon, className: "opacity-75" }
            : {})}
        />
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        {showWoke ? (
          <span className="rounded-full bg-sky-500/12 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:text-sky-300">
            Woke
          </span>
        ) : null}
        {section === "snoozed" && session.snoozedUntil !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground/80" />
              }
            >
              {raisedHand ? <HandIcon className="size-3 text-amber-500" /> : null}
              <AlarmClockIcon className="size-3" />
              {snoozeWakeLabel(session.snoozedUntil, now)}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {raisedHand
                ? "This session needs attention"
                : `Wakes ${snoozeWakeDescription(session.snoozedUntil, now)}`}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {prStatus ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={cn("inline-flex shrink-0 items-center", prStatus.colorClass)} />
              }
            >
              <ChangeRequestStatusIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
          </Tooltip>
        ) : null}
        <WorkingDuration session={session} />
        <SessionRowTrailingStatus session={session} />
        {jumpLabel ? <Kbd className="ml-0.5 h-4 min-w-4 px-1 text-[8px]">{jumpLabel}</Kbd> : null}
        <Menu>
          <MenuTrigger
            onClick={stopRowClick}
            render={
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-background/70 group-hover/session:opacity-100 focus-visible:opacity-100" />
            }
          >
            <MoreHorizontalIcon className="size-3.5" />
            <span className="sr-only">Session actions</span>
          </MenuTrigger>
          <MenuPopup align="end" side="right" className="w-48">
            {section === "settled" && settlementSupported ? (
              <MenuItem onClick={() => void unsettleSession(sessionRef)}>
                <Undo2Icon />
                Reactivate
              </MenuItem>
            ) : null}
            {section !== "settled" && settlementSupported ? (
              <MenuItem disabled={running} onClick={() => void settleSession(sessionRef)}>
                <CheckCircle2Icon />
                Settle
              </MenuItem>
            ) : null}
            {section === "snoozed" && snoozeSupported ? (
              <MenuItem onClick={() => void unsnoozeSession(sessionRef)}>
                <AlarmClockIcon />
                Wake now
              </MenuItem>
            ) : null}
            {section !== "snoozed" && snoozeSupported
              ? snoozePresets.map((preset) => (
                  <MenuItem
                    key={preset.id}
                    disabled={session.hasPendingApprovals || session.hasPendingUserInput}
                    onClick={() => void snoozeSession(sessionRef, preset.snoozedUntil)}
                  >
                    <AlarmClockIcon />
                    <span className="flex min-w-0 flex-1 justify-between gap-3">
                      <span>{preset.label}</span>
                      <span className="text-muted-foreground">{preset.whenLabel}</span>
                    </span>
                  </MenuItem>
                ))
              : null}
            <MenuSeparator />
            <MenuItem disabled={running} onClick={() => void archiveSession(sessionRef)}>
              <ArchiveIcon />
              Archive
            </MenuItem>
            <MenuItem
              variant="destructive"
              onClick={() => void confirmAndDeleteSession(sessionRef)}
            >
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </button>
    </li>
  );
});

interface ShelfProps {
  label: string;
  section: "snoozed" | "settled";
  sessions: readonly SidebarSessionSummary[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: (sessions: readonly SidebarSessionSummary[]) => React.ReactNode;
  routeSessionRef: ScopedSessionRef | null;
  visibleCount?: number;
  onShowMore?: () => void;
  attachAnimatedListRef: (node: HTMLUListElement | null) => void;
}

function ParkedShelf({
  label,
  section,
  sessions,
  expanded,
  onExpandedChange,
  children,
  routeSessionRef,
  visibleCount,
  onShowMore,
  attachAnimatedListRef,
}: ShelfProps) {
  if (sessions.length === 0) return null;
  const collapsedSafe = parkedSessionsVisibleWhenCollapsed({
    sessions,
    expanded,
    routeSessionRef,
  });
  const visible =
    visibleCount === undefined
      ? collapsedSafe
      : pageSessionsWithRouteRetention({
          sessions: collapsedSafe,
          visibleCount,
          routeSessionRef,
        });
  const hiddenCount = Math.max(0, sessions.length - visible.length);

  return (
    <div data-sidebar-v2-shelf={section} className="mt-1">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/65 hover:bg-sidebar-accent/50 hover:text-muted-foreground"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        <span>{label}</span>
        <span className="ml-auto tabular-nums">{sessions.length}</span>
      </button>
      {visible.length > 0 ? (
        <ul
          ref={attachAnimatedListRef}
          className="space-y-0.5"
          data-sidebar-v2-animated-list={section}
          data-sidebar-v2-shelf-list={section}
        >
          {children(visible)}
        </ul>
      ) : null}
      {expanded && onShowMore && hiddenCount > 0 ? (
        <button
          type="button"
          className="ml-7 mt-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onShowMore}
        >
          Show {Math.min(SETTLED_PAGE_SIZE, hiddenCount)} more
        </button>
      ) : null}
    </div>
  );
}

interface ProjectGroupProps {
  project: SidebarProjectSnapshot;
  sessions: readonly SidebarSessionSummary[];
  routeSessionRef: ScopedSessionRef | null;
  activeDraftProjectKey: string | null;
  nowIso: string;
  autoSettleAfterDays: number | null;
  changeRequestStateBySessionKey: ReadonlyMap<string, ChangeRequestStateLike | null>;
  observedChangeRequestBySessionKey: ReadonlyMap<string, ObservedChangeRequest>;
  jumpLabelByKey: ReadonlyMap<string, string>;
  onNavigate: (sessionRef: ScopedSessionRef) => void;
  onObservedChangeRequest: (sessionKey: string, observation: ObservedChangeRequest | null) => void;
  onNewSession: (projectRef: ScopedProjectRef) => void;
  registerVisibleSessionKeys: (projectKey: string, sessionKeys: readonly string[]) => void;
}

function SidebarV2ProjectGroup({
  project,
  sessions,
  routeSessionRef,
  activeDraftProjectKey,
  nowIso,
  autoSettleAfterDays,
  changeRequestStateBySessionKey,
  observedChangeRequestBySessionKey,
  jumpLabelByKey,
  onNavigate,
  onObservedChangeRequest,
  onNewSession,
  registerVisibleSessionKeys,
}: ProjectGroupProps) {
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const [settledExpanded, setSettledExpanded] = useState(true);
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_INITIAL_COUNT);
  const animatedListsRef = useRef(new WeakSet<HTMLElement>());
  const attachAnimatedListRef = useCallback((node: HTMLUListElement | null) => {
    attachSidebarV2ListAnimation(node, animatedListsRef.current);
  }, []);
  const partition = useMemo(
    () =>
      partitionSidebarV2Sessions({
        sessions,
        now: nowIso,
        autoSettleAfterDays,
        changeRequestStateBySessionKey,
        settlementSupported: (session) =>
          environmentSupportsSessionSettlement(session.environmentId),
        snoozeSupported: (session) => environmentSupportsSessionSnooze(session.environmentId),
      }),
    [autoSettleAfterDays, changeRequestStateBySessionKey, nowIso, sessions],
  );
  const observedSessions = useMemo(
    () => sessionsRequiringChangeRequestObservation(sessions),
    [sessions],
  );
  const draftActive = activeDraftProjectKey === project.projectKey;
  const routeInProject =
    routeSessionRef !== null &&
    sessions.some(
      (session) =>
        session.environmentId === routeSessionRef.environmentId &&
        session.id === routeSessionRef.sessionId,
    );
  const representative =
    project.memberProjects.find(
      (member) => member.environmentId === project.environmentId && member.id === project.id,
    ) ?? project.memberProjects[0];

  const activeVisible = useMemo(
    () => (projectExpanded ? partition.active : []),
    [partition.active, projectExpanded],
  );
  const snoozedVisible = useMemo(
    () =>
      parkedSessionsVisibleWhenCollapsed({
        sessions: partition.snoozed,
        expanded: projectExpanded && snoozedExpanded,
        routeSessionRef,
      }),
    [partition.snoozed, projectExpanded, routeSessionRef, snoozedExpanded],
  );
  const settledCollapsedSafe = useMemo(
    () =>
      parkedSessionsVisibleWhenCollapsed({
        sessions: partition.settled,
        expanded: projectExpanded && settledExpanded,
        routeSessionRef,
      }),
    [partition.settled, projectExpanded, routeSessionRef, settledExpanded],
  );
  const settledVisible = useMemo(
    () =>
      pageSessionsWithRouteRetention({
        sessions: settledCollapsedSafe,
        visibleCount: settledVisibleCount,
        routeSessionRef,
      }),
    [routeSessionRef, settledCollapsedSafe, settledVisibleCount],
  );
  const visibleSessionKeys = useMemo(
    () =>
      [...activeVisible, ...snoozedVisible, ...settledVisible].map((session) =>
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      ),
    [activeVisible, settledVisible, snoozedVisible],
  );

  useEffect(() => {
    registerVisibleSessionKeys(project.projectKey, visibleSessionKeys);
  }, [project.projectKey, registerVisibleSessionKeys, visibleSessionKeys]);

  const renderRows = (section: SidebarV2Section, rows: readonly SidebarSessionSummary[]) =>
    rows.map((session) => {
      const sessionKey = scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
      return (
        <SidebarV2SessionRow
          key={sidebarV2SessionRowKey(session)}
          session={session}
          project={project}
          section={section}
          isActive={
            routeSessionRef?.environmentId === session.environmentId &&
            routeSessionRef.sessionId === session.id
          }
          jumpLabel={jumpLabelByKey.get(sessionKey) ?? null}
          nowIso={nowIso}
          changeRequest={observedChangeRequestBySessionKey.get(sessionKey) ?? null}
          onNavigate={onNavigate}
        />
      );
    });

  if (!representative) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-transparent px-1 py-1 transition-colors",
        (routeInProject || draftActive) && "border-border/70 bg-sidebar-accent/25",
      )}
      data-project-key={project.projectKey}
      data-draft-active={draftActive || undefined}
    >
      <div className="group/project flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs font-medium outline-hidden hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={projectExpanded}
          onClick={() => setProjectExpanded((current) => !current)}
        >
          {projectExpanded ? (
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <ProjectFavicon environmentId={representative.environmentId} cwd={representative.cwd} />
          <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
          {project.groupedProjectCount > 1 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {project.groupedProjectCount}
            </span>
          ) : null}
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
                onClick={() =>
                  onNewSession(scopeProjectRef(representative.environmentId, representative.id))
                }
              />
            }
          >
            <PlusIcon />
            <span className="sr-only">New session in {project.displayName}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">New session</TooltipPopup>
        </Tooltip>
        <ProjectActionsMenu project={project} sessions={sessions} onNewSession={onNewSession} />
      </div>
      {observedSessions.map((session) => {
        const sessionKey = scopedSessionKey(scopeSessionRef(session.environmentId, session.id));
        return (
          <SidebarV2ChangeRequestObserver
            key={sessionKey}
            session={session}
            project={project}
            onChange={onObservedChangeRequest}
          />
        );
      })}
      <div>
        {projectExpanded && partition.active.length > 0 ? (
          <ul
            ref={attachAnimatedListRef}
            className="space-y-0.5"
            data-sidebar-v2-animated-list="active"
          >
            {renderRows("active", partition.active)}
          </ul>
        ) : null}
        <ParkedShelf
          label="Snoozed"
          section="snoozed"
          sessions={partition.snoozed}
          expanded={projectExpanded && snoozedExpanded}
          onExpandedChange={(expanded) => {
            setProjectExpanded(true);
            setSnoozedExpanded(expanded);
          }}
          routeSessionRef={routeSessionRef}
          attachAnimatedListRef={attachAnimatedListRef}
        >
          {(rows) => renderRows("snoozed", rows)}
        </ParkedShelf>
        <ParkedShelf
          label="Settled"
          section="settled"
          sessions={partition.settled}
          expanded={projectExpanded && settledExpanded}
          onExpandedChange={(expanded) => {
            setProjectExpanded(true);
            setSettledExpanded(expanded);
          }}
          routeSessionRef={routeSessionRef}
          visibleCount={settledVisibleCount}
          onShowMore={() => setSettledVisibleCount((current) => current + SETTLED_PAGE_SIZE)}
          attachAnimatedListRef={attachAnimatedListRef}
        >
          {(rows) => renderRows("settled", rows)}
        </ParkedShelf>
      </div>
    </div>
  );
}

export default function SidebarV2() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sessions = useStore(useShallow(selectSidebarSessionsAcrossEnvironments));
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const settings = useSettings();
  const groupingSettings = useMemo(() => selectProjectGroupingSettings(settings), [settings]);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentRuntime = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveSessionRouteTarget(params),
  });
  const routeSessionRef = routeTarget?.kind === "server" ? routeTarget.sessionRef : null;
  const activeDraft = useComposerDraftStore((state) =>
    routeTarget?.kind === "draft"
      ? (state.draftSessionsBySessionKey[routeTarget.draftId] ?? null)
      : null,
  );
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { handleNewSession: createNewSession } = useNewSessionHandler();
  const openNewSessionIn = useCommandPaletteStore((state) => state.openNewSessionIn);
  const openAddProject = useCommandPaletteStore((state) => state.openAddProject);
  const shortcuts = useServerShortcuts();
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const modelPickerOpen = useModelPickerOpen();
  const { showSessionJumpHints, updateSessionJumpHintsVisibility } = useSessionJumpHintVisibility();
  const nowMinute = useNowMinute();
  const nowIso = `${nowMinute}:00.000Z`;
  const [observedChangeRequestBySessionKey, setObservedChangeRequestBySessionKey] = useState<
    ReadonlyMap<string, ObservedChangeRequest>
  >(() => new Map());
  const [visibleKeysByProject, setVisibleKeysByProject] = useState<
    ReadonlyMap<string, readonly string[]>
  >(() => new Map());

  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );
  const physicalToLogicalKey = useMemo(
    () =>
      buildPhysicalToLogicalProjectKeyMap({
        projects: orderedProjects,
        settings: groupingSettings,
      }),
    [groupingSettings, orderedProjects],
  );
  const physicalKeyByProjectRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );
  const sidebarProjects = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: orderedProjects,
        settings: groupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) =>
          savedEnvironmentRuntime[environmentId]?.descriptor?.label ??
          savedEnvironmentRegistry[environmentId]?.label ??
          null,
      }),
    [
      groupingSettings,
      orderedProjects,
      primaryEnvironmentId,
      savedEnvironmentRegistry,
      savedEnvironmentRuntime,
    ],
  );
  const sessionsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarSessionSummary[]>();
    for (const session of sessions) {
      const scopedProjectRef = scopeProjectRef(session.environmentId, session.projectId);
      const physicalKey =
        physicalKeyByProjectRef.get(scopedProjectKey(scopedProjectRef)) ??
        scopedProjectKey(scopedProjectRef);
      const projectKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const group = next.get(projectKey);
      if (group) group.push(session);
      else next.set(projectKey, [session]);
    }
    return next;
  }, [physicalKeyByProjectRef, physicalToLogicalKey, sessions]);
  const changeRequestStateBySessionKey = useMemo(
    () =>
      new Map(
        [...observedChangeRequestBySessionKey].map(([sessionKey, observation]) => [
          sessionKey,
          observation.state,
        ]),
      ),
    [observedChangeRequestBySessionKey],
  );
  const sessionByKey = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
          session,
        ]),
      ),
    [sessions],
  );
  const visibleSessionKeys = useMemo(
    () => sidebarProjects.flatMap((project) => visibleKeysByProject.get(project.projectKey) ?? []),
    [sidebarProjects, visibleKeysByProject],
  );
  const jumpCommandByKey = useMemo(() => {
    const result = new Map<string, NonNullable<ReturnType<typeof sessionJumpCommandForIndex>>>();
    for (const [index, key] of visibleSessionKeys.entries()) {
      const command = sessionJumpCommandForIndex(index);
      if (!command) break;
      result.set(key, command);
    }
    return result;
  }, [visibleSessionKeys]);
  const jumpLabelByKey = useMemo(
    () =>
      buildSessionJumpLabelMap({
        shortcuts,
        platform,
        terminalOpen: false,
        sessionJumpCommandByKey: jumpCommandByKey,
      }),
    [jumpCommandByKey, platform, shortcuts],
  );
  const visibleJumpLabels = showSessionJumpHints ? jumpLabelByKey : EMPTY_THREAD_JUMP_LABELS;
  const activeDraftProjectKey =
    activeDraft?.logicalProjectKey ||
    (activeDraft
      ? (() => {
          const scopedRef = scopeProjectRef(activeDraft.environmentId, activeDraft.projectId);
          const physical =
            physicalKeyByProjectRef.get(scopedProjectKey(scopedRef)) ?? scopedProjectKey(scopedRef);
          return physicalToLogicalKey.get(physical) ?? physical;
        })()
      : null);

  const navigateToSession = useCallback(
    (sessionRef: ScopedSessionRef) => {
      if (isMobile) setOpenMobile(false);
      void navigate({
        to: "/$environmentId/$sessionId",
        params: buildSessionRouteParams(sessionRef),
      });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const registerVisibleSessionKeys = useCallback((projectKey: string, keys: readonly string[]) => {
    setVisibleKeysByProject((current) => {
      const existing = current.get(projectKey);
      if (existing?.length === keys.length && existing.every((key, index) => key === keys[index])) {
        return current;
      }
      const next = new Map(current);
      next.set(projectKey, keys);
      return next;
    });
  }, []);
  const handleObservedChangeRequest = useCallback(
    (sessionKey: string, observation: ObservedChangeRequest | null) => {
      setObservedChangeRequestBySessionKey((current) => {
        const existing = current.get(sessionKey);
        if (observedChangeRequestsEqual(existing, observation)) return current;
        const next = new Map(current);
        if (observation) next.set(sessionKey, observation);
        else next.delete(sessionKey);
        return next;
      });
    },
    [],
  );
  const handleNewSession = useCallback(
    (projectRef: ScopedProjectRef) => {
      void createNewSession(
        projectRef,
        resolveSidebarV2NewSessionOptions(settings.defaultSessionEnvMode),
      );
    },
    [createNewSession, settings.defaultSessionEnvMode],
  );

  const shouldShowJumpHints = shouldShowSessionJumpHintsForModifiers(shortcutModifiers, shortcuts, {
    platform,
    context: {
      terminalFocus: false,
      terminalOpen: false,
      modelPickerOpen,
    },
  });

  useEffect(() => {
    updateSessionJumpHintsVisibility(shouldShowJumpHints);
  }, [shouldShowJumpHints, updateSessionJumpHintsVisibility]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, shortcuts, {
        platform,
        context: {
          terminalFocus: false,
          terminalOpen: false,
          modelPickerOpen,
        },
      });
      const direction = sessionTraversalDirectionFromCommand(command);
      let targetKey: string | null = null;
      if (direction !== null) {
        targetKey = resolveAdjacentSessionId({
          sessionIds: visibleSessionKeys,
          currentSessionId: routeSessionRef ? scopedSessionKey(routeSessionRef) : null,
          direction,
        });
      } else {
        const index = sessionJumpIndexFromCommand(command ?? "");
        targetKey = index === null ? null : (visibleSessionKeys[index] ?? null);
      }
      if (!targetKey) return;
      const session = sessionByKey.get(targetKey);
      if (!session) return;
      event.preventDefault();
      event.stopPropagation();
      navigateToSession(scopeSessionRef(session.environmentId, session.id));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    modelPickerOpen,
    navigateToSession,
    platform,
    routeSessionRef,
    sessionByKey,
    shortcuts,
    visibleSessionKeys,
  ]);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent className="px-1">
        <SidebarGroup className="gap-2 px-1 py-2">
          <div className="flex items-center gap-1 px-1">
            <Button
              data-testid="new-session-button"
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start gap-2 px-2 text-xs"
              onClick={openNewSessionIn}
            >
              <PlusIcon className="size-3.5" />
              New session
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Search sessions"
                    onClick={() => useCommandPaletteStore.getState().setOpen(true)}
                  />
                }
              >
                <SearchIcon />
              </TooltipTrigger>
              <TooltipPopup>Search sessions</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Add project"
                    onClick={openAddProject}
                  />
                }
              >
                <FolderPlusIcon />
              </TooltipTrigger>
              <TooltipPopup>Add project</TooltipPopup>
            </Tooltip>
          </div>
          <div className="space-y-1">
            {sidebarProjects.map((project) => (
              <SidebarV2ProjectGroup
                key={project.projectKey}
                project={project}
                sessions={sessionsByProjectKey.get(project.projectKey) ?? []}
                routeSessionRef={routeSessionRef}
                activeDraftProjectKey={activeDraftProjectKey}
                nowIso={nowIso}
                autoSettleAfterDays={settings.sidebarAutoSettleAfterDays}
                changeRequestStateBySessionKey={changeRequestStateBySessionKey}
                observedChangeRequestBySessionKey={observedChangeRequestBySessionKey}
                jumpLabelByKey={visibleJumpLabels}
                onNavigate={navigateToSession}
                onObservedChangeRequest={handleObservedChangeRequest}
                onNewSession={handleNewSession}
                registerVisibleSessionKeys={registerVisibleSessionKeys}
              />
            ))}
          </div>
          {sidebarProjects.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <p>No projects yet</p>
              <button
                type="button"
                className="mt-2 text-primary hover:underline"
                onClick={openAddProject}
              >
                Add a project
              </button>
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarChromeFooter />
      <span className="sr-only" data-sidebar-v2-pathname={pathname} />
    </>
  );
}
