import { getKnownEnvironmentHttpBaseUrl } from "@t3tools/client-runtime";
import {
  PersistedSavedEnvironmentRecordSchema,
  type AuthSessionRole,
  type EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  type PersistedSavedEnvironmentRecord,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import { ensureLocalApi } from "../../localApi";
import { getPrimaryKnownEnvironment } from "../primary";

export interface SavedEnvironmentRecord {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly wsBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly createdAt: string;
  readonly lastConnectedAt: string | null;
  readonly desktopSsh?: PersistedSavedEnvironmentRecord["desktopSsh"];
}

const isPersistedSavedEnvironmentRecord = Schema.is(PersistedSavedEnvironmentRecordSchema);

function isSupportedSavedEnvironmentRecord(record: SavedEnvironmentRecord): boolean {
  return isPersistedSavedEnvironmentRecord(record);
}

export function assertSupportedSavedEnvironmentRecord(record: SavedEnvironmentRecord): void {
  if (!isSupportedSavedEnvironmentRecord(record)) {
    throw new Error(
      `Saved environment ${record.environmentId} has an unsupported or mismatched remote target.`,
    );
  }
}

interface SavedEnvironmentRegistryState {
  readonly byId: Record<EnvironmentId, SavedEnvironmentRecord>;
}

interface SavedEnvironmentRegistryStore extends SavedEnvironmentRegistryState {
  readonly upsert: (record: SavedEnvironmentRecord) => void;
  readonly remove: (environmentId: EnvironmentId) => void;
  readonly markConnected: (environmentId: EnvironmentId, connectedAt: string) => void;
  readonly rename: (environmentId: EnvironmentId, label: string) => void;
  readonly reset: () => void;
}

let savedEnvironmentRegistryHydrated = false;
let savedEnvironmentRegistryHydrationPromise: Promise<void> | null = null;
let savedEnvironmentRegistryHydrationGeneration = 0;
let savedEnvironmentPersistenceTail: Promise<void> = Promise.resolve();

type SavedEnvironmentRegistryById = Record<EnvironmentId, SavedEnvironmentRecord>;
let savedEnvironmentRegistryCommittedById: SavedEnvironmentRegistryById | null = null;

type SavedEnvironmentRegistryMutationScope =
  | { readonly _tag: "all" }
  | {
      readonly _tag: "environmentIds";
      readonly environmentIds: ReadonlyArray<EnvironmentId>;
    };

interface SavedEnvironmentRegistryMutationIntent {
  readonly byId: SavedEnvironmentRegistryById;
  readonly scope: SavedEnvironmentRegistryMutationScope;
}

type SavedEnvironmentRegistryOperationResult<T> =
  | {
      readonly _tag: "success";
      readonly value: T;
      readonly committedById: SavedEnvironmentRegistryById;
    }
  | {
      readonly _tag: "failure";
      readonly error: unknown;
      readonly committedById: SavedEnvironmentRegistryById;
    };

const ALL_SAVED_ENVIRONMENT_REGISTRY_RECORDS: SavedEnvironmentRegistryMutationScope = {
  _tag: "all",
};

function savedEnvironmentRegistryMutationScope(
  environmentIds: ReadonlyArray<EnvironmentId>,
): SavedEnvironmentRegistryMutationScope {
  return {
    _tag: "environmentIds",
    environmentIds,
  };
}

function savedEnvironmentRegistryMutationIntent(
  byId: SavedEnvironmentRegistryById,
  scope: SavedEnvironmentRegistryMutationScope,
): SavedEnvironmentRegistryMutationIntent {
  if (scope._tag === "all") {
    return {
      byId: { ...byId },
      scope,
    };
  }

  const scopedById: SavedEnvironmentRegistryById = {};
  for (const environmentId of scope.environmentIds) {
    const record = byId[environmentId];
    if (record) {
      scopedById[environmentId] = record;
    }
  }
  return {
    byId: scopedById,
    scope,
  };
}

export function toPersistedSavedEnvironmentRecord(
  record: SavedEnvironmentRecord,
): PersistedSavedEnvironmentRecord {
  assertSupportedSavedEnvironmentRecord(record);
  return {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
    ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
  };
}

function valuesOfSavedEnvironmentRegistry(
  byId: SavedEnvironmentRegistryById,
): ReadonlyArray<SavedEnvironmentRecord> {
  return Object.values(byId) as ReadonlyArray<SavedEnvironmentRecord>;
}

function applySavedEnvironmentRegistryMutationIntent(
  committedById: SavedEnvironmentRegistryById,
  intent: SavedEnvironmentRegistryMutationIntent,
): SavedEnvironmentRegistryById {
  if (intent.scope._tag === "all") {
    return { ...intent.byId };
  }

  const nextById = { ...committedById };
  for (const environmentId of intent.scope.environmentIds) {
    const record = intent.byId[environmentId];
    if (record) {
      nextById[environmentId] = record;
    } else {
      delete nextById[environmentId];
    }
  }
  return nextById;
}

function areSavedEnvironmentRegistriesIdentical(
  left: SavedEnvironmentRegistryById,
  right: SavedEnvironmentRegistryById,
): boolean {
  const leftEnvironmentIds = Object.keys(left) as EnvironmentId[];
  const rightEnvironmentIds = Object.keys(right) as EnvironmentId[];
  return (
    leftEnvironmentIds.length === rightEnvironmentIds.length &&
    leftEnvironmentIds.every((environmentId) => left[environmentId] === right[environmentId])
  );
}

async function writeSavedEnvironmentRegistrySnapshot(
  byId: SavedEnvironmentRegistryById,
): Promise<void> {
  await ensureLocalApi().persistence.setSavedEnvironmentRegistry(
    valuesOfSavedEnvironmentRegistry(byId).map(toPersistedSavedEnvironmentRecord),
  );
}

function publishSavedEnvironmentRegistryState(byId: SavedEnvironmentRegistryById): void {
  useSavedEnvironmentRegistryStore.setState({ byId: { ...byId } });
}

function commitSavedEnvironmentRegistryState(
  byId: SavedEnvironmentRegistryById,
): SavedEnvironmentRegistryById {
  savedEnvironmentRegistryCommittedById = { ...byId };
  publishSavedEnvironmentRegistryState(savedEnvironmentRegistryCommittedById);
  return savedEnvironmentRegistryCommittedById;
}

async function initializeSavedEnvironmentRegistryLane(options: {
  readonly reconcileStore: boolean;
}): Promise<SavedEnvironmentRegistryById> {
  if (savedEnvironmentRegistryCommittedById) {
    return savedEnvironmentRegistryCommittedById;
  }

  const persistedRecords: ReadonlyArray<SavedEnvironmentRecord> =
    await ensureLocalApi().persistence.getSavedEnvironmentRegistry();
  const supportedRecords = persistedRecords.filter(isSupportedSavedEnvironmentRecord);
  const persistedById = Object.fromEntries(
    supportedRecords.map((record) => [record.environmentId, record]),
  );
  const rejectedEnvironmentIds = persistedRecords
    .filter((record) => !isSupportedSavedEnvironmentRecord(record))
    .map((record) => record.environmentId);

  if (rejectedEnvironmentIds.length > 0) {
    console.warn("[SAVED_ENVIRONMENTS] removed unsupported persisted targets", {
      environmentIds: rejectedEnvironmentIds,
    });
  }

  const currentById = useSavedEnvironmentRegistryStore.getState().byId;
  const reconciledById = options.reconcileStore
    ? {
        ...persistedById,
        ...currentById,
      }
    : persistedById;
  const shouldPersistReconciliation =
    rejectedEnvironmentIds.length > 0 ||
    (options.reconcileStore && Object.keys(currentById).length > 0);

  let initializedById = persistedById;
  if (shouldPersistReconciliation) {
    try {
      await writeSavedEnvironmentRegistrySnapshot(reconciledById);
      initializedById = reconciledById;
    } catch {
      if (rejectedEnvironmentIds.length > 0) {
        console.error("[SAVED_ENVIRONMENTS] failed to persist filtered registry", {
          environmentIds: rejectedEnvironmentIds,
        });
      } else {
        console.error("[SAVED_ENVIRONMENTS] failed to persist hydrated registry reconciliation");
      }
    }
  }

  savedEnvironmentRegistryCommittedById = { ...initializedById };
  if (options.reconcileStore) {
    publishSavedEnvironmentRegistryState(savedEnvironmentRegistryCommittedById);
  }
  return savedEnvironmentRegistryCommittedById;
}

function enqueueSavedEnvironmentPersistenceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const queuedOperation = savedEnvironmentPersistenceTail.then(operation);
  savedEnvironmentPersistenceTail = queuedOperation.then(
    () => undefined,
    () => undefined,
  );
  return queuedOperation;
}

