import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ServerConfig } from "../../config.ts";
import { resolveClaudeCapabilitiesProbeContext } from "./ClaudeDriver.ts";

it.effect("uses ServerConfig cwd for the production Claude capability probe context", () =>
  Effect.gen(function* () {
    const cwd = "/workspace/clinical-study";
    const context = yield* resolveClaudeCapabilitiesProbeContext({
      binaryPath: "claude",
      homePath: "",
    }).pipe(Effect.provide(ServerConfig.layerTest(cwd, { prefix: "lincei-claude-driver-" })));

    expect(context.cwd).toBe(cwd);
    expect(context.cacheKey.endsWith(`\0${cwd}`)).toBe(true);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
