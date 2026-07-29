export type SidebarImplementation = "v1" | "v2";

export function resolveSidebarImplementation(input: {
  pathname: string;
  sidebarV1RollbackEnabled: boolean;
  clientSettingsHydrated: boolean;
}): SidebarImplementation {
  if (
    !input.clientSettingsHydrated ||
    input.sidebarV1RollbackEnabled ||
    input.pathname.startsWith("/settings")
  ) {
    return "v1";
  }
  return "v2";
}
