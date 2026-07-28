import { describe, expect, it } from "vitest";

import { resolveSidebarImplementation } from "./AppSidebarLayout.logic";

describe("Sidebar implementation rollout", () => {
  it("uses Sidebar v2 by default for alpha session routes", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: false,
      }),
    ).toBe("v2");
  });

  it("honors the persisted Sidebar v1 rollback flag", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/environment/session",
        sidebarV1RollbackEnabled: true,
      }),
    ).toBe("v1");
  });

  it("keeps the settings navigation on Sidebar v1 during qualification", () => {
    expect(
      resolveSidebarImplementation({
        pathname: "/settings/appearance",
        sidebarV1RollbackEnabled: false,
      }),
    ).toBe("v1");
  });
});
