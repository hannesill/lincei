import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import { actoolMajorVersion, installLinceiMacIconCatalog } from "./macIconCatalog.mjs";

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
