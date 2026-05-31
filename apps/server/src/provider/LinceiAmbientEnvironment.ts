import type { ProviderSessionStartInput } from "@t3tools/contracts";

export const LINCEI_SESSION_ID_ENV = "LINCEI_SESSION_ID";
export const LINCEI_PROJECT_ID_ENV = "LINCEI_PROJECT_ID";
export const LINCEI_PROJECT_DIR_ENV = "LINCEI_PROJECT_DIR";
export const LINCEI_PROVIDER_INSTANCE_ID_ENV = "LINCEI_PROVIDER_INSTANCE_ID";
export const LINCEI_CLI_PATH_ENV = "LINCEI_CLI_PATH";

const PATH_DELIMITER = process.platform === "win32" ? ";" : ":";

interface LinceiCliAmbientEnvironment {
  readonly binDir: string;
  readonly cliPath: string;
}

let configuredCliEnvironment: LinceiCliAmbientEnvironment | undefined;

export function configureLinceiCliAmbientEnvironment(
  environment: LinceiCliAmbientEnvironment,
): void {
  configuredCliEnvironment = environment;
}

export function resetLinceiCliAmbientEnvironmentForTest(): void {
  configuredCliEnvironment = undefined;
}

function resolvePathKey(baseEnv: NodeJS.ProcessEnv): string {
  if (baseEnv.Path !== undefined) {
    return "Path";
  }
  return "PATH";
}

export function prependPathEntry(
  pathValue: string | undefined,
  entry: string,
  delimiter = PATH_DELIMITER,
): string {
  const existingEntries = (pathValue ?? "")
    .split(delimiter)
    .filter((candidate) => candidate.length > 0 && candidate !== entry);
  return [entry, ...existingEntries].join(delimiter);
}

export function makeLinceiSessionEnvironment(
  input: ProviderSessionStartInput,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const cliEnvironment = configuredCliEnvironment;
  const pathKey = resolvePathKey(baseEnv);
  return {
    ...(cliEnvironment
      ? {
          [pathKey]: prependPathEntry(baseEnv[pathKey], cliEnvironment.binDir),
          [LINCEI_CLI_PATH_ENV]: cliEnvironment.cliPath,
        }
      : {}),
    [LINCEI_SESSION_ID_ENV]: input.sessionId,
    ...(input.projectId ? { [LINCEI_PROJECT_ID_ENV]: input.projectId } : {}),
    ...(input.workspaceRoot ? { [LINCEI_PROJECT_DIR_ENV]: input.workspaceRoot } : {}),
    ...(input.providerInstanceId
      ? { [LINCEI_PROVIDER_INSTANCE_ID_ENV]: input.providerInstanceId }
      : {}),
  };
}
