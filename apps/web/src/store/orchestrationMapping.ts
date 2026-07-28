import type {
  EnvironmentId,
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationProviderRuntime,
  OrchestrationProviderRuntimeStatus,
  OrchestrationSession,
  OrchestrationSessionShell,
} from "@t3tools/contracts";
import { isProviderDriverKind, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { resolveModelSlugForProvider } from "@t3tools/shared/model";
import { resolveEnvironmentHttpUrl } from "../environments/runtime";
import { sanitizeSessionErrorMessage } from "../rpc/transportError";
import type {
  ChatMessage,
  Project,
  ProposedPlan,
  SidebarSessionSummary,
  Session,
  ProviderRuntime,
  SessionShell,
  SessionTurnState,
  TurnDiffSummary,
} from "../types";

const isProviderDriverKindValue = Schema.is(ProviderDriverKind);

export function normalizeModelSelection<T extends { instanceId: string; model: string }>(
  selection: T,
): T {
  if (!isProviderDriverKind(selection.instanceId)) {
    return selection;
  }
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.instanceId, selection.model),
  };
}

export function mapProjectScripts(
  scripts: ReadonlyArray<Project["scripts"][number]>,
): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

export function mapProviderRuntime(session: OrchestrationProviderRuntime): ProviderRuntime {
  return {
    provider: toLegacyProvider(session.providerName),
    providerInstanceId: session.providerInstanceId ?? undefined,
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

export function mapMessage(
  environmentId: EnvironmentId,
  message: OrchestrationMessage,
): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: resolveEnvironmentHttpUrl({
      environmentId,
      pathname: attachmentPreviewRoutePath(attachment.id),
    }),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

export function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationSessionId: proposedPlan.implementationSessionId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

export function mapTurnDiffSummary(checkpoint: OrchestrationCheckpointSummary): TurnDiffSummary {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

export function mapProject(
  project:
    | OrchestrationReadModel["projects"][number]
    | OrchestrationShellSnapshot["projects"][number],
  environmentId: EnvironmentId,
): Project {
  return {
    id: project.id,
    environmentId,
    name: project.title,
    cwd: project.workspaceRoot,
    repositoryIdentity: project.repositoryIdentity ?? null,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
  };
}

export function mapSession(session: OrchestrationSession, environmentId: EnvironmentId): Session {
  return {
    id: session.id,
    environmentId,
    codexSessionId: null,
    projectId: session.projectId,
    title: session.title,
    modelSelection: normalizeModelSelection(session.modelSelection),
    runtimeMode: session.runtimeMode,
    interactionMode: session.interactionMode,
    workflowId: session.workflowId ?? null,
    workflowVersion: session.workflowVersion ?? null,
    session: session.session ? mapProviderRuntime(session.session) : null,
    messages: session.messages.map((message) => mapMessage(environmentId, message)),
    proposedPlans: session.proposedPlans.map(mapProposedPlan),
    error: sanitizeSessionErrorMessage(session.session?.lastError),
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    settledOverride: session.settledOverride,
    settledAt: session.settledAt,
    updatedAt: session.updatedAt,
    latestTurn: session.latestTurn,
    pendingSourceProposedPlan: session.latestTurn?.sourceProposedPlan,
    branch: session.branch,
    worktreePath: session.worktreePath,
    turnDiffSummaries: session.checkpoints.map(mapTurnDiffSummary),
    activities: session.activities.map((activity) => ({ ...activity })),
  };
}

export function mapSessionShell(
  session: OrchestrationSessionShell,
  environmentId: EnvironmentId,
): {
  shell: SessionShell;
  session: ProviderRuntime | null;
  turnState: SessionTurnState;
  summary: SidebarSessionSummary;
} {
  const shell: SessionShell = {
    id: session.id,
    environmentId,
    codexSessionId: null,
    projectId: session.projectId,
    title: session.title,
    modelSelection: normalizeModelSelection(session.modelSelection),
    runtimeMode: session.runtimeMode,
    interactionMode: session.interactionMode,
    workflowId: session.workflowId ?? null,
    workflowVersion: session.workflowVersion ?? null,
    error: sanitizeSessionErrorMessage(session.session?.lastError),
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    settledOverride: session.settledOverride,
    settledAt: session.settledAt,
    updatedAt: session.updatedAt,
    branch: session.branch,
    worktreePath: session.worktreePath,
  };
  const providerRuntime = session.session ? mapProviderRuntime(session.session) : null;
  const turnState: SessionTurnState = {
    latestTurn: session.latestTurn,
    pendingSourceProposedPlan: session.latestTurn?.sourceProposedPlan,
  };
  const summary: SidebarSessionSummary = {
    id: session.id,
    environmentId,
    projectId: session.projectId,
    title: session.title,
    interactionMode: session.interactionMode,
    workflowId: session.workflowId,
    workflowVersion: session.workflowVersion,
    session: providerRuntime,
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    settledOverride: session.settledOverride,
    settledAt: session.settledAt,
    updatedAt: session.updatedAt,
    latestTurn: session.latestTurn,
    branch: session.branch,
    worktreePath: session.worktreePath,
    latestUserMessageAt: session.latestUserMessageAt,
    hasPendingApprovals: session.hasPendingApprovals,
    hasPendingUserInput: session.hasPendingUserInput,
    hasActionableProposedPlan: session.hasActionableProposedPlan,
  };
  return {
    shell,
    session: providerRuntime,
    turnState,
    summary,
  };
}

export function toSessionShell(session: Session): SessionShell {
  return {
    id: session.id,
    environmentId: session.environmentId,
    codexSessionId: session.codexSessionId,
    projectId: session.projectId,
    title: session.title,
    modelSelection: session.modelSelection,
    runtimeMode: session.runtimeMode,
    interactionMode: session.interactionMode,
    workflowId: session.workflowId ?? null,
    workflowVersion: session.workflowVersion ?? null,
    error: session.error,
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    settledOverride: session.settledOverride,
    settledAt: session.settledAt,
    updatedAt: session.updatedAt,
    branch: session.branch,
    worktreePath: session.worktreePath,
  };
}

export function toSessionTurnState(session: Session): SessionTurnState {
  return {
    latestTurn: session.latestTurn,
    ...(session.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: session.pendingSourceProposedPlan }
      : {}),
  };
}

export function sourceProposedPlansEqual(
  left: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
  right: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.sessionId === right.sessionId && left.planId === right.planId;
}

export function latestTurnsEqual(
  left: OrchestrationLatestTurn | null | undefined,
  right: OrchestrationLatestTurn | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    sourceProposedPlansEqual(left.sourceProposedPlan, right.sourceProposedPlan)
  );
}

export function providerRuntimesEqual(
  left: ProviderRuntime | null | undefined,
  right: ProviderRuntime | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.orchestrationStatus === right.orchestrationStatus &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError
  );
}

