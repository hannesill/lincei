import { describe, expect, it } from "vitest";

import { projectVitrineDataDir } from "./vitrine.ts";

describe("projectVitrineDataDir", () => {
  it("appends project-scoped storage without changing path style", () => {
    expect(projectVitrineDataDir("/repo/project/")).toBe("/repo/project/.vitrine");
    expect(projectVitrineDataDir("C:\\repo\\project\\")).toBe("C:\\repo\\project\\.vitrine");
  });

  it("handles filesystem roots", () => {
    expect(projectVitrineDataDir("/")).toBe("/.vitrine");
    expect(projectVitrineDataDir("C:\\")).toBe("C:\\.vitrine");
  });
});
