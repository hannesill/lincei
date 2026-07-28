import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  environmentSupportsSessionSettlement,
  environmentSupportsSessionSnooze,
  getEnvironmentDescriptor,
} from "./capabilities";
import {
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from "./primary";
import {
  resetSavedEnvironmentRuntimeStoreForTests,
  useSavedEnvironmentRuntimeStore,
} from "./runtime";

function makeDescriptor(
  environmentId: EnvironmentId,
  capabilities: ExecutionEnvironmentDescriptor["capabilities"],
): ExecutionEnvironmentDescriptor {
  return {
    environmentId,
    label: environmentId,
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.0-test",
    capabilities,
  };
}

describe("environment lifecycle capabilities", () => {
  beforeEach(() => {
    resetPrimaryEnvironmentDescriptorForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
  });

  it("reads advertised capabilities from primary and saved environments", () => {
    const primaryId = EnvironmentId.make("environment-primary");
    const savedId = EnvironmentId.make("environment-saved");
    writePrimaryEnvironmentDescriptor(
      makeDescriptor(primaryId, {
        repositoryIdentity: true,
        sessionSettlement: true,
        sessionSnooze: true,
      }),
    );
    useSavedEnvironmentRuntimeStore.getState().patch(savedId, {
      descriptor: makeDescriptor(savedId, {
        repositoryIdentity: true,
        sessionSettlement: true,
        sessionSnooze: false,
      }),
    });

    expect(getEnvironmentDescriptor(primaryId)?.environmentId).toBe(primaryId);
    expect(environmentSupportsSessionSettlement(primaryId)).toBe(true);
    expect(environmentSupportsSessionSnooze(primaryId)).toBe(true);
    expect(environmentSupportsSessionSettlement(savedId)).toBe(true);
    expect(environmentSupportsSessionSnooze(savedId)).toBe(false);
  });

  it("treats legacy and unknown environment capabilities as unsupported", () => {
    const legacyId = EnvironmentId.make("environment-legacy");
    useSavedEnvironmentRuntimeStore.getState().patch(legacyId, {
      descriptor: makeDescriptor(legacyId, { repositoryIdentity: true }),
    });

    expect(environmentSupportsSessionSettlement(legacyId)).toBe(false);
    expect(environmentSupportsSessionSnooze(legacyId)).toBe(false);
    expect(environmentSupportsSessionSettlement(EnvironmentId.make("environment-unknown"))).toBe(
      false,
    );
    expect(environmentSupportsSessionSnooze(EnvironmentId.make("environment-unknown"))).toBe(false);
  });
});
