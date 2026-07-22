export const VITRINE_DATA_DIR_ENV = "VITRINE_DATA_DIR";

const VITRINE_BROWSER_HOSTS = new Set(["vitrine.localhost", "localhost", "127.0.0.1", "[::1]"]);

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

/**
 * Accept only the root page of the project-scoped loopback browser server.
 * When provided, `expectedPort` must match the URL's explicit port.
 */
export function isAllowedVitrineBrowserUrl(rawUrl: string, expectedPort?: number): boolean {
  try {
    const url = new URL(rawUrl);
    const port = Number(url.port);
    return (
      url.protocol === "http:" &&
      VITRINE_BROWSER_HOSTS.has(url.hostname) &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65_536 &&
      (expectedPort === undefined || port === expectedPort) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === "/" &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
