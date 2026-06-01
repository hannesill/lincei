import { describe, expect, it } from "vitest";
import { ProviderDriverKind, type ModelCapabilities } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import { buildServerProvider, providerModelsFromSettings } from "./providerSnapshot.ts";

const OPENCODE_CUSTOM_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [{ id: "build", label: "Build", isDefault: true }],
      currentValue: "build",
    },
  ],
});

describe("providerModelsFromSettings", () => {
  it("applies the provided capabilities to custom models", () => {
    const models = providerModelsFromSettings(
      [],
      ProviderDriverKind.make("opencode"),
      ["openai/gpt-5"],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "openai/gpt-5",
        name: "openai/gpt-5",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
    ]);
  });
});

describe("buildServerProvider", () => {
  it("adds merged Lincei skills ahead of provider-native skills", () => {
    const provider = buildServerProvider({
      driver: ProviderDriverKind.make("codex"),
      presentation: { displayName: "Codex" },
      enabled: true,
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      probe: {
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "authenticated" },
      },
      skills: [
        {
          name: "native-review",
          path: "/native/review/SKILL.md",
          enabled: true,
          scope: "user",
        },
      ],
    });

    expect(provider.skills.map((skill) => skill.name).slice(0, 2)).toEqual([
      "lincei-api",
      "lincei-cards-api",
    ]);
    expect(provider.skills.at(-1)).toMatchObject({
      name: "native-review",
      linceiSyncStatus: "unmanaged",
    });
  });
});
