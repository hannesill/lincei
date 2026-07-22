import type {
  EnvironmentId,
  ProjectId,
  ServerAuthPolicy,
  VitrineProjectInput,
  VitrineProjectState,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { isAllowedVitrineBrowserUrl } from "@t3tools/shared/vitrine";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "~/hooks/useLocalStorage";

const VITRINE_AUTO_OPEN_STORAGE_PREFIX = "lincei:vitrine:auto-open";
export type VitrinePresentation = "cancelled" | "embedded" | "external" | "not-ready";

export interface OpenManagedVitrineResult {
  readonly state: VitrineProjectState;
  readonly presentation: VitrinePresentation;
  readonly embeddedError?: unknown;
}

export function isVitrineResearchAvailable(input: {
  readonly projectEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primaryTargetLoopback: boolean;
  readonly primaryAuthPolicy: ServerAuthPolicy | null;
}): boolean {
  return (
    input.primaryEnvironmentId !== null &&
    input.projectEnvironmentId === input.primaryEnvironmentId &&
    input.primaryTargetLoopback &&
    (input.primaryAuthPolicy === "desktop-managed-local" ||
      input.primaryAuthPolicy === "loopback-browser")
  );
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
  if (!state.url || !state.port || !isAllowedVitrineBrowserUrl(state.url, state.port)) {
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
