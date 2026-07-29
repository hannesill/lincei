import {
  EnvironmentId,
  type LocalApi,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  persistSavedEnvironmentRecordWithBearerToken,
  removeSavedEnvironmentRecord,
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
} from "./catalog";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("environment runtime catalog stores", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    await resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resets the saved environment registry store state", async () => {
    const environmentId = EnvironmentId.make("environment-1");

    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    });

    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toBeDefined();

    await resetSavedEnvironmentRegistryStoreForTests();

    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({});
  });

  it("resets the saved environment runtime store state", () => {
    const environmentId = EnvironmentId.make("environment-1");

    useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
      connectionState: "connected",
      connectedAt: "2026-04-09T00:00:00.000Z",
    });

    expect(useSavedEnvironmentRuntimeStore.getState().byId[environmentId]).toBeDefined();

    resetSavedEnvironmentRuntimeStoreForTests();

    expect(useSavedEnvironmentRuntimeStore.getState().byId).toEqual({});
  });

  it("does not throw when local api lookup fails during registry persistence", async () => {
    vi.unstubAllGlobals();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    expect(() =>
      useSavedEnvironmentRegistryStore.getState().upsert({
        environmentId: EnvironmentId.make("environment-1"),
        label: "Remote environment",
        httpBaseUrl: "https://remote.example.com/",
        wsBaseUrl: "wss://remote.example.com/",
        createdAt: "2026-04-09T00:00:00.000Z",
        lastConnectedAt: null,
      }),
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "[SAVED_ENVIRONMENTS] persist failed",
        expect.any(Error),
      );
    });
  });

  it("writes exact registry snapshots in FIFO order and recovers after a failed write", async () => {
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    const snapshots: ReadonlyArray<PersistedSavedEnvironmentRecord>[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        snapshots.push(records);
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        try {
          await (snapshots.length === 1 ? firstWrite.promise : secondWrite.promise);
        } finally {
          activeWrites -= 1;
        }
      },
    );
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Environment A",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    useSavedEnvironmentRegistryStore.getState().upsert(record);
    await vi.waitFor(() => expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1));

    useSavedEnvironmentRegistryStore.getState().rename(environmentId, "Environment B");
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);

    firstWrite.reject(new Error("write A failed"));
    await vi.waitFor(() => expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(2));
    expect(snapshots).toEqual([[record], [{ ...record, label: "Environment B" }]]);
    expect(maximumActiveWrites).toBe(1);

    secondWrite.resolve();
    await resetSavedEnvironmentRegistryStoreForTests();
    expect(activeWrites).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] persist failed",
      expect.objectContaining({ message: "write A failed" }),
    );
  });

  it("holds competing registry writes until metadata and credentials are both durable", async () => {
    const metadataWriteStarted = createDeferred<void>();
    const releaseMetadataWrite = createDeferred<void>();
    const secretWriteStarted = createDeferred<void>();
    const releaseSecretWrite = createDeferred<void>();
    const snapshots: ReadonlyArray<PersistedSavedEnvironmentRecord>[] = [];
    let persistedRecords: readonly PersistedSavedEnvironmentRecord[] = [];
    const persistedSecrets = new Map<EnvironmentId, string>();
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        snapshots.push(records);
        if (snapshots.length === 1) {
          metadataWriteStarted.resolve();
          await releaseMetadataWrite.promise;
        }
        persistedRecords = records;
      },
    );
    const setSavedEnvironmentSecret = vi.fn(
      async (environmentId: EnvironmentId, secret: string) => {
        secretWriteStarted.resolve();
        await releaseSecretWrite.promise;
        persistedSecrets.set(environmentId, secret);
        return true;
      },
    );
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const environmentA = {
      environmentId: EnvironmentId.make("environment-a"),
      label: "Environment A",
      httpBaseUrl: "https://a.example.com/",
      wsBaseUrl: "wss://a.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const environmentB = {
      environmentId: EnvironmentId.make("environment-b"),
      label: "Environment B",
      httpBaseUrl: "https://b.example.com/",
      wsBaseUrl: "wss://b.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;

    const persistEnvironmentA = persistSavedEnvironmentRecordWithBearerToken(
      environmentA,
      "token-a",
    );
    await metadataWriteStarted.promise;
    useSavedEnvironmentRegistryStore.getState().upsert(environmentB);

    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);
    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({
      [environmentB.environmentId]: environmentB,
    });

    releaseMetadataWrite.resolve();
    await secretWriteStarted.promise;
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentA.environmentId]).toBe(
      undefined,
    );

    releaseSecretWrite.resolve();
    await expect(persistEnvironmentA).resolves.toBe(true);
    await vi.waitFor(() => expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(2));
    await resetSavedEnvironmentRegistryStoreForTests();

    expect(snapshots[0]).toEqual([environmentA]);
    expect(snapshots[1]).toEqual(expect.arrayContaining([environmentA, environmentB]));
    expect(snapshots[1]).toHaveLength(2);
    expect(persistedRecords).toEqual(expect.arrayContaining([environmentA, environmentB]));
    expect(persistedSecrets.get(environmentA.environmentId)).toBe("token-a");
  });

  it("queues same-environment removal behind an unpublished saved environment add", async () => {
    const metadataWriteStarted = createDeferred<void>();
    const releaseMetadataWrite = createDeferred<void>();
    const events: string[] = [];
    let persistedRecords: readonly PersistedSavedEnvironmentRecord[] = [];
    const persistedSecrets = new Map<EnvironmentId, string>();
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        events.push(`registry:${records.map((record) => record.environmentId).join(",")}`);
        if (setSavedEnvironmentRegistry.mock.calls.length === 1) {
          metadataWriteStarted.resolve();
          await releaseMetadataWrite.promise;
        }
        persistedRecords = records;
      },
    );
    const setSavedEnvironmentSecret = vi.fn(
      async (environmentId: EnvironmentId, secret: string) => {
        events.push(`secret:set:${environmentId}`);
        persistedSecrets.set(environmentId, secret);
        return true;
      },
    );
    const removeSavedEnvironmentSecret = vi.fn(async (environmentId: EnvironmentId) => {
      events.push(`secret:remove:${environmentId}`);
      persistedSecrets.delete(environmentId);
    });
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret,
          removeSavedEnvironmentSecret,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const record = {
      environmentId: EnvironmentId.make("environment-a"),
      label: "Environment A",
      httpBaseUrl: "https://a.example.com/",
      wsBaseUrl: "wss://a.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;

    const add = persistSavedEnvironmentRecordWithBearerToken(record, "token-a");
    await metadataWriteStarted.promise;
    expect(useSavedEnvironmentRegistryStore.getState().byId[record.environmentId]).toBeUndefined();

    const remove = removeSavedEnvironmentRecord(record.environmentId);
    expect(removeSavedEnvironmentSecret).not.toHaveBeenCalled();

    releaseMetadataWrite.resolve();
    await expect(add).resolves.toBe(true);
    await expect(remove).resolves.toBe(record);

    expect(events).toEqual([
      `registry:${record.environmentId}`,
      `secret:set:${record.environmentId}`,
      "registry:",
      `secret:remove:${record.environmentId}`,
    ]);
    expect(persistedRecords).toEqual([]);
    expect(persistedSecrets.has(record.environmentId)).toBe(false);
    expect(useSavedEnvironmentRegistryStore.getState().byId[record.environmentId]).toBeUndefined();
  });

  it("rolls metadata back inside the FIFO lane when credential persistence fails", async () => {
    const existingRecord = {
      environmentId: EnvironmentId.make("environment-existing"),
      label: "Existing environment",
      httpBaseUrl: "https://existing.example.com/",
      wsBaseUrl: "wss://existing.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const failedRecord = {
      environmentId: EnvironmentId.make("environment-failed"),
      label: "Failed environment",
      httpBaseUrl: "https://failed.example.com/",
      wsBaseUrl: "wss://failed.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const snapshots: ReadonlyArray<PersistedSavedEnvironmentRecord>[] = [];
    let persistedRecords: readonly PersistedSavedEnvironmentRecord[] = [existingRecord];
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        snapshots.push(records);
        persistedRecords = records;
      },
    );
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [existingRecord],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => false,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    await expect(persistSavedEnvironmentRecordWithBearerToken(failedRecord, "token")).resolves.toBe(
      false,
    );

    expect(snapshots).toEqual([[existingRecord, failedRecord], [existingRecord]]);
    expect(persistedRecords).toEqual([existingRecord]);
    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({
      [existingRecord.environmentId]: existingRecord,
    });
  });

  it("drains active and queued writes before resetting registry state", async () => {
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    const setSavedEnvironmentRegistry = vi
      .fn<(records: readonly PersistedSavedEnvironmentRecord[]) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const environmentId = EnvironmentId.make("environment-1");
    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId,
      label: "Environment A",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    });
    await vi.waitFor(() => expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1));
    useSavedEnvironmentRegistryStore.getState().rename(environmentId, "Environment B");

    let didReset = false;
    const reset = resetSavedEnvironmentRegistryStoreForTests().then(() => {
      didReset = true;
    });
    await Promise.resolve();
    expect(didReset).toBe(false);

    firstWrite.resolve();
    await vi.waitFor(() => expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(2));
    expect(didReset).toBe(false);

    secondWrite.resolve();
    await reset;
    expect(didReset).toBe(true);
    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({});
  });

  it("restores and reports a record when durable registry removal fails", async () => {
    const persistenceError = new Error("registry unavailable");
    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const setSavedEnvironmentRegistry = vi.fn(async () => {
      throw persistenceError;
    });
    const removeSavedEnvironmentSecret = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [record],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useSavedEnvironmentRegistryStore.setState({ byId: { [environmentId]: record } });

    await expect(removeSavedEnvironmentRecord(environmentId)).rejects.toBe(persistenceError);

    expect(setSavedEnvironmentRegistry).toHaveBeenCalledWith([]);
    expect(removeSavedEnvironmentSecret).not.toHaveBeenCalled();
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(record);
    expect(errorSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] registry removal failed; restored record",
      {
        environmentId,
        error: persistenceError,
      },
    );
  });

  it("restores the durable record inside the FIFO lane when secret removal fails", async () => {
    const secretError = new Error("secret removal failed");
    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const snapshots: ReadonlyArray<PersistedSavedEnvironmentRecord>[] = [];
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        snapshots.push(records);
      },
    );
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [record],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => {
            throw secretError;
          },
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useSavedEnvironmentRegistryStore.setState({ byId: { [environmentId]: record } });

    await expect(removeSavedEnvironmentRecord(environmentId)).rejects.toBe(secretError);

    expect(snapshots).toEqual([[], [record]]);
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(record);
    expect(errorSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] secret removal failed; restored registry record",
      {
        environmentId,
        error: secretError,
      },
    );
  });

  it("reconciles a local upsert with persisted records while hydration is blocked", async () => {
    const registryReadStarted = createDeferred<void>();
    const releaseRegistryRead = createDeferred<void>();
    const persistedRecord = {
      environmentId: EnvironmentId.make("environment-persisted"),
      label: "Persisted environment",
      httpBaseUrl: "https://persisted.example.com/",
      wsBaseUrl: "wss://persisted.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const localRecord = {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      httpBaseUrl: "https://local.example.com/",
      wsBaseUrl: "wss://local.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    let persistedRecords: readonly PersistedSavedEnvironmentRecord[] = [persistedRecord];
    const setSavedEnvironmentRegistry = vi.fn(
      async (records: readonly PersistedSavedEnvironmentRecord[]) => {
        persistedRecords = records;
      },
    );

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => {
            registryReadStarted.resolve();
            await releaseRegistryRead.promise;
            return [persistedRecord];
          },
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });

    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const hydrationPromise = waitForSavedEnvironmentRegistryHydration();
    await registryReadStarted.promise;
    useSavedEnvironmentRegistryStore.getState().upsert(localRecord);
    releaseRegistryRead.resolve();
    await hydrationPromise;

    const expectedRecords = expect.arrayContaining([persistedRecord, localRecord]);
    expect(Object.values(useSavedEnvironmentRegistryStore.getState().byId)).toEqual(
      expectedRecords,
    );
    expect(Object.values(useSavedEnvironmentRegistryStore.getState().byId)).toHaveLength(2);
    expect(persistedRecords).toEqual(expectedRecords);
    expect(persistedRecords).toHaveLength(2);
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);
  });

  it("removes unsupported persisted targets instead of hydrating them", async () => {
    const validRecord: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("environment-valid"),
      label: "Valid remote",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    };
    const invalidRecord: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("environment-invalid"),
      label: "Invalid remote",
      httpBaseUrl: "ftp://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    };
    const setSavedEnvironmentRegistry = vi.fn(async () => undefined);
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [validRecord, invalidRecord],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    await waitForSavedEnvironmentRegistryHydration();

    expect(useSavedEnvironmentRegistryStore.getState().byId[validRecord.environmentId]).toEqual(
      validRecord,
    );
    expect(
      useSavedEnvironmentRegistryStore.getState().byId[invalidRecord.environmentId],
    ).toBeUndefined();
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledWith([validRecord]);
    expect(warningSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] removed unsupported persisted targets",
      { environmentIds: [invalidRecord.environmentId] },
    );
  });

  it("keeps valid records hydrated when filtered registry persistence fails", async () => {
    const validRecord: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("environment-valid"),
      label: "Valid remote",
      httpBaseUrl: "https://valid.example.com/",
      wsBaseUrl: "wss://valid.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    };
    const invalidRecord: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("environment-invalid"),
      label: "Invalid remote",
      httpBaseUrl: "ftp://invalid.example.com/",
      wsBaseUrl: "wss://invalid.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    };
    const cleanupError = new Error(`failed to remove ${invalidRecord.httpBaseUrl}`);
    const setSavedEnvironmentRegistry = vi.fn(async () => {
      throw cleanupError;
    });
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [validRecord, invalidRecord],
          setSavedEnvironmentRegistry,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    await waitForSavedEnvironmentRegistryHydration();

    expect(useSavedEnvironmentRegistryStore.getState().byId[validRecord.environmentId]).toEqual(
      validRecord,
    );
    expect(
      useSavedEnvironmentRegistryStore.getState().byId[invalidRecord.environmentId],
    ).toBeUndefined();
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledWith([validRecord]);
    expect(warningSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] removed unsupported persisted targets",
      { environmentIds: [invalidRecord.environmentId] },
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[SAVED_ENVIRONMENTS] failed to persist filtered registry",
      { environmentIds: [invalidRecord.environmentId] },
    );
    expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), cleanupError);
  });
});
