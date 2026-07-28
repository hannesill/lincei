import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import { describe, it } from "vitest";

import {
  loadOpenCodeInventoryFromCli,
  parseAgentListCliOutput,
  parseModelsCliOutput,
} from "./opencodeRuntime.ts";

const successfulModelsCliOutput = [
  "openai/gpt-5.4",
  JSON.stringify({
    id: "gpt-5.4",
    providerID: "openai",
    name: "GPT-5.4",
    family: "gpt",
    capabilities: {
      attachment: false,
      reasoning: true,
      temperature: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: { medium: {} },
  }),
].join("\n");

const successfulAgentsCliOutput = [
  "build (primary)",
  JSON.stringify([{ permission: "*", action: "allow", pattern: "*" }]),
].join("\n");

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

describe("loadOpenCodeInventoryFromCli", () => {
  it("bounds an exhausted agent command to two attempts and preserves models", async () => {
    let modelAttempts = 0;
    let agentAttempts = 0;
    const inventory = await Effect.runPromise(
      loadOpenCodeInventoryFromCli({
        binaryPath: "opencode",
        retryDelay: Effect.void,
        runCommand: ({ args }) =>
          Effect.sync(() => {
            if (args[0] === "models") {
              modelAttempts += 1;
              return { stdout: successfulModelsCliOutput, stderr: "", code: 0 };
            }
            agentAttempts += 1;
            return { stdout: "", stderr: "database is locked", code: 1 };
          }),
      }),
    );

    assert.equal(modelAttempts, 1);
    assert.equal(agentAttempts, 2);
    assert.deepEqual(inventory.providerList.connected, ["openai"]);
    assert.equal(inventory.providerList.all[0]?.models["gpt-5.4"]?.name, "GPT-5.4");
    assert.deepEqual(inventory.agents, []);
    assert.deepEqual(inventory.diagnostics, [
      {
        command: "agents",
        attempts: 2,
        detail: "exited with code 1: database is locked",
      },
    ]);
  });

  it("bounds an exhausted models command to two attempts and preserves agents", async () => {
    let modelAttempts = 0;
    let agentAttempts = 0;
    const inventory = await Effect.runPromise(
      loadOpenCodeInventoryFromCli({
        binaryPath: "opencode",
        retryDelay: Effect.void,
        runCommand: ({ args }) =>
          Effect.sync(() => {
            if (args[0] === "models") {
              modelAttempts += 1;
              return { stdout: "", stderr: "database is locked", code: 1 };
            }
            agentAttempts += 1;
            return { stdout: successfulAgentsCliOutput, stderr: "", code: 0 };
          }),
      }),
    );

    assert.equal(modelAttempts, 2);
    assert.equal(agentAttempts, 1);
    assert.deepEqual(inventory.providerList.connected, []);
    assert.deepEqual(
      inventory.agents.map((agent) => agent.name),
      ["build"],
    );
    assert.deepEqual(inventory.diagnostics, [
      {
        command: "models",
        attempts: 2,
        detail: "exited with code 1: database is locked",
      },
    ]);
  });
});
