// @effect-diagnostics nodeBuiltinImport:off - Cross-repository wheel verification uses local temp paths.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../src/config.ts";
import * as M4CliLayer from "../src/datasets/M4Cli.ts";
import * as ProcessRunner from "../src/processRunner.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";
import {
  SkillCatalogService,
  layer as SkillCatalogServiceLive,
} from "../src/skills/SkillCatalogService.ts";

const m4Wheel = process.env.LINCEI_M4_WHEEL?.trim();

describe.skipIf(!m4Wheel)("M4 skills wheel compatibility", () => {
  it("consumes and materializes the real packaged M4 catalog", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "lincei-m4-wheel-"));
    try {
      const settings = ServerSettingsService.layerTest({
        datasets: {
          workspacePath: "",
          preferredBackendId: "duckdb",
          m4Command: `uv run --isolated --no-project --with ${JSON.stringify(m4Wheel)} m4`,
        },
      });
      const processRunner = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
      const nodeRuntime = Layer.mergeAll(NodeServices.layer, processRunner);
      const m4Cli = M4CliLayer.layer.pipe(
        Layer.provideMerge(nodeRuntime),
        Layer.provideMerge(settings),
      );
      const catalogLayer = SkillCatalogServiceLive.pipe(
        Layer.provideMerge(m4Cli),
        Layer.provideMerge(settings),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provideMerge(nodeRuntime),
      );

      const snapshot = await Effect.runPromise(
        Effect.gen(function* () {
          const catalog = yield* SkillCatalogService;
          return yield* catalog.getSnapshot;
        }).pipe(Effect.provide(catalogLayer)),
      );

      const m4Source = snapshot.sources.find((source) => source.publisher === "m4");
      const m4Skills = snapshot.skills.filter((skill) => skill.publisher === "m4");
      expect(m4Source?.state).toBe("ready");
      expect(satisfiesSemverRange(m4Source?.bundleVersion ?? "", ">=0.5.4 <0.6")).toBe(true);
      expect(m4Skills.some((skill) => skill.id === "m4:clinical-research-pitfalls")).toBe(true);
      expect(m4Skills.every((skill) => skill.deliveryState === "managed-cache")).toBe(true);
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
