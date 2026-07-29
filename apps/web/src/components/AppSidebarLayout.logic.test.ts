import { describe, expect, it } from "vitest";

import { resolveSidebarImplementation } from "./AppSidebarLayout.logic";

describe("Sidebar implementation rollout", () => {
  it("uses Sidebar v2 by default for alpha session routes", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: false,
        clientSettingsHydrated: true,
      }),
    ).toBe("v2");
  });

  it("honors the persisted Sidebar v1 rollback flag", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: true,
        clientSettingsHydrated: true,
      }),
    ).toBe("v1");
  });

  it("keeps the settings navigation on Sidebar v1 during qualification", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/settings/appearance",
        sidebarV1RollbackEnabled: false,
        clientSettingsHydrated: true,
      }),
    ).toBe("v1");
  });

  it("never mounts Sidebar v2 before a persisted rollback flag hydrates", () => {
    expect([
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: false,
        clientSettingsHydrated: false,
      }),
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: true,
        clientSettingsHydrated: true,
      }),
    ]).toEqual(["v1", "v1"]);
  });
});
