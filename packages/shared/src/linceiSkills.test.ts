import { describe, expect, it } from "vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import {
  appendSelectedLinceiSkillPrompts,
  buildSelectedLinceiSkillsPrompt,
  bundledLinceiSkills,
  buildEffectiveLinceiPrompt,
  configuredBundledLinceiSkills,
  enrichServerProviderWithLinceiSkills,
  isExternalProviderSkill,
  isLinceiOwnedProviderSkill,
  isLinceiWorkflowEnabled,
  linceiContentHash,
  linceiSkillTokenPrefixForProvider,
  linceiSkillTokenPrefixForProviderSkill,
  mergeLinceiSkillCatalog,
  parseSelectedLinceiSkillIds,
  projectSkillFromBody,
} from "./linceiSkills.ts";

describe("linceiSkills", () => {
  it("ships only Lincei-owned context without copied M4 or Vitrine APIs", () => {
    const skills = bundledLinceiSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: "lincei:context", version: "3.0.0" });
    expect(skills[0]?.body).not.toContain("from vitrine import");
    expect(skills[0]?.body).not.toContain("# Clinical Research Pitfalls");
  });

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
      "lincei:context",
      "project-skill",
      "provider-native",
    ]);
    expect(merged[0]?.linceiAvailability).toBe("prompt fallback");
    expect(merged[2]?.linceiSyncStatus).toBe("unmanaged");
    expect(merged[2]?.linceiSource).toBe("provider-native");
    expect(merged[2]?.linceiAvailability).toBe("external provider skill");
  });

  it("classifies raw provider skills as external unless they are Lincei-owned", () => {
    expect(
      isExternalProviderSkill({
        path: "/Users/test/.codex/skills/agent-browser/SKILL.md",
      }),
    ).toBe(true);
    expect(
      isExternalProviderSkill({
        path: "/Users/test/.codex/skills/agent-browser/SKILL.md",
        linceiSource: "provider-native",
      }),
    ).toBe(true);
    expect(
      isLinceiOwnedProviderSkill({
        path: "lincei://bundled/lincei:context",
      }),
    ).toBe(true);
    expect(
      isExternalProviderSkill({
        path: "lincei://bundled/lincei:context",
      }),
    ).toBe(false);
  });

  it("uses provider-default visible token prefixes for Lincei-owned skills", () => {
    expect(linceiSkillTokenPrefixForProvider(ProviderDriverKind.make("codex"))).toBe("$");
    expect(linceiSkillTokenPrefixForProvider(ProviderDriverKind.make("claudeAgent"))).toBe("/");
    expect(linceiSkillTokenPrefixForProvider(ProviderDriverKind.make("cursor"))).toBe("/");
    expect(linceiSkillTokenPrefixForProvider(ProviderDriverKind.make("opencode"))).toBe("/");

    expect(
      linceiSkillTokenPrefixForProviderSkill({
        provider: ProviderDriverKind.make("claudeAgent"),
        skill: { path: "lincei://bundled/lincei:context" },
      }),
    ).toBe("/");
    expect(
      linceiSkillTokenPrefixForProviderSkill({
        provider: ProviderDriverKind.make("claudeAgent"),
        skill: { path: "/Users/test/.agents/skills/provider-native/SKILL.md" },
      }),
    ).toBe("$");
  });

  it("enriches raw provider snapshots with settings-aware Lincei skills", () => {
    const provider = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [
        {
          name: "provider-native",
          path: "/Users/test/.agents/skills/provider-native/SKILL.md",
          enabled: true,
        },
      ],
    } satisfies ServerProvider;

    const enriched = enrichServerProviderWithLinceiSkills({ provider });
    expect(enriched.skills.map((skill) => skill.name).slice(0, 1)).toEqual(["lincei:context"]);
    expect(enriched.skills.at(-1)).toMatchObject({
      name: "provider-native",
      linceiSource: "provider-native",
    });

    const disabled = enrichServerProviderWithLinceiSkills({
      provider: enriched,
      skillSettings: {
        "lincei:context": {
          enabled: false,
        },
      },
    });
    expect(disabled.skills.find((skill) => skill.name === "lincei:context")?.enabled).toBe(false);
    expect(disabled.skills.find((skill) => skill.name === "provider-native")).toBeDefined();
  });

  it("parses visible Lincei skill tokens and appends selected XML", () => {
    expect(
      parseSelectedLinceiSkillIds({
        text: "/lincei-api $lincei:context $provider-native",
      }),
    ).toEqual(["lincei:context"]);
    expect(
      parseSelectedLinceiSkillIds({
        text: "/lincei:context",
        skillSettings: {
          "lincei:context": {
            enabled: false,
          },
        },
      }),
    ).toEqual([]);

    const prompt = buildSelectedLinceiSkillsPrompt({ skillIds: ["lincei:context"] });
    expect(prompt).toContain("<lincei_selected_skills>");
    expect(prompt).toContain('<lincei_skill id="lincei:context"');

    const expanded = appendSelectedLinceiSkillPrompts({
      text: "Use /lincei:context for dataset context.",
    });
    expect(expanded).toContain("Use /lincei:context for dataset context.");
    expect(expanded).toContain("<lincei_selected_skills>");
  });

  it("applies persisted skill settings to bundled skills and prompt injection", () => {
    const configured = configuredBundledLinceiSkills({
      "lincei:context": { enabled: false },
    });

    expect(configured.find((skill) => skill.id === "lincei:context")?.enabled).toBe(false);

    const prompt = buildEffectiveLinceiPrompt({
      workflowId: "structured-clinical-study",
      skills: configured,
    });
    expect(prompt).not.toContain('<lincei_skill id="lincei:context"');
    expect(prompt).toContain('<lincei_workflow id="structured-clinical-study"');
  });

  it("omits disabled workflows and their default skill set from the effective prompt", () => {
    expect(isLinceiWorkflowEnabled("structured-clinical-study", undefined)).toBe(true);
    expect(
      isLinceiWorkflowEnabled("structured-clinical-study", {
        "structured-clinical-study": { enabled: false },
      }),
    ).toBe(false);

    const prompt = buildEffectiveLinceiPrompt({
      workflowId: "structured-clinical-study",
      workflowSettings: {
        "structured-clinical-study": { enabled: false },
      },
    });

    expect(prompt).not.toContain('<lincei_workflow id="structured-clinical-study"');
    expect(prompt).not.toContain('<lincei_skill id="lincei:context"');
  });
});
