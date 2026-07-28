import {
  EnvironmentId,
  type LocalApi,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
} from "./catalog";

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
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resets the saved environment registry store state", () => {
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

    resetSavedEnvironmentRegistryStoreForTests();

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

    expect(errorSpy).toHaveBeenCalledWith("[SAVED_ENVIRONMENTS] persist failed", expect.any(Error));
  });

  it("does not let stale hydration overwrite records added while hydration is in flight", async () => {
    let resolveRegistryRead: () => void = () => {
      throw new Error("Registry read resolver was not initialized.");
    };

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: () =>
            new Promise<readonly PersistedSavedEnvironmentRecord[]>((resolve) => {
              resolveRegistryRead = () => resolve([]);
            }),
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });

    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const hydrationPromise = waitForSavedEnvironmentRegistryHydration();

    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    resolveRegistryRead();
    await hydrationPromise;

    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(record);
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
