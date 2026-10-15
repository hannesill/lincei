// @effect-diagnostics nodeBuiltinImport:off - Reads the NSIS script that electron-builder includes.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { getDesktopScheme } from "../electron/ElectronProtocol.ts";

const installerScript = NodeFS.readFileSync(
  NodeURL.fileURLToPath(new URL("../../resources/installer.nsh", import.meta.url)),
  "utf8",
);

describe("Windows uninstaller", () => {
  // The script spells the scheme out, because NSIS cannot read it from the app. A scheme that
  // drifted would leave Lincei's key behind or, worse, remove another app's.
  it("removes the scheme the installed app registers, and no other key", () => {
    const schemeKey = `Software\\Classes\\${getDesktopScheme(false)}`;
    const keys = Array.from(
      installerScript.matchAll(/^\s*(?:ReadRegStr\s+\$\d|DeleteRegKey)\s+HKCU\s+"([^"]+)"/gm),
      (match) => match[1],
    );

    expect(keys).toEqual([`${schemeKey}\\shell\\open\\command`, schemeKey]);
    expect(installerScript).not.toMatch(/HKLM|HKCR|DeleteRegValue/);
  });
});
