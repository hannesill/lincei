import {
  type ApprovalRequestId,
  DEFAULT_MODEL,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProjectId,
  type ProviderApprovalDecision,
  ProviderInstanceId,
  type ServerProvider,
  type ResolvedShortcutsConfig,
  type ScopedSessionRef,
  type SessionId,
  type TurnId,
  type ShortcutCommand,
  OrchestrationSessionActivity,
  ProviderInteractionMode,
  ProviderDriverKind,
  RuntimeMode,
  TerminalOpenInput,
} from "@t3tools/contracts";
import {
  parseScopedSessionKey,
  scopedSessionKey,
  scopeProjectRef,
  scopeSessionRef,
} from "@t3tools/client-runtime";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { truncate } from "@t3tools/shared/String";
import { Debouncer } from "@tanstack/react-pacer";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/gitStatusState";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { readEnvironmentApi } from "../environmentApi";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import {
  collapseExpandedComposerCursor,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  deriveCompletionDividerBeforeEntryId,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import {
  selectProjectsAcrossEnvironments,
  selectSessionsAcrossEnvironments,
  useStore,
} from "../store";
import { createProjectSelectorByRef, createSessionSelectorByRef } from "../storeSelectors";
import { useUiStateStore } from "../uiStateStore";
import {
  buildPlanImplementationSessionTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Session,
  type TurnDiffSummary,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { BranchToolbar } from "./BranchToolbar";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../shortcuts";
import PlanSidebar from "./PlanSidebar";
import SessionTerminalDrawer from "./SessionTerminalDrawer";
import { ChevronDownIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { cn, randomUUID } from "~/lib/utils";
import { stackedSessionToast, toastManager } from "./ui/toast";
import { decodeProjectScriptShortcutRule } from "~/lib/projectScriptShortcuts";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/projectScripts";
import { newCommandId, newDraftId, newMessageId, newSessionId } from "~/lib/utils";
import { getProviderModelCapabilities, resolveSelectableProvider } from "../providerModels";
import { useSettings } from "../hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  reconnectSavedEnvironment,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { buildDraftSessionRouteParams } from "../sessionRoutes";
import {
  type ComposerImageAttachment,
  type DraftSessionEnvMode,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import { selectSessionTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestSessionDialog } from "./PullRequestSessionDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { ChatHeader } from "./chat/ChatHeader";
import { type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveSessionState } from "./NoActiveSessionState";
import { resolveEffectiveEnvMode, resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import { ProviderStatusBanner } from "./chat/ProviderStatusBanner";
import { SessionErrorBanner } from "./chat/SessionErrorBanner";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftSession,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  cloneComposerImageForRetry,
  deriveLockedProvider,
  readFileAsDataUrl,
  reconcileMountedTerminalSessionIds,
  resolveSendEnvMode,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  shouldWriteSessionErrorToCurrentServerSession,
  waitForStartedServerSession,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import { useServerAvailableEditors, useServerConfig, useServerShortcuts } from "~/rpc/serverState";
import { sanitizeSessionErrorMessage } from "~/rpc/transportError";
import { retainSessionDetailSubscription } from "../environments/runtime/service";
import { RightPanelSheet } from "./RightPanelSheet";
import { APP_CONTENT_MAX_WIDTH_CLASS } from "./appShell";
import { Button } from "./ui/button";
import {
  buildVersionMismatchDismissalKey,
  dismissVersionMismatch,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
} from "../versionSkew";

const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
const EMPTY_ACTIVITIES: OrchestrationSessionActivity[] = [];
const EMPTY_PROPOSED_PLANS: Session["proposedPlans"] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const AI_REVIEW_NOTICE = "AI can make mistakes. Review its outputs.";
type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connecting" | "disconnected" | "error";
};

type SessionPlanCatalogEntry = Pick<Session, "id" | "proposedPlans">;

function AiReviewNotice() {
  return (
    <p className="px-2 text-center text-[11px] leading-4 text-muted-foreground/55">
      {AI_REVIEW_NOTICE}
    </p>
  );
}

function useSessionPlanCatalog(sessionIds: readonly SessionId[]): SessionPlanCatalogEntry[] {
  return useStore(
    useMemo(() => {
      let previousSessionIds: readonly SessionId[] = [];
      let previousResult: SessionPlanCatalogEntry[] = [];
      let previousEntries = new Map<
        SessionId,
        {
          shell: object | null;
          proposedPlanIds: readonly string[] | undefined;
          proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;
          entry: SessionPlanCatalogEntry;
        }
      >();

      return (state) => {
        const sameSessionIds =
          previousSessionIds.length === sessionIds.length &&
          previousSessionIds.every((id, index) => id === sessionIds[index]);
        const nextEntries = new Map<
          SessionId,
          {
            shell: object | null;
            proposedPlanIds: readonly string[] | undefined;
            proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;
            entry: SessionPlanCatalogEntry;
          }
        >();
        const nextResult: SessionPlanCatalogEntry[] = [];
        let changed = !sameSessionIds;

        for (const sessionId of sessionIds) {
          let shell: object | undefined;
          let proposedPlanIds: readonly string[] | undefined;
          let proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;

          for (const environmentState of Object.values(state.environmentStateById)) {
            const matchedShell = environmentState.sessionShellById[sessionId];
            if (!matchedShell) {
              continue;
            }
            shell = matchedShell;
            proposedPlanIds = environmentState.proposedPlanIdsBySessionId[sessionId];
            proposedPlansById = environmentState.proposedPlanBySessionId[sessionId] as
              | Record<string, Session["proposedPlans"][number]>
              | undefined;
            break;
          }

          if (!shell) {
            const previous = previousEntries.get(sessionId);
            if (
              previous &&
              previous.shell === null &&
              previous.proposedPlanIds === undefined &&
              previous.proposedPlansById === undefined
            ) {
              nextEntries.set(sessionId, previous);
              continue;
            }
            changed = true;
            nextEntries.set(sessionId, {
              shell: null,
              proposedPlanIds: undefined,
              proposedPlansById: undefined,
              entry: { id: sessionId, proposedPlans: EMPTY_PROPOSED_PLANS },
            });
            continue;
          }

          const previous = previousEntries.get(sessionId);
          if (
            previous &&
            previous.shell === shell &&
            previous.proposedPlanIds === proposedPlanIds &&
            previous.proposedPlansById === proposedPlansById
          ) {
            nextEntries.set(sessionId, previous);
            nextResult.push(previous.entry);
            continue;
          }

          changed = true;
          const proposedPlans =
            proposedPlanIds && proposedPlanIds.length > 0 && proposedPlansById
              ? proposedPlanIds.flatMap((planId) => {
                  const proposedPlan = proposedPlansById?.[planId];
                  return proposedPlan ? [proposedPlan] : [];
                })
              : EMPTY_PROPOSED_PLANS;
          const entry = { id: sessionId, proposedPlans };
          nextEntries.set(sessionId, {
            shell,
            proposedPlanIds,
            proposedPlansById,
            entry,
          });
          nextResult.push(entry);
        }

        if (!changed && previousResult.length === nextResult.length) {
          return previousResult;
        }

        previousSessionIds = sessionIds;
        previousEntries = nextEntries;
        previousResult = nextResult;
        return nextResult;
      };
    }, [sessionIds]),
  );
}

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      sessionId: SessionId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      sessionId: SessionId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

interface TerminalLaunchContext {
  sessionId: SessionId;
  cwd: string;
  worktreePath: string | null;
}

type PersistentTerminalLaunchContext = Pick<TerminalLaunchContext, "cwd" | "worktreePath">;

function useLocalDispatchState(input: {
  activeSession: Session | undefined;
  activeLatestTurn: Session["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  sessionError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        if (current) {
          return current.preparingWorktree === preparingWorktree
            ? current
            : { ...current, preparingWorktree };
        }
        return createLocalDispatchSnapshot(input.activeSession, options);
      });
    },
    [input.activeSession],
  );

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        session: input.activeSession?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        sessionError: input.sessionError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeSession?.session,
      input.phase,
      input.sessionError,
      localDispatch,
    ],
  );

  useEffect(() => {
    if (!serverAcknowledgedLocalDispatch) {
      return;
    }
    resetLocalDispatch();
  }, [resetLocalDispatch, serverAcknowledgedLocalDispatch]);

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  };
}

