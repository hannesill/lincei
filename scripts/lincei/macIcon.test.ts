import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { ChildProcess } from "effect/process";

import {
  addLinceiMacIconToBuildConfig,
  LINCEI_MAC_ASSET_CATALOG,
  LinceiMacIconCatalogError,
  stageLinceiMacIconCatalog,
} from "./macIcon.ts";

/** A variant directory with the macOS PNG's path and, unless `withProject` is false, the project. */
const variant = (withProject = true) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-mac-icon-test-" });
    const stageResourcesDir = path.join(root, "resources");
    const tmpRoot = path.join(root, "tmp");
    yield* fs.makeDirectory(stageResourcesDir);
    yield* fs.makeDirectory(tmpRoot);
    if (withProject) {
      yield* fs.makeDirectory(path.join(root, "prod", "Lincei.icon"), { recursive: true });
    }
    return {
      macIconPng: path.join(root, "prod", "black-macos-1024.png"),
      stageResourcesDir,
      tmpRoot,
    };
  });

/** Stands in for actool: writes `catalog` (if any) to the directory after `--compile`. */
const fakeActool = (catalog: string | undefined) => (command: ChildProcess.Command) =>
  Effect.gen(function* () {
    if (catalog === undefined || command._tag !== "StandardCommand") return;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const outputDir = command.args[command.args.indexOf("--compile") + 1]!;
    yield* fs.writeFileString(path.join(outputDir, "Assets.car"), catalog);
  });

it.layer(NodeServices.layer)("stageLinceiMacIconCatalog", (it) => {
  it.effect("stages the catalog actool compiles from the variant's project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { macIconPng, stageResourcesDir, tmpRoot } = yield* variant();

        yield* stageLinceiMacIconCatalog(macIconPng, stageResourcesDir, tmpRoot, fakeActool("car"));

        assert.equal(yield* fs.readFileString(path.join(stageResourcesDir, "Assets.car")), "car");
      }),
    ),
  );

  it.effect("fails when actool leaves no catalog, as one older than Xcode 26 can", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { macIconPng, stageResourcesDir, tmpRoot } = yield* variant();

        const error = yield* stageLinceiMacIconCatalog(
          macIconPng,
          stageResourcesDir,
          tmpRoot,
          fakeActool(undefined),
        ).pipe(Effect.flip);

        assert.instanceOf(error, LinceiMacIconCatalogError);
        assert.include(error.message, "Xcode 26");
      }),
    ),
  );

  it.effect("fails before compiling when the variant has no project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { macIconPng, stageResourcesDir, tmpRoot } = yield* variant(false);
        let compiled = false;

        const error = yield* stageLinceiMacIconCatalog(macIconPng, stageResourcesDir, tmpRoot, () =>
          Effect.sync(() => void (compiled = true)),
        ).pipe(Effect.flip);

        assert.instanceOf(error, LinceiMacIconCatalogError);
        assert.isFalse(compiled);
      }),
    ),
  );
});

it("adds the catalog and CFBundleIconName to the mac config and keeps upstream's entries", () => {
  const build: Record<string, unknown> = {
    mac: {
      icon: "icon.icns",
      extendInfo: { NSScreenCaptureUsageDescription: "capture" },
    },
  };

  addLinceiMacIconToBuildConfig(build);

  assert.deepStrictEqual(build.mac, {
    icon: "icon.icns",
    extraResources: [LINCEI_MAC_ASSET_CATALOG],
    extendInfo: { NSScreenCaptureUsageDescription: "capture", CFBundleIconName: "Lincei" },
  });
});
