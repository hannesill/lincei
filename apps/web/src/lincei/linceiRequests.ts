/**
 * The client side of Lincei's one RPC (see `packages/contracts/src/lincei.ts`).
 * A server that is not Lincei does not know the method and says so in its
 * answer, which `linceiAnswers.ts` tells apart from a request that failed.
 *
 * The method needs `orchestration:operate` (`CLIENT_GUARDED_RPC_SCOPES`).
 * `linceiCommand` checks that before it sends, and its `permissionAtom` is
 * what a control asks to know whether it may act.
 */
import { requestGuarded, RpcPermissionGuard } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import { LINCEI_WS_METHODS, type LinceiRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Reads from a Lincei server, cached per environment and request. A read is
 * sent without the client's check and the server answers it: only the answer
 * can say that a server is not Lincei, which hides Lincei's surfaces, where the
 * check would call every such server's refusal "view-only". The server still
 * refuses a connection without the scope, and the surfaces say so.
 */
export const linceiQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "lincei:query",
  staleTimeMs: 2_000,
  idleTtlMs: 60_000,
  execute: (input: LinceiRequest) =>
    requestGuarded(LINCEI_WS_METHODS.request, input).pipe(
      Effect.provideService(RpcPermissionGuard, { authorize: () => Effect.void }),
    ),
});

/** Asks a Lincei server to do something, once this connection may. */
export const linceiCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "lincei:command",
  tag: LINCEI_WS_METHODS.request,
});
