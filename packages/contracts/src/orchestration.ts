import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProviderItemId,
  ResearchCardId,
  SessionId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullSessionDiff: "orchestration.getFullSessionDiff",
  replayEvents: "orchestration.replayEvents",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeSession: "orchestration.subscribeSession",
} as const;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationSessionId: Schema.NullOr(SessionId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  sessionId: SessionId,
  planId: OrchestrationProposedPlanId,
});

export const ResearchCardType = Schema.Literals([
  "markdown",
  "table",
  "keyValue",
  "chart",
  "image",
  "decision",
]);
export type ResearchCardType = typeof ResearchCardType.Type;

export const ResearchCardLifecycleStatus = Schema.Literals([
  "proposed",
  "accepted",
  "changes-requested",
  "rejected",
]);
export type ResearchCardLifecycleStatus = typeof ResearchCardLifecycleStatus.Type;

export const ResearchCardArtifactKind = Schema.Literals([
  "code",
  "visual",
  "table",
  "sql",
  "parquet",
  "csv",
  "markdown",
  "other",
]);
export type ResearchCardArtifactKind = typeof ResearchCardArtifactKind.Type;

export const ResearchCardArtifactReference = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ResearchCardArtifactKind,
  path: Schema.optional(TrimmedNonEmptyString),
  uri: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
  mimeType: Schema.optional(TrimmedNonEmptyString),
  createdAt: Schema.optional(IsoDateTime),
});
export type ResearchCardArtifactReference = typeof ResearchCardArtifactReference.Type;

export const ResearchCardProvenance = Schema.Struct({
  source: Schema.optional(TrimmedNonEmptyString),
  query: Schema.optional(TrimmedNonEmptyString),
  codeHash: Schema.optional(TrimmedNonEmptyString),
  dataset: Schema.optional(TrimmedNonEmptyString),
  timestamp: Schema.optional(IsoDateTime),
});
export type ResearchCardProvenance = typeof ResearchCardProvenance.Type;

export const ResearchCardReviewAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  value: Schema.optional(Schema.Unknown),
});
export type ResearchCardReviewAction = typeof ResearchCardReviewAction.Type;

export const ResearchCardReviewResponse = Schema.Struct({
  action: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  values: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  summary: Schema.optional(TrimmedNonEmptyString),
  artifactId: Schema.optional(TrimmedNonEmptyString),
  timestamp: IsoDateTime,
});
export type ResearchCardReviewResponse = typeof ResearchCardReviewResponse.Type;

export const ResearchCardReview = Schema.Struct({
  prompt: TrimmedNonEmptyString,
  actions: Schema.Array(ResearchCardReviewAction),
  response: Schema.optional(ResearchCardReviewResponse),
});
export type ResearchCardReview = typeof ResearchCardReview.Type;