export function sidebarSessionSummariesEqual(
  left: SidebarSessionSummary | undefined,
  right: SidebarSessionSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    left.workflowId === right.workflowId &&
    left.workflowVersion === right.workflowVersion &&
    providerRuntimesEqual(left.session, right.session) &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.settledOverride === right.settledOverride &&
    left.settledAt === right.settledAt &&
    left.updatedAt === right.updatedAt &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

export function sessionShellsEqual(left: SessionShell | undefined, right: SessionShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.codexSessionId === right.codexSessionId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.workflowId === right.workflowId &&
    left.workflowVersion === right.workflowVersion &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.settledOverride === right.settledOverride &&
    left.settledAt === right.settledAt &&
    left.updatedAt === right.updatedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath
  );
}

export function sessionTurnStatesEqual(
  left: SessionTurnState | undefined,
  right: SessionTurnState,
): boolean {
  return (
    left !== undefined &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    sourceProposedPlansEqual(left.pendingSourceProposedPlan, right.pendingSourceProposedPlan)
  );
}

export function toLegacySessionStatus(
  status: OrchestrationProviderRuntimeStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

export function toLegacyProvider(providerName: string | null): ProviderDriverKind {
  if (isProviderDriverKindValue(providerName)) {
    return providerName;
  }
  return ProviderDriverKind.make("codex");
}

export function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}
