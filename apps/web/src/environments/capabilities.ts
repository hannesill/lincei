import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

import { readPrimaryEnvironmentDescriptor } from "./primary";
import { getSavedEnvironmentRuntimeState } from "./runtime";

export function getEnvironmentDescriptor(
  environmentId: EnvironmentId,
): ExecutionEnvironmentDescriptor | null {
  const primaryDescriptor = readPrimaryEnvironmentDescriptor();
  if (primaryDescriptor?.environmentId === environmentId) {
    return primaryDescriptor;
  }
  return getSavedEnvironmentRuntimeState(environmentId).descriptor;
}

export function environmentSupportsSessionSettlement(environmentId: EnvironmentId): boolean {
  return getEnvironmentDescriptor(environmentId)?.capabilities.sessionSettlement === true;
}

export function environmentSupportsSessionSnooze(environmentId: EnvironmentId): boolean {
  return getEnvironmentDescriptor(environmentId)?.capabilities.sessionSnooze === true;
}
