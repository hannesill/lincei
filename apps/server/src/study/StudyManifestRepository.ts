// @effect-diagnostics nodeBuiltinImport:off
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ResearchStudyManifest } from "@t3tools/contracts";
import { resolveStudyRecordPaths } from "@t3tools/shared/researchStudy";
import * as Schema from "effect/Schema";

import { pathExists, readJsonFile, writeJsonFile } from "./StudyRecordJson.ts";
import { asStudyId, nowIso } from "./StudyRecordModel.ts";
import type { StudyRecordInitInput } from "./StudyRecordTypes.ts";

const encodeStudyManifest = Schema.encodeUnknownSync(ResearchStudyManifest);
const decodeStudyManifest = Schema.decodeUnknownSync(ResearchStudyManifest);

const DEFAULT_STUDY_GITIGNORE_LINES = ["artifacts/*", "!artifacts/.gitkeep", "!artifacts/*.json"];
const DEFAULT_STUDY_GITIGNORE = `${DEFAULT_STUDY_GITIGNORE_LINES.join("\n")}\n`;

async function ensureStudyGitignore(gitignorePath: string): Promise<void> {
  if (!(await pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, DEFAULT_STUDY_GITIGNORE, "utf8");
    return;
  }

  const current = await fs.readFile(gitignorePath, "utf8");
  const currentLines = new Set(current.split(/\r?\n/u));
  const missingLines = DEFAULT_STUDY_GITIGNORE_LINES.filter((line) => !currentLines.has(line));
  if (missingLines.length === 0) {
    return;
  }

  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await fs.writeFile(gitignorePath, `${prefix}${missingLines.join("\n")}\n`, "utf8");
}

export async function initializeStudyRecord(
  input: StudyRecordInitInput,
): Promise<ResearchStudyManifest> {
  const paths = resolveStudyRecordPaths(input.studyRoot);
  await fs.mkdir(paths.cardsDir, { recursive: true });
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  await fs.mkdir(paths.runsDir, { recursive: true });
  await fs.mkdir(paths.indexesDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(paths.cardsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.artifactsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.runsDir, ".gitkeep"), "", { flag: "a" }),
    fs.writeFile(path.join(paths.indexesDir, ".gitkeep"), "", { flag: "a" }),
    ensureStudyGitignore(paths.gitignorePath),
  ]);

  if (await pathExists(paths.studyManifestPath)) {
    return decodeStudyManifest(await readJsonFile(paths.studyManifestPath));
  }

  const timestamp = nowIso();
  const fallbackTitle = path.basename(path.resolve(input.studyRoot)) || "study";
  const manifest: ResearchStudyManifest = {
    schemaVersion: 1,
    studyId: asStudyId(`study-${randomUUID()}`),
    title: input.title?.trim() || fallbackTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeJsonFile(paths.studyManifestPath, encodeStudyManifest(manifest));
  return manifest;
}

export async function readStudyManifest(studyRoot: string): Promise<ResearchStudyManifest> {
  const paths = resolveStudyRecordPaths(studyRoot);
  return decodeStudyManifest(await readJsonFile(paths.studyManifestPath));
}
