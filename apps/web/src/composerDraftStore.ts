import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ProviderInteractionMode,
  ProviderDriverKind,
  ProviderOptionSelection,
  RuntimeMode,
  type ServerProvider,
  type ScopedProjectRef,
  type ScopedSessionRef,
  SessionId,
} from "@t3tools/contracts";
import {
  parseScopedProjectKey,
  parseScopedSessionKey,
  scopedProjectKey,
  scopeProjectRef,
  scopedSessionKey,
  scopeSessionRef,
} from "@t3tools/client-runtime";
import * as Schema from "effect/Schema";
import * as Equal from "effect/Equal";
import { DeepMutable } from "effect/Types";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import { useMemo } from "react";
import { getLocalStorageItem } from "./hooks/useLocalStorage";
import { resolveAppModelSelection, resolveAppModelSelectionForInstance } from "./modelSelection";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type ChatImageAttachment } from "./types";
import {
  type TerminalContextDraft,
  ensureInlineTerminalContextPlaceholders,
  normalizeTerminalContextText,
} from "./lib/terminalContext";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createDebouncedStorage, createMemoryStorage } from "./lib/storage";
import { getDefaultServerModel } from "./providerModels";
import { UnifiedSettings } from "@t3tools/contracts/settings";
const isRuntimeMode = Schema.is(RuntimeMode);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

export const COMPOSER_DRAFT_STORAGE_KEY = "lincei:composer-drafts:v1";
const COMPOSER_DRAFT_STORAGE_VERSION = 6;
const DraftSessionEnvModeSchema = Schema.Literals(["local", "worktree"]);
export type DraftSessionEnvMode = typeof DraftSessionEnvModeSchema.Type;

export const DraftId = Schema.String.pipe(Schema.brand("DraftId"));
export type DraftId = typeof DraftId.Type;

const COMPOSER_PERSIST_DEBOUNCE_MS = 300;

const composerDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS,
);

// Flush pending composer draft writes before page unload to prevent data loss.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    composerDebouncedStorage.flush();
  });
}

export const PersistedComposerImageAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});
export type PersistedComposerImageAttachment = typeof PersistedComposerImageAttachment.Type;

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  sessionId: SessionId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});
type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

const PersistedComposerSessionDraftState = Schema.Struct({
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  // Keyed by `ProviderInstanceId` (open branded slug) so custom provider
  // instances (e.g. `codex_personal`) round-trip alongside the built-in
  // `codex` / `claudeAgent` / ... entries. Every prior `ProviderDriverKind`
  // literal satisfies the `ProviderInstanceId` slug pattern, so existing
  // persisted drafts decode unchanged.
  //
  // The record's value schema is NOT wrapped in `Schema.optionalKey`:
  // that helper is only meaningful on property signatures with a known
  // key set, and `Schema.Record(<branded string>, …)` produces an index
  // signature at runtime (Schema rejects the combination). Absence of
  // an entry already encodes "no selection for this instance".
  modelSelectionByProvider: Schema.optionalKey(Schema.Record(ProviderInstanceId, ModelSelection)),
  activeProvider: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
});
type PersistedComposerSessionDraftState = typeof PersistedComposerSessionDraftState.Type;

/**
 * Per-provider record of generic option selections. Used as a transient
 * representation when migrating legacy v2 storage payloads and when
 * deriving per-provider option bundles for downstream consumers.
 */
type ProviderOptionSelectionsByProvider = Partial<
  Record<string, ReadonlyArray<ProviderOptionSelection>>
>;

type LegacyCodexFields = {
  effort?: unknown;
  codexFastMode?: unknown;
  serviceTier?: unknown;
};

type LegacySessionModelFields = {
  provider?: unknown;
  model?: unknown;
  modelOptions?: unknown;
};

type LegacyV2SessionDraftFields = {
  modelSelection?: ModelSelection | null;
  modelOptions?: unknown;
};

type LegacyPersistedComposerSessionDraftState = PersistedComposerSessionDraftState &
  LegacyCodexFields &
  LegacySessionModelFields &
  LegacyV2SessionDraftFields;

type LegacyStickyModelFields = {
  stickyProvider?: unknown;
  stickyModel?: unknown;
  stickyModelOptions?: unknown;
};

type LegacyV2StoreFields = {
  stickyModelSelection?: ModelSelection | null;
  stickyModelOptions?: unknown;
  projectDraftSessionIdByProjectId?: Record<string, string> | null;
  draftsBySessionId?: Record<string, PersistedComposerSessionDraftState> | null;
  draftSessionsBySessionId?: Record<string, PersistedDraftSessionState> | null;
  projectDraftSessionIdByProjectKey?: Record<string, string> | null;
  draftsBySessionKey?: Record<string, PersistedComposerSessionDraftState> | null;
  draftSessionsBySessionKey?: Record<string, PersistedDraftSessionState> | null;
  projectDraftSessionKeyByProjectKey?: Record<string, string> | null;
  logicalProjectDraftSessionKeyByLogicalProjectKey?: Record<string, string> | null;
};

type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields;

const PersistedDraftSessionState = Schema.Struct({
  sessionId: SessionId,
  environmentId: Schema.String,
  projectId: ProjectId,
  logicalProjectKey: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workflowId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  envMode: DraftSessionEnvModeSchema,
  promotedTo: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        environmentId: Schema.String,
        sessionId: Schema.String,
      }),
    ),
  ),
});
type PersistedDraftSessionState = typeof PersistedDraftSessionState.Type;

const PersistedComposerDraftStoreState = Schema.Struct({
  draftsBySessionKey: Schema.Record(Schema.String, PersistedComposerSessionDraftState),
  draftSessionsBySessionKey: Schema.Record(Schema.String, PersistedDraftSessionState),
  logicalProjectDraftSessionKeyByLogicalProjectKey: Schema.Record(Schema.String, Schema.String),
  stickyModelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderInstanceId, ModelSelection),
  ),
  stickyActiveProvider: Schema.optionalKey(Schema.NullOr(ProviderInstanceId)),
});
type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;

const PersistedComposerDraftStoreStorage = Schema.Struct({
  version: Schema.Number,
  state: PersistedComposerDraftStoreState,
});

/**
 * Composer content keyed by either a draft session (`DraftId`) or a real server
 * session (`ScopedSessionRef`). This is the editable payload shown in the composer.
 */
export interface ComposerSessionDraftState {
  prompt: string;
  images: ComposerImageAttachment[];
  nonPersistedImageIds: string[];
  persistedAttachments: PersistedComposerImageAttachment[];
  terminalContexts: TerminalContextDraft[];
  /**
   * Per-instance model selection. Keyed by `ProviderInstanceId` (open
   * branded slug) so a default `codex` instance and a user-authored
   * `codex_personal` instance each persist their own selected model. Every
   * historical `ProviderDriverKind` literal (`codex` / `claudeAgent` / `cursor` /
   * `opencode`) also satisfies the `ProviderInstanceId` slug pattern, so
   * legacy kind-keyed drafts round-trip unchanged.
   */
  modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
  /** Routing key of the last picked instance (see `modelSelectionByProvider`). */
  activeProvider: ProviderInstanceId | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
}

/**
 * Mutable routing and execution context for a pre-session draft session.
 *
 * Unlike a real server session, a draft session can still change target
 * environment/worktree configuration before the first send.
 */
export interface DraftSessionState {
  sessionId: SessionId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  logicalProjectKey: string;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  workflowId?: string | null;
  workflowVersion?: string | null;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftSessionEnvMode;
  promotedTo?: ScopedSessionRef | null;
}

/**
 * Draft session metadata paired with its stable draft-session identity.
 */
interface ProjectDraftSession extends DraftSessionState {
  draftId: DraftId;
}

/**
 * App-facing composer identity:
 * - `DraftId` for pre-session draft sessions
 * - `ScopedSessionRef` for server-backed sessions
 *
 * Raw `SessionId` is intentionally excluded so callers cannot drop environment
 * identity for real sessions.
 */
type ComposerSessionTarget = ScopedSessionRef | DraftId;

/**
 * Persisted store for composer content plus draft-session metadata.
 *
 * The store intentionally models two domains:
 * - draft sessions keyed by `DraftId`
 * - server session composer state keyed by `ScopedSessionRef`
 */
interface ComposerDraftStoreState {
  draftsBySessionKey: Record<string, ComposerSessionDraftState>;
  draftSessionsBySessionKey: Record<string, DraftSessionState>;
  logicalProjectDraftSessionKeyByLogicalProjectKey: Record<string, string>;
  stickyModelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
  stickyActiveProvider: ProviderInstanceId | null;
  /** Returns the editable composer content for a draft session or server session. */
  getComposerDraft: (target: ComposerSessionTarget) => ComposerSessionDraftState | null;
  /** Looks up the active draft session for a logical project identity. */
  getDraftSessionByLogicalProjectKey: (logicalProjectKey: string) => ProjectDraftSession | null;
  getDraftSessionByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  /** Resolves a server-session ref back to a matching draft session when one exists. */
  getDraftSessionByRef: (sessionRef: ScopedSessionRef) => DraftSessionState | null;
  /** Reads mutable draft-session metadata by draft id or server-session ref. */
  getDraftSession: (sessionRef: ComposerSessionTarget) => DraftSessionState | null;
  listDraftSessionKeys: () => string[];
  hasDraftSessionsInEnvironment: (environmentId: EnvironmentId) => boolean;
  /** Creates or updates the draft session tracked for a logical project. */
  setLogicalProjectDraftSessionId: (
    logicalProjectKey: string,
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      sessionId?: SessionId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftSessionEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      workflowId?: string | null;
      workflowVersion?: string | null;
    },
  ) => void;
  /** Creates or updates the draft session tracked for a concrete project ref. */
  setProjectDraftSessionId: (
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      sessionId?: SessionId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftSessionEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      workflowId?: string | null;
      workflowVersion?: string | null;
    },
  ) => void;
  /** Updates mutable draft-session metadata without touching composer content. */
  setDraftSessionContext: (
    sessionRef: ComposerSessionTarget,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      projectRef?: ScopedProjectRef;
      createdAt?: string;
      envMode?: DraftSessionEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      workflowId?: string | null;
      workflowVersion?: string | null;
    },
  ) => void;
  clearProjectDraftSessionId: (projectRef: ScopedProjectRef) => void;
  clearProjectDraftSessionById: (
    projectRef: ScopedProjectRef,
    sessionRef: ComposerSessionTarget,
  ) => void;
  /** Marks a draft session as being promoted to a real server session. */
  markDraftSessionPromoting: (
    sessionRef: ComposerSessionTarget,
    promotedTo?: ScopedSessionRef,
  ) => void;
  /** Removes draft-session metadata after promotion is complete. */
  finalizePromotedDraftSession: (sessionRef: ComposerSessionTarget) => void;
  clearDraftSession: (sessionRef: ComposerSessionTarget) => void;
  setStickyModelSelection: (modelSelection: ModelSelection | null | undefined) => void;
  setPrompt: (sessionRef: ComposerSessionTarget, prompt: string) => void;
  setTerminalContexts: (
    sessionRef: ComposerSessionTarget,
    contexts: TerminalContextDraft[],
  ) => void;
  setModelSelection: (
    sessionRef: ComposerSessionTarget,
    modelSelection: ModelSelection | null | undefined,
  ) => void;
  /** Replace the model options for one or more providers in the draft. */
  setModelOptions: (
    sessionRef: ComposerSessionTarget,
    modelOptions:
      | Partial<Record<string, ReadonlyArray<ProviderOptionSelection>>>
      | null
      | undefined,
  ) => void;
  applyStickyState: (sessionRef: ComposerSessionTarget) => void;
  setProviderModelOptions: (
    sessionRef: ComposerSessionTarget,
    provider: ProviderDriverKind,
    nextProviderOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
    options?: {
      instanceId?: ProviderInstanceId | null | undefined;
      model?: string | null | undefined;
      persistSticky?: boolean;
    },
  ) => void;
  setRuntimeMode: (
    sessionRef: ComposerSessionTarget,
    runtimeMode: RuntimeMode | null | undefined,
  ) => void;
  setInteractionMode: (
    sessionRef: ComposerSessionTarget,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  addImage: (sessionRef: ComposerSessionTarget, image: ComposerImageAttachment) => void;
  addImages: (sessionRef: ComposerSessionTarget, images: ComposerImageAttachment[]) => void;
  removeImage: (sessionRef: ComposerSessionTarget, imageId: string) => void;
  insertTerminalContext: (
    sessionRef: ComposerSessionTarget,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  addTerminalContext: (sessionRef: ComposerSessionTarget, context: TerminalContextDraft) => void;
  addTerminalContexts: (
    sessionRef: ComposerSessionTarget,
    contexts: TerminalContextDraft[],
  ) => void;
  removeTerminalContext: (sessionRef: ComposerSessionTarget, contextId: string) => void;
  clearTerminalContexts: (sessionRef: ComposerSessionTarget) => void;
  clearPersistedAttachments: (sessionRef: ComposerSessionTarget) => void;
  syncPersistedAttachments: (
    sessionRef: ComposerSessionTarget,
    attachments: PersistedComposerImageAttachment[],
  ) => void;
  clearComposerContent: (sessionRef: ComposerSessionTarget) => void;
}

export interface EffectiveComposerModelState {
  selectedModel: string;
  modelOptions: ProviderOptionSelectionsByProvider | null;
}

interface ComposerDraftModelState {
  activeProvider: ProviderInstanceId | null;
  modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
}

function providerSelectionsFromModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  if (!modelSelection) {
    return null;
  }
  const options = modelSelection.options;
  if (!options || options.length === 0) {
    return null;
  }
  return { [modelSelection.instanceId]: options };
}