interface PersistentSessionTerminalDrawerProps {
  sessionRef: { environmentId: EnvironmentId; sessionId: SessionId };
  sessionId: SessionId;
  visible: boolean;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  shortcuts: ResolvedShortcutsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

const PersistentSessionTerminalDrawer = memo(function PersistentSessionTerminalDrawer({
  sessionRef,
  sessionId,
  visible,
  launchContext,
  focusRequestId,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  shortcuts,
  onAddTerminalContext,
}: PersistentSessionTerminalDrawerProps) {
  const serverSession = useStore(
    useMemo(() => createSessionSelectorByRef(sessionRef), [sessionRef]),
  );
  const draftSession = useComposerDraftStore((store) => store.getDraftSessionByRef(sessionRef));
  const projectRef = serverSession
    ? scopeProjectRef(serverSession.environmentId, serverSession.projectId)
    : draftSession
      ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
      : null;
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));
  const terminalState = useTerminalStateStore((state) =>
    selectSessionTerminalState(state.terminalStateBySessionKey, sessionRef),
  );
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverSession?.worktreePath ?? draftSession?.worktreePath ?? null;
  const effectiveWorktreePath = useMemo(() => {
    if (launchContext !== null) {
      return launchContext.worktreePath;
    }
    return worktreePath;
  }, [launchContext, worktreePath]);
  const cwd = useMemo(
    () =>
      launchContext?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : null),
    [effectiveWorktreePath, launchContext?.cwd, project],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(sessionRef, height);
    },
    [storeSetTerminalHeight, sessionRef],
  );

  const splitTerminal = useCallback(() => {
    storeSplitTerminal(sessionRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeSplitTerminal, sessionRef]);

  const createNewTerminal = useCallback(() => {
    storeNewTerminal(sessionRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeNewTerminal, sessionRef]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(sessionRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, sessionRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(sessionRef.environmentId);
      if (!api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal.write({ sessionId, terminalId, data: "exit\n" }).catch(() => undefined);

      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal.clear({ sessionId, terminalId }).catch(() => undefined);
          }
          await api.terminal.close({
            sessionId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }

      storeCloseTerminal(sessionRef, terminalId);
      bumpFocusRequestId();
    },
    [
      bumpFocusRequestId,
      storeCloseTerminal,
      terminalState.terminalIds.length,
      sessionId,
      sessionRef,
    ],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || !terminalState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div className={visible ? undefined : "hidden"}>
      <SessionTerminalDrawer
        sessionRef={sessionRef}
        sessionId={sessionId}
        cwd={cwd}
        worktreePath={effectiveWorktreePath}
        runtimeEnv={runtimeEnv}
        visible={visible}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalState.terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
        onSplitTerminal={splitTerminal}
        onNewTerminal={createNewTerminal}
        splitShortcutLabel={visible ? splitShortcutLabel : undefined}
        newShortcutLabel={visible ? newShortcutLabel : undefined}
        closeShortcutLabel={visible ? closeShortcutLabel : undefined}
        shortcuts={shortcuts}
        onActiveTerminalChange={activateTerminal}
        onCloseTerminal={closeTerminal}
        onHeightChange={setTerminalHeight}
        onAddTerminalContext={handleAddTerminalContext}
      />
    </div>
  );
});

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    sessionId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
  } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeSessionRef = useMemo(
    () => scopeSessionRef(environmentId, sessionId),
    [environmentId, sessionId],
  );
  const routeSessionKey = useMemo(() => scopedSessionKey(routeSessionRef), [routeSessionRef]);
  const composerDraftTarget: ScopedSessionRef | DraftId =
    routeKind === "server" ? routeSessionRef : props.draftId;
  const serverSession = useStore(
    useMemo(
      () => createSessionSelectorByRef(routeKind === "server" ? routeSessionRef : null),
      [routeKind, routeSessionRef],
    ),
  );
  const setStoreSessionError = useStore((store) => store.setError);
  const markSessionVisited = useUiStateStore((store) => store.markSessionVisited);
  const activeSessionLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.sessionLastVisitedAtById[routeSessionKey] : undefined,
  );
  const settings = useSettings();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const autoOpenPlanSidebar = settings.autoOpenPlanSidebar;
  const navigate = useNavigate();
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftSessionContext = useComposerDraftStore((store) => store.setDraftSessionContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftSessionId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftSessionId,
  );
  const draftSession = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeSessionRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, string | null>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the session-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new session" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextSessionRef = useRef(false);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [pendingServerSessionEnvMode, setPendingServerSessionEnvMode] =
    useState<DraftSessionEnvMode | null>(null);
  const [pendingServerSessionBranch, setPendingServerSessionBranch] = useState<string | null>();
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const isAtEndRef = useRef(true);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const sendInFlightRef = useRef(false);
  const terminalOpenBySessionRef = useRef<Record<string, boolean>>({});

  const terminalState = useTerminalStateStore((state) =>
    selectSessionTerminalState(state.terminalStateBySessionKey, routeSessionRef),
  );
  const openTerminalSessionKeys = useTerminalStateStore(
    useShallow((state) =>
      Object.entries(state.terminalStateBySessionKey).flatMap(
        ([nextSessionKey, nextTerminalState]) =>
          nextTerminalState.terminalOpen ? [nextSessionKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const serverSessionKeys = useStore(
    useShallow((state) =>
      selectSessionsAcrossEnvironments(state).map((session) =>
        scopedSessionKey(scopeSessionRef(session.environmentId, session.id)),
      ),
    ),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore(
    (s) => s.terminalLaunchContextBySessionKey[scopedSessionKey(routeSessionRef)] ?? null,
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftSessionsBySessionKey = useComposerDraftStore(
    (store) => store.draftSessionsBySessionKey,
  );
  const draftSessionKeys = useMemo(
    () =>
      Object.values(draftSessionsBySessionKey).map((draftSession) =>
        scopedSessionKey(scopeSessionRef(draftSession.environmentId, draftSession.sessionId)),
      ),
    [draftSessionsBySessionKey],
  );
  const [mountedTerminalSessionKeys, setMountedTerminalSessionKeys] = useState<string[]>([]);
  const mountedTerminalSessionRefs = useMemo(
    () =>
      mountedTerminalSessionKeys.flatMap((mountedSessionKey) => {
        const mountedSessionRef = parseScopedSessionKey(mountedSessionKey);
        return mountedSessionRef ? [{ key: mountedSessionKey, sessionRef: mountedSessionRef }] : [];
      }),
    [mountedTerminalSessionKeys],
  );

  const fallbackDraftProjectRef = draftSession
    ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
    : null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelectorByRef(fallbackDraftProjectRef), [fallbackDraftProjectRef]),
  );
  const localDraftError =
    routeKind === "server" && serverSession
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftSession = useMemo(
    () =>
      draftSession
        ? buildLocalDraftSession(
            sessionId,
            draftSession,
            fallbackDraftProject?.defaultModelSelection ?? {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
            localDraftError,
          )
        : undefined,
    [draftSession, fallbackDraftProject?.defaultModelSelection, localDraftError, sessionId],
  );
  const isServerSession = routeKind === "server" && serverSession !== undefined;
  const activeSession = isServerSession ? serverSession : localDraftSession;
  const runtimeMode = composerRuntimeMode ?? activeSession?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerInteractionMode ?? activeSession?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isLocalDraftSession = !isServerSession && localDraftSession !== undefined;
  const canCheckoutPullRequestIntoSession = isLocalDraftSession;
  const diffOpen = rawSearch.diff === "1";
  const activeSessionId = activeSession?.id ?? null;
  const activeSessionRef = useMemo(
    () => (activeSession ? scopeSessionRef(activeSession.environmentId, activeSession.id) : null),
    [activeSession],
  );
  const activeSessionKey = activeSessionRef ? scopedSessionKey(activeSessionRef) : null;
  const existingOpenTerminalSessionKeys = useMemo(() => {
    const existingSessionKeys = new Set<string>([...serverSessionKeys, ...draftSessionKeys]);
    return openTerminalSessionKeys.filter((nextSessionKey) =>
      existingSessionKeys.has(nextSessionKey),
    );
  }, [draftSessionKeys, openTerminalSessionKeys, serverSessionKeys]);
  const activeLatestTurn = activeSession?.latestTurn ?? null;
  const sessionPlanCatalog = useSessionPlanCatalog(
    useMemo(() => {
      const sessionIds: SessionId[] = [];
      if (activeSession?.id) {
        sessionIds.push(activeSession.id);
      }
      const sourceSessionId = activeLatestTurn?.sourceProposedPlan?.sessionId;
      if (sourceSessionId && sourceSessionId !== activeSession?.id) {
        sessionIds.push(sourceSessionId);
      }
      return sessionIds;
    }, [activeLatestTurn?.sourceProposedPlan?.sessionId, activeSession?.id]),
  );
  useEffect(() => {
    setMountedTerminalSessionKeys((currentSessionIds) => {
      const nextSessionIds = reconcileMountedTerminalSessionIds({
        currentSessionIds,
        openSessionIds: existingOpenTerminalSessionKeys,
        activeSessionId: activeSessionKey,
        activeSessionTerminalOpen: Boolean(activeSessionKey && terminalState.terminalOpen),
        maxHiddenSessionCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentSessionIds.length === nextSessionIds.length &&
        currentSessionIds.every((nextSessionId, index) => nextSessionId === nextSessionIds[index])
        ? currentSessionIds
        : nextSessionIds;
    });
  }, [activeSessionKey, existingOpenTerminalSessionKeys, terminalState.terminalOpen]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeSession?.session ?? null);
  const activeProjectRef = activeSession
    ? scopeProjectRef(activeSession.environmentId, activeSession.projectId)
    : null;
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );

  useEffect(() => {
    if (routeKind !== "server") {
      return;
    }
    return retainSessionDetailSubscription(environmentId, sessionId);
  }, [environmentId, routeKind, sessionId]);

  // Compute the list of environments this logical project spans, used to
  // drive the environment picker in BranchToolbar.
  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const activeSavedEnvironmentRecord =
    activeSession && activeSession.environmentId !== primaryEnvironmentId
      ? (savedEnvironmentRegistry[activeSession.environmentId] ?? null)
      : null;
  const activeSavedEnvironmentRuntime = activeSavedEnvironmentRecord
    ? (savedEnvironmentRuntimeById[activeSavedEnvironmentRecord.environmentId] ?? null)
    : null;
  const activeSavedEnvironmentConnectionState = activeSavedEnvironmentRecord
    ? (activeSavedEnvironmentRuntime?.connectionState ?? "disconnected")
    : "connected";
  const activeEnvironmentUnavailable =
    activeSavedEnvironmentRecord !== null && activeSavedEnvironmentConnectionState !== "connected";
  const activeSavedEnvironmentId = activeSavedEnvironmentRecord?.environmentId ?? null;
  const activeEnvironmentUnavailableLabel = activeSavedEnvironmentRecord
    ? resolveEnvironmentOptionLabel({
        isPrimary: false,
        environmentId: activeSavedEnvironmentRecord.environmentId,
        runtimeLabel: activeSavedEnvironmentRuntime?.descriptor?.label ?? null,
        savedLabel: activeSavedEnvironmentRecord.label,
      })
    : null;
  const activeEnvironmentUnavailableState = useMemo<EnvironmentUnavailableState | null>(() => {
    if (
      !activeEnvironmentUnavailable ||
      !activeEnvironmentUnavailableLabel ||
      !activeSavedEnvironmentId
    ) {
      return null;
    }

    return {
      environmentId: activeSavedEnvironmentId,
      label: activeEnvironmentUnavailableLabel,
      connectionState:
        activeSavedEnvironmentConnectionState === "connecting" ||
        activeSavedEnvironmentConnectionState === "error"
          ? activeSavedEnvironmentConnectionState
          : "disconnected",
    };
  }, [
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    activeSavedEnvironmentConnectionState,
    activeSavedEnvironmentId,
  ]);
  const [reconnectingEnvironmentId, setReconnectingEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const handleReconnectActiveEnvironment = useCallback(
    async (environmentId: EnvironmentId, label: string) => {
      setReconnectingEnvironmentId(environmentId);
      try {
        await reconnectSavedEnvironment(environmentId);
        toastManager.add({
          type: "success",
          title: "Environment reconnected",
          description: `${label} is ready.`,
        });
      } catch (error) {
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Could not reconnect environment",
            description: error instanceof Error ? error.message : "Failed to reconnect.",
          }),
        );
      } finally {
        setReconnectingEnvironmentId(null);
      }
    },
    [],
  );
  const projectGroupingSettings = useSettings(selectProjectGroupingSettings);
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const memberProjects = allProjects.filter(
      (p) => deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) === logicalKey,
    );
    const seen = new Set<string>();
    const envs: Array<{
      environmentId: EnvironmentId;
      projectId: ProjectId;
      label: string;
      isPrimary: boolean;
    }> = [];
    for (const p of memberProjects) {
      if (seen.has(p.environmentId)) continue;
      seen.add(p.environmentId);
      const isPrimary = p.environmentId === primaryEnvironmentId;
      const savedRecord = savedEnvironmentRegistry[p.environmentId];
      const runtimeState = savedEnvironmentRuntimeById[p.environmentId];
      const label = resolveEnvironmentOptionLabel({
        isPrimary,
        environmentId: p.environmentId,
        runtimeLabel: runtimeState?.descriptor?.label ?? null,
        savedLabel: savedRecord?.label ?? null,
      });
      envs.push({
        environmentId: p.environmentId,
        projectId: p.id,
        label,
        isPrimary,
      });
    }
    // Sort: primary first, then alphabetical
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [
    activeProject,
    allProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoSession) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
    },
    [canCheckoutPullRequestIntoSession],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftSession = useCallback(
    async (input: {
      branch: string;
      worktreePath: string | null;
      envMode: DraftSessionEnvMode;
    }) => {
      if (!activeProject) {
        throw new Error("No active study is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftSessionContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftSessionId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            sessionId: storedDraftSession.sessionId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftSessionRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.sessionId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerSession &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftSessionContext(draftId, input);
        setLogicalProjectDraftSessionId(logicalProjectKey, activeProjectRef, draftId, {
          sessionId: activeDraftSession.sessionId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          ...input,
        });
        return activeDraftSession.sessionId;
      }

      const nextDraftId = newDraftId();
      const nextSessionId = newSessionId();
      setLogicalProjectDraftSessionId(logicalProjectKey, activeProjectRef, nextDraftId, {
        sessionId: nextSessionId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftSessionRouteParams(nextDraftId),
      });
      return nextSessionId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerSession,
      navigate,
      projectGroupingSettings,
      routeKind,
      setDraftSessionContext,
      setLogicalProjectDraftSessionId,
    ],
  );

  const handlePreparedPullRequestSession = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftSession({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftSession],
  );

  useEffect(() => {
    if (!serverSession?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeSessionLastVisitedAt ? Date.parse(activeSessionLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markSessionVisited(
      scopedSessionKey(scopeSessionRef(serverSession.environmentId, serverSession.id)),
      activeLatestTurn.completedAt,
    );
  }, [
    activeLatestTurn?.completedAt,
    activeSessionLastVisitedAt,
    latestTurnSettled,
    markSessionVisited,
    serverSession?.environmentId,
    serverSession?.id,
  ]);

  const selectedProviderBySessionId = composerActiveProvider ?? null;
  const sessionProvider =
    activeSession?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    session: activeSession,
    selectedProvider: selectedProviderBySessionId,
    sessionProvider,
  });
  const primaryServerConfig = useServerConfig();
  const activeEnvRuntimeState = useSavedEnvironmentRuntimeStore((s) =>
    activeSession?.environmentId ? s.byId[activeSession.environmentId] : null,
  );
  // Use the server config for the session's environment.  For the primary
  // environment fall back to the global atom; for remote environments use
  // the runtime state stored by the environment manager.
  const serverConfig =
    primaryEnvironmentId && activeSession?.environmentId === primaryEnvironmentId
      ? primaryServerConfig
      : (activeEnvRuntimeState?.serverConfig ?? primaryServerConfig);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeSession
      ? buildVersionMismatchDismissalKey(activeSession.environmentId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const hasMultipleRegisteredEnvironments = Object.keys(savedEnvironmentRegistry).length > 0;
  const versionMismatchServerLabel = useMemo(() => {
    if (!hasMultipleRegisteredEnvironments || !activeSession) {
      return "server";
    }

    const isPrimary = activeSession.environmentId === primaryEnvironmentId;
    const savedRecord = savedEnvironmentRegistry[activeSession.environmentId];
    const runtimeState = savedEnvironmentRuntimeById[activeSession.environmentId];
    return `${resolveEnvironmentOptionLabel({
      isPrimary,
      environmentId: activeSession.environmentId,
      runtimeLabel: runtimeState?.descriptor?.label ?? serverConfig?.environment.label ?? null,
      savedLabel: savedRecord?.label ?? null,
    })} server`;
  }, [
    activeSession,
    hasMultipleRegisteredEnvironments,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
    serverConfig?.environment.label,
  ]);
  const composerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    if (activeEnvironmentUnavailableState) {
      items.push({
        id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
        variant:
          activeEnvironmentUnavailableState.connectionState === "error" ? "error" : "warning",
        icon: <WifiOffIcon />,
        title: (
          <>
            {activeEnvironmentUnavailableState.label} is{" "}
            {activeEnvironmentUnavailableState.connectionState === "connecting"
              ? "connecting"
              : "disconnected"}
          </>
        ),
        description: "Reconnect this environment before sending messages or running actions.",
        actions: (
          <>
            <Button
              size="xs"
              disabled={
                activeEnvironmentUnavailableState.connectionState === "connecting" ||
                reconnectingEnvironmentId === activeEnvironmentUnavailableState.environmentId
              }
              onClick={() =>
                void handleReconnectActiveEnvironment(
                  activeEnvironmentUnavailableState.environmentId,
                  activeEnvironmentUnavailableState.label,
                )
              }
            >
              {activeEnvironmentUnavailableState.connectionState === "connecting" ||
              reconnectingEnvironmentId === activeEnvironmentUnavailableState.environmentId
                ? "Reconnecting..."
                : "Reconnect"}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void navigate({ to: "/settings/connections" })}
            >
              Connections
            </Button>
          </>
        ),
      });
    }
    if (showVersionMismatchBanner && versionMismatch && versionMismatchDismissKey) {
      items.push({
        id: `version-mismatch:${versionMismatchDismissKey}`,
        variant: "warning",
        icon: <TriangleAlertIcon />,
        title: "Client and server versions differ",
        description: (
          <>
            Client {versionMismatch.clientVersion} is connected to {versionMismatchServerLabel}{" "}
            {versionMismatch.serverVersion}. Sync them if RPC calls or reconnects fail.
          </>
        ),
        dismissLabel: "Dismiss version mismatch warning",
        onDismiss: () => {
          dismissVersionMismatch(versionMismatchDismissKey);
          setDismissedVersionMismatchKey(versionMismatchDismissKey);
        },
      });
    }
    return items;
  }, [
    activeEnvironmentUnavailableState,
    handleReconnectActiveEnvironment,
    navigate,
    reconnectingEnvironmentId,
    showVersionMismatchBanner,
    versionMismatch,
    versionMismatchDismissKey,
    versionMismatchServerLabel,
  ]);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderBySessionId ?? sessionProvider ?? ProviderDriverKind.make("codex"),
  );
  const selectedProvider: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
  const phase = derivePhase(activeSession?.session ?? null);
  const sessionActivities = activeSession?.activities ?? EMPTY_ACTIVITIES;
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(sessionActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, sessionActivities],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(sessionActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, sessionActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(sessionActivities),
    [sessionActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(sessionActivities),
    [sessionActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeSession?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeSession?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        sessions: sessionPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        sessionId: activeSession?.id ?? null,
      }),
    [activeLatestTurn, activeSession?.id, latestTurnSettled, sessionPlanCatalog],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(sessionActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, sessionActivities],
  );
  const planSidebarLabel = sidebarProposedPlan || interactionMode === "plan" ? "Plan" : "Tasks";
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({
    activeSession,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    sessionError: activeSession?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeSession?.session ?? null,
    localDispatchStartedAt,
  );
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  const serverMessages = activeSession?.messages;
  useEffect(() => {
    if (typeof Image === "undefined" || !serverMessages || serverMessages.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = serverMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image" && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [attachmentPreviewHandoffByMessageId, clearAttachmentPreviewHandoff, serverMessages]);
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeSession?.proposedPlans ?? [], workLogEntries),
    [activeSession?.proposedPlans, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeSession);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!completionSummary) return null;
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn);
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeSession?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const shortcuts = useServerShortcuts();
  const availableEditors = useServerAvailableEditors();
  // Prefer an instance-id match so a custom Codex instance (e.g.
  // `codex_personal`) surfaces its own status/message in the banner rather
  // than the default Codex's. Falls back to first-match-by-kind when no
  // saved instance id is available or the instance no longer exists.
  const activeProviderInstanceId =
    activeSession?.session?.providerInstanceId ??
    activeSession?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const activeProviderStatus = useMemo(() => {
    if (activeProviderInstanceId) {
      return (
        providerStatuses.find((status) => status.instanceId === activeProviderInstanceId) ?? null
      );
    }
    const defaultInstanceId = defaultInstanceIdForDriver(selectedProvider);
    return providerStatuses.find((status) => status.instanceId === defaultInstanceId) ?? null;
  }, [activeProviderInstanceId, providerStatuses, selectedProvider]);
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeSessionWorktreePath = activeSession?.worktreePath ?? null;
  const activeWorkspaceRoot = activeSessionWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.sessionId === activeSessionId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const nonTerminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: false,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(shortcuts, "terminal.toggle"),
    [shortcuts],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(shortcuts, "terminal.split", terminalShortcutLabelOptions),
    [shortcuts, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(shortcuts, "terminal.new", terminalShortcutLabelOptions),
    [shortcuts, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(shortcuts, "terminal.close", terminalShortcutLabelOptions),
    [shortcuts, terminalShortcutLabelOptions],
  );
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(shortcuts, "diff.toggle", nonTerminalShortcutLabelOptions),
    [shortcuts, nonTerminalShortcutLabelOptions],
  );
  const onToggleDiff = useCallback(() => {
    if (!isServerSession) {
      return;
    }
    if (!diffOpen) {
      onDiffPanelOpen?.();
    }
    void navigate({
      to: "/$environmentId/$sessionId",
      params: {
        environmentId,
        sessionId,
      },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1" };
      },
    });
  }, [diffOpen, environmentId, isServerSession, navigate, onDiffPanelOpen, sessionId]);

  const envLocked = Boolean(
    activeSession &&
    (activeSession.messages.length > 0 ||
      (activeSession.session !== null && activeSession.session.status !== "closed")),
  );

  // Handle environment change for draft sessions.  When the user picks a
  // different environment we update the draft context to point at the physical
  // project in that environment while keeping the same logical project.
  const onEnvironmentChange = useCallback(
    (nextEnvironmentId: EnvironmentId) => {
      if (envLocked || !draftId) return;
      const target = logicalProjectEnvironments.find(
        (env) => env.environmentId === nextEnvironmentId,
      );
      if (!target) return;
      setDraftSessionContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [draftId, envLocked, logicalProjectEnvironments, setDraftSessionContext],
  );

  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setSessionError = useCallback(
    (targetSessionId: SessionId | null, error: string | null) => {
      if (!targetSessionId) return;
      const nextError = sanitizeSessionErrorMessage(error);
      const isCurrentServerSession = shouldWriteSessionErrorToCurrentServerSession({
        serverSession,
        routeSessionRef,
        targetSessionId,
      });
      if (isCurrentServerSession) {
        setStoreSessionError(targetSessionId, nextError);
        return;
      }
      const localDraftErrorKey = draftId ?? targetSessionId;
      setLocalDraftErrorsByDraftId((existing) => {
        if ((existing[localDraftErrorKey] ?? null) === nextError) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextError,
        };
      });
    },
    [draftId, routeSessionRef, serverSession, setStoreSessionError],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, []);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback((selection: TerminalContextSelection) => {
    composerRef.current?.addTerminalContext(selection);
  }, []);
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeSessionRef) return;
      storeSetTerminalOpen(activeSessionRef, open);
    },
    [activeSessionRef, storeSetTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeSessionRef) return;
    setTerminalOpen(!terminalState.terminalOpen);
  }, [activeSessionRef, setTerminalOpen, terminalState.terminalOpen]);
  const splitTerminal = useCallback(() => {
    if (!activeSessionRef || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeSessionRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeSessionRef, hasReachedSplitLimit, storeSplitTerminal]);
  const createNewTerminal = useCallback(() => {
    if (!activeSessionRef) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeSessionRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeSessionRef, storeNewTerminal]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!activeSessionId || !api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ sessionId: activeSessionId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ sessionId: activeSessionId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            sessionId: activeSessionId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      if (activeSessionRef) {
        storeCloseTerminal(activeSessionRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeSessionId,
      activeSessionRef,
      environmentId,
      storeCloseTerminal,
      terminalState.terminalIds.length,
    ],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeSessionId || !activeProject || !activeSession) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;
      const targetWorktreePath = options?.worktreePath ?? activeSession.worktreePath ?? null;

      setTerminalLaunchContext({
        sessionId: activeSessionId,
        cwd: targetCwd,
        worktreePath: targetWorktreePath,
      });
      setTerminalOpen(true);
      if (!activeSessionRef) {
        return;
      }
      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeSessionRef, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeSessionRef, targetTerminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            sessionId: activeSessionId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            sessionId: activeSessionId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          sessionId: activeSessionId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setSessionError(
          activeSessionId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeSession,
      activeSessionId,
      activeSessionRef,
      gitCwd,
      setTerminalOpen,
      setSessionError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      environmentId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
    ],
  );

  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ProjectScript[];
      nextScripts: ProjectScript[];
      shortcut?: string | null;
      shortcutCommand: ShortcutCommand;
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) return;

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: input.projectId,
        scripts: input.nextScripts,
      });

      const shortcutRule = decodeProjectScriptShortcutRule({
        shortcut: input.shortcut,
        command: input.shortcutCommand,
      });

      if (isElectron && shortcutRule) {
        const localApi = readLocalApi();
        if (!localApi) {
          throw new Error("Local API unavailable.");
        }
        await localApi.server.upsertShortcut(shortcutRule);
      }
    },
    [environmentId],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        shortcut: input.shortcut,
        shortcutCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        shortcut: input.shortcut,
        shortcutCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject) return;
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          previousScripts: activeProject.scripts,
          nextScripts,
          shortcut: null,
          shortcutCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Could not delete action",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
    },
    [activeProject, persistProjectScripts],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftSession) {
        setDraftSessionContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftSession,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftSessionContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftSession) {
        setDraftSessionContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftSession,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftSessionContext,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        planSidebarDismissedForTurnRef.current =
          activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);
  const closePlanSidebar = useCallback(() => {
    setPlanSidebarOpen(false);
    planSidebarDismissedForTurnRef.current =
      activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);

  const persistSessionSettingsForNextTurn = useCallback(
    async (input: {
      sessionId: SessionId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverSession) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverSession.modelSelection.model ||
          input.modelSelection.instanceId !== serverSession.modelSelection.instanceId ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverSession.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "session.meta.update",
          commandId: newCommandId(),
          sessionId: input.sessionId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverSession.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "session.runtime-mode.set",
          commandId: newCommandId(),
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverSession.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "session.interaction-mode.set",
          commandId: newCommandId(),
          sessionId: input.sessionId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }
    },
    [environmentId, serverSession],
  );

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // session switches.  LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );

  // Scroll helpers — LegendList handles auto-scroll via maintainScrollAtEnd.
  const scrollToEnd = useCallback((animated = false) => {
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    legendListRef.current?.scrollToEnd?.({ animated });
  }, []);

  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    showScrollDebouncer.current.maybeExecute();
  }, []);

  useEffect(() => {
    setPullRequestDialogState(null);
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    if (planSidebarOpenOnNextSessionRef.current) {
      planSidebarOpenOnNextSessionRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      planSidebarOpenOnNextSessionRef.current = false;
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;
  }, [activeSession?.id]);

  // Auto-open the plan sidebar when plan/todo steps arrive for the current turn.
  // Don't auto-open for plans carried over from a previous turn (the user can open manually).
  useEffect(() => {
    if (!autoOpenPlanSidebar) return;
    if (!activePlan) return;
    if (planSidebarOpen) return;
    const latestTurnId = activeLatestTurn?.turnId ?? null;
    if (latestTurnId && activePlan.turnId !== latestTurnId) return;
    const turnKey = activePlan.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
    if (planSidebarDismissedForTurnRef.current === turnKey) return;
    setPlanSidebarOpen(true);
  }, [
    activePlan,
    activeLatestTurn?.turnId,
    autoOpenPlanSidebar,
    planSidebarOpen,
    sidebarProposedPlan?.turnId,
  ]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeSession?.id, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    if (!activeSession?.id) return;
    if (activeSession.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeSession.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeSession?.id,
    activeSession?.messages,
    handoffAttachmentPreviews,
    optimisticUserMessages,
  ]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, sessionId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeSession?.worktreePath ?? null;
  const derivedEnvMode: DraftSessionEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerSession: isServerSession,
    draftSessionEnvMode: isLocalDraftSession ? draftSession?.envMode : undefined,
  });
  const canOverrideServerSessionEnvMode = Boolean(
    isServerSession &&
    activeSession &&
    activeSession.messages.length === 0 &&
    activeSession.worktreePath === null &&
    !envLocked,
  );
  const envMode: DraftSessionEnvMode = canOverrideServerSessionEnvMode
    ? (pendingServerSessionEnvMode ?? draftSession?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeSessionBranch =
    canOverrideServerSessionEnvMode && pendingServerSessionBranch !== undefined
      ? pendingServerSessionBranch
      : (activeSession?.branch ?? null);
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });

  useEffect(() => {
    setPendingServerSessionEnvMode(null);
    setPendingServerSessionBranch(undefined);
  }, [activeSession?.id]);

  useEffect(() => {
    if (canOverrideServerSessionEnvMode) {
      return;
    }
    setPendingServerSessionEnvMode(null);
    setPendingServerSessionBranch(undefined);
  }, [canOverrideServerSessionEnvMode]);

  useEffect(() => {
    if (!activeSessionId) {
      setTerminalLaunchContext(null);
      storeClearTerminalLaunchContext(routeSessionRef);
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current) return current;
      if (current.sessionId === activeSessionId) return current;
      return null;
    });
  }, [activeSessionId, routeSessionRef, storeClearTerminalLaunchContext]);

  useEffect(() => {
    if (!activeSessionId || !activeProjectCwd) {
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current || current.sessionId !== activeSessionId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeSessionWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeSessionWorktreePath ?? null) === current.worktreePath
      ) {
        if (activeSessionRef) {
          storeClearTerminalLaunchContext(activeSessionRef);
        }
        return null;
      }
      return current;
    });
  }, [
    activeProjectCwd,
    activeSessionId,
    activeSessionRef,
    activeSessionWorktreePath,
    storeClearTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (!activeSessionId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeSessionWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      (activeSessionWorktreePath ?? null) === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeSessionRef) {
        storeClearTerminalLaunchContext(activeSessionRef);
      }
    }
  }, [
    activeProjectCwd,
    activeSessionId,
    activeSessionRef,
    activeSessionWorktreePath,
    storeClearTerminalLaunchContext,
    storeServerTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (terminalState.terminalOpen) {
      return;
    }
    if (activeSessionRef) {
      storeClearTerminalLaunchContext(activeSessionRef);
    }
    setTerminalLaunchContext((current) =>
      current?.sessionId === activeSessionId ? null : current,
    );
  }, [
    activeSessionId,
    activeSessionRef,
    storeClearTerminalLaunchContext,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeSessionKey) return;
    const previous = terminalOpenBySessionRef.current[activeSessionKey] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenBySessionRef.current[activeSessionKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenBySessionRef.current[activeSessionKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenBySessionRef.current[activeSessionKey] = current;
  }, [activeSessionKey, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeSessionId || useCommandPaletteStore.getState().open || event.defaultPrevented) {
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
        modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
      };

      const command = resolveShortcutCommand(event, shortcuts, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      if (command === "modelPicker.toggle") {
        event.preventDefault();
        event.stopPropagation();
        composerRef.current?.toggleModelPicker();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeProject,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeSessionId,
    closeTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    shortcuts,
    onToggleDiff,
    toggleTerminalVisibility,
  ]);

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readEnvironmentApi(environmentId);
      const localApi = readLocalApi();
      if (!api || !localApi || !activeSession || isRevertingCheckpoint) return;

      if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
        setSessionError(
          activeSession.id,
          `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
        );
        return;
      }
      if (phase === "running" || isSendBusy || isConnecting) {
        setSessionError(
          activeSession.id,
          "Interrupt the current turn before reverting checkpoints.",
        );
        return;
      }
      const confirmed = await localApi.dialogs.confirm(
        [
          `Revert this session to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this session.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setSessionError(activeSession.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "session.checkpoint.revert",
          commandId: newCommandId(),
          sessionId: activeSession.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        setSessionError(
          activeSession.id,
          err instanceof Error ? err.message : "Failed to revert session state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [
      activeSession,
      activeEnvironmentUnavailable,
      activeEnvironmentUnavailableLabel,
      environmentId,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      setSessionError,
    ],
  );

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeSession ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    )
      return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) return;
    const {
      images: composerImages,
      terminalContexts: composerTerminalContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
    });
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedSessionToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      return;
    }
    if (!activeProject) return;
    const sessionIdForSend = activeSession.id;
    const isFirstMessage = !isServerSession || activeSession.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeSession.worktreePath
        ? activeSessionBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeSession.worktreePath;
    if (shouldCreateWorktree && !activeSessionBranch) {
      setSessionError(
        sessionIdForSend,
        "Select a base branch before sending in New worktree mode.",
      );
      return;
    }

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });

    const composerImagesSnapshot = [...composerImages];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const messageTextForSend = appendTerminalContextsToPrompt(
      promptForSend,
      composerTerminalContextsSnapshot,
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const turnAttachmentsPromise = Promise.all(
      composerImagesSnapshot.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
    );
    const optimisticAttachments = composerImagesSnapshot.map((image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    }));
    // Scroll to the current end *before* adding the optimistic message.
    // This sets LegendList's internal isAtEnd=true so maintainScrollAtEnd
    // automatically pins to the new item when the data changes.
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    await legendListRef.current?.scrollToEnd?.({ animated: false });

    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);

    setSessionError(sessionIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add(
        stackedSessionToast({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        }),
      );
    }
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    composerRef.current?.resetCursorState();

    let turnStartSucceeded = false;
    await (async () => {
      let firstComposerImageName: string | null = null;
      if (composerImagesSnapshot.length > 0) {
        const firstComposerImage = composerImagesSnapshot[0];
        if (firstComposerImage) {
          firstComposerImageName = firstComposerImage.name;
        }
      }
      let titleSeed = trimmed;
      if (!titleSeed) {
        if (firstComposerImageName) {
          titleSeed = `Image: ${firstComposerImageName}`;
        } else if (composerTerminalContextsSnapshot.length > 0) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
        } else {
          titleSeed = "New session";
        }
      }
      const title = truncate(titleSeed);
      const sessionCreateModelSelection = createModelSelection(
        ctxSelectedModelSelection.instanceId,
        ctxSelectedModel || activeProject.defaultModelSelection?.model || DEFAULT_MODEL,
        ctxSelectedModelSelection.options,
      );

      // Auto-title from first message
      if (isFirstMessage && isServerSession) {
        await api.orchestration.dispatchCommand({
          type: "session.meta.update",
          commandId: newCommandId(),
          sessionId: sessionIdForSend,
          title,
        });
      }

      if (isServerSession) {
        await persistSessionSettingsForNextTurn({
          sessionId: sessionIdForSend,
          createdAt: messageCreatedAt,
          ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
          runtimeMode,
          interactionMode,
        });
      }

      const turnAttachments = await turnAttachmentsPromise;
      const bootstrap =
        isLocalDraftSession || baseBranchForWorktree
          ? {
              ...(isLocalDraftSession
                ? {
                    createSession: {
                      projectId: activeProject.id,
                      title,
                      modelSelection: sessionCreateModelSelection,
                      runtimeMode,
                      interactionMode,
                      branch: activeSessionBranch,
                      worktreePath: activeSession.worktreePath,
                      createdAt: activeSession.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject.cwd,
                      baseBranch: baseBranchForWorktree,
                      branch: buildTemporaryWorktreeBranchName(),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      beginLocalDispatch({ preparingWorktree: false });
      await api.orchestration.dispatchCommand({
        type: "session.turn.start",
        commandId: newCommandId(),
        sessionId: sessionIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
        },
        modelSelection: ctxSelectedModelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        ...(bootstrap ? { bootstrap } : {}),
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        promptRef.current = promptForSend;
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
        setComposerDraftPrompt(composerDraftTarget, promptForSend);
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
        composerRef.current?.resetCursorState({
          cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
          prompt: promptForSend,
          detectTrigger: true,
        });
      }
      setSessionError(
        sessionIdForSend,
        err instanceof Error ? err.message : "Failed to send message.",
      );
    });
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      resetLocalDispatch();
    }
  };

  const onInterrupt = async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeSession) return;
    await api.orchestration.dispatchCommand({
      type: "session.turn.interrupt",
      commandId: newCommandId(),
      sessionId: activeSession.id,
      createdAt: new Date().toISOString(),
    });
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeSessionId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "session.approval.respond",
          commandId: newCommandId(),
          sessionId: activeSessionId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setSessionError(
            activeSessionId,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeSessionId, environmentId, setSessionError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeSessionId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "session.user-input.respond",
          commandId: newCommandId(),
          sessionId: activeSessionId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setSessionError(
            activeSessionId,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeSessionId, environmentId, setSessionError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          (activePendingProgress?.activeQuestion?.id === questionId
            ? activePendingProgress.activeQuestion
            : undefined) ??
          activePendingUserInput.questions.find((entry) => entry.id === questionId);
        if (!question) {
          return existing;
        }

        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionLabel,
            ),
          },
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (
        !api ||
        !activeSession ||
        !isServerSession ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx) {
        return;
      }
      const {
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
      } = sendCtx;

      const sessionIdForSend = activeSession.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setSessionError(sessionIdForSend, null);

      // Scroll to the current end *before* adding the optimistic message.
      isAtEndRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      await legendListRef.current?.scrollToEnd?.({ animated: false });

      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      try {
        await persistSessionSettingsForNextTurn({
          sessionId: sessionIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-session implementation turn is starting.
        setComposerDraftInteractionMode(
          scopeSessionRef(activeSession.environmentId, sessionIdForSend),
          nextInteractionMode,
        );

        await api.orchestration.dispatchCommand({
          type: "session.turn.start",
          commandId: newCommandId(),
          sessionId: sessionIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeSession.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  sessionId: activeSession.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default" && autoOpenPlanSidebar) {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setSessionError(
          sessionIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
    },
    [
      activeSession,
      activeProposedPlan,
      beginLocalDispatch,
      isConnecting,
      isSendBusy,
      isServerSession,
      persistSessionSettingsForNextTurn,
      resetLocalDispatch,
      runtimeMode,
      setComposerDraftInteractionMode,
      setSessionError,
      autoOpenPlanSidebar,
      environmentId,
    ],
  );

  const onImplementPlanInNewSession = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeSession ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerSession ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextSessionId = newSessionId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    const nextSessionTitle = truncate(buildPlanImplementationSessionTitle(planMarkdown));
    const nextSessionModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "session.create",
        commandId: newCommandId(),
        sessionId: nextSessionId,
        projectId: activeProject.id,
        title: nextSessionTitle,
        modelSelection: nextSessionModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeSessionBranch,
        worktreePath: activeSession.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "session.turn.start",
          commandId: newCommandId(),
          sessionId: nextSessionId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextSessionTitle,
          runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            sessionId: activeSession.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        });
      })
      .then(() => {
        return waitForStartedServerSession(
          scopeSessionRef(activeSession.environmentId, nextSessionId),
        );
      })
      .then(() => {
        // Signal that the plan sidebar should open on the new session when enabled.
        planSidebarOpenOnNextSessionRef.current = autoOpenPlanSidebar;
        return navigate({
          to: "/$environmentId/$sessionId",
          params: {
            environmentId: activeSession.environmentId,
            sessionId: nextSessionId,
          },
        });
      })
      .catch(async (err: unknown) => {
        await api.orchestration
          .dispatchCommand({
            type: "session.delete",
            commandId: newCommandId(),
            sessionId: nextSessionId,
          })
          .catch(() => undefined);
        toastManager.add(
          stackedSessionToast({
            type: "error",
            title: "Could not start implementation session",
            description:
              err instanceof Error
                ? err.message
                : "An error occurred while creating the new session.",
          }),
        );
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeSessionBranch,
    activeSession,
    beginLocalDispatch,
    activeEnvironmentUnavailable,
    isConnecting,
    isSendBusy,
    isServerSession,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    autoOpenPlanSidebar,
    environmentId,
  ]);

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeSession) return;
      // Look up the configured instance so model normalization and custom
      // model lookup stay scoped to that exact instance. Unknown instance ids
      // are rejected by returning early; the server remains authoritative too.
      const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
      const resolvedDriverKind = entry?.driver ?? null;
      if (
        lockedProvider !== null &&
        resolvedDriverKind !== null &&
        resolvedDriverKind !== lockedProvider
      ) {
        scheduleComposerFocus();
        return;
      }
      if (lockedProvider !== null && activeSession.session?.providerInstanceId) {
        const currentEntry = providerStatuses.find(
          (snapshot) => snapshot.instanceId === activeSession.session?.providerInstanceId,
        );
        if (
          currentEntry?.continuation?.groupKey &&
          entry?.continuation?.groupKey &&
          currentEntry.continuation.groupKey !== entry.continuation.groupKey
        ) {
          scheduleComposerFocus();
          return;
        }
      }
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(
        scopeSessionRef(activeSession.environmentId, activeSession.id),
        nextModelSelection,
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeSession,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const onEnvModeChange = useCallback(
    (mode: DraftSessionEnvMode) => {
      if (canOverrideServerSessionEnvMode) {
        setPendingServerSessionEnvMode(mode);
        scheduleComposerFocus();
        return;
      }
      if (isLocalDraftSession) {
        setDraftSessionContext(composerDraftTarget, {
          envMode: mode,
          ...(mode === "worktree" && draftSession?.worktreePath ? { worktreePath: null } : {}),
        });
      }
      scheduleComposerFocus();
    },
    [
      canOverrideServerSessionEnvMode,
      composerDraftTarget,
      draftSession?.worktreePath,
      isLocalDraftSession,
      setPendingServerSessionEnvMode,
      scheduleComposerFocus,
      setDraftSessionContext,
    ],
  );

  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (!isServerSession) {
        return;
      }
      onDiffPanelOpen?.();
      void navigate({
        to: "/$environmentId/$sessionId",
        params: {
          environmentId,
          sessionId,
        },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [environmentId, isServerSession, navigate, onDiffPanelOpen, sessionId],
  );
  // Both the Map and the revert handler are read from refs at call-time so
  // the callback reference is fully stable and never busts context identity.
  const revertTurnCountRef = useRef(revertTurnCountByUserMessageId);
  revertTurnCountRef.current = revertTurnCountByUserMessageId;
  const onRevertToTurnCountRef = useRef(onRevertToTurnCount);
  onRevertToTurnCountRef.current = onRevertToTurnCount;
  const onRevertUserMessage = useCallback((messageId: MessageId) => {
    const targetTurnCount = revertTurnCountRef.current.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCountRef.current(targetTurnCount);
  }, []);

  // Empty state: no active session
  if (!activeSession) {
    return <NoActiveSessionState />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-white dark:bg-background">
      {/* Top bar */}
      <ChatHeader
        activeSessionEnvironmentId={activeSession.environmentId}
        activeSessionId={activeSession.id}
        {...(routeKind === "draft" && draftId ? { draftId } : {})}
        activeSessionTitle={activeSession.title}
        activeProjectName={activeProject?.name}
        isGitRepo={isGitRepo}
        openInCwd={gitCwd}
        activeProjectScripts={activeProject?.scripts}
        preferredScriptId={
          activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
        }
        shortcuts={shortcuts}
        availableEditors={availableEditors}
        terminalAvailable={activeProject !== undefined}
        terminalOpen={terminalState.terminalOpen}
        terminalToggleShortcutLabel={terminalToggleShortcutLabel}
        diffToggleShortcutLabel={diffPanelShortcutLabel}
        gitCwd={gitCwd}
        diffOpen={diffOpen}
        onRunProjectScript={runProjectScript}
        onAddProjectScript={saveProjectScript}
        onUpdateProjectScript={updateProjectScript}
        onDeleteProjectScript={deleteProjectScript}
        onToggleTerminal={toggleTerminalVisibility}
        onToggleDiff={onToggleDiff}
        reserveTitleBarControlInset={reserveTitleBarControlInset}
      />

      {/* Error banner */}
      <ProviderStatusBanner status={activeProviderStatus} />
      <SessionErrorBanner
        error={activeSession.error}
        onDismiss={() => setSessionError(activeSession.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/98">
          {/* Messages Wrapper */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Messages — LegendList handles virtualization and scrolling internally */}
            <MessagesTimeline
              key={activeSession.id}
              isWorking={isWorking}
              activeTurnInProgress={isWorking || !latestTurnSettled}
              activeTurnId={activeLatestTurn?.turnId ?? null}
              activeTurnStartedAt={activeWorkStartedAt}
              listRef={legendListRef}
              timelineEntries={timelineEntries}
              completionDividerBeforeEntryId={completionDividerBeforeEntryId}
              completionSummary={completionSummary}
              turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
              activeSessionEnvironmentId={activeSession.environmentId}
              routeSessionKey={routeSessionKey}
              onOpenTurnDiff={onOpenTurnDiff}
              revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
              onRevertUserMessage={onRevertUserMessage}
              isRevertingCheckpoint={isRevertingCheckpoint}
              onImageExpand={onExpandTimelineImage}
              markdownCwd={gitCwd ?? undefined}
              resolvedTheme={resolvedTheme}
              timestampFormat={timestampFormat}
              workspaceRoot={activeWorkspaceRoot}
              skills={activeProviderStatus?.skills ?? EMPTY_PROVIDER_SKILLS}
              onIsAtEndChange={onIsAtEndChange}
            />

            {/* scroll to bottom control shown when user has scrolled away from the bottom */}
            {showScrollToBottom && (
              <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                <button
                  type="button"
                  onClick={() => scrollToEnd(true)}
                  aria-label="Scroll to bottom"
                  title="Scroll to bottom"
                  className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:cursor-pointer hover:border-border hover:text-foreground"
                >
                  <ChevronDownIcon className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div
            className={cn(
              "pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] pt-2 sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)] sm:pt-2.5",
              isGitRepo
                ? "pb-[calc(env(safe-area-inset-bottom)+0.25rem)]"
                : "pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]",
            )}
          >
            <div className="relative isolate">
              <ComposerBannerStack className="relative z-0" items={composerBannerItems} />
              <div className="relative z-10">
                <ChatComposer
                  composerRef={composerRef}
                  composerDraftTarget={composerDraftTarget}
                  environmentId={environmentId}
                  routeKind={routeKind}
                  routeSessionRef={routeSessionRef}
                  draftId={draftId}
                  activeSessionId={activeSessionId}
                  activeSessionEnvironmentId={activeSession?.environmentId}
                  activeSession={activeSession}
                  isServerSession={isServerSession}
                  isLocalDraftSession={isLocalDraftSession}
                  phase={phase}
                  isConnecting={isConnecting}
                  isSendBusy={isSendBusy}
                  isPreparingWorktree={isPreparingWorktree}
                  environmentUnavailable={activeEnvironmentUnavailableState}
                  activePendingApproval={activePendingApproval}
                  pendingApprovals={pendingApprovals}
                  pendingUserInputs={pendingUserInputs}
                  activePendingProgress={activePendingProgress}
                  activePendingResolvedAnswers={activePendingResolvedAnswers}
                  activePendingIsResponding={activePendingIsResponding}
                  activePendingDraftAnswers={activePendingDraftAnswers}
                  activePendingQuestionIndex={activePendingQuestionIndex}
                  respondingRequestIds={respondingRequestIds}
                  showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                  activeProposedPlan={activeProposedPlan}
                  activePlan={activePlan as { turnId?: TurnId } | null}
                  sidebarProposedPlan={sidebarProposedPlan as { turnId?: TurnId } | null}
                  planSidebarLabel={planSidebarLabel}
                  planSidebarOpen={planSidebarOpen}
                  runtimeMode={runtimeMode}
                  interactionMode={interactionMode}
                  lockedProvider={lockedProvider}
                  providerStatuses={providerStatuses as ServerProvider[]}
                  activeProjectDefaultModelSelection={activeProject?.defaultModelSelection}
                  activeSessionModelSelection={activeSession?.modelSelection}
                  activeSessionActivities={activeSession?.activities}
                  resolvedTheme={resolvedTheme}
                  settings={settings}
                  shortcuts={shortcuts}
                  terminalOpen={Boolean(terminalState.terminalOpen)}
                  gitCwd={gitCwd}
                  promptRef={promptRef}
                  composerImagesRef={composerImagesRef}
                  composerTerminalContextsRef={composerTerminalContextsRef}
                  shouldAutoScrollRef={isAtEndRef}
                  scheduleStickToBottom={scrollToEnd}
                  onSend={onSend}
                  onInterrupt={onInterrupt}
                  onImplementPlanInNewSession={onImplementPlanInNewSession}
                  onRespondToApproval={onRespondToApproval}
                  onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
                  onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
                  onPreviousActivePendingUserInputQuestion={
                    onPreviousActivePendingUserInputQuestion
                  }
                  onChangeActivePendingUserInputCustomAnswer={
                    onChangeActivePendingUserInputCustomAnswer
                  }
                  onProviderModelSelect={onProviderModelSelect}
                  toggleInteractionMode={toggleInteractionMode}
                  handleRuntimeModeChange={handleRuntimeModeChange}
                  handleInteractionModeChange={handleInteractionModeChange}
                  togglePlanSidebar={togglePlanSidebar}
                  focusComposer={focusComposer}
                  scheduleComposerFocus={scheduleComposerFocus}
                  setSessionError={setSessionError}
                  onExpandImage={onExpandTimelineImage}
                />
              </div>
            </div>
            {isGitRepo && (
              <BranchToolbar
                environmentId={activeSession.environmentId}
                sessionId={activeSession.id}
                {...(routeKind === "draft" && draftId ? { draftId } : {})}
                onEnvModeChange={onEnvModeChange}
                {...(canOverrideServerSessionEnvMode ? { effectiveEnvModeOverride: envMode } : {})}
                {...(canOverrideServerSessionEnvMode
                  ? {
                      activeSessionBranchOverride: activeSessionBranch,
                      onActiveSessionBranchOverrideChange: setPendingServerSessionBranch,
                    }
                  : {})}
                envLocked={envLocked}
                onComposerFocusRequest={scheduleComposerFocus}
                centerContent={<AiReviewNotice />}
                {...(canCheckoutPullRequestIntoSession
                  ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                  : {})}
                {...(hasMultipleEnvironments ? { onEnvironmentChange } : {})}
                availableEnvironments={logicalProjectEnvironments}
              />
            )}
            {!isGitRepo && (
              <div
                className={cn(
                  "mx-auto flex w-full justify-center px-2.5 pb-1 pt-1.5 sm:px-3",
                  APP_CONTENT_MAX_WIDTH_CLASS,
                )}
              >
                <AiReviewNotice />
              </div>
            )}
          </div>

          {pullRequestDialogState ? (
            <PullRequestSessionDialog
              key={pullRequestDialogState.key}
              open
              environmentId={activeSession.environmentId}
              sessionId={activeSession.id}
              cwd={activeProject?.cwd ?? null}
              initialReference={pullRequestDialogState.initialReference}
              onOpenChange={(open) => {
                if (!open) {
                  closePullRequestDialog();
                }
              }}
              onPrepared={handlePreparedPullRequestSession}
            />
          ) : null}
        </div>
        {/* end chat column */}

        {/* Plan sidebar */}
        {planSidebarOpen && !shouldUsePlanSidebarSheet ? (
          <PlanSidebar
            activePlan={activePlan}
            activeProposedPlan={sidebarProposedPlan}
            label={planSidebarLabel}
            environmentId={environmentId}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeWorkspaceRoot}
            timestampFormat={timestampFormat}
            mode="sidebar"
            onClose={closePlanSidebar}
          />
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {mountedTerminalSessionRefs.map(
        ({ key: mountedSessionKey, sessionRef: mountedSessionRef }) => (
          <PersistentSessionTerminalDrawer
            key={mountedSessionKey}
            sessionRef={mountedSessionRef}
            sessionId={mountedSessionRef.sessionId}
            visible={mountedSessionKey === activeSessionKey && terminalState.terminalOpen}
            launchContext={
              mountedSessionKey === activeSessionKey ? (activeTerminalLaunchContext ?? null) : null
            }
            focusRequestId={mountedSessionKey === activeSessionKey ? terminalFocusRequestId : 0}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            shortcuts={shortcuts}
            onAddTerminalContext={addTerminalContextToDraft}
          />
        ),
      )}
      {shouldUsePlanSidebarSheet ? (
        <RightPanelSheet open={planSidebarOpen} onClose={closePlanSidebar}>
          <PlanSidebar
            activePlan={activePlan}
            activeProposedPlan={sidebarProposedPlan}
            label={planSidebarLabel}
            environmentId={environmentId}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeWorkspaceRoot}
            timestampFormat={timestampFormat}
            mode="sheet"
            onClose={closePlanSidebar}
          />
        </RightPanelSheet>
      ) : null}

      {expandedImage && (
        <ExpandedImageDialog preview={expandedImage} onClose={closeExpandedImage} />
      )}
    </div>
  );
}
