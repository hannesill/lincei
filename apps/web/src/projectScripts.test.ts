import type { ProjectScript } from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";
import { describe, expect, it } from "vitest";

import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptIdFromCommand,
} from "./projectScripts";

describe("projectScripts helpers", () => {
  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary and setup scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree-a",
      VITRINE_DATA_DIR: "/repo/.vitrine",
    });
  });

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        T3CODE_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
        VITRINE_DATA_DIR: "/wrong/worktree/.vitrine",
      },
    });

    expect(env.T3CODE_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.VITRINE_DATA_DIR).toBe("/repo/.vitrine");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
  });
});

const existingPreviewScript: ProjectScript = {
  id: "serve",
  name: "Serve",
  command: "bun dev",
  icon: "play",
  runOnWorktreeCreate: false,
  previewUrl: "http://localhost:3000/",
  autoOpenPreview: true,
};

describe("buildProjectScript", () => {
  it("persists preview metadata", () => {
    expect(
      buildProjectScript("serve", {
        name: "Serve",
        command: "bun dev",
        icon: "play",
        runOnWorktreeCreate: false,
        previewUrl: " http://localhost:5173/ ",
        autoOpenPreview: true,
      }),
    ).toMatchObject({
      previewUrl: "http://localhost:5173/",
      autoOpenPreview: true,
    });
  });

  it("removes stale preview metadata when the URL is cleared", () => {
    const updated = buildProjectScript(
      "serve",
      {
        name: "Serve",
        command: "bun dev",
        icon: "play",
        runOnWorktreeCreate: false,
        previewUrl: null,
        autoOpenPreview: true,
      },
      existingPreviewScript,
    );
    expect(updated).not.toHaveProperty("previewUrl");
    expect(updated).not.toHaveProperty("autoOpenPreview");
  });
});