function modelSelectionByProviderToOptions(
  map: Partial<Record<string, ModelSelection>> | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  if (!map) return null;
  const result: ProviderOptionSelectionsByProvider = {};
  for (const [provider, selection] of Object.entries(map)) {
    if (selection?.options && selection.options.length > 0) {
      result[provider] = selection.options;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function cloneModelSelection(selection: ModelSelection): DeepMutable<ModelSelection> {
  return {
    ...selection,
    ...(selection.options ? { options: selection.options.map((option) => ({ ...option })) } : {}),
  } as DeepMutable<ModelSelection>;
}

function compactModelSelectionByProvider(
  selections: Partial<Record<ProviderInstanceId, ModelSelection>>,
): DeepMutable<Record<ProviderInstanceId, ModelSelection>> {
  const entries: Array<[string, DeepMutable<ModelSelection>]> = [];
  for (const [provider, selection] of Object.entries(selections)) {
    if (selection !== undefined) {
      entries.push([provider, cloneModelSelection(selection)]);
    }
  }
  return Object.fromEntries(entries) as DeepMutable<Record<ProviderInstanceId, ModelSelection>>;
}

const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsBySessionKey: {},
  draftSessionsBySessionKey: {},
  logicalProjectDraftSessionKeyByLogicalProjectKey: {},
  stickyModelSelectionByProvider: {},
  stickyActiveProvider: null,
});

const EMPTY_IMAGES: ComposerImageAttachment[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_PERSISTED_ATTACHMENTS: PersistedComposerImageAttachment[] = [];
const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENTS);
const EMPTY_MODEL_SELECTION_BY_PROVIDER: Partial<Record<ProviderDriverKind, ModelSelection>> =
  Object.freeze({});
const EMPTY_COMPOSER_DRAFT_MODEL_STATE = Object.freeze<ComposerDraftModelState>({
  activeProvider: null,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
});

const EMPTY_THREAD_DRAFT = Object.freeze<ComposerSessionDraftState>({
  prompt: "",
  images: EMPTY_IMAGES,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachments: EMPTY_PERSISTED_ATTACHMENTS,
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
});

function createEmptySessionDraft(): ComposerSessionDraftState {
  return {
    prompt: "",
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  };
}

function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

function terminalContextDedupKey(context: TerminalContextDraft): string {
  return `${context.terminalId}\u0000${context.lineStart}\u0000${context.lineEnd}`;
}

function normalizeTerminalContextForSession(
  sessionId: SessionId,
  context: TerminalContextDraft,
): TerminalContextDraft | null {
  const terminalId = context.terminalId.trim();
  const terminalLabel = context.terminalLabel.trim();
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(context.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(context.lineEnd));
  return {
    ...context,
    sessionId,
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text: normalizeTerminalContextText(context.text),
  };
}

function normalizeTerminalContextsForSession(
  sessionId: SessionId,
  contexts: ReadonlyArray<TerminalContextDraft>,
): TerminalContextDraft[] {
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();
  const normalizedContexts: TerminalContextDraft[] = [];

  for (const context of contexts) {
    const normalizedContext = normalizeTerminalContextForSession(sessionId, context);
    if (!normalizedContext) {
      continue;
    }
    const dedupKey = terminalContextDedupKey(normalizedContext);
    if (existingIds.has(normalizedContext.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedContexts.push(normalizedContext);
    existingIds.add(normalizedContext.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedContexts;
}

function shouldRemoveDraft(draft: ComposerSessionDraftState): boolean {
  return (
    draft.prompt.length === 0 &&
    draft.images.length === 0 &&
    draft.persistedAttachments.length === 0 &&
    draft.terminalContexts.length === 0 &&
    Object.keys(draft.modelSelectionByProvider).length === 0 &&
    draft.activeProvider === null &&
    draft.runtimeMode === null &&
    draft.interactionMode === null
  );
}

function normalizeProviderDriverKind(value: unknown): ProviderDriverKind | null {
  return isProviderDriverKind(value) ? value : null;
}

/**
 * Match the `ProviderInstanceId` slug pattern (letter followed by
 * letters/digits/`-`/`_`, 1..64 chars). Permissive validator — the schema
 * layer owns authoritative validation; this is used inline to gate typed
 * writes to the draft's instance-keyed maps without pulling the full
 * Effect Schema runtime into the hot path.
 */
const PROVIDER_INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Coerce an arbitrary persisted value into a valid `ProviderInstanceId`. Used
 * wherever we need to accept both legacy driver-kind keys and custom instance
 * slugs (e.g. `codex_personal`) as routing keys.
 */
function normalizeProviderInstanceId(value: unknown): ProviderInstanceId | null {
  if (typeof value !== "string") return null;
  if (!PROVIDER_INSTANCE_ID_PATTERN.test(value)) return null;
  return value as ProviderInstanceId;
}

/**
 * Coerce an unknown value into a `ReadonlyArray<ProviderOptionSelection>`.
 * Accepts either:
 *   - the v3 representation: an array of `{ id, value }` entries
 *   - the legacy v2 representation: a record of `{ id: string | boolean }`
 *
 * Validation is intentionally permissive: descriptors are the source of truth
 * for which option ids are meaningful for a given provider/model. Anything
 * outside the descriptor list is harmless trailing data and will simply be
 * ignored downstream.
 */
function coerceProviderOptionSelections(
  value: unknown,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (Array.isArray(value)) {
    const out: ProviderOptionSelection[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = record.id;
      const optionValue = record.value;
      if (typeof id !== "string" || id.length === 0) continue;
      if (typeof optionValue === "string" || typeof optionValue === "boolean") {
        out.push({ id, value: optionValue });
      }
    }
    return out.length > 0 ? out : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: ProviderOptionSelection[] = [];
    for (const [id, raw] of Object.entries(record)) {
      if (typeof raw === "string" || typeof raw === "boolean") {
        out.push({ id, value: raw });
      }
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * Normalize a per-provider options bag from either the v3 or legacy v2 shape.
 *
 * `provider` and `legacy` parameters are migration-only inputs used to
 * recover legacy codex fields (effort/codexFastMode/serviceTier) that lived
 * directly on the draft instead of inside `modelOptions.codex`.
 */
function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderDriverKind | null,
  legacy?: LegacyCodexFields,
): ProviderOptionSelectionsByProvider | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const result: ProviderOptionSelectionsByProvider = {};
  for (const providerKey of ["codex", "claudeAgent", "cursor", "opencode"] as const) {
    const selections = coerceProviderOptionSelections(candidate?.[providerKey]);
    if (selections) {
      result[providerKey] = selections;
    }
  }

  // Recover legacy codex fields that lived outside modelOptions.
  if (provider === "codex" && legacy) {
    const codexExtras: ProviderOptionSelection[] = [];
    if (typeof legacy.effort === "string" && legacy.effort.length > 0) {
      codexExtras.push({ id: "reasoningEffort", value: legacy.effort });
    }
    const fastMode =
      legacy.codexFastMode === true ||
      (typeof legacy.serviceTier === "string" && legacy.serviceTier === "fast");
    if (fastMode) {
      codexExtras.push({ id: "fastMode", value: true });
    }
    if (codexExtras.length > 0) {
      const existing = result.codex ?? [];
      const existingIds = new Set(existing.map((entry) => entry.id));
      const merged = [...existing];
      for (const extra of codexExtras) {
        if (!existingIds.has(extra.id)) merged.push(extra);
      }
      result.codex = merged;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// Returns a model selection whose `instanceId` is a valid
// `ProviderInstanceId` slug. Legacy `provider` fields are promoted verbatim
// because default instance ids used the same slug as the driver kind.
//
// Selections whose instance id doesn't match the slug pattern collapse to
// `null` — caller is responsible for deciding whether that's a dropped
// write or a routed error.
function normalizeModelSelection(
  value: unknown,
  legacy?: {
    provider?: unknown;
    model?: unknown;
    modelOptions?: unknown;
    legacyCodex?: LegacyCodexFields;
  },
): NormalizedModelSelection | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  // Post-migration ModelSelection carries `instanceId`; pre-migration (v2
  // storage, legacy wire shapes) carries `provider`. Accept either so both
  // normalized stores and legacy drafts round-trip through this helper.
  const instanceId = normalizeProviderInstanceId(
    candidate?.instanceId ?? candidate?.provider ?? legacy?.provider,
  );
  if (instanceId === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  if (typeof rawModel !== "string") {
    return null;
  }
  // Slug normalization can use provider-kind-specific rules when a legacy
  // driver key is present. Instance-only selections are not reverse-inferred
  // into a driver kind here; they get generic default normalization.
  const driverKindHint =
    normalizeProviderDriverKind(candidate?.provider ?? legacy?.provider) ??
    ProviderDriverKind.make("codex");
  const model = normalizeModelSlug(rawModel, driverKindHint);
  if (!model) {
    return null;
  }
  if (Array.isArray(candidate?.options)) {
    const selections = coerceProviderOptionSelections(candidate.options);
    return createModelSelection(instanceId, model, selections) as NormalizedModelSelection;
  }
  // Per-kind options were a pre-migration concern; only recover them for a
  // built-in-kind instance. Custom instances don't have a legacy options
  // store to session through here.
  const kindForLegacyOptions = normalizeProviderDriverKind(instanceId);
  const modelOptions = kindForLegacyOptions
    ? normalizeProviderModelOptions(
        candidate?.options ? { [kindForLegacyOptions]: candidate.options } : legacy?.modelOptions,
        kindForLegacyOptions,
        kindForLegacyOptions === "codex" ? legacy?.legacyCodex : undefined,
      )
    : null;
  const options = kindForLegacyOptions ? modelOptions?.[kindForLegacyOptions] : undefined;
  return createModelSelection(instanceId, model, options) as NormalizedModelSelection;
}

type NormalizedModelSelection = Omit<ModelSelection, "instanceId"> & {
  readonly instanceId: ProviderInstanceId;
};

// ── Legacy sync helpers (used only during migration from v2 storage) ──
//
// These operate against the legacy kind-keyed `modelOptions` map. The
// normalized selection now carries an open `ProviderInstanceId`; legacy
// migration only recovers options for keys that existed before custom
// provider instances.

function legacySyncModelSelectionOptions(
  modelSelection: NormalizedModelSelection | null,
  modelOptions: ProviderOptionSelectionsByProvider | null | undefined,
): NormalizedModelSelection | null {
  if (modelSelection === null) {
    return null;
  }
  const kind = normalizeProviderDriverKind(modelSelection.instanceId);
  const options = kind ? modelOptions?.[kind] : undefined;
  return createModelSelection(
    modelSelection.instanceId,
    modelSelection.model,
    options,
  ) as NormalizedModelSelection;
}

function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: NormalizedModelSelection | null,
  currentModelOptions: ProviderOptionSelectionsByProvider | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  if (!modelSelection?.options || modelSelection.options.length === 0) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  const kind = normalizeProviderDriverKind(modelSelection.instanceId);
  if (!kind) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    kind,
    modelSelection.options,
  );
}

function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderOptionSelectionsByProvider | null | undefined,
  provider: ProviderDriverKind,
  nextProviderOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ProviderOptionSelectionsByProvider | null {
  const { [provider]: _discardedProviderModelOptions, ...otherProviderModelOptions } =
    currentModelOptions ?? {};
  const merged: ProviderOptionSelectionsByProvider = { ...otherProviderModelOptions };
  if (nextProviderOptions && nextProviderOptions.length > 0) {
    merged[provider] = nextProviderOptions;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

// ── New helpers for the consolidated representation ────────────────────

function legacyToModelSelectionByProvider(
  modelSelection: NormalizedModelSelection | null,
  modelOptions: ProviderOptionSelectionsByProvider | null | undefined,
): Partial<Record<ProviderInstanceId, ModelSelection>> {
  const result: Partial<Record<ProviderInstanceId, ModelSelection>> = {};
  if (modelOptions) {
    for (const provider of ["codex", "claudeAgent", "cursor", "opencode"] as const) {
      const options = modelOptions[provider];
      if (options && options.length > 0) {
        const driverKind = ProviderDriverKind.make(provider);
        const instanceKey = defaultInstanceIdForDriver(driverKind);
        result[instanceKey] = createModelSelection(
          instanceKey,
          modelSelection?.instanceId === instanceKey
            ? modelSelection.model
            : (DEFAULT_MODEL_BY_PROVIDER[driverKind] ?? DEFAULT_MODEL),
          options,
        );
      }
    }
  }
  if (modelSelection) {
    result[modelSelection.instanceId] = modelSelection as ModelSelection;
  }
  return result;
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerSessionDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderDriverKind;
  /**
   * Optional routing key of the instance whose selection should override
   * the driver-level lookup. When present, the draft is queried by
   * `modelSelectionByProvider[selectedInstanceId]` so a custom Codex
   * instance (e.g. `codex_personal`) reads its own saved model instead of
   * collapsing to the default Codex bucket.
   */
  selectedInstanceId?: ProviderInstanceId | null | undefined;
  sessionModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveComposerModelState {
  const baseModelCandidate =
    input.sessionModelSelection?.model ?? input.projectModelSelection?.model ?? null;
  const baseModel =
    (input.selectedInstanceId
      ? resolveAppModelSelectionForInstance(
          input.selectedInstanceId,
          input.settings,
          input.providers,
          baseModelCandidate,
        )
      : null) ??
    resolveAppModelSelection(
      input.selectedProvider,
      input.settings,
      input.providers,
      baseModelCandidate,
    ) ??
    normalizeModelSlug(baseModelCandidate, input.selectedProvider) ??
    getDefaultServerModel(input.providers, input.selectedProvider);
  // Look up the instance's saved selection first; fall back to the
  // driver-kind bucket so legacy kind-keyed drafts still resolve. Every
  // `ProviderDriverKind` literal is a valid `ProviderInstanceId` slug, so the
  // cast to the branded type is safe.
  const instanceSelection = input.selectedInstanceId
    ? input.draft?.modelSelectionByProvider?.[input.selectedInstanceId]
    : undefined;
  const legacySelection =
    input.draft?.modelSelectionByProvider?.[ProviderInstanceId.make(input.selectedProvider)];
  const activeSelection = instanceSelection ?? legacySelection;
  const activeSelectionInstanceId = instanceSelection
    ? (input.selectedInstanceId ?? ProviderInstanceId.make(input.selectedProvider))
    : ProviderInstanceId.make(input.selectedProvider);
  const selectedModel = activeSelection?.model
    ? (resolveAppModelSelectionForInstance(
        activeSelectionInstanceId,
        input.settings,
        input.providers,
        activeSelection.model,
      ) ??
      resolveAppModelSelection(
        input.selectedProvider,
        input.settings,
        input.providers,
        activeSelection.model,
      ))
    : baseModel;
  const modelOptions =
    modelSelectionByProviderToOptions(input.draft?.modelSelectionByProvider) ??
    providerSelectionsFromModelSelection(input.sessionModelSelection) ??
    providerSelectionsFromModelSelection(input.projectModelSelection) ??
    null;

  return {
    selectedModel,
    modelOptions,
  };
}

function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

function revokeDraftSessionPreviewUrls(draft: ComposerSessionDraftState | undefined): void {
  if (!draft) {
    return;
  }
  for (const image of draft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

function normalizePersistedAttachment(value: unknown): PersistedComposerImageAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  const dataUrl = candidate.dataUrl;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    typeof dataUrl !== "string" ||
    id.length === 0 ||
    dataUrl.length === 0
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const sessionId = candidate.sessionId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart));
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd));
  return {
    id,
    sessionId: sessionId as SessionId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  };
}

function normalizeDraftSessionEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftSessionEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

function projectDraftKey(projectRef: ScopedProjectRef): string {
  return scopedProjectKey(projectRef);
}

function logicalProjectDraftKey(logicalProjectKey: string): string {
  return logicalProjectKey.trim();
}

/**
 * Runtime composer storage key for app-facing identities only.
 *
 * Draft sessions are keyed by `DraftId`. Real sessions are keyed by
 * `ScopedSessionRef` so environment identity is always preserved.
 */
function composerTargetKey(target: ScopedSessionRef | DraftId): string {
  if (typeof target === "string") {
    return target.trim();
  }
  return scopedSessionKey(target);
}

/**
 * Legacy persisted data may still be keyed by a raw `SessionId`. This helper is
 * intentionally migration-only so live code cannot accidentally accept that
 * incomplete identity.
 */
function normalizeLegacyComposerStorageKey(
  sessionKeyOrId: string,
  options?: {
    environmentId?: EnvironmentId;
  },
): string {
  const parsedSessionRef = parseScopedSessionKey(sessionKeyOrId);
  if (parsedSessionRef) {
    return composerTargetKey(parsedSessionRef);
  }
  if (options?.environmentId) {
    return composerTargetKey(scopeSessionRef(options.environmentId, sessionKeyOrId as SessionId));
  }
  return sessionKeyOrId;
}

function composerSessionRefFromKey(sessionKey: string): ScopedSessionRef | null {
  return parseScopedSessionKey(sessionKey);
}

type ComposerSessionLookupState = Pick<
  ComposerDraftStoreState,
  "draftsBySessionKey" | "draftSessionsBySessionKey"
>;

function normalizeComposerTarget(
  state: ComposerSessionLookupState,
  target: ComposerSessionTarget,
): ComposerSessionTarget | null {
  if (typeof target === "string") {
    const draftId = target.trim();
    return draftId.length > 0 ? DraftId.make(draftId) : null;
  }
  return target;
}

function resolveComposerDraftKey(
  state: ComposerSessionLookupState,
  target: ComposerSessionTarget,
): string | null {
  const normalizedTarget = normalizeComposerTarget(state, target);
  if (!normalizedTarget) {
    return null;
  }
  if (typeof normalizedTarget !== "string") {
    const scopedKey = composerTargetKey(normalizedTarget);
    if (state.draftsBySessionKey[scopedKey]) {
      return scopedKey;
    }
    for (const [draftId, draftSession] of Object.entries(state.draftSessionsBySessionKey)) {
      if (
        draftSession.environmentId === normalizedTarget.environmentId &&
        draftSession.sessionId === normalizedTarget.sessionId
      ) {
        return draftId;
      }
    }
    return scopedKey;
  }
  const sessionKey = composerTargetKey(normalizedTarget);
  return sessionKey.length > 0 ? sessionKey : null;
}

function resolveComposerSessionId(
  state: ComposerSessionLookupState,
  target: ComposerSessionTarget,
): SessionId | null {
  const normalizedTarget = normalizeComposerTarget(state, target);
  if (!normalizedTarget) {
    return null;
  }
  if (typeof normalizedTarget !== "string") {
    return normalizedTarget.sessionId;
  }
  return state.draftSessionsBySessionKey[normalizedTarget]?.sessionId ?? null;
}

function getComposerDraftState(
  state: Pick<ComposerDraftStoreState, "draftsBySessionKey" | "draftSessionsBySessionKey">,
  target: ComposerSessionTarget,
): ComposerSessionDraftState | null {
  const sessionKey = resolveComposerDraftKey(state, target);
  if (!sessionKey) {
    return null;
  }
  return state.draftsBySessionKey[sessionKey] ?? null;
}

function isComposerSessionKeyInUse(mappings: Record<string, string>, sessionKey: string): boolean {
  return Object.values(mappings).includes(sessionKey);
}

function toProjectDraftSession(
  draftId: DraftId,
  draftSession: DraftSessionState,
): ProjectDraftSession {
  return {
    draftId,
    ...draftSession,
  };
}

function createDraftSessionState(
  projectRef: ScopedProjectRef,
  sessionId: SessionId,
  logicalProjectKey: string,
  existingSession: DraftSessionState | undefined,
  options?: {
    sessionId?: SessionId;
    branch?: string | null;
    worktreePath?: string | null;
    createdAt?: string;
    envMode?: DraftSessionEnvMode;
    runtimeMode?: RuntimeMode;
    interactionMode?: ProviderInteractionMode;
    workflowId?: string | null;
    workflowVersion?: string | null;
  },
): DraftSessionState {
  const projectChanged =
    existingSession !== undefined &&
    (existingSession.environmentId !== projectRef.environmentId ||
      existingSession.projectId !== projectRef.projectId);
  const nextWorktreePath =
    options?.worktreePath === undefined
      ? projectChanged
        ? null
        : (existingSession?.worktreePath ?? null)
      : (options.worktreePath ?? null);
  const nextBranch =
    options?.branch === undefined
      ? projectChanged
        ? null
        : (existingSession?.branch ?? null)
      : (options.branch ?? null);
  return {
    sessionId,
    environmentId: projectRef.environmentId,
    projectId: projectRef.projectId,
    logicalProjectKey,
    createdAt: options?.createdAt ?? existingSession?.createdAt ?? new Date().toISOString(),
    runtimeMode: options?.runtimeMode ?? existingSession?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode:
      options?.interactionMode ?? existingSession?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    workflowId:
      options?.workflowId === undefined
        ? (existingSession?.workflowId ?? null)
        : options.workflowId,
    workflowVersion:
      options?.workflowVersion === undefined
        ? (existingSession?.workflowVersion ?? null)
        : options.workflowVersion,
    branch: nextBranch,
    worktreePath: nextWorktreePath,
    envMode:
      options?.envMode ??
      (nextWorktreePath
        ? "worktree"
        : projectChanged
          ? "local"
          : (existingSession?.envMode ?? "local")),
    promotedTo: null,
  };
}

function scopedSessionRefsEqual(
  left: ScopedSessionRef | null | undefined,
  right: ScopedSessionRef | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.environmentId === right.environmentId && left.sessionId === right.sessionId;
}

function isDraftSessionPromoting(draftSession: DraftSessionState | null | undefined): boolean {
  return draftSession?.promotedTo !== null && draftSession?.promotedTo !== undefined;
}

function draftSessionsEqual(
  left: DraftSessionState | undefined,
  right: DraftSessionState,
): boolean {
  return (
    !!left &&
    left.sessionId === right.sessionId &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId &&
    left.logicalProjectKey === right.logicalProjectKey &&
    left.createdAt === right.createdAt &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.workflowId === right.workflowId &&
    left.workflowVersion === right.workflowVersion &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.envMode === right.envMode &&
    scopedSessionRefsEqual(left.promotedTo, right.promotedTo)
  );
}

function removeDraftSessionReferences(
  state: Pick<
    ComposerDraftStoreState,
    | "draftSessionsBySessionKey"
    | "draftsBySessionKey"
    | "logicalProjectDraftSessionKeyByLogicalProjectKey"
  >,
  sessionKey: string,
): Pick<
  ComposerDraftStoreState,
  | "draftSessionsBySessionKey"
  | "draftsBySessionKey"
  | "logicalProjectDraftSessionKeyByLogicalProjectKey"
> {
  const nextLogicalMappings = Object.fromEntries(
    Object.entries(state.logicalProjectDraftSessionKeyByLogicalProjectKey).filter(
      ([, draftSessionKey]) => draftSessionKey !== sessionKey,
    ),
  ) as Record<string, string>;
  const { [sessionKey]: _removedDraftSession, ...restDraftSessionsBySessionKey } =
    state.draftSessionsBySessionKey;
  const { [sessionKey]: removedComposerDraft, ...restDraftsBySessionKey } =
    state.draftsBySessionKey;
  revokeDraftSessionPreviewUrls(removedComposerDraft);
  return {
    draftsBySessionKey: restDraftsBySessionKey,
    draftSessionsBySessionKey: restDraftSessionsBySessionKey,
    logicalProjectDraftSessionKeyByLogicalProjectKey: nextLogicalMappings,
  };
}

function normalizePersistedDraftSessions(
  rawDraftSessionsBySessionId: unknown,
  rawProjectDraftSessionIdByProjectKey: unknown,
): Pick<
  PersistedComposerDraftStoreState,
  "draftSessionsBySessionKey" | "logicalProjectDraftSessionKeyByLogicalProjectKey"
> {
  const draftSessionsBySessionKey: Record<string, PersistedDraftSessionState> = {};
  const environmentIdBySessionId = new Map<SessionId, EnvironmentId>();
  if (
    rawProjectDraftSessionIdByProjectKey &&
    typeof rawProjectDraftSessionIdByProjectKey === "object"
  ) {
    for (const [projectKey, sessionId] of Object.entries(
      rawProjectDraftSessionIdByProjectKey as Record<string, unknown>,
    )) {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        continue;
      }
      const projectRef = parseScopedProjectKey(projectKey);
      if (!projectRef) {
        continue;
      }
      const parsedSessionRef = parseScopedSessionKey(sessionId);
      if (parsedSessionRef) {
        environmentIdBySessionId.set(parsedSessionRef.sessionId, parsedSessionRef.environmentId);
        continue;
      }
      environmentIdBySessionId.set(sessionId as SessionId, projectRef.environmentId);
    }
  }
  if (rawDraftSessionsBySessionId && typeof rawDraftSessionsBySessionId === "object") {
    for (const [sessionKeyOrId, rawDraftSession] of Object.entries(
      rawDraftSessionsBySessionId as Record<string, unknown>,
    )) {
      if (typeof sessionKeyOrId !== "string" || sessionKeyOrId.length === 0) {
        continue;
      }
      if (!rawDraftSession || typeof rawDraftSession !== "object") {
        continue;
      }
      const candidateDraftSession = rawDraftSession as Record<string, unknown>;
      const parsedSessionRef = parseScopedSessionKey(sessionKeyOrId);
      const sessionKey = normalizeLegacyComposerStorageKey(sessionKeyOrId);
      const sessionId =
        parsedSessionRef?.sessionId ??
        (typeof candidateDraftSession.sessionId === "string" &&
        candidateDraftSession.sessionId.length > 0
          ? (candidateDraftSession.sessionId as SessionId)
          : (sessionKeyOrId as SessionId));
      const environmentId =
        parsedSessionRef?.environmentId ??
        (typeof candidateDraftSession.environmentId === "string" &&
        candidateDraftSession.environmentId.length > 0
          ? (candidateDraftSession.environmentId as EnvironmentId)
          : environmentIdBySessionId.get(sessionKeyOrId as SessionId));
      const projectId = candidateDraftSession.projectId;
      const createdAt = candidateDraftSession.createdAt;
      const branch = candidateDraftSession.branch;
      const worktreePath = candidateDraftSession.worktreePath;
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;
      const promotedToCandidate = candidateDraftSession.promotedTo;
      const promotedToRecord =
        promotedToCandidate && typeof promotedToCandidate === "object"
          ? (promotedToCandidate as Record<string, unknown>)
          : null;
      const promotedTo =
        promotedToRecord &&
        typeof promotedToRecord.environmentId === "string" &&
        promotedToRecord.environmentId.length > 0 &&
        typeof promotedToRecord.sessionId === "string" &&
        promotedToRecord.sessionId.length > 0
          ? scopeSessionRef(
              promotedToRecord.environmentId as EnvironmentId,
              promotedToRecord.sessionId as SessionId,
            )
          : null;
      if (typeof projectId !== "string" || projectId.length === 0 || environmentId === undefined) {
        continue;
      }
      const normalizedEnvironmentId = environmentId as EnvironmentId;
      draftSessionsBySessionKey[sessionKey] = {
        sessionId,
        environmentId: normalizedEnvironmentId,
        projectId: projectId as ProjectId,
        logicalProjectKey:
          typeof candidateDraftSession.logicalProjectKey === "string" &&
          candidateDraftSession.logicalProjectKey.length > 0
            ? candidateDraftSession.logicalProjectKey
            : parsedSessionRef
              ? projectDraftKey(scopeProjectRef(normalizedEnvironmentId, projectId as ProjectId))
              : sessionKeyOrId,
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        runtimeMode: isRuntimeMode(candidateDraftSession.runtimeMode)
          ? candidateDraftSession.runtimeMode
          : DEFAULT_RUNTIME_MODE,
        interactionMode:
          candidateDraftSession.interactionMode === "plan" ||
          candidateDraftSession.interactionMode === "default"
            ? candidateDraftSession.interactionMode
            : DEFAULT_INTERACTION_MODE,
        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        envMode: normalizeDraftSessionEnvMode(
          candidateDraftSession.envMode,
          normalizedWorktreePath,
        ),
        promotedTo,
      };
    }
  }

  const logicalProjectDraftSessionKeyByLogicalProjectKey: Record<string, string> = {};
  if (
    rawProjectDraftSessionIdByProjectKey &&
    typeof rawProjectDraftSessionIdByProjectKey === "object"
  ) {
    for (const [logicalProjectKey, sessionKeyOrId] of Object.entries(
      rawProjectDraftSessionIdByProjectKey as Record<string, unknown>,
    )) {
      if (typeof sessionKeyOrId !== "string" || sessionKeyOrId.length === 0) {
        continue;
      }
      const projectRef = parseScopedProjectKey(logicalProjectKey);
      const parsedSessionRef = parseScopedSessionKey(sessionKeyOrId);
      const sessionKey = normalizeLegacyComposerStorageKey(sessionKeyOrId);
      logicalProjectDraftSessionKeyByLogicalProjectKey[logicalProjectKey] = sessionKey;
      if (parsedSessionRef) {
        environmentIdBySessionId.set(parsedSessionRef.sessionId, parsedSessionRef.environmentId);
      }
      if (!projectRef) {
        const existingDraftSession = draftSessionsBySessionKey[sessionKey];
        if (existingDraftSession && !existingDraftSession.logicalProjectKey) {
          draftSessionsBySessionKey[sessionKey] = {
            ...existingDraftSession,
            logicalProjectKey,
          };
        }
        continue;
      }
      if (!draftSessionsBySessionKey[sessionKey]) {
        draftSessionsBySessionKey[sessionKey] = {
          sessionId: parsedSessionRef?.sessionId ?? (sessionKey as SessionId),
          environmentId: projectRef.environmentId,
          projectId: projectRef.projectId,
          logicalProjectKey,
          createdAt: new Date().toISOString(),
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          envMode: "local",
          promotedTo: null,
        };
      } else if (
        draftSessionsBySessionKey[sessionKey]?.projectId !== projectRef.projectId ||
        draftSessionsBySessionKey[sessionKey]?.environmentId !== projectRef.environmentId
      ) {
        draftSessionsBySessionKey[sessionKey] = {
          ...draftSessionsBySessionKey[sessionKey]!,
          sessionId: draftSessionsBySessionKey[sessionKey]!.sessionId,
          environmentId: projectRef.environmentId,
          projectId: projectRef.projectId,
          logicalProjectKey,
        };
      }
    }
  }

  return { draftSessionsBySessionKey, logicalProjectDraftSessionKeyByLogicalProjectKey };
}

function normalizePersistedDraftsBySessionId(
  rawDraftMap: unknown,
  draftSessionsBySessionKey: PersistedComposerDraftStoreState["draftSessionsBySessionKey"],
): PersistedComposerDraftStoreState["draftsBySessionKey"] {
  if (!rawDraftMap || typeof rawDraftMap !== "object") {
    return {};
  }

  const environmentIdBySessionId = new Map<SessionId, EnvironmentId>();
  for (const [sessionKey, draftSession] of Object.entries(draftSessionsBySessionKey)) {
    const parsedSessionRef = composerSessionRefFromKey(sessionKey);
    if (!parsedSessionRef) {
      continue;
    }
    environmentIdBySessionId.set(
      parsedSessionRef.sessionId,
      draftSession.environmentId as EnvironmentId,
    );
  }

  const nextDraftsBySessionKey: DeepMutable<
    PersistedComposerDraftStoreState["draftsBySessionKey"]
  > = {};
  for (const [sessionKeyOrId, draftValue] of Object.entries(
    rawDraftMap as Record<string, unknown>,
  )) {
    if (typeof sessionKeyOrId !== "string" || sessionKeyOrId.length === 0) {
      continue;
    }
    if (!draftValue || typeof draftValue !== "object") {
      continue;
    }
    const draftCandidate = draftValue as PersistedComposerSessionDraftState;
    const promptCandidate = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    const attachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizePersistedAttachment(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
      ? draftCandidate.terminalContexts.flatMap((entry) => {
          const normalized = normalizePersistedTerminalContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const runtimeMode = isRuntimeMode(draftCandidate.runtimeMode)
      ? draftCandidate.runtimeMode
      : null;
    const interactionMode =
      draftCandidate.interactionMode === "plan" || draftCandidate.interactionMode === "default"
        ? draftCandidate.interactionMode
        : null;
    const prompt = ensureInlineTerminalContextPlaceholders(
      promptCandidate,
      terminalContexts.length,
    );
    // If the draft already has the v3 shape, use it directly
    const legacyDraftCandidate = draftValue as LegacyPersistedComposerSessionDraftState;
    let modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>> = {};
    let activeProvider: ProviderInstanceId | null = null;

    if (
      draftCandidate.modelSelectionByProvider &&
      typeof draftCandidate.modelSelectionByProvider === "object"
    ) {
      // v3 format
      modelSelectionByProvider = draftCandidate.modelSelectionByProvider as Partial<
        Record<ProviderInstanceId, ModelSelection>
      >;
      activeProvider = normalizeProviderInstanceId(draftCandidate.activeProvider);
    } else {
      // v2 or legacy format: migrate
      const normalizedModelOptions =
        normalizeProviderModelOptions(
          legacyDraftCandidate.modelOptions,
          undefined,
          legacyDraftCandidate,
        ) ?? null;
      const normalizedModelSelection = normalizeModelSelection(
        legacyDraftCandidate.modelSelection,
        {
          provider: legacyDraftCandidate.provider,
          model: legacyDraftCandidate.model,
          modelOptions: normalizedModelOptions ?? (legacyDraftCandidate.modelOptions as unknown),
          legacyCodex: legacyDraftCandidate,
        },
      );
      const mergedModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
        normalizedModelSelection,
        normalizedModelOptions,
      );
      const modelSelection = legacySyncModelSelectionOptions(
        normalizedModelSelection,
        mergedModelOptions,
      );
      modelSelectionByProvider = legacyToModelSelectionByProvider(
        modelSelection,
        mergedModelOptions,
      );
      activeProvider = modelSelection?.instanceId ?? null;
    }

    const hasModelData =
      Object.keys(modelSelectionByProvider).length > 0 || activeProvider !== null;
    if (
      promptCandidate.length === 0 &&
      attachments.length === 0 &&
      terminalContexts.length === 0 &&
      !hasModelData &&
      !runtimeMode &&
      !interactionMode
    ) {
      continue;
    }
    const parsedSessionRef = parseScopedSessionKey(sessionKeyOrId);
    const normalizedSessionKey =
      parsedSessionRef !== null
        ? normalizeLegacyComposerStorageKey(sessionKeyOrId)
        : draftSessionsBySessionKey[sessionKeyOrId] !== undefined
          ? sessionKeyOrId
          : (() => {
              const environmentId = environmentIdBySessionId.get(sessionKeyOrId as SessionId);
              return environmentId
                ? normalizeLegacyComposerStorageKey(sessionKeyOrId, { environmentId })
                : sessionKeyOrId;
            })();
    nextDraftsBySessionKey[normalizedSessionKey] = {
      prompt,
      attachments,
      ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: compactModelSelectionByProvider(modelSelectionByProvider),
            activeProvider,
          }
        : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(interactionMode ? { interactionMode } : {}),
    };
  }

  return nextDraftsBySessionKey;
}

function migratePersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const candidate = persistedState as LegacyPersistedComposerDraftStoreState;
  const rawDraftMap = candidate.draftsBySessionKey ?? candidate.draftsBySessionId;
  const rawDraftSessionsBySessionId =
    candidate.draftSessionsBySessionKey ?? candidate.draftSessionsBySessionId;
  const rawProjectDraftSessionIdByProjectKey =
    candidate.logicalProjectDraftSessionKeyByLogicalProjectKey ??
    candidate.projectDraftSessionKeyByProjectKey ??
    candidate.projectDraftSessionIdByProjectKey ??
    candidate.projectDraftSessionIdByProjectId;

  // Migrate sticky state from v2 (dual) to v3 (consolidated)
  const stickyModelOptions = normalizeProviderModelOptions(candidate.stickyModelOptions) ?? {};
  const normalizedStickyModelSelection = normalizeModelSelection(candidate.stickyModelSelection, {
    provider: candidate.stickyProvider ?? "codex",
    model: candidate.stickyModel,
    modelOptions: stickyModelOptions,
  });
  const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
    normalizedStickyModelSelection,
    stickyModelOptions,
  );
  const stickyModelSelection = legacySyncModelSelectionOptions(
    normalizedStickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
    stickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyActiveProvider = normalizeProviderInstanceId(candidate.stickyProvider) ?? null;

  const { draftSessionsBySessionKey, logicalProjectDraftSessionKeyByLogicalProjectKey } =
    normalizePersistedDraftSessions(
      rawDraftSessionsBySessionId,
      rawProjectDraftSessionIdByProjectKey,
    );
  const draftsBySessionKey = normalizePersistedDraftsBySessionId(
    rawDraftMap,
    draftSessionsBySessionKey,
  );
  return {
    draftsBySessionKey,
    draftSessionsBySessionKey,
    logicalProjectDraftSessionKeyByLogicalProjectKey,
    stickyModelSelectionByProvider: compactModelSelectionByProvider(stickyModelSelectionByProvider),
    stickyActiveProvider,
  };
}

function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState,
): PersistedComposerDraftStoreState {
  const persistedDraftsBySessionKey: DeepMutable<
    PersistedComposerDraftStoreState["draftsBySessionKey"]
  > = {};
  for (const [sessionKey, draft] of Object.entries(state.draftsBySessionKey)) {
    if (typeof sessionKey !== "string" || sessionKey.length === 0) {
      continue;
    }
    const hasModelData =
      Object.keys(draft.modelSelectionByProvider).length > 0 || draft.activeProvider !== null;
    if (
      draft.prompt.length === 0 &&
      draft.persistedAttachments.length === 0 &&
      draft.terminalContexts.length === 0 &&
      !hasModelData &&
      draft.runtimeMode === null &&
      draft.interactionMode === null
    ) {
      continue;
    }
    const persistedDraft: DeepMutable<PersistedComposerSessionDraftState> = {
      prompt: draft.prompt,
      attachments: draft.persistedAttachments,
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((context) => ({
              id: context.id,
              sessionId: context.sessionId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: compactModelSelectionByProvider(
              draft.modelSelectionByProvider,
            ),
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
    };
    persistedDraftsBySessionKey[sessionKey] = persistedDraft;
  }
  return {
    draftsBySessionKey: persistedDraftsBySessionKey,
    draftSessionsBySessionKey: state.draftSessionsBySessionKey,
    logicalProjectDraftSessionKeyByLogicalProjectKey:
      state.logicalProjectDraftSessionKeyByLogicalProjectKey,
    stickyModelSelectionByProvider: compactModelSelectionByProvider(
      state.stickyModelSelectionByProvider,
    ),
    stickyActiveProvider: state.stickyActiveProvider,
  };
}

function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const normalizedPersistedState = persistedState as LegacyPersistedComposerDraftStoreState;
  const { draftSessionsBySessionKey, logicalProjectDraftSessionKeyByLogicalProjectKey } =
    normalizePersistedDraftSessions(
      normalizedPersistedState.draftSessionsBySessionKey ??
        normalizedPersistedState.draftSessionsBySessionId,
      normalizedPersistedState.logicalProjectDraftSessionKeyByLogicalProjectKey ??
        normalizedPersistedState.projectDraftSessionKeyByProjectKey ??
        normalizedPersistedState.projectDraftSessionIdByProjectKey ??
        normalizedPersistedState.projectDraftSessionIdByProjectId,
    );

  // Handle both v3 (modelSelectionByProvider) and v2/legacy formats
  let stickyModelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>> = {};
  let stickyActiveProvider: ProviderInstanceId | null = null;
  if (
    normalizedPersistedState.stickyModelSelectionByProvider &&
    typeof normalizedPersistedState.stickyModelSelectionByProvider === "object"
  ) {
    stickyModelSelectionByProvider =
      normalizedPersistedState.stickyModelSelectionByProvider as Partial<
        Record<ProviderInstanceId, ModelSelection>
      >;
    stickyActiveProvider = normalizeProviderInstanceId(
      normalizedPersistedState.stickyActiveProvider,
    );
  } else {
    // Legacy migration path
    const stickyModelOptions =
      normalizeProviderModelOptions(normalizedPersistedState.stickyModelOptions) ?? {};
    const normalizedStickyModelSelection = normalizeModelSelection(
      normalizedPersistedState.stickyModelSelection,
      {
        provider: normalizedPersistedState.stickyProvider,
        model: normalizedPersistedState.stickyModel,
        modelOptions: stickyModelOptions,
      },
    );
    const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
      normalizedStickyModelSelection,
      stickyModelOptions,
    );
    const stickyModelSelection = legacySyncModelSelectionOptions(
      normalizedStickyModelSelection,
      nextStickyModelOptions,
    );
    stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
      stickyModelSelection,
      nextStickyModelOptions,
    );
    stickyActiveProvider = normalizeProviderInstanceId(normalizedPersistedState.stickyProvider);
  }

  return {
    draftsBySessionKey: normalizePersistedDraftsBySessionId(
      normalizedPersistedState.draftsBySessionKey ?? normalizedPersistedState.draftsBySessionId,
      draftSessionsBySessionKey,
    ),
    draftSessionsBySessionKey,
    logicalProjectDraftSessionKeyByLogicalProjectKey,
    stickyModelSelectionByProvider: compactModelSelectionByProvider(stickyModelSelectionByProvider),
    stickyActiveProvider,
  };
}

function readPersistedAttachmentIdsFromStorage(sessionKey: string): string[] {
  if (sessionKey.length === 0) {
    return [];
  }
  try {
    const persisted = getLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      PersistedComposerDraftStoreStorage,
    );
    if (!persisted || persisted.version !== COMPOSER_DRAFT_STORAGE_VERSION) {
      return [];
    }
    return (persisted.state.draftsBySessionKey[sessionKey]?.attachments ?? []).map(
      (attachment) => attachment.id,
    );
  } catch {
    return [];
  }
}

function verifyPersistedAttachments(
  sessionKey: string,
  attachments: PersistedComposerImageAttachment[],
  set: (
    partial:
      | ComposerDraftStoreState
      | Partial<ComposerDraftStoreState>
      | ((
          state: ComposerDraftStoreState,
        ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
    replace?: false,
  ) => void,
): void {
  let persistedIdSet = new Set<string>();
  try {
    composerDebouncedStorage.flush();
    persistedIdSet = new Set(readPersistedAttachmentIdsFromStorage(sessionKey));
  } catch {
    persistedIdSet = new Set();
  }
  set((state) => {
    const current = state.draftsBySessionKey[sessionKey];
    if (!current) {
      return state;
    }
    const imageIdSet = new Set(current.images.map((image) => image.id));
    const persistedAttachments = attachments.filter(
      (attachment) => imageIdSet.has(attachment.id) && persistedIdSet.has(attachment.id),
    );
    const nonPersistedImageIds: string[] = [];
    for (const image of current.images) {
      if (!persistedIdSet.has(image.id)) {
        nonPersistedImageIds.push(image.id);
      }
    }
    const nextDraft: ComposerSessionDraftState = {
      ...current,
      persistedAttachments,
      nonPersistedImageIds,
    };
    const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
    if (shouldRemoveDraft(nextDraft)) {
      delete nextDraftsBySessionKey[sessionKey];
    } else {
      nextDraftsBySessionKey[sessionKey] = nextDraft;
    }
    return { draftsBySessionKey: nextDraftsBySessionKey };
  });
}

function hydratePersistedComposerImageAttachment(
  attachment: PersistedComposerImageAttachment,
): File | null {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex);
  const payload = commaIndex === -1 ? "" : attachment.dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    return null;
  }
  try {
    const isBase64 = header.includes(";base64");
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload);
      const inferredMimeType =
        header.startsWith("data:") && header.includes(";")
          ? header.slice("data:".length, header.indexOf(";"))
          : attachment.mimeType;
      return new File([decodedText], attachment.name, {
        type: inferredMimeType || attachment.mimeType,
      });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], attachment.name, { type: attachment.mimeType });
  } catch {
    return null;
  }
}

function hydrateImagesFromPersisted(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): ComposerImageAttachment[] {
  return attachments.flatMap((attachment) => {
    const file = hydratePersistedComposerImageAttachment(attachment);
    if (!file) return [];

    return [
      {
        type: "image" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: attachment.dataUrl,
        file,
      } satisfies ComposerImageAttachment,
    ];
  });
}

function toHydratedSessionDraft(
  persistedDraft: PersistedComposerSessionDraftState,
): ComposerSessionDraftState {
  // The persisted draft is already in v3 shape (migration handles older formats)
  const modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>> =
    persistedDraft.modelSelectionByProvider ?? {};
  const activeProvider = normalizeProviderInstanceId(persistedDraft.activeProvider) ?? null;

  return {
    prompt: persistedDraft.prompt,
    images: hydrateImagesFromPersisted(persistedDraft.attachments),
    nonPersistedImageIds: [],
    persistedAttachments: [...persistedDraft.attachments],
    terminalContexts:
      persistedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    modelSelectionByProvider,
    activeProvider,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
  };
}

function toHydratedDraftSessionState(
  persistedDraftSession: PersistedDraftSessionState,
): DraftSessionState {
  return {
    sessionId: persistedDraftSession.sessionId,
    environmentId: persistedDraftSession.environmentId as EnvironmentId,
    projectId: persistedDraftSession.projectId,
    logicalProjectKey:
      persistedDraftSession.logicalProjectKey ??
      projectDraftKey(
        scopeProjectRef(
          persistedDraftSession.environmentId as EnvironmentId,
          persistedDraftSession.projectId,
        ),
      ),
    createdAt: persistedDraftSession.createdAt,
    runtimeMode: persistedDraftSession.runtimeMode,
    interactionMode: persistedDraftSession.interactionMode,
    workflowId: persistedDraftSession.workflowId ?? null,
    workflowVersion: persistedDraftSession.workflowVersion ?? null,
    branch: persistedDraftSession.branch,
    worktreePath: persistedDraftSession.worktreePath,
    envMode: persistedDraftSession.envMode,
    promotedTo: persistedDraftSession.promotedTo
      ? scopeSessionRef(
          persistedDraftSession.promotedTo.environmentId as EnvironmentId,
          persistedDraftSession.promotedTo.sessionId as SessionId,
        )
      : null,
  };
}

const composerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (setBase, get) => {
      const set = setBase;

      return {
        draftsBySessionKey: {},
        draftSessionsBySessionKey: {},
        logicalProjectDraftSessionKeyByLogicalProjectKey: {},
        stickyModelSelectionByProvider: {},
        stickyActiveProvider: null,
        getComposerDraft: (target) => getComposerDraftState(get(), target),
        getDraftSessionByLogicalProjectKey: (logicalProjectKey) => {
          const normalizedLogicalProjectKey = logicalProjectDraftKey(logicalProjectKey);
          if (normalizedLogicalProjectKey.length === 0) {
            return null;
          }
          const draftId =
            get().logicalProjectDraftSessionKeyByLogicalProjectKey[normalizedLogicalProjectKey];
          if (!draftId) {
            return null;
          }
          const draftSession = get().draftSessionsBySessionKey[draftId];
          if (!draftSession || isDraftSessionPromoting(draftSession)) {
            return null;
          }
          return toProjectDraftSession(DraftId.make(draftId), draftSession);
        },
        getDraftSessionByProjectRef: (projectRef) => {
          for (const [draftId, draftSession] of Object.entries(get().draftSessionsBySessionKey)) {
            if (isDraftSessionPromoting(draftSession)) {
              continue;
            }
            if (
              draftSession.projectId === projectRef.projectId &&
              draftSession.environmentId === projectRef.environmentId
            ) {
              return toProjectDraftSession(DraftId.make(draftId), draftSession);
            }
          }
          return null;
        },
        getDraftSessionByRef: (sessionRef) => {
          for (const draftSession of Object.values(get().draftSessionsBySessionKey)) {
            if (
              draftSession.environmentId === sessionRef.environmentId &&
              draftSession.sessionId === sessionRef.sessionId
            ) {
              return draftSession;
            }
          }
          return null;
        },
        getDraftSession: (sessionRef) => {
          if (typeof sessionRef === "string") {
            return get().draftSessionsBySessionKey[sessionRef] ?? null;
          }
          return get().getDraftSessionByRef(sessionRef);
        },
        listDraftSessionKeys: () =>
          Object.values(get().draftSessionsBySessionKey).map((draftSession) =>
            scopedSessionKey(scopeSessionRef(draftSession.environmentId, draftSession.sessionId)),
          ),
        hasDraftSessionsInEnvironment: (environmentId) =>
          Object.values(get().draftSessionsBySessionKey).some(
            (draftSession) => draftSession.environmentId === environmentId,
          ),
        setLogicalProjectDraftSessionId: (logicalProjectKey, projectRef, draftId, options) => {
          const normalizedLogicalProjectKey = logicalProjectDraftKey(logicalProjectKey);
          if (normalizedLogicalProjectKey.length === 0 || draftId.length === 0) {
            return;
          }
          set((state) => {
            const existingSession = state.draftSessionsBySessionKey[draftId];
            const previousSessionKeyForLogicalProject =
              state.logicalProjectDraftSessionKeyByLogicalProjectKey[normalizedLogicalProjectKey];
            const nextDraftSession = createDraftSessionState(
              projectRef,
              options?.sessionId ?? existingSession?.sessionId ?? SessionId.make(draftId),
              normalizedLogicalProjectKey,
              existingSession,
              options,
            );
            const hasSameLogicalMapping = previousSessionKeyForLogicalProject === draftId;
            if (hasSameLogicalMapping && draftSessionsEqual(existingSession, nextDraftSession)) {
              return state;
            }
            const nextLogicalProjectDraftSessionKeyByLogicalProjectKey: Record<string, string> = {
              ...state.logicalProjectDraftSessionKeyByLogicalProjectKey,
              [normalizedLogicalProjectKey]: draftId,
            };
            const nextDraftSessionsBySessionKey: Record<string, DraftSessionState> = {
              ...state.draftSessionsBySessionKey,
              [draftId]: nextDraftSession,
            };
            let nextDraftsBySessionKey = state.draftsBySessionKey;
            const previousDraftSession =
              previousSessionKeyForLogicalProject === undefined
                ? undefined
                : nextDraftSessionsBySessionKey[previousSessionKeyForLogicalProject];
            if (
              previousSessionKeyForLogicalProject &&
              previousSessionKeyForLogicalProject !== draftId &&
              !isComposerSessionKeyInUse(
                nextLogicalProjectDraftSessionKeyByLogicalProjectKey,
                previousSessionKeyForLogicalProject,
              ) &&
              !isDraftSessionPromoting(previousDraftSession)
            ) {
              delete nextDraftSessionsBySessionKey[previousSessionKeyForLogicalProject];
              if (state.draftsBySessionKey[previousSessionKeyForLogicalProject] !== undefined) {
                nextDraftsBySessionKey = { ...state.draftsBySessionKey };
                delete nextDraftsBySessionKey[previousSessionKeyForLogicalProject];
              }
            }
            return {
              draftsBySessionKey: nextDraftsBySessionKey,
              draftSessionsBySessionKey: nextDraftSessionsBySessionKey,
              logicalProjectDraftSessionKeyByLogicalProjectKey:
                nextLogicalProjectDraftSessionKeyByLogicalProjectKey,
            };
          });
        },
        setProjectDraftSessionId: (projectRef, draftId, options) => {
          get().setLogicalProjectDraftSessionId(
            projectDraftKey(projectRef),
            projectRef,
            draftId,
            options,
          );
        },
        setDraftSessionContext: (sessionRef, options) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftSessionsBySessionKey[sessionKey];
            if (!existing) {
              return state;
            }
            const nextProjectRef = options.projectRef ?? {
              environmentId: existing.environmentId,
              projectId: existing.projectId,
            };
            if (
              nextProjectRef.projectId.length === 0 ||
              nextProjectRef.environmentId.length === 0
            ) {
              return state;
            }
            const projectChanged =
              nextProjectRef.environmentId !== existing.environmentId ||
              nextProjectRef.projectId !== existing.projectId;
            const nextWorktreePath =
              options.worktreePath === undefined
                ? projectChanged
                  ? null
                  : existing.worktreePath
                : (options.worktreePath ?? null);
            const nextBranch =
              options.branch === undefined
                ? projectChanged
                  ? null
                  : existing.branch
                : (options.branch ?? null);
            const nextDraftSession: DraftSessionState = {
              sessionId: existing.sessionId,
              environmentId: nextProjectRef.environmentId,
              projectId: nextProjectRef.projectId,
              logicalProjectKey: existing.logicalProjectKey,
              createdAt:
                options.createdAt === undefined
                  ? existing.createdAt
                  : options.createdAt || existing.createdAt,
              runtimeMode: options.runtimeMode ?? existing.runtimeMode,
              interactionMode: options.interactionMode ?? existing.interactionMode,
              workflowId:
                options.workflowId === undefined
                  ? (existing.workflowId ?? null)
                  : options.workflowId,
              workflowVersion:
                options.workflowVersion === undefined
                  ? (existing.workflowVersion ?? null)
                  : options.workflowVersion,
              branch: nextBranch,
              worktreePath: nextWorktreePath,
              envMode:
                options.envMode ??
                (nextWorktreePath
                  ? "worktree"
                  : projectChanged
                    ? "local"
                    : (existing.envMode ?? "local")),
              promotedTo: existing.promotedTo ?? null,
            };
            const isUnchanged =
              nextDraftSession.environmentId === existing.environmentId &&
              nextDraftSession.projectId === existing.projectId &&
              nextDraftSession.logicalProjectKey === existing.logicalProjectKey &&
              nextDraftSession.createdAt === existing.createdAt &&
              nextDraftSession.runtimeMode === existing.runtimeMode &&
              nextDraftSession.interactionMode === existing.interactionMode &&
              nextDraftSession.workflowId === existing.workflowId &&
              nextDraftSession.workflowVersion === existing.workflowVersion &&
              nextDraftSession.branch === existing.branch &&
              nextDraftSession.worktreePath === existing.worktreePath &&
              nextDraftSession.envMode === existing.envMode &&
              scopedSessionRefsEqual(nextDraftSession.promotedTo, existing.promotedTo);
            if (isUnchanged) {
              return state;
            }
            return {
              draftSessionsBySessionKey: {
                ...state.draftSessionsBySessionKey,
                [sessionKey]: nextDraftSession,
              },
            };
          });
        },
        clearProjectDraftSessionId: (projectRef) => {
          set((state) => {
            const matchingSessionEntry = Object.entries(state.draftSessionsBySessionKey).find(
              ([, draftSession]) =>
                draftSession.projectId === projectRef.projectId &&
                draftSession.environmentId === projectRef.environmentId,
            );
            if (!matchingSessionEntry) {
              return state;
            }
            return removeDraftSessionReferences(state, matchingSessionEntry[0]);
          });
        },
        clearProjectDraftSessionById: (projectRef, sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const draftSession = state.draftSessionsBySessionKey[sessionKey];
            if (
              !draftSession ||
              draftSession.projectId !== projectRef.projectId ||
              draftSession.environmentId !== projectRef.environmentId
            ) {
              return state;
            }
            return removeDraftSessionReferences(state, sessionKey);
          });
        },
        markDraftSessionPromoting: (sessionRef, promotedTo) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          if (!sessionKey) {
            return;
          }
          set((state) => {
            const existing = state.draftSessionsBySessionKey[sessionKey];
            if (!existing) {
              return state;
            }
            const nextPromotedTo =
              promotedTo ?? scopeSessionRef(existing.environmentId, existing.sessionId);
            if (scopedSessionRefsEqual(existing.promotedTo, nextPromotedTo)) {
              return state;
            }
            return {
              draftSessionsBySessionKey: {
                ...state.draftSessionsBySessionKey,
                [sessionKey]: {
                  ...existing,
                  promotedTo: nextPromotedTo,
                },
              },
            };
          });
        },
        finalizePromotedDraftSession: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftSessionsBySessionKey[sessionKey];
            if (!isDraftSessionPromoting(existing)) {
              return state;
            }
            return removeDraftSessionReferences(state, sessionKey);
          });
        },
        clearDraftSession: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const hasDraftSession = state.draftSessionsBySessionKey[sessionKey] !== undefined;
            const hasLogicalProjectMapping = Object.values(
              state.logicalProjectDraftSessionKeyByLogicalProjectKey,
            ).includes(sessionKey);
            const hasComposerDraft = state.draftsBySessionKey[sessionKey] !== undefined;
            if (!hasDraftSession && !hasLogicalProjectMapping && !hasComposerDraft) {
              return state;
            }
            return removeDraftSessionReferences(state, sessionKey);
          });
        },
        setStickyModelSelection: (modelSelection) => {
          const normalized = normalizeModelSelection(modelSelection);
          set((state) => {
            if (!normalized) {
              return state;
            }
            const nextMap: Partial<Record<ProviderInstanceId, ModelSelection>> = {
              ...state.stickyModelSelectionByProvider,
              [normalized.instanceId]: normalized,
            };
            if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
              return state.stickyActiveProvider === normalized.instanceId
                ? state
                : { stickyActiveProvider: normalized.instanceId };
            }
            return {
              stickyModelSelectionByProvider: nextMap,
              stickyActiveProvider: normalized.instanceId,
            };
          });
        },
        applyStickyState: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const stickyMap = state.stickyModelSelectionByProvider;
            const stickyActiveProvider = state.stickyActiveProvider;
            if (Object.keys(stickyMap).length === 0 && stickyActiveProvider === null) {
              return state;
            }
            const existing = state.draftsBySessionKey[sessionKey];
            const base = existing ?? createEmptySessionDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            for (const [provider, selection] of Object.entries(stickyMap)) {
              if (selection) {
                // Iteration key comes from the instance-keyed sticky map,
                // so coerce the string back to `ProviderInstanceId` for
                // the typed lookup.
                const instanceKey = provider as ProviderInstanceId;
                const current = nextMap[instanceKey];
                nextMap[instanceKey] = {
                  ...selection,
                  model: current?.model ?? selection.model,
                };
              }
            }
            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              base.activeProvider === stickyActiveProvider
            ) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              activeProvider: stickyActiveProvider,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setPrompt: (sessionRef, prompt) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey] ?? createEmptySessionDraft();
            const nextDraft: ComposerSessionDraftState = {
              ...existing,
              prompt,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setTerminalContexts: (sessionRef, contexts) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          const sessionId = resolveComposerSessionId(get(), sessionRef);
          if (!sessionKey || !sessionId) {
            return;
          }
          const normalizedContexts = normalizeTerminalContextsForSession(sessionId, contexts);
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey] ?? createEmptySessionDraft();
            const nextDraft: ComposerSessionDraftState = {
              ...existing,
              prompt: ensureInlineTerminalContextPlaceholders(
                existing.prompt,
                normalizedContexts.length,
              ),
              terminalContexts: normalizedContexts,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setModelSelection: (sessionRef, modelSelection) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          const normalized = normalizeModelSelection(modelSelection);
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey];
            if (!existing && normalized === null) {
              return state;
            }
            const base = existing ?? createEmptySessionDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            if (normalized) {
              const current = nextMap[normalized.instanceId];
              if (normalized.options !== undefined) {
                // Explicit options provided → use them
                nextMap[normalized.instanceId] = normalized as ModelSelection;
              } else {
                // No options in selection → preserve existing options, update provider+model
                nextMap[normalized.instanceId] = createModelSelection(
                  normalized.instanceId,
                  normalized.model,
                  current?.options,
                );
              }
            }
            const nextActiveProvider = normalized?.instanceId ?? base.activeProvider;
            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              base.activeProvider === nextActiveProvider
            ) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              activeProvider: nextActiveProvider,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setModelOptions: (sessionRef, modelOptions) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey];
            if (!existing && (!modelOptions || Object.keys(modelOptions).length === 0)) {
              return state;
            }
            const base = existing ?? createEmptySessionDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            for (const provider of ["codex", "claudeAgent", "cursor", "opencode"] as const) {
              if (!modelOptions || !(provider in modelOptions)) continue;
              const opts = modelOptions[provider];
              const driverKind = ProviderDriverKind.make(provider);
              const instanceKey = defaultInstanceIdForDriver(driverKind);
              const current = nextMap[instanceKey];
              if (opts && opts.length > 0) {
                nextMap[instanceKey] = createModelSelection(
                  instanceKey,
                  current?.model ?? DEFAULT_MODEL_BY_PROVIDER[driverKind] ?? DEFAULT_MODEL,
                  opts,
                );
              } else if (current?.options) {
                const { options: _, ...rest } = current;
                nextMap[instanceKey] = rest as ModelSelection;
              }
            }
            if (Equal.equals(base.modelSelectionByProvider, nextMap)) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setProviderModelOptions: (sessionRef, provider, nextProviderOptions, options) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          const normalizedProvider = normalizeProviderDriverKind(provider);
          if (normalizedProvider === null) {
            return;
          }
          const instanceKey = options?.instanceId ?? defaultInstanceIdForDriver(normalizedProvider);
          const fallbackModel =
            normalizeModelSlug(options?.model, normalizedProvider) ??
            DEFAULT_MODEL_BY_PROVIDER[normalizedProvider] ??
            DEFAULT_MODEL;
          const providerOpts =
            nextProviderOptions && nextProviderOptions.length > 0 ? nextProviderOptions : undefined;

          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey];
            const base = existing ?? createEmptySessionDraft();

            // Update the map entry for this provider
            const nextMap = { ...base.modelSelectionByProvider };
            const currentForProvider = nextMap[instanceKey];
            if (providerOpts) {
              nextMap[instanceKey] = createModelSelection(
                instanceKey,
                currentForProvider?.model ?? fallbackModel,
                providerOpts,
              );
            } else if (currentForProvider && (currentForProvider.options?.length ?? 0) > 0) {
              const { options: _, ...rest } = currentForProvider;
              nextMap[instanceKey] = rest as ModelSelection;
            }

            // Handle sticky persistence
            let nextStickyMap = state.stickyModelSelectionByProvider;
            let nextStickyActiveProvider = state.stickyActiveProvider;
            if (options?.persistSticky === true) {
              nextStickyMap = { ...state.stickyModelSelectionByProvider };
              const stickyBase =
                nextStickyMap[instanceKey] ??
                base.modelSelectionByProvider[instanceKey] ??
                createModelSelection(instanceKey, fallbackModel);
              if (providerOpts) {
                nextStickyMap[instanceKey] = createModelSelection(
                  instanceKey,
                  stickyBase.model,
                  providerOpts,
                );
              } else if ((stickyBase.options?.length ?? 0) > 0) {
                const { options: _, ...rest } = stickyBase;
                nextStickyMap[instanceKey] = rest as ModelSelection;
              }
              nextStickyActiveProvider = options.instanceId
                ? instanceKey
                : (base.activeProvider ?? instanceKey);
            }

            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
              state.stickyActiveProvider === nextStickyActiveProvider
            ) {
              return state;
            }

            const nextDraft: ComposerSessionDraftState = {
              ...base,
              ...(options?.instanceId ? { activeProvider: instanceKey } : {}),
              modelSelectionByProvider: nextMap,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }

            return {
              draftsBySessionKey: nextDraftsBySessionKey,
              ...(options?.persistSticky === true
                ? {
                    stickyModelSelectionByProvider: nextStickyMap,
                    stickyActiveProvider: nextStickyActiveProvider,
                  }
                : {}),
            };
          });
        },
        setRuntimeMode: (sessionRef, runtimeMode) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          const nextRuntimeMode = isRuntimeMode(runtimeMode) ? runtimeMode : null;
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey];
            if (!existing && nextRuntimeMode === null) {
              return state;
            }
            const base = existing ?? createEmptySessionDraft();
            if (base.runtimeMode === nextRuntimeMode) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...base,
              runtimeMode: nextRuntimeMode,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        setInteractionMode: (sessionRef, interactionMode) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          const nextInteractionMode =
            interactionMode === "plan" || interactionMode === "default" ? interactionMode : null;
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey];
            if (!existing && nextInteractionMode === null) {
              return state;
            }
            const base = existing ?? createEmptySessionDraft();
            if (base.interactionMode === nextInteractionMode) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...base,
              interactionMode: nextInteractionMode,
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        addImage: (sessionRef, image) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          const sessionId = resolveComposerSessionId(get(), sessionRef);
          if (!sessionKey || !sessionId) {
            return;
          }
          get().addImages(typeof sessionRef === "string" ? DraftId.make(sessionKey) : sessionRef, [
            image,
          ]);
        },
        addImages: (sessionRef, images) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0 || images.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey] ?? createEmptySessionDraft();
            const existingIds = new Set(existing.images.map((image) => image.id));
            const existingDedupKeys = new Set(
              existing.images.map((image) => composerImageDedupKey(image)),
            );
            const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
            const dedupedIncoming: ComposerImageAttachment[] = [];
            for (const image of images) {
              const dedupKey = composerImageDedupKey(image);
              if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
                // Avoid revoking a blob URL that's still referenced by an accepted image.
                if (!acceptedPreviewUrls.has(image.previewUrl)) {
                  revokeObjectPreviewUrl(image.previewUrl);
                }
                continue;
              }
              dedupedIncoming.push(image);
              existingIds.add(image.id);
              existingDedupKeys.add(dedupKey);
              acceptedPreviewUrls.add(image.previewUrl);
            }
            if (dedupedIncoming.length === 0) {
              return state;
            }
            return {
              draftsBySessionKey: {
                ...state.draftsBySessionKey,
                [sessionKey]: {
                  ...existing,
                  images: [...existing.images, ...dedupedIncoming],
                },
              },
            };
          });
        },
        removeImage: (sessionRef, imageId) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          const existing = get().draftsBySessionKey[sessionKey];
          if (!existing) {
            return;
          }
          const removedImage = existing.images.find((image) => image.id === imageId);
          if (removedImage) {
            revokeObjectPreviewUrl(removedImage.previewUrl);
          }
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              images: current.images.filter((image) => image.id !== imageId),
              nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
              persistedAttachments: current.persistedAttachments.filter(
                (attachment) => attachment.id !== imageId,
              ),
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        insertTerminalContext: (sessionRef, prompt, context, index) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          const sessionId = resolveComposerSessionId(get(), sessionRef);
          if (!sessionKey || !sessionId) {
            return false;
          }
          let inserted = false;
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey] ?? createEmptySessionDraft();
            const normalizedContext = normalizeTerminalContextForSession(sessionId, context);
            if (!normalizedContext) {
              return state;
            }
            const dedupKey = terminalContextDedupKey(normalizedContext);
            if (
              existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
              existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
            ) {
              return state;
            }
            inserted = true;
            const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
            const nextDraft: ComposerSessionDraftState = {
              ...existing,
              prompt,
              terminalContexts: [
                ...existing.terminalContexts.slice(0, boundedIndex),
                normalizedContext,
                ...existing.terminalContexts.slice(boundedIndex),
              ],
            };
            return {
              draftsBySessionKey: {
                ...state.draftsBySessionKey,
                [sessionKey]: nextDraft,
              },
            };
          });
          return inserted;
        },
        addTerminalContext: (sessionRef, context) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          const sessionId = resolveComposerSessionId(get(), sessionRef);
          if (!sessionKey || !sessionId) {
            return;
          }
          get().addTerminalContexts(
            typeof sessionRef === "string" ? DraftId.make(sessionKey) : sessionRef,
            [context],
          );
        },
        addTerminalContexts: (sessionRef, contexts) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          const sessionId = resolveComposerSessionId(get(), sessionRef);
          if (!sessionKey || !sessionId || contexts.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsBySessionKey[sessionKey] ?? createEmptySessionDraft();
            const acceptedContexts = normalizeTerminalContextsForSession(sessionId, [
              ...existing.terminalContexts,
              ...contexts,
            ]).slice(existing.terminalContexts.length);
            if (acceptedContexts.length === 0) {
              return state;
            }
            return {
              draftsBySessionKey: {
                ...state.draftsBySessionKey,
                [sessionKey]: {
                  ...existing,
                  prompt: ensureInlineTerminalContextPlaceholders(
                    existing.prompt,
                    existing.terminalContexts.length + acceptedContexts.length,
                  ),
                  terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
                },
              },
            };
          });
        },
        removeTerminalContext: (sessionRef, contextId) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0 || contextId.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              terminalContexts: current.terminalContexts.filter(
                (context) => context.id !== contextId,
              ),
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        clearTerminalContexts: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current || current.terminalContexts.length === 0) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              terminalContexts: [],
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        clearPersistedAttachments: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              persistedAttachments: [],
              nonPersistedImageIds: [],
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
        syncPersistedAttachments: (sessionRef, attachments) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef);
          if (!sessionKey) {
            return;
          }
          const attachmentIdSet = new Set(attachments.map((attachment) => attachment.id));
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              // Stage attempted attachments so persist middleware can try writing them.
              persistedAttachments: attachments,
              nonPersistedImageIds: current.nonPersistedImageIds.filter(
                (id) => !attachmentIdSet.has(id),
              ),
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
          Promise.resolve().then(() => {
            verifyPersistedAttachments(sessionKey, attachments, set);
          });
        },
        clearComposerContent: (sessionRef) => {
          const sessionKey = resolveComposerDraftKey(get(), sessionRef) ?? "";
          if (sessionKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsBySessionKey[sessionKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerSessionDraftState = {
              ...current,
              prompt: "",
              images: [],
              nonPersistedImageIds: [],
              persistedAttachments: [],
              terminalContexts: [],
            };
            const nextDraftsBySessionKey = { ...state.draftsBySessionKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsBySessionKey[sessionKey];
            } else {
              nextDraftsBySessionKey[sessionKey] = nextDraft;
            }
            return { draftsBySessionKey: nextDraftsBySessionKey };
          });
        },
      };
    },
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: createJSONStorage(() => composerDebouncedStorage),
      migrate: migratePersistedComposerDraftStoreState,
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState) => {
        const normalizedPersisted =
          normalizeCurrentPersistedComposerDraftStoreState(persistedState);
        const draftsBySessionKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsBySessionKey).map(([sessionKey, draft]) => [
            sessionKey,
            toHydratedSessionDraft(draft),
          ]),
        );
        const draftSessionsBySessionKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftSessionsBySessionKey).map(
            ([sessionKey, draftSession]) => [sessionKey, toHydratedDraftSessionState(draftSession)],
          ),
        ) as Record<string, DraftSessionState>;
        return {
          ...currentState,
          draftsBySessionKey,
          draftSessionsBySessionKey,
          logicalProjectDraftSessionKeyByLogicalProjectKey:
            normalizedPersisted.logicalProjectDraftSessionKeyByLogicalProjectKey,
          stickyModelSelectionByProvider: normalizedPersisted.stickyModelSelectionByProvider ?? {},
          stickyActiveProvider: normalizedPersisted.stickyActiveProvider ?? null,
        };
      },
    },
  ),
);

