import { scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { DraftSessionEnvMode } from "../composerDraftStore";

interface SessionContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftSessionContextLike extends SessionContextLike {
  envMode: DraftSessionEnvMode;
}

interface NewSessionHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftSessionEnvMode;
    },
  ): Promise<void>;
}

type NewSessionOptions = NonNullable<Parameters<NewSessionHandler>[1]>;

export interface ChatSessionActionContext {
  readonly activeDraftSession: DraftSessionContextLike | null;
  readonly activeSession: SessionContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultSessionEnvMode: DraftSessionEnvMode;
  readonly handleNewSession: NewSessionHandler;
}

export function resolveSessionActionProjectRef(
  context: ChatSessionActionContext,
): ScopedProjectRef | null {
  if (context.activeSession) {
    return scopeProjectRef(context.activeSession.environmentId, context.activeSession.projectId);
  }
  if (context.activeDraftSession) {
    return scopeProjectRef(
      context.activeDraftSession.environmentId,
      context.activeDraftSession.projectId,
    );
  }
  return context.defaultProjectRef;
}

function buildContextualSessionOptions(context: ChatSessionActionContext): NewSessionOptions {
  return {
    branch: context.activeSession?.branch ?? context.activeDraftSession?.branch ?? null,
    worktreePath:
      context.activeSession?.worktreePath ?? context.activeDraftSession?.worktreePath ?? null,
    envMode:
      context.activeDraftSession?.envMode ??
      (context.activeSession?.worktreePath ? "worktree" : "local"),
  };
}

function buildDefaultSessionOptions(context: ChatSessionActionContext): NewSessionOptions {
  return {
    envMode: context.defaultSessionEnvMode,
  };
}

export async function startNewSessionInProjectFromContext(
  context: ChatSessionActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewSession(projectRef, buildContextualSessionOptions(context));
}

export async function startNewSessionFromContext(
  context: ChatSessionActionContext,
): Promise<boolean> {
  const projectRef = resolveSessionActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewSessionInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewLocalSessionFromContext(
  context: ChatSessionActionContext,
): Promise<boolean> {
  const projectRef = resolveSessionActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewSession(projectRef, buildDefaultSessionOptions(context));
  return true;
}
