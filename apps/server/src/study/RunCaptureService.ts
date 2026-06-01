// @effect-diagnostics nodeBuiltinImport:off
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { ResearchRunManifest } from "@t3tools/contracts";
import { runManifestPath, toStudyRelativePath } from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { makeArtifactManifest, writeArtifactManifest } from "./ArtifactRepository.ts";
import { makeDependency } from "./StudyDependencyRepository.ts";
import { initializeStudyRecord } from "./StudyManifestRepository.ts";
import { writeJsonFile } from "./StudyRecordJson.ts";
import { asRunId, nowIso } from "./StudyRecordModel.ts";
import type { RunCaptureInput, RunCaptureResult } from "./StudyRecordTypes.ts";

const encodeRunManifest = Schema.encodeUnknownSync(ResearchRunManifest);
const decodeRunManifestForWrite = Schema.decodeUnknownSync(ResearchRunManifest);

export async function captureRun(input: RunCaptureInput): Promise<RunCaptureResult> {
  await initializeStudyRecord({ studyRoot: input.studyRoot });
  const cwd = input.cwd ? path.resolve(input.cwd) : path.resolve(input.studyRoot);
  const runId = asRunId(`run-${randomUUID()}`);
  const startedAt = nowIso();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(input.command[0], input.command.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const finishedAt = nowIso();
  const declaredInputs = await Promise.all(
    input.deps.map((dep) => makeDependency(input.studyRoot, dep)),
  );
  const declaredOutputs = await Promise.all(
    input.outs.map((out) =>
      makeArtifactManifest({
        studyRoot: input.studyRoot,
        relativePathInput: out,
        producingRunId: runId,
      }),
    ),
  );
  for (const artifact of declaredOutputs) {
    await writeArtifactManifest(input.studyRoot, artifact);
  }
  const cwdRelative =
    path.resolve(cwd) === path.resolve(input.studyRoot)
      ? "."
      : toStudyRelativePath(input.studyRoot, cwd);
  const run = decodeRunManifestForWrite({
    schemaVersion: 1,
    id: runId,
    command: input.command,
    cwd: cwdRelative,
    startedAt,
    finishedAt,
    exitCode,
    declaredInputs,
    declaredOutputs,
  });
  await writeJsonFile(runManifestPath(input.studyRoot, run.id), encodeRunManifest(run));
  return { run };
}
