// @effect-diagnostics nodeBuiltinImport:off
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import { bundledLinceiSkills, linceiContentHash } from "@t3tools/shared/linceiSkills";
import { inspectSkillSyncTarget, syncSkillToProviderTarget } from "./SkillSyncService.ts";

let tmpRoot = "";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lincei-skill-sync-"));
});

afterEach(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("SkillSyncService", () => {
  it("syncs missing bundled skills and writes a managed sidecar", async () => {
    const skill = bundledLinceiSkills()[0]!;
    const target = {
      provider: ProviderDriverKind.make("codex"),
      skillDirectory: path.join(tmpRoot, "codex", skill.id),
    };

    const result = await syncSkillToProviderTarget({
      skill,
      target,
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(result.state).toBe("current");
    expect(await fs.readFile(path.join(target.skillDirectory, "SKILL.md"), "utf8")).toBe(
      skill.body,
    );
    const sidecar = JSON.parse(
      await fs.readFile(path.join(target.skillDirectory, ".lincei-skill-sync.json"), "utf8"),
    );
    expect(sidecar).toMatchObject({
      skillId: skill.id,
      contentHash: skill.contentHash,
      installMode: "managed-copy",
      targetProvider: "codex",
    });
  });

  it("does not overwrite provider copies changed after the last sync", async () => {
    const skill = bundledLinceiSkills()[0]!;
    const target = {
      provider: ProviderDriverKind.make("codex"),
      skillDirectory: path.join(tmpRoot, "codex", skill.id),
    };
    await syncSkillToProviderTarget({ skill, target, now: "2026-01-01T00:00:00.000Z" });
    await fs.writeFile(path.join(target.skillDirectory, "SKILL.md"), "local edit", "utf8");

    const result = await syncSkillToProviderTarget({
      skill,
      target,
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(result.state).toBe("target-modified");
    expect(await fs.readFile(path.join(target.skillDirectory, "SKILL.md"), "utf8")).toBe(
      "local edit",
    );
  });

  it("reports conflict when canonical and target copies both changed", async () => {
    const original = bundledLinceiSkills()[0]!;
    const updated = {
      ...original,
      body: `${original.body}\n\nNew guidance.`,
      contentHash: linceiContentHash(`${original.body}\n\nNew guidance.`),
    };
    const target = {
      provider: ProviderDriverKind.make("codex"),
      skillDirectory: path.join(tmpRoot, "codex", original.id),
    };
    await syncSkillToProviderTarget({ skill: original, target, now: "2026-01-01T00:00:00.000Z" });
    await fs.writeFile(path.join(target.skillDirectory, "SKILL.md"), "local edit", "utf8");

    const result = await syncSkillToProviderTarget({
      skill: updated,
      target,
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(result.state).toBe("conflict");
    expect(await inspectSkillSyncTarget({ skill: updated, target })).toMatchObject({
      state: "conflict",
    });
  });
});
