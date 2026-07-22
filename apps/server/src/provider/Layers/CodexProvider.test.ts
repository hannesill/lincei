import { assert, it } from "@effect/vitest";

import { mapCodexModelCapabilities } from "./CodexProvider.ts";

it("maps current and future Codex reasoning effort labels", () => {
  const capabilities = mapCodexModelCapabilities({
    defaultReasoningEffort: "max",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    supportedReasoningEfforts: [
      { reasoningEffort: "max", description: "Maximum reasoning" },
      { reasoningEffort: "ultra", description: "Ultra reasoning" },
      { reasoningEffort: "future-effort", description: "Future reasoning" },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      currentValue: "max",
      options: [
        { id: "max", label: "Max", isDefault: true },
        { id: "ultra", label: "Ultra" },
        { id: "future-effort", label: "future-effort" },
      ],
    },
  ]);
});
