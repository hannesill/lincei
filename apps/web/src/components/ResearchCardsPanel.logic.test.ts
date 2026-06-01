import { describe, expect, it, vi } from "vitest";
import { SessionId, type EnvironmentApi } from "@t3tools/contracts";

import { loadResearchArtifactPreview } from "./ResearchCardsPanel.logic";

const makeStudyApi = (overrides: Partial<EnvironmentApi["study"]>): EnvironmentApi["study"] =>
  ({
    getStatus: vi.fn(),
    listArtifacts: vi.fn(),
    getArtifact: vi.fn(),
    previewArtifact: vi.fn(),
    previewFile: vi.fn(),
    ...overrides,
  }) as EnvironmentApi["study"];

describe("loadResearchArtifactPreview", () => {
  it("previews artifacts by stable id", async () => {
    const sessionId = SessionId.make("session-1");
    const study = makeStudyApi({
      previewArtifact: vi.fn(
        async () =>
          ({
            artifact: {
              artifact: {
                schemaVersion: 1,
                id: "artifact-1",
                kind: "csv",
                relativePath: "outputs/cohort.csv",
                size: 8,
                contentHash: "sha256:abc",
                createdAt: "2026-05-31T00:00:00.000Z",
                updatedAt: "2026-05-31T00:00:00.000Z",
              },
              relativePath: "outputs/cohort.csv",
              status: "current",
              currentSize: 8,
              currentMimeType: "text/csv",
              currentContentHash: "sha256:abc",
            },
            preview: {
              relativePath: "outputs/cohort.csv",
              mimeType: "text/csv",
              size: 8,
              contentHash: "sha256:abc",
              previewable: true,
              truncated: false,
              text: "a,b\n",
              reason: null,
            },
          }) as Awaited<ReturnType<EnvironmentApi["study"]["previewArtifact"]>>,
      ),
    });

    await expect(
      loadResearchArtifactPreview({
        study,
        sessionId,
        artifact: { id: "artifact-1", kind: "csv", path: "legacy.csv" },
      }),
    ).resolves.toMatchObject({
      text: "a,b\n",
      detail: "outputs/cohort.csv · current · 8 bytes · #abc",
    });
    expect(study.previewArtifact).toHaveBeenCalledWith({
      sessionId,
      artifactId: "artifact-1",
    });
    expect(study.previewFile).not.toHaveBeenCalled();
  });

  it("falls back to path preview for legacy path-only cards", async () => {
    const sessionId = SessionId.make("session-1");
    const study = makeStudyApi({
      previewArtifact: vi.fn(async () => {
        throw new Error("missing manifest");
      }),
      previewFile: vi.fn(
        async () =>
          ({
            relativePath: "legacy.csv",
            mimeType: "text/csv",
            size: 8,
            contentHash: "sha256:def",
            previewable: true,
            truncated: false,
            text: "legacy\n",
            reason: null,
          }) as Awaited<ReturnType<EnvironmentApi["study"]["previewFile"]>>,
      ),
    });

    await expect(
      loadResearchArtifactPreview({
        study,
        sessionId,
        artifact: { id: "legacy-ref", kind: "csv", path: "legacy.csv" },
      }),
    ).resolves.toEqual({ text: "legacy\n", message: null });
    expect(study.previewFile).toHaveBeenCalledWith({
      sessionId,
      relativePath: "legacy.csv",
    });
  });
});
