import { describe, expect, it } from "@effect/vitest";
import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Tool, Toolkit } from "effect/ai";

import * as ClinicalRuntime from "../ClinicalRuntime.ts";
import * as ClinicalHandlers from "./handlers.ts";
import { ClinicalToolkit } from "./tools.ts";

const READY: ClinicalRuntimeStatus = {
  state: "ready",
  message: "The clinical research tools are ready.",
  home: "/lincei/clinical",
  python: "/lincei/clinical/venv/bin/python",
  skillsDir: "/lincei/clinical/skills",
  dataDir: "/lincei/clinical/m4_data",
  requirements: ["m4-infra", "vitrine"],
  demoDataset: "ready",
};

// Upstream's tests build `McpHttpServer.layer`, which registers this toolkit,
// from the services upstream knows. What a tool declares as a dependency
// becomes a requirement of that layer, so this line stops compiling when a
// tool declares the clinical runtime again.
type Declared = Tool.HandlerServices<
  Toolkit.Tools<typeof ClinicalToolkit>[keyof Toolkit.Tools<typeof ClinicalToolkit>]
>;
const needsNoClinicalRuntime: [Extract<Declared, ClinicalRuntime.ClinicalRuntime>] extends [never]
  ? true
  : false = true;

describe("Lincei's agent tools", () => {
  it("leave the clinical runtime out of what the MCP server requires", () => {
    expect(needsNoClinicalRuntime).toBe(true);
  });

  it.effect("say that a server without a clinical runtime has no tools, instead of failing", () =>
    Effect.gen(function* () {
      const answer = yield* ClinicalHandlers.askClinicalRuntime((runtime) => runtime.status);
      expect(answer.state).toBe("not-installed");
      expect(answer.message).toBe("This server has no clinical research tools.");
    }),
  );

  it.effect("ask the clinical runtime where the server has one", () =>
    Effect.gen(function* () {
      const answer = yield* ClinicalHandlers.askClinicalRuntime((runtime) => runtime.status);
      expect(answer).toEqual(READY);
    }).pipe(
      Effect.provide(
        Layer.mock(ClinicalRuntime.ClinicalRuntime)({ status: Effect.succeed(READY) }),
      ),
    ),
  );
});
