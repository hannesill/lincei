import type { ProjectScript } from "@t3tools/contracts";

import { projectVitrineDataDir, VITRINE_DATA_DIR_ENV } from "./vitrine.ts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    LINCEI_PROJECT_ROOT: input.project.cwd,
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.LINCEI_WORKTREE_PATH = input.worktreePath;
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    Object.assign(env, input.extraEnv);
  }
  return {
    ...env,
    // This identity is owned by Lincei and must not follow a worktree cwd or
    // be redirected by a project-script override.
    [VITRINE_DATA_DIR_ENV]: projectVitrineDataDir(input.project.cwd),
  };
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
