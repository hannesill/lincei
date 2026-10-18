// @effect-diagnostics nodeBuiltinImport:off - Reads two upstream sources whose literals the identity script rewrites.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const read = (path: string) =>
  NodeFS.readFileSync(NodeURL.fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("boot service identity", () => {
  // `t3 update` decides whether a running server belongs to the boot service from its cgroup,
  // by a unit name it spells out itself. The identity script rewrites that spelling and the
  // unit bootService.ts installs separately, and when they disagree, `t3 update` warns about
  // a foreground server that the service runs and restarts by itself.
  it("t3 update looks for the unit the boot service installs", () => {
    const serviceName = read("../cloud/bootService.ts").match(
      /const BOOT_SERVICE_NAME = "([^"]+)"/,
    )?.[1];
    const unitInCgroup = read("../cli/update.ts").match(
      /cgroup\.value\.includes\("\/([^"]+)"\)/,
    )?.[1];

    expect(unitInCgroup).toBe(`${serviceName}.service`);
    expect(serviceName).toBe("lincei");
  });
});
