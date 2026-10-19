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
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { linceiAgentInstructions } from "./agentInstructions.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";
import * as ResearchBoard from "./ResearchBoard.ts";
import * as StudyHistory from "./StudyHistory.ts";

/** The RPC method this service answers, for the transport's handler table. */
export const method = LINCEI_WS_METHODS.request;

export class LinceiRequests extends Context.Service<
  LinceiRequests,
  {
    /**
     * Study histories are kept only for the server's projects. Their read
     * model is built above Lincei's layer, and the transport's context has it.
     */
    readonly handle: (
      request: LinceiRequest,
    ) => Effect.Effect<LinceiResponse, LinceiRequestError, ProjectStore.ProjectStoreV2>;
  }
>()("t3/lincei/LinceiRequests") {}

const toRequestError = (error: {
  readonly message: string;
  readonly detail?: string | undefined;
}) =>
  new LinceiRequestError({
    message: error.message,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
  });

const make = Effect.gen(function* () {
  const clinicalRuntime = yield* ClinicalRuntime.ClinicalRuntime;
  const clinicalDatasets = yield* ClinicalDatasets.ClinicalDatasets;
  const researchBoard = yield* ResearchBoard.ResearchBoard;
  const linceiPreferences = yield* LinceiPreferences.LinceiPreferences;
  const platform = yield* HostProcess.Platform;
  const studyHistory = yield* StudyHistory.StudyHistory;

  const datasets = Effect.all([clinicalDatasets.list, clinicalDatasets.actions], {
    concurrency: 2,
  }).pipe(
    Effect.map(
      ([list, actions]): LinceiResponse => ({ _tag: "ClinicalDatasets", datasets: list, actions }),
    ),
    Effect.mapError(toRequestError),
  );

  /**
   * A request that needs M4 or Vitrine before they are installed is answered
   * with how far setup is instead.
   */
  const whenInstalled = (answer: Effect.Effect<LinceiResponse, LinceiRequestError>) =>
    Effect.flatMap(clinicalRuntime.status, (status) =>
      ClinicalRuntime.toolsInstalled(status)
        ? answer
        : Effect.succeed<LinceiResponse>({ _tag: "Clinical", status }),
    );

  const handle = Effect.fn("LinceiRequests.handle")(function* (
    request: LinceiRequest,
  ): Effect.fn.Return<LinceiResponse, LinceiRequestError, ProjectStore.ProjectStoreV2> {
    switch (request._tag) {
      case "ClinicalStatus":
        return { _tag: "Clinical", status: yield* clinicalRuntime.status };
      case "ClinicalSetup":
        return { _tag: "Clinical", status: yield* clinicalRuntime.setup({ force: request.force }) };
      case "ResearchBoardOpen":
        return yield* whenInstalled(
          researchBoard.open(request.cwd).pipe(
            Effect.map((board): LinceiResponse => ({ _tag: "ResearchBoard", board })),
            Effect.mapError(toRequestError),
          ),
        );
      case "ResearchBoardActivity":
        return yield* whenInstalled(
          researchBoard.activity(request.cwd).pipe(
            Effect.map(
              (updatedAt): LinceiResponse => ({
                _tag: "ResearchBoardActivity",
                ...(Option.isSome(updatedAt) ? { updatedAt: updatedAt.value } : {}),
              }),
            ),
            Effect.mapError(toRequestError),
          ),
        );
      case "ClinicalDatasets":
        return yield* whenInstalled(datasets);
      case "ClinicalDatasetAdd":
        return yield* whenInstalled(
          clinicalDatasets
            .add(request)
            .pipe(Effect.mapError(toRequestError), Effect.andThen(datasets)),
        );
      case "ClinicalDatasetDownload":
        return yield* whenInstalled(
          clinicalDatasets
            .download(request)
            .pipe(Effect.mapError(toRequestError), Effect.andThen(datasets)),
        );
      case "ClinicalDatasetDefine":
        return yield* whenInstalled(
          clinicalDatasets
            .define(request)
            .pipe(Effect.mapError(toRequestError), Effect.andThen(datasets)),
        );
      case "ClinicalDataFolderOpen":
        return yield* whenInstalled(
          clinicalDatasets
            .openFolder(request.name)
            .pipe(Effect.mapError(toRequestError), Effect.as<LinceiResponse>({ _tag: "Done" })),
        );
      case "ClinicalDatasetRemove":
        return yield* whenInstalled(
          clinicalDatasets
            .remove(request.name)
            .pipe(Effect.mapError(toRequestError), Effect.andThen(datasets)),
        );
      case "ClinicalDatasetCancel":
        return yield* whenInstalled(
          clinicalDatasets.cancel(request.name).pipe(Effect.andThen(datasets)),
        );
      case "Preferences":
        return { _tag: "Preferences", preferences: yield* linceiPreferences.get };
      case "PreferencesUpdate":
        return {
          _tag: "Preferences",
          preferences: yield* linceiPreferences.update({ techieMode: request.techieMode }),
        };
      case "AgentBriefing": {
        const { techieMode } = yield* linceiPreferences.get;
        return {
          _tag: "AgentBriefing",
          instructions: linceiAgentInstructions({ techieMode, platform }),
          techieMode,
          skills: yield* clinicalRuntime.skills,
        };
      }
      case "ClinicalSkillText": {
        const text = yield* clinicalRuntime.skillText(request.name);
        if (Option.isNone(text)) {
          return yield* new LinceiRequestError({
            message: `Lincei has no clinical skill called "${request.name.slice(0, 60)}". Open Settings, Clinical Data again to see the current list.`,
          });
        }
        return { _tag: "ClinicalSkillText", name: request.name, text: text.value };
      }
      case "StudyHistory":
      case "StudyHistoryUpdate":
        return {
          _tag: "StudyHistory",
          history: yield* (
            request._tag === "StudyHistory"
              ? studyHistory.status(request.folder)
              : studyHistory.update(request.folder, request.on)
          ).pipe(Effect.mapError(toRequestError)),
        };
    }
  });

  return LinceiRequests.of({ handle });
});

export const layer = Layer.effect(LinceiRequests, make);