export const OrchestrationResearchCard = Schema.Struct({
  id: ResearchCardId,
  type: ResearchCardType,
  status: ResearchCardLifecycleStatus,
  title: TrimmedNonEmptyString,
  preview: Schema.optional(Schema.Unknown),
  artifacts: Schema.Array(ResearchCardArtifactReference).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  provenance: Schema.Array(ResearchCardProvenance).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  review: Schema.optional(ResearchCardReview),
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationResearchCard = typeof OrchestrationResearchCard.Type;

export const OrchestrationProviderRuntimeStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationProviderRuntimeStatus = typeof OrchestrationProviderRuntimeStatus.Type;

export const OrchestrationProviderRuntime = Schema.Struct({
  sessionId: SessionId,
  status: OrchestrationProviderRuntimeStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationProviderRuntime = typeof OrchestrationProviderRuntime.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationSessionActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationSessionActivityTone = typeof OrchestrationSessionActivityTone.Type;

export const OrchestrationSessionActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationSessionActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationSessionActivity = typeof OrchestrationSessionActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationSession = Schema.Struct({
  id: SessionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  researchCards: Schema.Array(OrchestrationResearchCard).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationSessionActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationProviderRuntime),
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  sessions: Schema.Array(OrchestrationSession),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationSessionShell = Schema.Struct({
  id: SessionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationProviderRuntime),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationSessionShell = typeof OrchestrationSessionShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  sessions: Schema.Array(OrchestrationSessionShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("session-upserted"),
    sequence: NonNegativeInt,
    session: OrchestrationSessionShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("session-removed"),
    sequence: NonNegativeInt,
    sessionId: SessionId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeSessionInput = Schema.Struct({
  sessionId: SessionId,
});
export type OrchestrationSubscribeSessionInput = typeof OrchestrationSubscribeSessionInput.Type;

export const OrchestrationSessionDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  session: OrchestrationSession,
});
export type OrchestrationSessionDetailSnapshot = typeof OrchestrationSessionDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const SessionCreateCommand = Schema.Struct({
  type: Schema.Literal("session.create"),
  commandId: CommandId,
  sessionId: SessionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const SessionDeleteCommand = Schema.Struct({
  type: Schema.Literal("session.delete"),
  commandId: CommandId,
  sessionId: SessionId,
});

const SessionArchiveCommand = Schema.Struct({
  type: Schema.Literal("session.archive"),
  commandId: CommandId,
  sessionId: SessionId,
});

const SessionUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("session.unarchive"),
  commandId: CommandId,
  sessionId: SessionId,
});

const SessionMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("session.meta.update"),
  commandId: CommandId,
  sessionId: SessionId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const SessionRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("session.runtime-mode.set"),
  commandId: CommandId,
  sessionId: SessionId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const SessionInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("session.interaction-mode.set"),
  commandId: CommandId,
  sessionId: SessionId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const SessionTurnStartBootstrapCreateSession = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const SessionTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const SessionTurnStartBootstrap = Schema.Struct({
  createSession: Schema.optional(SessionTurnStartBootstrapCreateSession),
  prepareWorktree: Schema.optional(SessionTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type SessionTurnStartBootstrap = typeof SessionTurnStartBootstrap.Type;

export const SessionTurnStartCommand = Schema.Struct({
  type: Schema.Literal("session.turn.start"),
  commandId: CommandId,
  sessionId: SessionId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(SessionTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientSessionTurnStartCommand = Schema.Struct({
  type: Schema.Literal("session.turn.start"),
  commandId: CommandId,
  sessionId: SessionId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(SessionTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const SessionTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("session.turn.interrupt"),
  commandId: CommandId,
  sessionId: SessionId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const SessionApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("session.approval.respond"),
  commandId: CommandId,
  sessionId: SessionId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const SessionUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("session.user-input.respond"),
  commandId: CommandId,
  sessionId: SessionId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const SessionCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("session.checkpoint.revert"),
  commandId: CommandId,
  sessionId: SessionId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ProviderRuntimeStopCommand = Schema.Struct({
  type: Schema.Literal("session.session.stop"),
  commandId: CommandId,
  sessionId: SessionId,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  SessionCreateCommand,
  SessionDeleteCommand,
  SessionArchiveCommand,
  SessionUnarchiveCommand,
  SessionMetaUpdateCommand,
  SessionRuntimeModeSetCommand,
  SessionInteractionModeSetCommand,
  SessionTurnStartCommand,
  SessionTurnInterruptCommand,
  SessionApprovalRespondCommand,
  SessionUserInputRespondCommand,
  SessionCheckpointRevertCommand,
  ProviderRuntimeStopCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  SessionCreateCommand,
  SessionDeleteCommand,
  SessionArchiveCommand,
  SessionUnarchiveCommand,
  SessionMetaUpdateCommand,
  SessionRuntimeModeSetCommand,
  SessionInteractionModeSetCommand,
  ClientSessionTurnStartCommand,
  SessionTurnInterruptCommand,
  SessionApprovalRespondCommand,
  SessionUserInputRespondCommand,
  SessionCheckpointRevertCommand,
  ProviderRuntimeStopCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ProviderRuntimeSetCommand = Schema.Struct({
  type: Schema.Literal("session.session.set"),
  commandId: CommandId,
  sessionId: SessionId,
  session: OrchestrationProviderRuntime,
  createdAt: IsoDateTime,
});

const SessionMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("session.message.assistant.delta"),
  commandId: CommandId,
  sessionId: SessionId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const SessionMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("session.message.assistant.complete"),
  commandId: CommandId,
  sessionId: SessionId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const SessionProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("session.proposed-plan.upsert"),
  commandId: CommandId,
  sessionId: SessionId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const SessionResearchCardProposeCommand = Schema.Struct({
  type: Schema.Literal("session.research-card.propose"),
  commandId: CommandId,
  sessionId: SessionId,
  researchCard: OrchestrationResearchCard,
  createdAt: IsoDateTime,
});

const SessionResearchCardUpdateCommand = Schema.Struct({
  type: Schema.Literal("session.research-card.update"),
  commandId: CommandId,
  sessionId: SessionId,
  cardId: ResearchCardId,
  researchCard: OrchestrationResearchCard,
  createdAt: IsoDateTime,
});

const SessionResearchCardReviewCommand = Schema.Struct({
  type: Schema.Literal("session.research-card.review"),
  commandId: CommandId,
  sessionId: SessionId,
  cardId: ResearchCardId,
  response: ResearchCardReviewResponse,
  createdAt: IsoDateTime,
});

const SessionTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("session.turn.diff.complete"),
  commandId: CommandId,
  sessionId: SessionId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const SessionActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("session.activity.append"),
  commandId: CommandId,
  sessionId: SessionId,
  activity: OrchestrationSessionActivity,
  createdAt: IsoDateTime,
});

const SessionRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("session.revert.complete"),
  commandId: CommandId,
  sessionId: SessionId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ProviderRuntimeSetCommand,
  SessionMessageAssistantDeltaCommand,
  SessionMessageAssistantCompleteCommand,
  SessionProposedPlanUpsertCommand,
  SessionResearchCardProposeCommand,
  SessionResearchCardUpdateCommand,
  SessionResearchCardReviewCommand,
  SessionTurnDiffCompleteCommand,
  SessionActivityAppendCommand,
  SessionRevertCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "session.created",
  "session.deleted",
  "session.archived",
  "session.unarchived",
  "session.meta-updated",
  "session.runtime-mode-set",
  "session.interaction-mode-set",
  "session.message-sent",
  "session.turn-start-requested",
  "session.turn-interrupt-requested",
  "session.approval-response-requested",
  "session.user-input-response-requested",
  "session.checkpoint-revert-requested",
  "session.reverted",
  "session.session-stop-requested",
  "session.session-set",
  "session.proposed-plan-upserted",
  "session.research-card-proposed",
  "session.research-card-updated",
  "session.research-card-reviewed",
  "session.turn-diff-completed",
  "session.activity-appended",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "session"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const SessionCreatedPayload = Schema.Struct({
  sessionId: SessionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SessionDeletedPayload = Schema.Struct({
  sessionId: SessionId,
  deletedAt: IsoDateTime,
});

export const SessionArchivedPayload = Schema.Struct({
  sessionId: SessionId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SessionUnarchivedPayload = Schema.Struct({
  sessionId: SessionId,
  updatedAt: IsoDateTime,
});

export const SessionMetaUpdatedPayload = Schema.Struct({
  sessionId: SessionId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const SessionRuntimeModeSetPayload = Schema.Struct({
  sessionId: SessionId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const SessionInteractionModeSetPayload = Schema.Struct({
  sessionId: SessionId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const SessionMessageSentPayload = Schema.Struct({
  sessionId: SessionId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SessionTurnStartRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const SessionTurnInterruptRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const SessionApprovalResponseRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const SessionUserInputResponseRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const SessionCheckpointRevertRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const SessionRevertedPayload = Schema.Struct({
  sessionId: SessionId,
  turnCount: NonNegativeInt,
});

export const ProviderRuntimeStopRequestedPayload = Schema.Struct({
  sessionId: SessionId,
  createdAt: IsoDateTime,
});

export const ProviderRuntimeSetPayload = Schema.Struct({
  sessionId: SessionId,
  session: OrchestrationProviderRuntime,
});

export const SessionProposedPlanUpsertedPayload = Schema.Struct({
  sessionId: SessionId,
  proposedPlan: OrchestrationProposedPlan,
});

export const SessionResearchCardProposedPayload = Schema.Struct({
  sessionId: SessionId,
  researchCard: OrchestrationResearchCard,
});

export const SessionResearchCardUpdatedPayload = Schema.Struct({
  sessionId: SessionId,
  cardId: ResearchCardId,
  researchCard: OrchestrationResearchCard,
});

export const SessionResearchCardReviewedPayload = Schema.Struct({
  sessionId: SessionId,
  cardId: ResearchCardId,
  response: ResearchCardReviewResponse,
});

export const SessionTurnDiffCompletedPayload = Schema.Struct({
  sessionId: SessionId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const SessionActivityAppendedPayload = Schema.Struct({
  sessionId: SessionId,
  activity: OrchestrationSessionActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, SessionId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.created"),
    payload: SessionCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.deleted"),
    payload: SessionDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.archived"),
    payload: SessionArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.unarchived"),
    payload: SessionUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.meta-updated"),
    payload: SessionMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.runtime-mode-set"),
    payload: SessionRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.interaction-mode-set"),
    payload: SessionInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.message-sent"),
    payload: SessionMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.turn-start-requested"),
    payload: SessionTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.turn-interrupt-requested"),
    payload: SessionTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.approval-response-requested"),
    payload: SessionApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.user-input-response-requested"),
    payload: SessionUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.checkpoint-revert-requested"),
    payload: SessionCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.reverted"),
    payload: SessionRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.session-stop-requested"),
    payload: ProviderRuntimeStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.session-set"),
    payload: ProviderRuntimeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.proposed-plan-upserted"),
    payload: SessionProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.research-card-proposed"),
    payload: SessionResearchCardProposedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.research-card-updated"),
    payload: SessionResearchCardUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.research-card-reviewed"),
    payload: SessionResearchCardReviewedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.turn-diff-completed"),
    payload: SessionTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("session.activity-appended"),
    payload: SessionActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationSessionStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationSessionDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationSessionStreamItem = typeof OrchestrationSessionStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const SessionTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    sessionId: SessionId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderRuntimeStatus = Schema.Literals(["starting", "running", "stopped", "error"]);
export type ProviderRuntimeStatus = typeof ProviderRuntimeStatus.Type;

const ProjectionSessionTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionSessionTurnStatus = typeof ProjectionSessionTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  sessionId: SessionId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    sessionId: SessionId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = SessionTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullSessionDiffInput = Schema.Struct({
  sessionId: SessionId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullSessionDiffInput = typeof OrchestrationGetFullSessionDiffInput.Type;

export const OrchestrationGetFullSessionDiffResult = SessionTurnDiff;
export type OrchestrationGetFullSessionDiffResult =
  typeof OrchestrationGetFullSessionDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullSessionDiff: {
    input: OrchestrationGetFullSessionDiffInput,
    output: OrchestrationGetFullSessionDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeSession: {
    input: OrchestrationSubscribeSessionInput,
    output: OrchestrationSessionStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullSessionDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullSessionDiffError>()(
  "OrchestrationGetFullSessionDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
