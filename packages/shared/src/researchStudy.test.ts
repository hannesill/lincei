// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cardManifestPath,
  normalizeStudyRelativePath,
  resolveStudyRecordPaths,
  resolveStudyRelativePath,
} from "./researchStudy.ts";

describe("research study paths", () => {
  it("resolves the study-local .lincei layout under the study root", () => {
    const paths = resolveStudyRecordPaths("/tmp/study");

    expect(paths.linceiDir).toBe(path.resolve("/tmp/study/.lincei"));
    expect(paths.studyManifestPath).toBe(path.resolve("/tmp/study/.lincei/study.json"));
    expect(cardManifestPath("/tmp/study", "card-1")).toBe(
      path.resolve("/tmp/study/.lincei/cards/card-1.json"),
    );
  });

  it("rejects absolute dependency paths", () => {
    expect(() => normalizeStudyRelativePath("/etc/passwd")).toThrow(/absolute/);
    expect(() => normalizeStudyRelativePath("C:\\Users\\research\\secret.txt")).toThrow(/absolute/);
  });

  it("rejects traversal outside the study root", () => {
    expect(() => normalizeStudyRelativePath("../secret.txt")).toThrow(/study root/);
    expect(() => resolveStudyRelativePath("/tmp/study", "src/../../secret.txt")).toThrow(
      /study root/,
    );
  });

  it("normalizes Windows separators to portable relative paths", () => {
    expect(normalizeStudyRelativePath(".\\analysis\\cohort.sql")).toBe("analysis/cohort.sql");
  });
});
