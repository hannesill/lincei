/**
 * What an answer from a Lincei server, or the lack of one, means for what a
 * surface shows. A request can be on its way, refused, failed, or sent to a
 * server that is not Lincei, and each has to look like what it is. Only the
 * last one hides Lincei's surfaces.
 */
import type { ClinicalDataset, ClinicalRuntimeStatus, LinceiResponse } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type { AsyncResult } from "effect/reactivity";

/** The state of one read from a Lincei server, as the query cache holds it. */
export type LinceiQueryResult = AsyncResult.AsyncResult<LinceiResponse, unknown>;

/** A command's answer: it settled, one way or the other. */
export type LinceiCommandResult =
  | AsyncResult.Success<LinceiResponse, unknown>
  | AsyncResult.Failure<LinceiResponse, unknown>;

/** What went wrong in words for the user, and the technical side of it for whoever helps them. */
export interface LinceiProblem {
  readonly message: string;
  readonly detail: string | null;
}

export type LinceiFailure =
  /** The server does not know Lincei's RPC: it is plain T3 Code. */
  | { readonly reason: "not-lincei" }
  /** This connection may not use Lincei's features on that server. */
  | { readonly reason: "forbidden" }
  /** The request was dropped before it was answered, which is nothing to report. */
  | { readonly reason: "interrupted" }
  | ({ readonly reason: "failed" } & LinceiProblem);

const hasTag = (value: unknown, tag: string): boolean =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === tag;

const messageOf = (value: unknown): string =>
  value instanceof Error ? value.message.trim() : typeof value === "string" ? value.trim() : "";

const detailOf = (value: unknown): string | null =>
  typeof value === "object" &&
  value !== null &&
  "detail" in value &&
  typeof value.detail === "string" &&
  value.detail.trim().length > 0
    ? value.detail
    : null;

export const NO_ANSWER =
  "Lincei could not get an answer from its background service. Try again; if it keeps happening, quit Lincei and open it again.";

/** Why a request to a Lincei server was not answered. */
export function classifyLinceiFailure(cause: Cause.Cause<unknown>): LinceiFailure {
  if (Cause.hasInterruptsOnly(cause)) return { reason: "interrupted" };
  // Effect's RPC server answers a method it has no handler for with this defect.
  const unknownMethod = cause.reasons.some(
    (reason) =>
      Cause.isDieReason(reason) && /^Unknown request tag\b/.test(messageOf(reason.defect)),
  );
  if (unknownMethod) return { reason: "not-lincei" };
  const error = Cause.squash(cause);
  if (hasTag(error, "EnvironmentAuthorizationError")) return { reason: "forbidden" };
  // The server writes its own failures for the user: what happened and what to do next.
  if (hasTag(error, "LinceiRequestError") && messageOf(error).length > 0) {
    return { reason: "failed", message: messageOf(error), detail: detailOf(error) };
  }
  // Anything else is the connection or the protocol speaking, in words that
  // help nobody but the person asked to look into it.
  return { reason: "failed", message: NO_ANSWER, detail: messageOf(error) || null };
}

export const CLINICAL_ACCESS_REFUSED =
  "This connection is view-only. To use the clinical research tools, pair this device again with a link that allows running agents.";

/** A failure in words, for a place that can show one sentence. Null when there is nothing to say. */
export function describeLinceiFailure(failure: LinceiFailure): string | null {
  switch (failure.reason) {
    case "interrupted":
      return null;
    case "not-lincei":
      return "This server is not Lincei, so it has no clinical research tools.";
    case "forbidden":
      return CLINICAL_ACCESS_REFUSED;
    case "failed":
      return failure.message;
  }
}

/** What is known about the clinical research tools on one computer. */
export type ClinicalStatusView =
  | { readonly phase: "loading" }
  /** Not a Lincei server, or no server at all: nothing clinical to show. */
  | { readonly phase: "absent" }
  | { readonly phase: "forbidden" }
  | ({ readonly phase: "failed" } & LinceiProblem)
  | { readonly phase: "known"; readonly status: ClinicalRuntimeStatus };

/** What a surface says in place of the status while it does not have one. */
export function describeUnknownStatus(
  view: Exclude<ClinicalStatusView, { readonly phase: "known" }>,
): string {
  switch (view.phase) {
    case "loading":
      return "Checking the clinical research tools…";
    case "absent":
      return "The server is not Lincei, so there are no clinical research tools here.";
    case "forbidden":
      return CLINICAL_ACCESS_REFUSED;
    case "failed":
      return view.message;
  }
}

/**
 * Reads the status query. The last good answer stays on screen while a newer
 * request is on its way or has failed, because setup's state rarely changes
 * and an empty surface would say less. `null` is "there is no server to ask".
 */
