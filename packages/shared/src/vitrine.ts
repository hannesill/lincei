export const VITRINE_DATA_DIR_ENV = "VITRINE_DATA_DIR";

function projectPathSeparator(projectRoot: string): "/" | "\\" {
  return projectRoot.includes("\\") && !projectRoot.includes("/") ? "\\" : "/";
}

/**
 * Resolve Vitrine storage from the registered project root, never from a
 * session's worktree cwd.
 */
export function projectVitrineDataDir(projectRoot: string): string {
  const normalizedRoot = projectRoot.trim();
  const separator = projectPathSeparator(normalizedRoot);
  const rootWithoutTrailingSeparators = normalizedRoot.replace(/[\\/]+$/g, "");

  if (rootWithoutTrailingSeparators.length === 0) {
    return `${separator}.vitrine`;
  }
  return `${rootWithoutTrailingSeparators}${separator}.vitrine`;
}
