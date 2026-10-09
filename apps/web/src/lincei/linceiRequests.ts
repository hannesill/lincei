/**
 * The client side of Lincei's one RPC (see `packages/contracts/src/lincei.ts`).
 * A server that is not Lincei does not know the method, so a failed query
 * doubles as "this environment has no Lincei features".
 */
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { LINCEI_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Reads from a Lincei server, cached per environment and request. */
export const linceiQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "lincei:query",
  tag: LINCEI_WS_METHODS.request,
  staleTimeMs: 2_000,
  idleTtlMs: 60_000,
});

/** Asks a Lincei server to do something. */
export const linceiCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "lincei:command",
  tag: LINCEI_WS_METHODS.request,
});
