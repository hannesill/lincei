import type {
  EnvironmentId,
  ProjectId,
  VitrineProjectInput,
  VitrineProjectState,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "~/hooks/useLocalStorage";

const VITRINE_AUTO_OPEN_STORAGE_PREFIX = "lincei:vitrine:auto-open";
const ALLOWED_VITRINE_HOSTS = new Set(["vitrine.localhost", "localhost", "127.0.0.1", "[::1]"]);

export type VitrinePresentation = "cancelled" | "embedded" | "external" | "not-ready";

export interface OpenManagedVitrineResult {
  readonly state: VitrineProjectState;
  readonly presentation: VitrinePresentation;
  readonly embeddedError?: unknown;
}

export function vitrineAutoOpenStorageKey(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): string {
  return `${VITRINE_AUTO_OPEN_STORAGE_PREFIX}:${encodeURIComponent(environmentId)}:${encodeURIComponent(projectId)}`;
}

export function readVitrineAutoOpenIntent(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  try {
    return (
      getLocalStorageItem(vitrineAutoOpenStorageKey(environmentId, projectId), Schema.Boolean) ===
      true
    );
  } catch {
    return false;
  }
}

export function rememberVitrineAutoOpenIntent(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  try {
    setLocalStorageItem(vitrineAutoOpenStorageKey(environmentId, projectId), true, Schema.Boolean);
    return true;
  } catch {
    return false;
  }
}

export function forgetVitrineAutoOpenIntent(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  try {
    removeLocalStorageItem(vitrineAutoOpenStorageKey(environmentId, projectId));
    return true;
  } catch {
    return false;
  }
}

export function isAllowedManagedVitrineUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const port = Number(url.port);
    return (
      url.protocol === "http:" &&
      ALLOWED_VITRINE_HOSTS.has(url.hostname) &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65_536 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === "/" &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export async function openManagedVitrine(input: {
  readonly projectId: ProjectId;
  readonly ensure: (input: VitrineProjectInput) => Promise<VitrineProjectState>;
  readonly embedded: boolean;
  readonly fallbackExternal: boolean;
  readonly isCurrent?: (() => boolean) | undefined;
  readonly openEmbedded: (url: string) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
}): Promise<OpenManagedVitrineResult> {
  const state = await input.ensure({ projectId: input.projectId });
  if (input.isCurrent && !input.isCurrent()) {
    return { state, presentation: "cancelled" };
  }
  if (state.projectId !== input.projectId) {
    throw new Error("Vitrine returned state for a different project.");
  }
  if (state.status !== "ready") {
    return { state, presentation: "not-ready" };
  }
  if (
    !state.url ||
    !state.port ||
    !isAllowedManagedVitrineUrl(state.url) ||
    Number(new URL(state.url).port) !== state.port
  ) {
    throw new Error("Vitrine returned an unsafe or malformed browser URL.");
  }

  if (!input.embedded) {
    await input.openExternal(state.url);
    return { state, presentation: "external" };
  }

  try {
    await input.openEmbedded(state.url);
    return { state, presentation: "embedded" };
  } catch (embeddedError) {
    if (!input.fallbackExternal) {
      throw embeddedError;
    }
    if (input.isCurrent && !input.isCurrent()) {
      return { state, presentation: "cancelled", embeddedError };
    }
    await input.openExternal(state.url);
    return { state, presentation: "external", embeddedError };
  }
}