export const useComposerDraftStore = composerDraftStore;

export function useComposerSessionDraft(
  sessionRef: ComposerSessionTarget,
): ComposerSessionDraftState {
  return useComposerDraftStore((state) => {
    return getComposerDraftState(state, sessionRef) ?? EMPTY_THREAD_DRAFT;
  });
}

export function useComposerDraftModelState(
  sessionRef: ComposerSessionTarget,
): ComposerDraftModelState {
  return useComposerDraftStore(
    useShallow((state) => {
      const draft = getComposerDraftState(state, sessionRef);
      return draft
        ? {
            activeProvider: draft.activeProvider,
            modelSelectionByProvider: draft.modelSelectionByProvider,
          }
        : EMPTY_COMPOSER_DRAFT_MODEL_STATE;
    }),
  );
}

export function useEffectiveComposerModelState(input: {
  sessionRef?: ComposerSessionTarget;
  draftId?: DraftId;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderDriverKind;
  /**
   * When supplied, the draft's saved selection for this instance takes
   * precedence over the driver-kind bucket — so a custom `codex_personal`
   * instance reads its own model, not the default Codex's.
   */
  selectedInstanceId?: ProviderInstanceId | null | undefined;
  sessionModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveComposerModelState {
  const draft = useComposerDraftModelState(input.sessionRef ?? input.draftId ?? DraftId.make(""));

  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        providers: input.providers,
        selectedProvider: input.selectedProvider,
        selectedInstanceId: input.selectedInstanceId,
        sessionModelSelection: input.sessionModelSelection,
        projectModelSelection: input.projectModelSelection,
        settings: input.settings,
      }),
    [
      draft,
      input.providers,
      input.settings,
      input.projectModelSelection,
      input.selectedInstanceId,
      input.selectedProvider,
      input.sessionModelSelection,
    ],
  );
}

