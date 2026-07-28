import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  RepositoryIdentity,
  OrchestrationProviderRuntimeStatus,
  OrchestrationSessionActivity,
  ProjectScript as ContractProjectScript,
  SessionId,
  ProjectId,
  TurnId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  CheckpointRef,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface SessionTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationSessionId: SessionId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface Project {
  id: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
  repositoryIdentity?: RepositoryIdentity | null;
  defaultModelSelection: ModelSelection | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Session {
  id: SessionId;
  environmentId: EnvironmentId;
  codexSessionId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  workflowId?: string | null;
  workflowVersion?: string | null;
  session: ProviderRuntime | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  settledOverride: "settled" | "active" | null;
  settledAt: string | null;
  snoozedUntil: string | null;
  snoozedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
  branch: string | null;
  worktreePath: string | null;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationSessionActivity[];
}

export interface SessionShell {
  id: SessionId;
  environmentId: EnvironmentId;
  codexSessionId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  workflowId?: string | null;
  workflowVersion?: string | null;
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  settledOverride: "settled" | "active" | null;
  settledAt: string | null;
  snoozedUntil: string | null;
  snoozedAt: string | null;
  updatedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
}

export interface SessionTurnState {
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
}

export interface SidebarSessionSummary {
  id: SessionId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title: string;
  interactionMode: ProviderInteractionMode;
  workflowId?: string | null;
  workflowVersion?: string | null;
  session: ProviderRuntime | null;
  createdAt: string;
  archivedAt: string | null;
  settledOverride: "settled" | "active" | null;
  settledAt: string | null;
  snoozedUntil: string | null;
  snoozedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  branch: string | null;
  worktreePath: string | null;
  latestUserMessageAt: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasActionableProposedPlan: boolean;
}

export interface ProviderRuntime {
  provider: ProviderDriverKind;
  providerInstanceId?: ProviderInstanceId | undefined;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationProviderRuntimeStatus;
}
