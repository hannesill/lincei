// Lincei's macOS 26 icon for the bundle electron-launcher.mjs builds around Electron, the local
// counterpart to what scripts/lincei/macIcon.ts does for release builds. A bundle with only an
// icon.icns gets redrawn by Tahoe as gray Liquid Glass; one whose CFBundleIconName names an icon in
// its Assets.car is drawn from that icon, which scripts/lincei/icons.ts writes flat.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const ICON_NAME = "Lincei";
// Lincei's counterpart to upstream's LAUNCHER_VERSION, which Lincei leaves alone so that both
// never bump it to the same number. Raise it when a Lincei change needs local bundles rebuilt.
const LINCEI_LAUNCHER_REVISION = 1;

const projectPath = (macIconPng) =>
  NodePath.join(NodePath.dirname(macIconPng), `${ICON_NAME}.icon`);

function mtimeMs(path) {
  try {
    return NodeFS.statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function selectedDeveloperDir() {
  if (process.env.DEVELOPER_DIR) {
    return process.env.DEVELOPER_DIR;
  }
  try {
    return NodeFS.readlinkSync("/var/db/xcode_select_link");
  } catch {
    return "/Applications/Xcode.app/Contents/Developer";
  }
}

/**
 * Lincei's part of the launcher's bundle cache key: changes with LINCEI_LAUNCHER_REVISION, when
 * the icon project does, or when the actool that xcrun
 * would run is installed, updated or switched, so a bundle built without the catalog is rebuilt
 * once actool can compile it. It only reads the file system, because it runs on every launch and
 * xcrun can take seconds when its lookup cache is cold.
 */
export function linceiMacIconCatalogKey(macIconPng) {
  const developerDir = selectedDeveloperDir();
  return [
    LINCEI_LAUNCHER_REVISION,
    mtimeMs(NodePath.join(projectPath(macIconPng), "icon.json")),
    developerDir,
    mtimeMs(NodePath.join(developerDir, "usr", "bin", "actool")),
  ].join(" ");
}

/** The major version of Xcode's actool, or 0 when there is none. */
export function actoolMajorVersion() {
  const result = NodeChildProcess.spawnSync("xcrun", ["actool", "--version"], { encoding: "utf8" });
  const match = /<key>short-bundle-version<\/key>\s*<string>(\d+)/.exec(result.stdout ?? "");
  return match ? Number(match[1]) : 0;
}

/**
 * Compiles the Icon Composer project beside `macIconPng` (assets/<variant>/Lincei.icon) into the
 * bundle's Assets.car and names it in CFBundleIconName with the launcher's `setPlistString`. Call
 * it before the bundle is signed. Returns whether it did: an actool older than Xcode 26 compiles no
 * .icon, and then the bundle keeps its icon.icns, because a dev launch must never fail over its icon.
 * `linceiMacIconCatalogKey` in the launcher's cache metadata brings the bundle back here once a newer
 * actool is installed or selected.
 */
export function installLinceiMacIconCatalog(macIconPng, appBundlePath, setPlistString) {
  const project = projectPath(macIconPng);
  if (!NodeFS.existsSync(project) || actoolMajorVersion() < 26) {
    return false;
  }

  const outputDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lincei-icon-"));
  try {
    // The same compile as scripts/lincei/macIcon.ts; 13.0 is Electron's LSMinimumSystemVersion.
    const result = NodeChildProcess.spawnSync(
      "xcrun",
      [
        "actool",
        project,
        "--compile",
        outputDir,
        "--platform",
        "macosx",
        "--target-device",
        "mac",
        "--minimum-deployment-target",
        "13.0",
        "--app-icon",
        ICON_NAME,
        "--output-partial-info-plist",
        NodePath.join(outputDir, "partial-info.plist"),
      ],
      { encoding: "utf8" },
    );
    const catalog = NodePath.join(outputDir, "Assets.car");
    if (!NodeFS.existsSync(catalog)) {
      throw new Error(result.stderr || result.stdout || "actool wrote no Assets.car");
    }
    const contentsDir = NodePath.join(appBundlePath, "Contents");
    NodeFS.copyFileSync(catalog, NodePath.join(contentsDir, "Resources", "Assets.car"));
    setPlistString(NodePath.join(contentsDir, "Info.plist"), "CFBundleIconName", ICON_NAME);
    return true;
  } catch (error) {
    const runtimeDir = NodePath.dirname(appBundlePath);
    console.warn(
      `[desktop-launcher] Kept the legacy app icon; delete ${runtimeDir} to retry: ${String(error).trim()}`,
    );
    return false;
  } finally {
    NodeFS.rmSync(outputDir, { recursive: true, force: true });
  }
}
