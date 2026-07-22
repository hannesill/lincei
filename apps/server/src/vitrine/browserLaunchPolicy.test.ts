import { describe, expect, it } from "vitest";

import { isVitrineBrowserLaunchPolicyAllowed } from "./browserLaunchPolicy.ts";

describe("isVitrineBrowserLaunchPolicyAllowed", () => {
  it.each(["desktop-managed-local", "loopback-browser"] as const)("allows %s", (policy) => {
    expect(isVitrineBrowserLaunchPolicyAllowed(policy)).toBe(true);
  });

  it.each(["remote-reachable", "unsafe-no-auth"] as const)("rejects %s", (policy) => {
    expect(isVitrineBrowserLaunchPolicyAllowed(policy)).toBe(false);
  });
});
