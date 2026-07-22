import type { ServerAuthPolicy } from "@t3tools/contracts";

export function isVitrineBrowserLaunchPolicyAllowed(policy: ServerAuthPolicy): boolean {
  return policy === "desktop-managed-local" || policy === "loopback-browser";
}