function enqueueSavedEnvironmentRegistryOperation<T>(input: {
  readonly intent: SavedEnvironmentRegistryMutationIntent;
  readonly execute: (
    nextById: SavedEnvironmentRegistryById,
    committedByIdBeforeOperation: SavedEnvironmentRegistryById,
  ) => Promise<SavedEnvironmentRegistryOperationResult<T>>;
}): Promise<T> {
  return enqueueSavedEnvironmentPersistenceOperation(async () => {
    const committedByIdBeforeOperation = await initializeSavedEnvironmentRegistryLane({
      reconcileStore: false,
    });
    const nextById = applySavedEnvironmentRegistryMutationIntent(
      committedByIdBeforeOperation,
      input.intent,
    );

    let result: SavedEnvironmentRegistryOperationResult<T>;
    try {
      result = await input.execute(nextById, committedByIdBeforeOperation);
    } catch (error) {
      publishSavedEnvironmentRegistryState(committedByIdBeforeOperation);
      throw error;
    }

    commitSavedEnvironmentRegistryState(result.committedById);
    if (result._tag === "failure") {
      throw result.error;
    }
    return result.value;
  });
}

function enqueueSavedEnvironmentRegistryWrite(
  byId: SavedEnvironmentRegistryById,
  scope: SavedEnvironmentRegistryMutationScope,
): Promise<void> {
  return enqueueSavedEnvironmentRegistryOperation({
    intent: savedEnvironmentRegistryMutationIntent(byId, scope),
    execute: async (nextById, committedByIdBeforeOperation) => {
      if (!areSavedEnvironmentRegistriesIdentical(nextById, committedByIdBeforeOperation)) {
        await writeSavedEnvironmentRegistrySnapshot(nextById);
      }
      return {
        _tag: "success",
        value: undefined,
        committedById: nextById,
      };
    },
  });
}

