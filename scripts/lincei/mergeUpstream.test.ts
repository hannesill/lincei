import { describe, expect, it } from "vite-plus/test";

import { addedIdentityLiterals, classifyConflict, joinAddedLines } from "./merge-upstream.ts";

const hunk = (ours: string, base: string, theirs: string) =>
  `<<<<<<< ours\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> theirs\n`;

describe("joinAddedLines", () => {
  it("keeps upstream's added lines, then Lincei's, where both appended to the same place", () => {
    const text = [
      "export const WsRpcGroup = RpcGroup.make(\n",
      "  WsServerProbeRpc,\n",
      hunk("  WsLinceiRequestRpc,\n", "", "  WsOrchestrationV2SubscribeCommandOutputRpc,\n"),
      ");\n",
    ].join("");

    expect(joinAddedLines(text)).toEqual({
      text: [
        "export const WsRpcGroup = RpcGroup.make(\n",
        "  WsServerProbeRpc,\n",
        "  WsOrchestrationV2SubscribeCommandOutputRpc,\n",
        "  WsLinceiRequestRpc,\n",
        ");\n",
      ].join(""),
      unresolved: 0,
    });
  });

  it("leaves a hunk alone when both sides changed the same existing lines", () => {
    const conflict = hunk(
      "  const navItems = useLinceiSettingsNav(SETTINGS_NAV_ITEMS).filter(\n",
      "  const navItems = SETTINGS_NAV_ITEMS.filter(\n",
      "  const navItems = SETTINGS_NAV_ITEMS.toSorted().filter(\n",
    );
    const text = `${hunk("  b,\n", "", "  a,\n")}${conflict}`;

    expect(joinAddedLines(text)).toEqual({ text: `  a,\n  b,\n${conflict}`, unresolved: 1 });
  });
});

describe("classifyConflict", () => {
  it("sorts conflicts by how a merge resolves them", () => {
    expect(classifyConflict("apps/desktop/package.json")).toBe("governed");
    expect(classifyConflict("README.md")).toBe("lincei-content");
    expect(classifyConflict("apps/web/public/favicon-32x32.png")).toBe("icon");
    expect(classifyConflict("assets/prod/black-macos-1024.png")).toBe("icon");
    expect(classifyConflict("apps/web/src/routeTree.gen.ts")).toBe("route-tree");
    expect(classifyConflict("apps/server/src/server.ts")).toBe("other");
  });
});

describe("addedIdentityLiterals", () => {
  it("finds upstream identity on added lines outside the governed files", () => {
    const diff = [
      "diff --git a/apps/server/src/rendererOrigins.ts b/apps/server/src/rendererOrigins.ts",
      "+++ b/apps/server/src/rendererOrigins.ts",
      '+export const DESKTOP_RENDERER_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;',
      '+const home = config.t3Home ?? path.join(homedir(), ".t3");',
      "+const settings = readT3Json();",
      " const unchanged = 't3code://context';",
      "diff --git a/apps/desktop/package.json b/apps/desktop/package.json",
      "+++ b/apps/desktop/package.json",
      '+  "productName": "T3 Code (Beta)"',
    ].join("\n");

    expect(addedIdentityLiterals(diff)).toEqual([
      {
        file: "apps/server/src/rendererOrigins.ts",
        line: 'export const DESKTOP_RENDERER_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;',
      },
      {
        file: "apps/server/src/rendererOrigins.ts",
        line: 'const home = config.t3Home ?? path.join(homedir(), ".t3");',
      },
    ]);
  });
});
