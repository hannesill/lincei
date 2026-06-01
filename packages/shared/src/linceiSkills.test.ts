import { describe, expect, it } from "vitest";
import {
  ProviderDriverKind,
  type LinceiSkillSyncSidecar,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import {
  bundledLinceiSkills,
  buildEffectiveLinceiPrompt,
  configuredBundledLinceiSkills,
  evaluateManagedSkillSyncState,
  linceiContentHash,
  mergeLinceiSkillCatalog,
  projectSkillFromBody,
  shouldAutoSyncSkill,
} from "./linceiSkills.ts";

const sidecar = (contentHash: string, targetHash = contentHash): LinceiSkillSyncSidecar => ({
  skillId: "lincei-api",
  contentHash,
  version: "1.0.0",
  targetProvider: ProviderDriverKind.make("codex"),
  targetPath: "/tmp/SKILL.md",
  syncedAt: "2026-01-01T00:00:00.000Z",
  lastSeenTargetHash: targetHash,
  installMode: "managed-copy",
});

describe("linceiSkills", () => {
  it("hashes content deterministically", () => {
    expect(linceiContentHash("abc")).toBe(linceiContentHash("abc"));
    expect(linceiContentHash("abc")).not.toBe(linceiContentHash("abcd"));
  });

  it("merges bundled, project, and provider-native skills in source-of-truth order", () => {
    const providerSkill: ServerProviderSkill = {
      name: "provider-native",
      path: "/native/SKILL.md",
      scope: "user",
      enabled: true,
      displayName: "Provider Native",
    };
    const projectSkill = projectSkillFromBody({
      id: "project-skill",
      body: "# Project Skill\n\nUse project-specific guidance.",
    });

    const merged = mergeLinceiSkillCatalog({
      bundled: bundledLinceiSkills().slice(0, 1),
      project: [projectSkill],
      providerNative: [providerSkill],
    });

    expect(merged.map((skill) => skill.name)).toEqual([
      "lincei-api",
      "project-skill",
      "provider-native",
    ]);
    expect(merged[0]?.linceiAvailability).toBe("prompt fallback");
    expect(merged[2]?.linceiSyncStatus).toBe("unmanaged");
  });

  it("applies persisted skill settings to bundled skills and prompt injection", () => {
    const configured = configuredBundledLinceiSkills({
      "clinical-research-session": { enabled: false, deployNative: true },
    });

    expect(configured.find((skill) => skill.id === "clinical-research-session")?.enabled).toBe(
      false,
    );

    const prompt = buildEffectiveLinceiPrompt({
      workflowId: "structured-clinical-study",
      skills: configured,
    });
    expect(prompt).not.toContain('<lincei_skill id="clinical-research-session"');
    expect(prompt).toContain('<lincei_skill id="lincei-api"');
  });

  it.each([
    ["current", { canonical: "a", targetExists: true, target: "a", sidecar: sidecar("a") }],
    ["outdated", { canonical: "b", targetExists: true, target: "a", sidecar: sidecar("a") }],
    [
      "target-modified",
      { canonical: "a", targetExists: true, target: "local", sidecar: sidecar("a") },
    ],
    ["missing", { canonical: "a", targetExists: false, target: undefined, sidecar: sidecar("a") }],
    ["unmanaged", { canonical: "a", targetExists: true, target: "a", sidecar: undefined }],
    ["conflict", { canonical: "b", targetExists: true, target: "local", sidecar: sidecar("a") }],
  ] as const)("detects %s sync state", (expected, input) => {
    expect(
      evaluateManagedSkillSyncState({
        canonicalHash: input.canonical,
        targetExists: input.targetExists,
        ...(input.target !== undefined ? { targetHash: input.target } : {}),
        ...(input.sidecar !== undefined ? { sidecar: input.sidecar } : {}),
      }),
    ).toBe(expected);
  });

  it("auto-syncs only bundled safe states", () => {
    const bundled = bundledLinceiSkills()[0]!;
    const project = projectSkillFromBody({ id: "project", body: "# Project" });

    expect(shouldAutoSyncSkill({ skill: bundled, state: "outdated" })).toBe(true);
    expect(shouldAutoSyncSkill({ skill: bundled, state: "target-modified" })).toBe(false);
    expect(shouldAutoSyncSkill({ skill: project, state: "outdated" })).toBe(false);
  });
});
