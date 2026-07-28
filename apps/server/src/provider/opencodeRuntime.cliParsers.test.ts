import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { parseAgentListCliOutput, parseModelsCliOutput } from "./opencodeRuntime.ts";

describe("parseModelsCliOutput", () => {
  it("groups verbose model blocks by provider and preserves nested metadata", () => {
    const stdout = [
      "anthropic/claude-sonnet-4-5",
      JSON.stringify(
        {
          id: "claude-sonnet-4-5",
          providerID: "anthropic",
          name: "Claude Sonnet 4.5",
          capabilities: { reasoning: true, toolcall: true },
          variants: { low: {}, high: {} },
        },
        null,
        2,
      ),
      "openai/gpt-5",
      JSON.stringify({ id: "gpt-5", providerID: "openai", name: "GPT-5" }),
    ].join("\r\n");

    const parsed = parseModelsCliOutput(stdout);

    assert.deepEqual(parsed.connected.toSorted(), ["anthropic", "openai"]);
    assert.equal(
      parsed.providers.get("anthropic")?.models["claude-sonnet-4-5"]?.name,
      "Claude Sonnet 4.5",
    );
    assert.deepEqual(
      Object.keys(parsed.providers.get("anthropic")?.models["claude-sonnet-4-5"]?.variants ?? {}),
      ["low", "high"],
    );
    assert.equal(parsed.providers.get("openai")?.models["gpt-5"]?.name, "GPT-5");
  });

  it("skips malformed blocks without discarding later valid models", () => {
    const stdout = [
      "anthropic/broken",
      "not valid json",
      "anthropic/claude-haiku",
      JSON.stringify({
        id: "claude-haiku",
        providerID: "anthropic",
        name: "Claude Haiku",
      }),
    ].join("\n");

    const parsed = parseModelsCliOutput(stdout);

    assert.deepEqual(Object.keys(parsed.providers.get("anthropic")?.models ?? {}), [
      "claude-haiku",
    ]);
  });

  it("returns empty inventory for empty output", () => {
    const parsed = parseModelsCliOutput("");

    assert.equal(parsed.providers.size, 0);
    assert.deepEqual(parsed.connected, []);
  });
});

describe("parseAgentListCliOutput", () => {
  it("parses names with spaces and marks OpenCode internal agents hidden", () => {
    const stdout = [
      "code reviewer (subagent)",
      JSON.stringify([{ permission: "read", action: "allow", pattern: "*" }]),
      "compaction (primary)",
      JSON.stringify([{ permission: "*", action: "allow", pattern: "*" }]),
    ].join("\r\n");

    const agents = parseAgentListCliOutput(stdout);

    assert.equal(agents[0]?.name, "code reviewer");
    assert.equal(agents[0]?.mode, "subagent");
    assert.equal(agents[0]?.hidden, false);
    assert.equal(agents[1]?.name, "compaction");
    assert.equal(agents[1]?.hidden, true);
  });

  it("skips malformed permission blocks without discarding later agents", () => {
    const stdout = [
      "broken (primary)",
      "not valid json",
      "plan (primary)",
      JSON.stringify([{ permission: "edit", action: "ask", pattern: "*.md" }]),
    ].join("\n");

    const agents = parseAgentListCliOutput(stdout);

    assert.deepEqual(
      agents.map((agent) => agent.name),
      ["plan"],
    );
  });

  it("returns no agents for empty output", () => {
    assert.deepEqual(parseAgentListCliOutput(""), []);
  });
});
