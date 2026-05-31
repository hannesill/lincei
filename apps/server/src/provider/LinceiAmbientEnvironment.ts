import type { ProviderSessionStartInput } from "@t3tools/contracts";

export const LINCEI_SESSION_ID_ENV = "LINCEI_SESSION_ID";
export const LINCEI_PROJECT_ID_ENV = "LINCEI_PROJECT_ID";
export const LINCEI_WORKSPACE_ROOT_ENV = "LINCEI_WORKSPACE_ROOT";
export const LINCEI_PROVIDER_INSTANCE_ID_ENV = "LINCEI_PROVIDER_INSTANCE_ID";

export function makeLinceiSessionEnvironment(
  input: ProviderSessionStartInput,
): Record<string, string> {
  return {
    [LINCEI_SESSION_ID_ENV]: input.sessionId,
    ...(input.projectId ? { [LINCEI_PROJECT_ID_ENV]: input.projectId } : {}),
    ...(input.workspaceRoot ? { [LINCEI_WORKSPACE_ROOT_ENV]: input.workspaceRoot } : {}),
    ...(input.providerInstanceId
      ? { [LINCEI_PROVIDER_INSTANCE_ID_ENV]: input.providerInstanceId }
      : {}),
  };
}