async function drainSavedEnvironmentRegistryWrites(): Promise<void> {
  while (true) {
    const observedTail = savedEnvironmentPersistenceTail;
    await observedTail;
    if (observedTail === savedEnvironmentPersistenceTail) {
      return;
    }
  }
}

function scheduleSavedEnvironmentRegistryWrite(
  byId: SavedEnvironmentRegistryById,
  scope: SavedEnvironmentRegistryMutationScope,
): void {
  void enqueueSavedEnvironmentRegistryWrite(byId, scope).catch((error) => {
    console.error("[SAVED_ENVIRONMENTS] persist failed", error);
  });
}

async function hydrateSavedEnvironmentRegistry(): Promise<void> {
  if (savedEnvironmentRegistryHydrated) {
    return;
  }
  if (savedEnvironmentRegistryHydrationPromise) {
    return savedEnvironmentRegistryHydrationPromise;
  }

  const hydrationGeneration = savedEnvironmentRegistryHydrationGeneration;
  const nextHydration = enqueueSavedEnvironmentPersistenceOperation(async () => {
    const committedById = await initializeSavedEnvironmentRegistryLane({
      reconcileStore: true,
    });
    publishSavedEnvironmentRegistryState(committedById);
  })
    .catch((error) => {
      console.error("[SAVED_ENVIRONMENTS] hydrate failed", error);
    })
    .finally(() => {
      if (hydrationGeneration === savedEnvironmentRegistryHydrationGeneration) {
        savedEnvironmentRegistryHydrated = true;
      }
    });

  const hydrationPromise = nextHydration.finally(() => {
    if (savedEnvironmentRegistryHydrationPromise === hydrationPromise) {
      savedEnvironmentRegistryHydrationPromise = null;
    }
  });
  savedEnvironmentRegistryHydrationPromise = hydrationPromise;

  return savedEnvironmentRegistryHydrationPromise;
}

