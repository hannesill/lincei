import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  actoolMajorVersion,
  installLinceiMacIconCatalog,
  linceiMacIconCatalogKey,
} from "./macIconCatalog.mjs";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../..",
);

function makeBundle() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lincei-icon-test-"));
  const appBundlePath = NodePath.join(root, "Lincei (Dev).app");
  NodeFS.mkdirSync(NodePath.join(appBundlePath, "Contents", "Resources"), { recursive: true });
  return { root, appBundlePath };
}

describe("linceiMacIconCatalogKey", () => {
  it("changes when the project or the selected actool changes", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lincei-icon-key-"));
    const developerDir = NodePath.join(root, "Developer");
    const actool = NodePath.join(developerDir, "usr", "bin", "actool");
    const projectJson = NodePath.join(root, "dev", "Lincei.icon", "icon.json");
    const macIconPng = NodePath.join(root, "dev", "blueprint-macos-1024.png");
    const previousDeveloperDir = process.env.DEVELOPER_DIR;
    process.env.DEVELOPER_DIR = developerDir;
    try {
      NodeFS.mkdirSync(NodePath.dirname(projectJson), { recursive: true });
      NodeFS.writeFileSync(projectJson, "{}");
      const withoutActool = linceiMacIconCatalogKey(macIconPng);

      NodeFS.mkdirSync(NodePath.dirname(actool), { recursive: true });
      NodeFS.writeFileSync(actool, "");
      NodeFS.utimesSync(actool, 1_000, 1_000);
      const withActool = linceiMacIconCatalogKey(macIconPng);
      assert.notEqual(withActool, withoutActool);
      assert.equal(linceiMacIconCatalogKey(macIconPng), withActool);

      NodeFS.utimesSync(actool, 2_000, 2_000);
      const withUpdatedActool = linceiMacIconCatalogKey(macIconPng);
      assert.notEqual(withUpdatedActool, withActool);

      NodeFS.utimesSync(projectJson, 3_000, 3_000);
      assert.notEqual(linceiMacIconCatalogKey(macIconPng), withUpdatedActool);
    } finally {
      if (previousDeveloperDir === undefined) {
        delete process.env.DEVELOPER_DIR;
      } else {
        process.env.DEVELOPER_DIR = previousDeveloperDir;
      }
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("installLinceiMacIconCatalog", () => {
  it("leaves the bundle alone when the variant has no Icon Composer project", () => {
    const { root, appBundlePath } = makeBundle();
    const plistWrites = [];
    try {
      const installed = installLinceiMacIconCatalog(
        NodePath.join(root, "missing", "blueprint-macos-1024.png"),
        appBundlePath,
        (...write) => plistWrites.push(write),
      );

      assert.isFalse(installed);
      assert.deepEqual(plistWrites, []);
      assert.deepEqual(
        NodeFS.readdirSync(NodePath.join(appBundlePath, "Contents", "Resources")),
        [],
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(actoolMajorVersion() < 26)(
    "compiles the dev project into Assets.car and names it in CFBundleIconName",
    () => {
      const { root, appBundlePath } = makeBundle();
      const plistWrites = [];
      try {
        const installed = installLinceiMacIconCatalog(
          NodePath.join(repoRoot, "assets", "dev", "blueprint-macos-1024.png"),
          appBundlePath,
          (...write) => plistWrites.push(write),
        );

        assert.isTrue(installed);
        assert.isTrue(
          NodeFS.existsSync(NodePath.join(appBundlePath, "Contents", "Resources", "Assets.car")),
        );
        assert.deepEqual(plistWrites, [
          [NodePath.join(appBundlePath, "Contents", "Info.plist"), "CFBundleIconName", "Lincei"],
        ]);
      } finally {
        NodeFS.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
