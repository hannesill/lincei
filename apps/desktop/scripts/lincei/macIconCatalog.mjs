// Lincei's macOS 26 icon for the bundle electron-launcher.mjs builds around Electron, the local
// counterpart to what scripts/lincei/macIcon.ts does for release builds. A bundle with only an
// icon.icns gets redrawn by Tahoe as gray Liquid Glass; one whose CFBundleIconName names an icon in
// its Assets.car is drawn from that icon, which scripts/lincei/icons.ts writes flat.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const ICON_NAME = "Lincei";

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
 */
export function installLinceiMacIconCatalog(macIconPng, appBundlePath, setPlistString) {
  const project = NodePath.join(NodePath.dirname(macIconPng), `${ICON_NAME}.icon`);
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
    console.warn(`[desktop-launcher] Kept the legacy app icon: ${String(error).trim()}`);
    return false;
  } finally {
    NodeFS.rmSync(outputDir, { recursive: true, force: true });
  }
}
