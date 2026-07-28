import {
  type EnvironmentId,
  isProviderDriverKind,
  ProjectId,
  type ModelSelection,
  type ProviderDriverKind,
  type ScopedSessionRef,
  type SessionId,
  type TurnId,
} from "@t3tools/contracts";
import { type ChatMessage, type SessionPhase, type Session, type ProviderRuntime } from "../types";
import { type ComposerImageAttachment, type DraftSessionState } from "../composerDraftStore";
import * as Schema from "effect/Schema";
import { selectSessionByRef, useStore } from "../store";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import type { DraftSessionEnvMode } from "../composerDraftStore";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "lincei:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 10;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftSession(
  sessionId: SessionId,
  draftSession: DraftSessionState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Session {
  return {
    id: sessionId,
    environmentId: draftSession.environmentId,
    codexSessionId: null,
    projectId: draftSession.projectId,
    title: "New session",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftSession.runtimeMode,
    interactionMode: draftSession.interactionMode,
    workflowId: draftSession.workflowId ?? null,
    workflowVersion: draftSession.workflowVersion ?? null,
    session: null,
    messages: [],
    error,
    createdAt: draftSession.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestTurn: null,
    branch: draftSession.branch,
    worktreePath: draftSession.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function shouldWriteSessionErrorToCurrentServerSession(input: {
  serverSession:
    | {
        environmentId: EnvironmentId;
        id: SessionId;
      }
    | null
    | undefined;
  routeSessionRef: ScopedSessionRef;
  targetSessionId: SessionId;
}): boolean {
  return Boolean(
    input.serverSession &&
    input.targetSessionId === input.routeSessionRef.sessionId &&
    input.serverSession.environmentId === input.routeSessionRef.environmentId &&
    input.serverSession.id === input.targetSessionId,
  );
}

export function reconcileMountedTerminalSessionIds(input: {
  currentSessionIds: ReadonlyArray<string>;
  openSessionIds: ReadonlyArray<string>;
  activeSessionId: string | null;
  activeSessionTerminalOpen: boolean;
  maxHiddenSessionCount?: number;
}): string[] {
  const openSessionIdSet = new Set(input.openSessionIds);
  const hiddenSessionIds = input.currentSessionIds.filter(
    (sessionId) => sessionId !== input.activeSessionId && openSessionIdSet.has(sessionId),
  );
  const maxHiddenSessionCount = Math.max(
    0,
    input.maxHiddenSessionCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  );
  const nextSessionIds =
    hiddenSessionIds.length > maxHiddenSessionCount
      ? hiddenSessionIds.slice(-maxHiddenSessionCount)
      : hiddenSessionIds;

  if (
    input.activeSessionId &&
    input.activeSessionTerminalOpen &&
    !nextSessionIds.includes(input.activeSessionId)
  ) {
    nextSessionIds.push(input.activeSessionId);
  }

  return nextSessionIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftSessionEnvMode;
  isGitRepo: boolean;
}): DraftSessionEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function sessionHasStarted(session: Session | null | undefined): boolean {
  return Boolean(
    session &&
    (session.latestTurn !== null || session.messages.length > 0 || session.session !== null),
  );
}

// `sessionProvider` is the open branded driver kind carried by the session.
// Unknown driver kinds degrade to `null` (i.e. "unlocked"), which is the safe
// rollback / fork behavior — the routing layer is the right place to surface
// "driver not installed" errors, not the lock state.
//
// `selectedProvider` takes the same open-string shape because the composer
// now tracks the picker selection as a `ProviderInstanceId` (e.g.
// `codex_personal`). Custom instance ids that don't directly match a
// registered driver resolve to `null` here, which matches the existing
// "unknown driver -> unlocked" semantics. Callers that want the lock to track
// a custom instance's underlying driver kind should resolve the instance id
// upstream and pass the correlated kind.
export function deriveLockedProvider(input: {
  session: Session | null | undefined;
  selectedProvider: string | null;
  sessionProvider: string | null;
}): ProviderDriverKind | null {
  if (!sessionHasStarted(input.session)) {
    return null;
  }
  const sessionProvider = input.session?.session?.provider ?? null;
  if (sessionProvider) {
    return sessionProvider;
  }
  const narrowedSessionProvider =
    input.sessionProvider && isProviderDriverKind(input.sessionProvider)
      ? input.sessionProvider
      : null;
  const narrowedSelectedProvider =
    input.selectedProvider && isProviderDriverKind(input.selectedProvider)
      ? input.selectedProvider
      : null;
  return narrowedSessionProvider ?? narrowedSelectedProvider ?? null;
}

export async function waitForStartedServerSession(
  sessionRef: ScopedSessionRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const getSession = () => selectSessionByRef(useStore.getState(), sessionRef);
  const session = getSession();

  if (sessionHasStarted(session)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      if (!sessionHasStarted(selectSessionByRef(state, sessionRef))) {
        return;
      }
      finish(true);
    });

    if (sessionHasStarted(getSession())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: ProviderRuntime["orchestrationStatus"] | null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeSession: Session | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = activeSession?.latestTurn ?? null;
  const session = activeSession?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Session["latestTurn"] | null;
  session: Session["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  sessionError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.sessionError)) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== undefined &&
      session.activeTurnId !== null &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  return (
    latestTurnChanged ||
    input.localDispatch.sessionOrchestrationStatus !== (session?.orchestrationStatus ?? null) ||
    input.localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}
