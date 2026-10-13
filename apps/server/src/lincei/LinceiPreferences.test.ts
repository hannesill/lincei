import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";

const agentsAreTold = () => buildRuntimeInstructions({ harness: "test" });

/** A server over one home directory; building it again is a restart. */
const serverOver = (baseDir: string) =>
  LinceiPreferences.layer.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

const withHome = <A, E>(
  use: (baseDir: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-preferences-" });
    return yield* use(baseDir);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("LinceiPreferences", () => {
  it.effect("starts in researcher mode and tells agents who they work with", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        const preferences = yield* LinceiPreferences.LinceiPreferences;
        expect(yield* preferences.get).toEqual({ techieMode: false });
        expect(agentsAreTold()).toContain("<lincei_researcher>");
      }).pipe(Effect.provide(serverOver(baseDir))),
    ),
  );

  it.effect("turning Techie mode on changes what agents are told at once", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        const preferences = yield* LinceiPreferences.LinceiPreferences;
        expect(yield* preferences.update({ techieMode: true })).toEqual({ techieMode: true });
        expect(agentsAreTold()).not.toContain("<lincei_researcher>");
        expect(agentsAreTold()).toContain("<lincei_clinical_research>");

        yield* preferences.update({ techieMode: false });
        expect(agentsAreTold()).toContain("<lincei_researcher>");
      }).pipe(Effect.provide(serverOver(baseDir))),
    ),
  );

  it.effect("keeps the mode across a restart", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const preferences = yield* LinceiPreferences.LinceiPreferences;
          yield* preferences.update({ techieMode: true });
        }).pipe(Effect.provide(serverOver(baseDir)));

        yield* Effect.gen(function* () {
          const preferences = yield* LinceiPreferences.LinceiPreferences;
          expect(yield* preferences.get).toEqual({ techieMode: true });
          expect(agentsAreTold()).not.toContain("<lincei_researcher>");
        }).pipe(Effect.provide(serverOver(baseDir)));
      }),
    ),
  );

  it.effect("treats an unreadable file as nobody having chosen", () =>
    withHome((baseDir) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* Effect.map(
          ServerConfig.ServerConfig,
          (config) => config.stateDir,
        ).pipe(Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
        yield* fileSystem.makeDirectory(stateDir, { recursive: true });
        yield* fileSystem.writeFileString(path.join(stateDir, "lincei.json"), "{ not json");

        yield* Effect.gen(function* () {
          const preferences = yield* LinceiPreferences.LinceiPreferences;
          expect(yield* preferences.get).toEqual({ techieMode: false });
        }).pipe(Effect.provide(serverOver(baseDir)));
      }),
    ),
  );
});
