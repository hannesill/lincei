// @effect-diagnostics nodeBuiltinImport:off - Path helper shared with the standalone icons script.
/**
 * Lincei's macOS app icon for macOS 26 (Tahoe): an Icon Composer project compiled into the app's
 * `Assets.car`.
 *
 * Tahoe recognises the classic grid in a legacy `icon.icns` (an 824-point tile inset 100 points),
 * lifts the art off the tile and re-renders it as Liquid Glass, which turns Lincei's ink mark gray
 * and blurs it. An app whose `CFBundleIconName` names an icon in its asset catalog is drawn from
 * that icon instead. `scripts/lincei/icons.ts` writes the project with glass, specular, shadow and
 * translucency off, so Tahoe draws the mark flat. Older macOS reads the flat renditions actool also
 * puts in the catalog, and `icon.icns` stays for whatever reads `CFBundleIconFile`, such as the
 * DMG's volume icon.
 *
 * `scripts/build-desktop-artifact.ts` calls `stageLinceiMacIconCatalog` from `stageMacIcons` and
 * ships the catalog through `LINCEI_MAC_ASSET_CATALOG`. Compiling an `.icon` needs actool from
 * Xcode 26 or newer.
 */
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

/** The icon's name in the asset catalog and in `CFBundleIconName`, and the project's file name. */
export const LINCEI_MAC_ICON_NAME = "Lincei";

/** The project sits beside the macOS PNG that `icons.ts` draws for the same variant. */
export const linceiMacIconProject = (macIconPng: string) =>
  NodePath.join(NodePath.dirname(macIconPng), `${LINCEI_MAC_ICON_NAME}.icon`);

/** electron-builder `extraResources` entry: the staged catalog into `Contents/Resources`. */
export const LINCEI_MAC_ASSET_CATALOG = {
  from: "apps/desktop/prod-resources/Assets.car",
  to: "Assets.car",
} as const;

export class LinceiMacIconCatalogError extends Schema.TaggedError<LinceiMacIconCatalogError>()(
  "LinceiMacIconCatalogError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Lincei's macOS icon catalog: ${this.reason} (${this.path})`;
  }
}

/**
 * Compiles the variant's Icon Composer project with `run` and writes `Assets.car` to
 * `stageResourcesDir`. Fails when actool leaves no catalog, which an actool older than Xcode 26
 * can do without an error.
 */
export function stageLinceiMacIconCatalog<E, R>(
  macIconPng: string,
  stageResourcesDir: string,
  tmpRoot: string,
  run: (command: ChildProcess.Command) => Effect.Effect<void, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const project = linceiMacIconProject(macIconPng);
    if (!(yield* fs.exists(project))) {
      return yield* new LinceiMacIconCatalogError({
        path: project,
        reason: "the Icon Composer project is missing; run node scripts/lincei/icons.ts",
      });
    }

    const outputDir = path.join(tmpRoot, "lincei-icon-catalog");
    yield* fs.makeDirectory(outputDir, { recursive: true });
    yield* run(
      ChildProcess.make("xcrun", [
        "actool",
        project,
        "--compile",
        outputDir,
        "--platform",
        "macosx",
        "--target-device",
        "mac",
        "--minimum-deployment-target",
        // Electron's LSMinimumSystemVersion; the flat renditions for older macOS come with it.
        "13.0",
        "--app-icon",
        LINCEI_MAC_ICON_NAME,
        "--output-partial-info-plist",
        path.join(outputDir, "partial-info.plist"),
      ]),
    );

    const catalog = path.join(outputDir, "Assets.car");
    if (!(yield* fs.exists(catalog))) {
      return yield* new LinceiMacIconCatalogError({
        path: project,
        reason: "actool wrote no Assets.car; compiling an .icon needs Xcode 26 or newer",
      });
    }
    yield* fs.copyFile(catalog, path.join(stageResourcesDir, "Assets.car"));
  });
}
