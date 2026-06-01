// @effect-diagnostics nodeBuiltinImport:off
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { ResearchCardId } from "@t3tools/contracts";

import {
  buildCardArtifactReferences,
  captureRun,
  getArtifact,
  getStudyStatus,
  hashStudyFile,
  initializeStudyRecord,
  listArtifacts,
  previewArtifact,
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

  it("initializes the study .gitignore idempotently", async () => {
    const studyRoot = await makeTempStudy();

    await initializeStudyRecord({ studyRoot });
    await initializeStudyRecord({ studyRoot });

    const gitignore = await fs.readFile(path.join(studyRoot, ".lincei", ".gitignore"), "utf8");
    expect(gitignore.split("\n").filter((line) => line === "artifacts/*")).toHaveLength(1);
    expect(gitignore.split("\n").filter((line) => line === "!artifacts/.gitkeep")).toHaveLength(1);
    expect(gitignore.split("\n").filter((line) => line === "!artifacts/*.json")).toHaveLength(1);
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

  it("merges dependency index entries across card upserts", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "cohort.sql"), "select 1;\n");
    await fs.writeFile(path.join(studyRoot, "analysis", "outcomes.sql"), "select 2;\n");

    await upsertCardManifest({
      studyRoot,
      card: makeCard("card-1"),
      deps: ["analysis/cohort.sql"],
    });
    await upsertCardManifest({
      studyRoot,
      card: makeCard("card-2"),
      deps: ["analysis/outcomes.sql"],
    });

    await expect(
      fs
        .readFile(path.join(studyRoot, ".lincei", "indexes", "dependencies.json"), "utf8")
        .then((content) => JSON.parse(content) as unknown),
    ).resolves.toEqual([
      {
        cardId: "card-1",
        dependencyId: expect.any(String),
        relativePath: "analysis/cohort.sql",
      },
      {
        cardId: "card-2",
        dependencyId: expect.any(String),
        relativePath: "analysis/outcomes.sql",
      },
    ]);
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

  it("looks up and previews captured artifacts by stable id", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "input.txt"), "input\n");

    const result = await captureRun({
      studyRoot,
      deps: ["analysis/input.txt"],
      outs: ["analysis/output.csv"],
      command: [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync('analysis/output.csv', 'a,b\\n1,2\\n')",
      ],
    });
    const artifactId = result.run.declaredOutputs[0]!.id;

    await expect(listArtifacts(studyRoot)).resolves.toMatchObject({
      artifacts: [{ artifact: { id: artifactId }, status: "current" }],
    });
    await expect(getArtifact({ studyRoot, artifactId })).resolves.toMatchObject({
      artifact: { id: artifactId, relativePath: "analysis/output.csv" },
      status: "current",
      currentMimeType: "text/csv",
    });
    await expect(previewArtifact({ studyRoot, artifactId })).resolves.toMatchObject({
      artifact: { artifact: { id: artifactId }, status: "current" },
      preview: { previewable: true, text: "a,b\n1,2\n" },
    });
  });

  it("reports stale and missing artifacts without throwing", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "output.txt"), "first\n");
    const artifacts = await buildCardArtifactReferences({
      studyRoot,
      artifacts: [{ id: "legacy-output", kind: "other", path: "analysis/output.txt" }],
    });
    const artifactId = artifacts[0]!.id;

    await fs.writeFile(path.join(studyRoot, "analysis", "output.txt"), "second\n");
    await expect(getArtifact({ studyRoot, artifactId })).resolves.toMatchObject({
      status: "stale",
    });

    await fs.unlink(path.join(studyRoot, "analysis", "output.txt"));
    await expect(previewArtifact({ studyRoot, artifactId })).resolves.toMatchObject({
      artifact: { status: "missing" },
      preview: { previewable: false, reason: "missing" },
    });
  });

  it("rejects artifact manifests that point outside the study root", async () => {
    const studyRoot = await makeTempStudy();
    await initializeStudyRecord({ studyRoot });
    await fs.writeFile(
      path.join(studyRoot, ".lincei", "artifacts", "artifact-bad.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "artifact-bad",
          kind: "other",
          relativePath: "../secret.txt",
          size: 0,
          contentHash: "sha256:bad",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        null,
        2,
      ),
    );

    await expect(getArtifact({ studyRoot, artifactId: "artifact-bad" })).rejects.toThrow(
      "must stay within the study root",
    );
  });

  it("enriches card artifact references from artifact ids and path refs", async () => {
    const studyRoot = await makeTempStudy();
    await fs.mkdir(path.join(studyRoot, "analysis"), { recursive: true });
    await fs.writeFile(path.join(studyRoot, "analysis", "table.csv"), "a\n1\n");
    const [artifact] = await buildCardArtifactReferences({
      studyRoot,
      artifacts: [{ id: "path-ref", kind: "csv", path: "analysis/table.csv" }],
    });
    expect(artifact?.id).not.toBe("path-ref");
    expect(artifact).toMatchObject({
      kind: "csv",
      path: "analysis/table.csv",
      mimeType: "text/csv",
    });

    const manifest = await upsertCardManifest({
      studyRoot,
      card: makeCard(),
      artifactIds: [artifact!.id],
    });

    expect(manifest.artifactIds).toEqual([artifact!.id]);
    expect(manifest.artifacts[0]).toMatchObject({
      id: artifact!.id,
      path: "analysis/table.csv",
      contentHash: artifact!.contentHash,
    });
    expect(manifest.card.artifacts[0]?.id).toBe(artifact!.id);
  });
});