/**
 * Mark a draft session as promoting once the server has materialized the same session id.
 *
 * Use the single-session helper for live `session.created` events and the
 * iterable helper for bootstrap/recovery paths that discover multiple server
 * sessions at once.
 */
export function markPromotedDraftSession(sessionId: SessionId): void {
  const store = useComposerDraftStore.getState();
  const draftSessionTargets: ComposerSessionTarget[] = [];
  for (const [draftId, draftSession] of Object.entries(store.draftSessionsBySessionKey)) {
    if (draftSession.sessionId === sessionId) {
      draftSessionTargets.push(DraftId.make(draftId));
    }
  }
  if (draftSessionTargets.length === 0) {
    return;
  }
  for (const draftSessionTarget of draftSessionTargets) {
    store.markDraftSessionPromoting(draftSessionTarget);
  }
}

export function markPromotedDraftSessionByRef(sessionRef: ScopedSessionRef): void {
  const draftStore = useComposerDraftStore.getState();
  for (const [draftId, draftSession] of Object.entries(draftStore.draftSessionsBySessionKey)) {
    if (
      draftSession.environmentId === sessionRef.environmentId &&
      draftSession.sessionId === sessionRef.sessionId
    ) {
      draftStore.markDraftSessionPromoting(DraftId.make(draftId), sessionRef);
    }
  }
}

export function markPromotedDraftSessions(serverSessionIds: Iterable<SessionId>): void {
  for (const sessionId of serverSessionIds) {
    markPromotedDraftSession(sessionId);
  }
}

export function markPromotedDraftSessionsByRef(
  serverSessionRefs: Iterable<ScopedSessionRef>,
): void {
  for (const sessionRef of serverSessionRefs) {
    markPromotedDraftSessionByRef(sessionRef);
  }
}

export function finalizePromotedDraftSessionByRef(sessionRef: ScopedSessionRef): void {
  const draftStore = useComposerDraftStore.getState();
  for (const [draftId, draftSession] of Object.entries(draftStore.draftSessionsBySessionKey)) {
    if (
      draftSession.promotedTo &&
      draftSession.promotedTo.environmentId === sessionRef.environmentId &&
      draftSession.promotedTo.sessionId === sessionRef.sessionId
    ) {
      draftStore.finalizePromotedDraftSession(DraftId.make(draftId));
    }
  }
}

export function finalizePromotedDraftSessionsByRef(
  serverSessionRefs: Iterable<ScopedSessionRef>,
): void {
  for (const sessionRef of serverSessionRefs) {
    finalizePromotedDraftSessionByRef(sessionRef);
  }
}
