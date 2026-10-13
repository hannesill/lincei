import { useTechieMode } from "./techieMode";

/**
 * Whether the thread view should behave as if the folder is a git repository.
 * In researcher mode it never does: no branch strip under the composer, no
 * worktree choice, no diff tab. New threads then always run in the project's
 * own folder, which is where a researcher's data files are. The server still
 * takes its per-turn checkpoints, so rewinding a conversation keeps working.
 */
export function useLinceiIsGitRepo(isGitRepo: boolean): boolean {
  return useTechieMode() && isGitRepo;
}