export function clinicalStatusView(result: LinceiQueryResult | null): ClinicalStatusView {
  if (result === null) return { phase: "absent" };
  const answer =
    result._tag === "Success"
      ? result.value
      : result._tag === "Failure"
        ? Option.getOrNull(Option.map(result.previousSuccess, (previous) => previous.value))
        : null;
  if (answer?._tag === "Clinical") return { phase: "known", status: answer.status };
  if (result._tag !== "Failure") return { phase: "loading" };
  const failure = classifyLinceiFailure(result.cause);
  switch (failure.reason) {
    case "interrupted":
      return { phase: "loading" };
    case "not-lincei":
      return { phase: "absent" };
    case "forbidden":
      return { phase: "forbidden" };
    case "failed":
      return { phase: "failed", message: failure.message, detail: failure.detail };
  }
}

/** One read whose answer a surface shows as it is, such as what agents are told. */
export type AnswerView<Answer> =
  | { readonly phase: "loading" }
  | ({ readonly phase: "failed" } & LinceiProblem)
  | { readonly phase: "known"; readonly answer: Answer };

/**
 * Reads a query whose answer has the tag `tag`. Like the status, the last
 * good answer stays while a newer request is on its way or has failed.
 */
export function answerView<Tag extends LinceiResponse["_tag"]>(
  result: LinceiQueryResult | null,
  tag: Tag,
): AnswerView<Extract<LinceiResponse, { readonly _tag: Tag }>> {
  if (result === null) return { phase: "loading" };
  const answer =
    result._tag === "Success"
      ? result.value
      : result._tag === "Failure"
        ? Option.getOrNull(Option.map(result.previousSuccess, (previous) => previous.value))
        : null;
  if (answer !== null && answer._tag === tag) {
    return { phase: "known", answer: answer as Extract<LinceiResponse, { readonly _tag: Tag }> };
  }
  if (result._tag !== "Failure") return { phase: "loading" };
  const failure = classifyLinceiFailure(result.cause);
  if (failure.reason === "failed") {
    return { phase: "failed", message: failure.message, detail: failure.detail };
  }
  const message = describeLinceiFailure(failure);
  return message === null ? { phase: "loading" } : { phase: "failed", message, detail: null };
}

/** The dataset list a command answered with, and when, so it can outrank an older read. */
export interface DatasetAnswer {
  readonly datasets: ReadonlyArray<ClinicalDataset>;
  readonly at: number;
}

export type DatasetListView =
  | { readonly phase: "loading" }
  | ({ readonly phase: "failed" } & LinceiProblem)
  | {
      readonly phase: "listed";
      readonly datasets: ReadonlyArray<ClinicalDataset>;
      /** Why the newest read failed, when the list on screen is an older one. */
      readonly refreshProblem: LinceiProblem | null;
    };

const TOOLS_NOT_READY =
  "The clinical research tools are not set up yet. Set them up under Settings, Clinical Data.";

/** A failed request as something to show, or null when it is nothing to report. */
const problemOf = (cause: Cause.Cause<unknown>): LinceiProblem | null => {
  const failure = classifyLinceiFailure(cause);
  const message = describeLinceiFailure(failure);
  if (message === null) return null;
  return { message, detail: failure.reason === "failed" ? failure.detail : null };
};

/**
 * Reads the dataset query together with the newest list a command returned.
 * Every dataset command answers with the list as it is afterwards, so the row
 * the user acted on changes at once instead of after the next read.
 */
export function datasetListView(
  result: LinceiQueryResult | null,
  answer: DatasetAnswer | null,
): DatasetListView {
  const read =
    result?._tag === "Success"
      ? result
      : result?._tag === "Failure"
        ? Option.getOrNull(result.previousSuccess)
        : null;
  const fromRead: DatasetAnswer | null =
    read?.value._tag === "ClinicalDatasets"
      ? { datasets: read.value.datasets, at: read.timestamp }
      : null;
  const newest =
    fromRead === null || (answer !== null && answer.at > fromRead.at) ? answer : fromRead;
  const problem = result?._tag === "Failure" ? problemOf(result.cause) : null;
  if (newest !== null) {
    return { phase: "listed", datasets: newest.datasets, refreshProblem: problem };
  }
  if (problem !== null) return { phase: "failed", ...problem };
  // A server whose tools are not installed answers with how far setup is.
  if (result?._tag === "Success") {
    return { phase: "failed", message: TOOLS_NOT_READY, detail: null };
  }
  return { phase: "loading" };
}

export type DatasetActionOutcome =
  | { readonly accepted: true; readonly datasets: ReadonlyArray<ClinicalDataset> }
  /** `message` is null when there is nothing to tell the user: the request was dropped. */
  | { readonly accepted: false; readonly message: string | null };

/** Whether the server took on a dataset command, and its reason when it did not. */
export function datasetActionOutcome(result: LinceiCommandResult): DatasetActionOutcome {
  if (result._tag === "Failure") {
    return {
      accepted: false,
      message: describeLinceiFailure(classifyLinceiFailure(result.cause)),
    };
  }
  return result.value._tag === "ClinicalDatasets"
    ? { accepted: true, datasets: result.value.datasets }
    : { accepted: false, message: TOOLS_NOT_READY };
}
