// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  LinceiCanonicalSkill,
  LinceiSkillSyncSidecar,
  LinceiSkillSyncState,
  ProviderDriverKind,
} from "@t3tools/contracts";
import {
  evaluateManagedSkillSyncState,
  linceiContentHash,
  LINCEI_SKILL_SYNC_SIDECAR,
  shouldAutoSyncSkill,
} from "@t3tools/shared/linceiSkills";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

export interface SkillSyncTarget {
  readonly provider: ProviderDriverKind;
  readonly skillDirectory: string;
}

export interface SkillSyncInspection {
  readonly state: LinceiSkillSyncState;
  readonly targetPath: string;
  readonly sidecarPath: string;
  readonly targetHash?: string;
  readonly sidecar?: LinceiSkillSyncSidecar;
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parseSidecar(raw: string | undefined): LinceiSkillSyncSidecar | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LinceiSkillSyncSidecar>;
    if (
      typeof parsed.skillId !== "string" ||
      typeof parsed.contentHash !== "string" ||
      typeof parsed.version !== "string" ||
      typeof parsed.targetProvider !== "string" ||
      typeof parsed.targetPath !== "string" ||
      typeof parsed.syncedAt !== "string" ||
      typeof parsed.lastSeenTargetHash !== "string" ||
      parsed.installMode !== "managed-copy"
    ) {
      return undefined;
    }
    return parsed as LinceiSkillSyncSidecar;
  } catch {
    return undefined;
  }
}

export async function inspectSkillSyncTarget(input: {
  readonly skill: LinceiCanonicalSkill;
  readonly target: SkillSyncTarget;
}): Promise<SkillSyncInspection> {
  const targetPath = path.join(input.target.skillDirectory, "SKILL.md");
  const sidecarPath = path.join(input.target.skillDirectory, LINCEI_SKILL_SYNC_SIDECAR);
  const [targetBody, sidecarBody] = await Promise.all([
    readOptionalFile(targetPath),
    readOptionalFile(sidecarPath),
  ]);
  const targetHash = targetBody === undefined ? undefined : linceiContentHash(targetBody);
  const sidecar = parseSidecar(sidecarBody);
  const state = evaluateManagedSkillSyncState({
    canonicalHash: input.skill.contentHash,
    targetExists: targetBody !== undefined,
    ...(targetHash !== undefined ? { targetHash } : {}),
    ...(sidecar !== undefined ? { sidecar } : {}),
  });

  return {
    state,
    targetPath,
    sidecarPath,
    ...(targetHash !== undefined ? { targetHash } : {}),
    ...(sidecar !== undefined ? { sidecar } : {}),
  };
}

function writeAtomic(filePath: string, contents: string): Promise<void> {
  return Effect.runPromise(
    writeFileStringAtomically({ filePath, contents }).pipe(Effect.provide(NodeServices.layer)),
  );
}

export async function syncSkillToProviderTarget(input: {
  readonly skill: LinceiCanonicalSkill;
  readonly target: SkillSyncTarget;
  readonly now?: string;
}): Promise<SkillSyncInspection> {
  const inspection = await inspectSkillSyncTarget(input);
  if (!shouldAutoSyncSkill({ skill: input.skill, state: inspection.state })) {
    return inspection;
  }

  await fs.mkdir(input.target.skillDirectory, { recursive: true });
  const syncedAt = input.now ?? new Date().toISOString();
  const sidecar: LinceiSkillSyncSidecar = {
    skillId: input.skill.id,
    contentHash: input.skill.contentHash,
    version: input.skill.version,
    targetProvider: input.target.provider,
    targetPath: inspection.targetPath,
    syncedAt,
    lastSeenTargetHash: input.skill.contentHash,
    installMode: "managed-copy",
  };
  await writeAtomic(inspection.targetPath, input.skill.body);
  await writeAtomic(inspection.sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  return inspectSkillSyncTarget(input);
}
