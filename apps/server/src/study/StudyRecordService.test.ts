// @effect-diagnostics nodeBuiltinImport:off
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { ResearchCardId } from "@t3tools/contracts";

import {
  captureRun,
  getStudyStatus,
  hashStudyFile,
  initializeStudyRecord,
  previewStudyFile,
  upsertCardManifest,
} from "./StudyRecordService.ts";

const timestamp = "2026-05-31T00:00:00.000Z";

async function makeTempStudy(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lincei-study-"));
}

function makeCard(id = "card-1") {
  return {
    id: ResearchCardId.make(id),
    type: "markdown" as const,
    status: "proposed" as const,
    title: "Cohort definition",
    artifacts: [],
    provenance: [],
    turnId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("StudyRecordService", () => {
  it("initializes the .lincei layout", async () => {
    const studyRoot = await makeTempStudy();
    const manifest = await initializeStudyRecord({ studyRoot, title: "Demo study" });

    expect(manifest.title).toBe("Demo study");
    await expect(fs.stat(path.join(studyRoot, ".lincei", "study.json"))).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(studyRoot, ".lincei", "cards", ".gitkeep")),
    ).resolves.toBeTruthy();
    await expect(
      fs.readFile(path.join(studyRoot, ".lincei", ".gitignore"), "utf8"),
    ).resolves.toContain("artifacts/*");
  });

  it("hashes files deterministically and marks cards current, stale, and missing", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "cohort.sql"), "select 1;\n");

    const firstHash = await hashStudyFile(studyRoot, "analysis/cohort.sql");
    const secondHash = await hashStudyFile(studyRoot, "analysis/cohort.sql");
    expect(firstHash).toBe(secondHash);

    await upsertCardManifest({
      studyRoot,
      card: makeCard(),
      deps: ["analysis/cohort.sql"],
    });
    await expect(getStudyStatus(studyRoot)).resolves.toMatchObject({
      summary: { current: 1, stale: 0, missing: 0, unknown: 0 },
    });

    await fs.writeFile(path.join(studyRoot, "analysis", "cohort.sql"), "select 2;\n");
    await expect(getStudyStatus(studyRoot)).resolves.toMatchObject({
      summary: { current: 0, stale: 1, missing: 0, unknown: 0 },
    });

    await fs.unlink(path.join(studyRoot, "analysis", "cohort.sql"));
    await expect(getStudyStatus(studyRoot)).resolves.toMatchObject({
      summary: { current: 0, stale: 0, missing: 1, unknown: 0 },
    });
  });

  it("captures runs, artifacts, and read-only previews without absolute manifest paths", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "input.txt"), "input\n");

    const result = await captureRun({
      studyRoot,
      deps: ["analysis/input.txt"],
      outs: ["analysis/output.txt"],
      command: [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync('analysis/output.txt', 'output\\n')",
      ],
    });
    const runJson = await fs.readFile(
      path.join(studyRoot, ".lincei", "runs", `${result.run.id}.json`),
      "utf8",
    );

    expect(result.run.exitCode).toBe(0);
    expect(runJson).not.toContain(studyRoot);
    await expect(
      previewStudyFile({ studyRoot, relativePath: "analysis/output.txt" }),
    ).resolves.toMatchObject({
      previewable: true,
      text: "output\n",
    });
  });
});