export const useSavedEnvironmentRegistryStore = create<SavedEnvironmentRegistryStore>()((set) => ({
  byId: {},
  upsert: (record) => {
    assertSupportedSavedEnvironmentRecord(record);
    set((state) => {
      if (state.byId[record.environmentId] === record) {
        return state;
      }
      const byId = {
        ...state.byId,
        [record.environmentId]: record,
      };
      scheduleSavedEnvironmentRegistryWrite(
        byId,
        savedEnvironmentRegistryMutationScope([record.environmentId]),
      );
      return { byId };
    });
  },
  remove: (environmentId) =>
    set((state) => {
      if (!state.byId[environmentId]) {
        return state;
      }
      const { [environmentId]: _removed, ...remaining } = state.byId;
      scheduleSavedEnvironmentRegistryWrite(
        remaining,
        savedEnvironmentRegistryMutationScope([environmentId]),
      );
      return {
        byId: remaining,
      };
    }),
  markConnected: (environmentId, connectedAt) =>
    set((state) => {
      const existing = state.byId[environmentId];
      if (!existing) {
        return state;
      }
      const byId = {
        ...state.byId,
        [environmentId]: {
          ...existing,
          lastConnectedAt: connectedAt,
        },
      };
      scheduleSavedEnvironmentRegistryWrite(
        byId,
        savedEnvironmentRegistryMutationScope([environmentId]),
      );
      return { byId };
    }),
  rename: (environmentId, label) =>
    set((state) => {
      const existing = state.byId[environmentId];
      const nextLabel = label.trim();
      if (!existing || nextLabel.length === 0 || existing.label === nextLabel) {
        return state;
      }
      const byId = {
        ...state.byId,
        [environmentId]: {
          ...existing,
          label: nextLabel,
        },
      };
      scheduleSavedEnvironmentRegistryWrite(
        byId,
        savedEnvironmentRegistryMutationScope([environmentId]),
      );
      return { byId };
    }),
  reset: () => {
    scheduleSavedEnvironmentRegistryWrite({}, ALL_SAVED_ENVIRONMENT_REGISTRY_RECORDS);
    set({
      byId: {},
    });
  },
}));

export function hasSavedEnvironmentRegistryHydrated(): boolean {
  return savedEnvironmentRegistryHydrated;
}

export function waitForSavedEnvironmentRegistryHydration(): Promise<void> {
  if (hasSavedEnvironmentRegistryHydrated()) {
    return Promise.resolve();
  }

  return hydrateSavedEnvironmentRegistry();
}

export function listSavedEnvironmentRecords(): ReadonlyArray<SavedEnvironmentRecord> {
  return Object.values(useSavedEnvironmentRegistryStore.getState().byId).toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function getSavedEnvironmentRecord(
  environmentId: EnvironmentId,
): SavedEnvironmentRecord | null {
  return useSavedEnvironmentRegistryStore.getState().byId[environmentId] ?? null;
}

export function getEnvironmentHttpBaseUrl(environmentId: EnvironmentId): string | null {
  const primaryEnvironment = getPrimaryKnownEnvironment();
  if (primaryEnvironment?.environmentId === environmentId) {
    return getKnownEnvironmentHttpBaseUrl(primaryEnvironment);
  }

  return getSavedEnvironmentRecord(environmentId)?.httpBaseUrl ?? null;
}

export function resolveEnvironmentHttpUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly pathname: string;
  readonly searchParams?: Record<string, string>;
}): string {
  const httpBaseUrl = getEnvironmentHttpBaseUrl(input.environmentId);
  if (!httpBaseUrl) {
    throw new Error(`Unable to resolve HTTP base URL for environment ${input.environmentId}.`);
  }

  const url = new URL(httpBaseUrl);
  url.pathname = input.pathname;
  if (input.searchParams) {
    url.search = new URLSearchParams(input.searchParams).toString();
  }
  return url.toString();
}

export async function resetSavedEnvironmentRegistryStoreForTests(): Promise<void> {
  savedEnvironmentRegistryHydrationGeneration += 1;
  await drainSavedEnvironmentRegistryWrites();
  savedEnvironmentRegistryHydrated = false;
  savedEnvironmentRegistryHydrationPromise = null;
  savedEnvironmentRegistryCommittedById = null;
  useSavedEnvironmentRegistryStore.setState({ byId: {} });
}

export async function persistSavedEnvironmentRecord(record: SavedEnvironmentRecord): Promise<void> {
  assertSupportedSavedEnvironmentRecord(record);
  const byId = {
    ...useSavedEnvironmentRegistryStore.getState().byId,
    [record.environmentId]: record,
  };
  await enqueueSavedEnvironmentRegistryWrite(
    byId,
    savedEnvironmentRegistryMutationScope([record.environmentId]),
  );
}

