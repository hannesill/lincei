/**
 * LinceiRequests - answers the one RPC Lincei's clients call.
 *
 * The transport hands every `lincei.request` here. Each case reads its input,
 * calls one service, and shapes the answer; the behavior lives in the
 * services.
 *
 * @module LinceiRequests
 */
import {
  LINCEI_WS_METHODS,
  LinceiRequestError,
  type LinceiRequest,
  type LinceiResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as ResearchBoard from "./ResearchBoard.ts";

/** The RPC method this service answers, for the transport's handler table. */
export const method = LINCEI_WS_METHODS.request;

export class LinceiRequests extends Context.Service<
  LinceiRequests,
  {
    readonly handle: (request: LinceiRequest) => Effect.Effect<LinceiResponse, LinceiRequestError>;
  }
>()("t3/lincei/LinceiRequests") {}

const make = Effect.gen(function* () {
  const clinicalRuntime = yield* ClinicalRuntime.ClinicalRuntime;
  const researchBoard = yield* ResearchBoard.ResearchBoard;

  const handle = Effect.fn("LinceiRequests.handle")(function* (
    request: LinceiRequest,
  ): Effect.fn.Return<LinceiResponse, LinceiRequestError> {
    switch (request._tag) {
      case "ClinicalStatus":
        return { _tag: "Clinical", status: yield* clinicalRuntime.status };
      case "ClinicalSetup":
        return { _tag: "Clinical", status: yield* clinicalRuntime.setup };
      case "ResearchBoardOpen": {
        // Vitrine lives in the clinical runtime, so there is no board before it
        // is installed. The demo dataset downloads last and is not needed for one.
        const status = yield* clinicalRuntime.status;
        const vitrineInstalled =
          status.state === "ready" || (status.state === "installing" && status.step === "dataset");
        if (!vitrineInstalled) return { _tag: "Clinical", status };
        const board = yield* researchBoard.open(request.cwd).pipe(
          Effect.mapError(
            (error) =>
              new LinceiRequestError({
                message: error.message,
                ...(error.detail === undefined ? {} : { detail: error.detail }),
              }),
          ),
        );
        return { _tag: "ResearchBoard", board };
      }
    }
  });

  return LinceiRequests.of({ handle });
});

export const layer = Layer.effect(LinceiRequests, make);
