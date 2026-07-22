import { EnvironmentId, ProjectId, type VitrineProjectState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  isAllowedManagedVitrineUrl,
  openManagedVitrine,
  readVitrineAutoOpenIntent,
  rememberVitrineAutoOpenIntent,
  vitrineAutoOpenStorageKey,
} from "./vitrinePreview";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project-a");

function readyState(overrides: Partial<VitrineProjectState> = {}): VitrineProjectState {
  return {
    projectId,
    status: "ready",
    dataDir: "/workspace/project-a/.vitrine",
    url: "http://vitrine.localhost:8812/",
    apiUrl: "http://127.0.0.1:8812/",
    pid: 12_345,
    port: 8_812,
    sessionId: "vitrine-session",
    version: "0.1.0",
    issueCode: null,
    message: null,
    updatedAt: "2026-07-22T18:00:00.000Z",
    ...overrides,
  };
}

describe("managed Vitrine preview", () => {
  it("opens the actual discovered port in the embedded browser", async () => {
    const ensure = vi.fn(async () => readyState());
    const openEmbedded = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);

    const result = await openManagedVitrine({
      projectId,
      ensure,
      embedded: true,
      fallbackExternal: true,
      openEmbedded,
      openExternal,
    });

    expect(ensure).toHaveBeenCalledWith({ projectId });
    expect(openEmbedded).toHaveBeenCalledWith("http://vitrine.localhost:8812/");
    expect(openExternal).not.toHaveBeenCalled();
    expect(result.presentation).toBe("embedded");
  });

  it("falls back to the system browser after a manual embedded-open failure", async () => {
    const embeddedError = new Error("webview unavailable");
    const openExternal = vi.fn(async () => undefined);

    const result = await openManagedVitrine({
      projectId,
      ensure: async () => readyState(),
      embedded: true,
      fallbackExternal: true,
      openEmbedded: async () => Promise.reject(embeddedError),
      openExternal,
    });

    expect(openExternal).toHaveBeenCalledWith("http://vitrine.localhost:8812/");
    expect(result).toMatchObject({ presentation: "external", embeddedError });
  });

  it("does not open an external window when automatic embedded restore fails", async () => {
    const openExternal = vi.fn(async () => undefined);

    await expect(
      openManagedVitrine({
        projectId,
        ensure: async () => readyState(),
        embedded: true,
        fallbackExternal: false,
        openEmbedded: async () => Promise.reject(new Error("webview unavailable")),
        openExternal,
      }),
    ).rejects.toThrow("webview unavailable");

    expect(openExternal).not.toHaveBeenCalled();
  });

  it("leaves presentation closed when the lifecycle is not ready", async () => {
    const openEmbedded = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);

    const result = await openManagedVitrine({
      projectId,
      ensure: async () =>
        readyState({
          status: "unavailable",
          url: null,
          apiUrl: null,
          pid: null,
          port: null,
          sessionId: null,
          version: null,
          issueCode: "executable_unavailable",
          message: "Install Vitrine and ensure `vitrine` is on PATH.",
        }),
      embedded: true,
      fallbackExternal: true,
      openEmbedded,
      openExternal,
    });

    expect(result.presentation).toBe("not-ready");
    expect(openEmbedded).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("rejects non-loopback and non-root URLs before presentation", async () => {
    for (const url of [
      "https://vitrine.localhost:8812/",
      "http://example.com:8812/",
      "http://user@vitrine.localhost:8812/",
      "http://vitrine.localhost:8812/study",
      "http://vitrine.localhost:8812/?next=external",
    ]) {
      await expect(
        openManagedVitrine({
          projectId,
          ensure: async () => readyState({ url }),
          embedded: true,
          fallbackExternal: true,
          openEmbedded: async () => undefined,
          openExternal: async () => undefined,
        }),
      ).rejects.toThrow("unsafe or malformed");
    }
  });

  it("rejects project identity and discovered-port mismatches", async () => {
    for (const state of [
      readyState({ projectId: ProjectId.make("project-b") }),
      readyState({ port: 8_813 }),
    ]) {
      await expect(
        openManagedVitrine({
          projectId,
          ensure: async () => state,
          embedded: true,
          fallbackExternal: true,
          openEmbedded: async () => undefined,
          openExternal: async () => undefined,
        }),
      ).rejects.toThrow(
        state.projectId === projectId ? "unsafe or malformed" : "different project",
      );
    }
  });

  it("cancels external fallback after the active session changes", async () => {
    let current = true;
    const openExternal = vi.fn(async () => undefined);

    const result = await openManagedVitrine({
      projectId,
      ensure: async () => readyState(),
      embedded: true,
      fallbackExternal: true,
      isCurrent: () => current,
      openEmbedded: async () => {
        current = false;
        throw new Error("webview unavailable");
      },
      openExternal,
    });

    expect(result.presentation).toBe("cancelled");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("accepts only explicit loopback display URLs", () => {
    expect(isAllowedManagedVitrineUrl("http://vitrine.localhost:7749/")).toBe(true);
    expect(isAllowedManagedVitrineUrl("http://localhost:7749/")).toBe(true);
    expect(isAllowedManagedVitrineUrl("http://127.0.0.1:7749/")).toBe(true);
    expect(isAllowedManagedVitrineUrl("http://[::1]:7749/")).toBe(true);
    expect(isAllowedManagedVitrineUrl("http://127.0.0.1/")).toBe(false);
  });

  it("persists restart intent separately per environment and project", () => {
    const otherProjectId = ProjectId.make("project-b");
    const otherEnvironmentId = EnvironmentId.make("remote");

    rememberVitrineAutoOpenIntent(environmentId, projectId);

    expect(readVitrineAutoOpenIntent(environmentId, projectId)).toBe(true);
    expect(readVitrineAutoOpenIntent(environmentId, otherProjectId)).toBe(false);
    expect(readVitrineAutoOpenIntent(otherEnvironmentId, projectId)).toBe(false);
    expect(vitrineAutoOpenStorageKey(environmentId, projectId)).not.toBe(
      vitrineAutoOpenStorageKey(otherEnvironmentId, projectId),
    );
  });
});
