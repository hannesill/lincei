import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ResearchArtifactManifest,
  ResearchCardDependency,
  ResearchCardDependencyStatus,
  ResearchCardManifest,
  ResearchRunManifest,
  ResearchStudyManifest,
} from "./researchStudy.ts";

const decodeStudy = Schema.decodeUnknownSync(ResearchStudyManifest);
const decodeDependency = Schema.decodeUnknownSync(ResearchCardDependency);
const decodeRun = Schema.decodeUnknownSync(ResearchRunManifest);
const decodeArtifact = Schema.decodeUnknownSync(ResearchArtifactManifest);
const decodeCard = Schema.decodeUnknownSync(ResearchCardManifest);
const decodeStatus = Schema.decodeUnknownSync(ResearchCardDependencyStatus);

const timestamp = "2026-05-31T00:00:00.000Z";

describe("research study schemas", () => {
  it("decodes portable study, run, artifact, dependency, and card manifests", () => {
    const study = decodeStudy({
      schemaVersion: 1,
      studyId: "study-1",
      title: "Cardiology cohort",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const dependency = decodeDependency({
      id: "dep-1",
      kind: "source",
      relativePath: "analysis/cohort.sql",
      role: "cohort definition",
      contentHash: "sha256:abc",
    });
    const artifact = decodeArtifact({
      schemaVersion: 1,
      id: "artifact-1",
      kind: "csv",
      relativePath: "outputs/cohort.csv",
      mimeType: "text/csv",
      size: 42,
      contentHash: "sha256:def",
      producingRunId: "run-1",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const run = decodeRun({
      schemaVersion: 1,
      id: "run-1",
      command: ["bun", "run", "analysis"],
      cwd: ".",
      startedAt: timestamp,
      finishedAt: timestamp,
      exitCode: 0,
      declaredInputs: [dependency],
      declaredOutputs: [artifact],
    });
    const card = decodeCard({
      schemaVersion: 1,
      id: "card-1",
      card: {
        id: "card-1",
        type: "markdown",
        status: "proposed",
        title: "Cohort definition",
        artifacts: [],
        provenance: [],
        turnId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      dependencyIds: ["dep-1"],
      dependencies: [dependency],
      artifactIds: ["artifact-1"],
      artifacts: [],
      runId: "run-1",
      consistency: { status: "current", checkedAt: timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(study.studyId).toBe("study-1");
    expect(run.declaredInputs).toHaveLength(1);
    expect(card.consistency.status).toBe("current");
  });

  it("rejects malformed dependency status and empty ids", () => {
    expect(() => decodeStatus("fresh")).toThrow();
    expect(() =>
      decodeStudy({
        schemaVersion: 1,
        studyId: "",
        title: "Study",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow();
  });
});