function removeSavedEnvironmentRecordFromStoreIfCurrent(
  environmentId: EnvironmentId,
  record: SavedEnvironmentRecord,
): void {
  const currentById = useSavedEnvironmentRegistryStore.getState().byId;
  if (currentById[environmentId] !== record) {
    return;
  }
  const { [environmentId]: _removedRecord, ...remaining } = currentById;
  useSavedEnvironmentRegistryStore.setState({ byId: remaining });
}

async function rollbackSavedEnvironmentRegistrySnapshot(input: {
  readonly rollbackById: SavedEnvironmentRegistryById;
  readonly environmentId: EnvironmentId;
  readonly error: unknown;
  readonly message: string;
}): Promise<void> {
  try {
    await writeSavedEnvironmentRegistrySnapshot(input.rollbackById);
  } catch (restoreError) {
    console.error(input.message, {
      environmentId: input.environmentId,
      error: input.error,
      restoreError,
    });
    throw restoreError;
  }
}

export async function persistSavedEnvironmentRecordWithBearerToken(
  record: SavedEnvironmentRecord,
  bearerToken: string,
): Promise<boolean> {
  assertSupportedSavedEnvironmentRecord(record);

  return await enqueueSavedEnvironmentRegistryOperation({
    intent: savedEnvironmentRegistryMutationIntent(
      { [record.environmentId]: record },
      savedEnvironmentRegistryMutationScope([record.environmentId]),
    ),
    execute: async (nextById, committedByIdBeforeOperation) => {
      await writeSavedEnvironmentRegistrySnapshot(nextById);

      let didPersistBearerToken: boolean;
      try {
        didPersistBearerToken = await ensureLocalApi().persistence.setSavedEnvironmentSecret(
          record.environmentId,
          bearerToken,
        );
      } catch (error) {
        await rollbackSavedEnvironmentRegistrySnapshot({
          rollbackById: committedByIdBeforeOperation,
          environmentId: record.environmentId,
          error,
          message:
            "[SAVED_ENVIRONMENTS] credential persistence failed and registry rollback failed",
        });
        return {
          _tag: "failure",
          error,
          committedById: committedByIdBeforeOperation,
        };
      }

      if (!didPersistBearerToken) {
        await rollbackSavedEnvironmentRegistrySnapshot({
          rollbackById: committedByIdBeforeOperation,
          environmentId: record.environmentId,
          error: new Error("Saved environment credential persistence returned false."),
          message:
            "[SAVED_ENVIRONMENTS] credential persistence failed and registry rollback failed",
        });
        return {
          _tag: "success",
          value: false,
          committedById: committedByIdBeforeOperation,
        };
      }

      return {
        _tag: "success",
        value: true,
        committedById: nextById,
      };
    },
  });
}

export async function replaceSavedEnvironmentRegistryRecords(
  records: ReadonlyArray<SavedEnvironmentRecord>,
  touchedEnvironmentIds: ReadonlyArray<EnvironmentId>,
): Promise<void> {
  for (const record of records) {
    assertSupportedSavedEnvironmentRecord(record);
  }
  await enqueueSavedEnvironmentRegistryWrite(
    Object.fromEntries(records.map((record) => [record.environmentId, record])),
    savedEnvironmentRegistryMutationScope(touchedEnvironmentIds),
  );
}

export async function removeSavedEnvironmentRecord(
  environmentId: EnvironmentId,
): Promise<SavedEnvironmentRecord | null> {
  const capturedById = useSavedEnvironmentRegistryStore.getState().byId;
  const initiallyRemovedRecord = capturedById[environmentId] ?? null;
  const { [environmentId]: _removedRecord, ...remaining } = capturedById;
  if (initiallyRemovedRecord) {
    useSavedEnvironmentRegistryStore.setState({ byId: remaining });
  }

  return await enqueueSavedEnvironmentRegistryOperation({
    intent: savedEnvironmentRegistryMutationIntent(
      {},
      savedEnvironmentRegistryMutationScope([environmentId]),
    ),
    execute: async (nextById, committedByIdBeforeOperation) => {
      const removedRecord = committedByIdBeforeOperation[environmentId] ?? null;
      if (removedRecord) {
        removeSavedEnvironmentRecordFromStoreIfCurrent(environmentId, removedRecord);
      }
      try {
        if (!areSavedEnvironmentRegistriesIdentical(nextById, committedByIdBeforeOperation)) {
          await writeSavedEnvironmentRegistrySnapshot(nextById);
        }
      } catch (error) {
        console.error("[SAVED_ENVIRONMENTS] registry removal failed; restored record", {
          environmentId,
          error,
        });
        return {
          _tag: "failure",
          error,
          committedById: committedByIdBeforeOperation,
        };
      }

      try {
        await ensureLocalApi().persistence.removeSavedEnvironmentSecret(environmentId);
      } catch (error) {
        await rollbackSavedEnvironmentRegistrySnapshot({
          rollbackById: committedByIdBeforeOperation,
          environmentId,
          error,
          message: "[SAVED_ENVIRONMENTS] secret removal failed and registry restoration failed",
        });
        console.error("[SAVED_ENVIRONMENTS] secret removal failed; restored registry record", {
          environmentId,
          error,
        });
        return {
          _tag: "failure",
          error,
          committedById: committedByIdBeforeOperation,
        };
      }

      return {
        _tag: "success",
        value: removedRecord,
        committedById: nextById,
      };
    },
  });
}

