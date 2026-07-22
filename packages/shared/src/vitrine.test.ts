import { describe, expect, it } from "vitest";

import { isAllowedVitrineBrowserUrl, projectVitrineDataDir } from "./vitrine.ts";

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

describe("isAllowedVitrineBrowserUrl", () => {
  it.each([
    "http://vitrine.localhost:7741/",
    "http://localhost:7741/",
    "http://127.0.0.1:7741/",
    "http://[::1]:7741/",
  ])("allows a project browser root at %s", (url) => {
    expect(isAllowedVitrineBrowserUrl(url, 7741)).toBe(true);
  });

  it.each([
    "https://vitrine.localhost:7741/",
    "http://example.com:7741/",
    "http://user@vitrine.localhost:7741/",
    "http://vitrine.localhost:7741/study",
    "http://vitrine.localhost:7741/?next=external",
    "not a URL",
  ])("rejects an unsafe browser target at %s", (url) => {
    expect(isAllowedVitrineBrowserUrl(url, 7741)).toBe(false);
  });

  it("requires the reported lifecycle port when supplied", () => {
    expect(isAllowedVitrineBrowserUrl("http://vitrine.localhost:7741/", 8812)).toBe(false);
  });
});
