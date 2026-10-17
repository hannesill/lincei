// @effect-diagnostics nodeBuiltinImport:off - Reads the GNOME extension, which runs inside GNOME Shell.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { resolveLinuxDesktopEntryName } from "../app/DesktopEarlyElectronStartup.ts";

const read = (path: string) =>
  NodeFS.readFileSync(NodeURL.fileURLToPath(new URL(path, import.meta.url)), "utf8");
const quoted = (text: string) => Array.from(text.matchAll(/"([^"]+)"/g), (match) => match[1]);

describe("Linux SnapShots", () => {
  // The extension spells out the bus names it answers, and the desktop derives the one it asks
  // as from its desktop entry. The identity script rewrites both, so they can drift apart, and
  // then every GNOME SnapShot fails with "Only Lincei may request a snapshot".
  it("the GNOME extension answers the bus names the desktop asks as", () => {
    const clientNames = read("../../gnome-extension/captureService.js").match(
      /CLIENT_NAMES = \[([^\]]*)\]/,
    );
    const asked = [false, true].map(
      (isDevelopment) =>
        `${resolveLinuxDesktopEntryName(isDevelopment).replace(/\.desktop$/, "")}.SnapShot`,
    );

    expect(quoted(clientNames?.[1] ?? "")).toEqual(asked);
  });

  it("the desktop calls the D-Bus name the GNOME extension owns", () => {
    const owned = read("../../gnome-extension/extension.js").match(/const NAME = "([^"]+)"/);
    const called = read("../snapShot/LinuxSnapShot.ts").match(/const EXTENSION = "([^"]+)"/);

    expect(called?.[1]).toBe(owned?.[1]);
    expect(owned?.[1]).not.toBe("org.gnome.Shell.Extensions.T3SnapShot");
  });
});