export async function readSavedEnvironmentBearerToken(
  environmentId: EnvironmentId,
): Promise<string | null> {
  return ensureLocalApi().persistence.getSavedEnvironmentSecret(environmentId);
}

export async function writeSavedEnvironmentBearerToken(
  environmentId: EnvironmentId,
  bearerToken: string,
): Promise<boolean> {
  return enqueueSavedEnvironmentPersistenceOperation(async () =>
    ensureLocalApi().persistence.setSavedEnvironmentSecret(environmentId, bearerToken),
  );
}

export async function removeSavedEnvironmentBearerToken(
  environmentId: EnvironmentId,
): Promise<void> {
  await enqueueSavedEnvironmentPersistenceOperation(async () => {
    await ensureLocalApi().persistence.removeSavedEnvironmentSecret(environmentId);
  });
}

export type SavedEnvironmentConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type SavedEnvironmentAuthState = "authenticated" | "requires-auth" | "unknown";

export interface SavedEnvironmentRuntimeState {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly authState: SavedEnvironmentAuthState;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly role: AuthSessionRole | null;
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
  readonly serverConfig: ServerConfig | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
}

interface SavedEnvironmentRuntimeStoreState {
  readonly byId: Record<EnvironmentId, SavedEnvironmentRuntimeState>;
  readonly ensure: (environmentId: EnvironmentId) => void;
  readonly patch: (
    environmentId: EnvironmentId,
    patch: Partial<SavedEnvironmentRuntimeState>,
  ) => void;
  readonly clear: (environmentId: EnvironmentId) => void;
  readonly reset: () => void;
}

const DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE: SavedEnvironmentRuntimeState = Object.freeze({
  connectionState: "disconnected",
  authState: "unknown",
  lastError: null,
  lastErrorAt: null,
  role: null,
  descriptor: null,
  serverConfig: null,
  connectedAt: null,
  disconnectedAt: null,
});

function createDefaultSavedEnvironmentRuntimeState(): SavedEnvironmentRuntimeState {
  return {
    ...DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE,
  };
}

export const useSavedEnvironmentRuntimeStore = create<SavedEnvironmentRuntimeStoreState>()(
  (set) => ({
    byId: {},
    ensure: (environmentId) =>
      set((state) => {
        if (state.byId[environmentId]) {
          return state;
        }
        return {
          byId: {
            ...state.byId,
            [environmentId]: createDefaultSavedEnvironmentRuntimeState(),
          },
        };
      }),
    patch: (environmentId, patch) =>
      set((state) => ({
        byId: {
          ...state.byId,
          [environmentId]: {
            ...(state.byId[environmentId] ?? createDefaultSavedEnvironmentRuntimeState()),
            ...patch,
          },
        },
      })),
    clear: (environmentId) =>
      set((state) => {
        const { [environmentId]: _removed, ...remaining } = state.byId;
        return {
          byId: remaining,
        };
      }),
    reset: () =>
      set({
        byId: {},
      }),
  }),
);

export function getSavedEnvironmentRuntimeState(
  environmentId: EnvironmentId,
): SavedEnvironmentRuntimeState {
  return (
    useSavedEnvironmentRuntimeStore.getState().byId[environmentId] ??
    DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE
  );
}

export function resetSavedEnvironmentRuntimeStoreForTests() {
  useSavedEnvironmentRuntimeStore.getState().reset();
}
