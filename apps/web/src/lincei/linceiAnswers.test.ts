import {
  EnvironmentAuthorizationError,
  LinceiRequestError,
  WsLinceiRequestRpc,
  type ClinicalDataset,
  type ClinicalRuntimeStatus,
  type LinceiResponse,
  type StudyHistory,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CLINICAL_ACCESS_REFUSED,
  classifyLinceiFailure,
  answerView,
  clinicalStatusView,
  datasetActionOutcome,
  datasetListView,
  NO_ANSWER,
  studyHistoryView,
} from "./linceiAnswers";

const status: ClinicalRuntimeStatus = {
  state: "ready",
  message: "Ready.",
  home: "",
  python: "",
  skillsDir: "",
  dataDir: "",
  requirements: [],
  demoDataset: "ready",
};

const dataset = (name: string): ClinicalDataset => ({
  name,
  state: "missing",
  requiresCredentials: false,
  downloadable: true,
});

const clinical: LinceiResponse = { _tag: "Clinical", status };
const listed = (...names: ReadonlyArray<string>): LinceiResponse => ({
  _tag: "ClinicalDatasets",
  datasets: names.map(dataset),
});

const succeeded = (value: LinceiResponse, timestamp = 1_000) =>
  AsyncResult.success<LinceiResponse, unknown>(value, { timestamp });
const failed = (
  cause: Cause.Cause<unknown>,
  previous?: AsyncResult.Success<LinceiResponse, unknown>,
) =>
  AsyncResult.failure<LinceiResponse, unknown>(cause, {
    previousSuccess: previous === undefined ? Option.none() : Option.some(previous),
  });

// What Effect's RPC server sends for a method it has no handler for.
const unknownMethod = Cause.die("Unknown request tag: lincei.request");
const refused = Cause.fail(
  new EnvironmentAuthorizationError({
    message: "This connection requires orchestration:operate.",
    requiredScope: "orchestration:operate",
  }),
);
// A failure the server reports itself: its sentence is for the user, its detail is not.
const problem = {
  message: "Lincei could not read the list of datasets from M4. Try again.",
  detail: "Traceback: KeyError 'datasets'",
};
const broken = Cause.fail(new LinceiRequestError(problem));

describe("classifyLinceiFailure", () => {
  it("tells a server that is not Lincei from one that refused or failed", () => {
    expect(classifyLinceiFailure(unknownMethod)).toEqual({ reason: "not-lincei" });
    expect(classifyLinceiFailure(refused)).toEqual({ reason: "forbidden" });
    expect(classifyLinceiFailure(broken)).toEqual({ reason: "failed", ...problem });
  });

  it("recognises what a server without Lincei's RPC really answers", async () => {
    // Upstream's server and Lincei's client, wired together in memory: the
    // client asks for a method the server's group does not have.
    const Ping = Rpc.make("ping", { success: Schema.String });
    const upstream = RpcGroup.make(Ping);
    const lincei = RpcGroup.make(Ping, WsLinceiRequestRpc);
    const answer = await Effect.gen(function* () {
      const link: { toClient?: (response: never) => Effect.Effect<void> } = {};
      const server = yield* RpcServer.makeNoSerialization(upstream, {
        onFromServer: (response) => link.toClient?.(response as never) ?? Effect.void,
      });
      const client = yield* RpcClient.makeNoSerialization(lincei, {
        flatten: true,
        // The two ends speak different groups on purpose, which their types rule out.
        onFromClient: ({ message }) => server.write(0, message as never),
      });
      link.toClient = client.write;
      return yield* Effect.exit(client.client("lincei.request", { _tag: "ClinicalStatus" }));
    }).pipe(
      Effect.scoped,
      Effect.provide(upstream.toLayer({ ping: () => Effect.succeed("pong") })),
      Effect.runPromise,
    );
    expect(answer._tag === "Failure" && classifyLinceiFailure(answer.cause)).toEqual({
      reason: "not-lincei",
    });
  });

  it("has nothing to report for a request that was dropped", () => {
    expect(classifyLinceiFailure(Cause.interrupt())).toEqual({ reason: "interrupted" });
  });

  it("keeps the connection's own words out of the sentence and in the details", () => {
    expect(classifyLinceiFailure(Cause.fail(new Error("Environment 7f3a is offline.")))).toEqual({
      reason: "failed",
      message: NO_ANSWER,
      detail: "Environment 7f3a is offline.",
    });
    expect(classifyLinceiFailure(Cause.die({ code: 7 }))).toEqual({
      reason: "failed",
      message: NO_ANSWER,
      detail: null,
    });
  });
});

describe("answerView", () => {
  const briefing: LinceiResponse = {
    _tag: "AgentBriefing",
    instructions: "<lincei_clinical_research/>",
    techieMode: false,
    skills: [],
  };

  it("shows the answer it waits for, and keeps it while a newer read fails", () => {
    const known = { phase: "known", answer: briefing };
    expect(answerView(succeeded(briefing), "AgentBriefing")).toEqual(known);
    expect(answerView(failed(broken, succeeded(briefing)), "AgentBriefing")).toEqual(known);
  });

  it("says what went wrong in words, and waits through an interruption", () => {
    expect(answerView(failed(broken), "AgentBriefing")).toEqual({ phase: "failed", ...problem });
    expect(answerView(failed(refused), "AgentBriefing")).toMatchObject({
      phase: "failed",
      detail: null,
    });
    expect(answerView(failed(Cause.interrupt()), "AgentBriefing")).toEqual({ phase: "loading" });
  });

  it("does not take another answer for the one it waits for", () => {
    expect(answerView(succeeded(clinical), "AgentBriefing")).toEqual({ phase: "loading" });
  });
});

describe("clinicalStatusView", () => {
  it("is loading until the first answer, not absent", () => {
    expect(clinicalStatusView(AsyncResult.initial(true))).toEqual({ phase: "loading" });
  });

  it("hides the surfaces only without a server to ask or against one that is not Lincei", () => {
    expect(clinicalStatusView(null)).toEqual({ phase: "absent" });
    expect(clinicalStatusView(failed(unknownMethod))).toEqual({ phase: "absent" });
  });

  it("shows a refusal and a failure as what they are", () => {
    expect(clinicalStatusView(failed(refused))).toEqual({ phase: "forbidden" });
    expect(clinicalStatusView(failed(broken))).toEqual({ phase: "failed", ...problem });
  });

  it("keeps the last good answer while a newer request fails or is on its way", () => {
    const known = { phase: "known", status };
    expect(clinicalStatusView(succeeded(clinical))).toEqual(known);
    expect(clinicalStatusView(failed(broken, succeeded(clinical)))).toEqual(known);
    expect(clinicalStatusView(AsyncResult.waiting(succeeded(clinical)))).toEqual(known);
  });

  it("treats a dropped first request as still loading", () => {
    expect(clinicalStatusView(failed(Cause.interrupt()))).toEqual({ phase: "loading" });
  });
});

describe("datasetListView", () => {
  it("is loading, then lists what the server read", () => {
    expect(datasetListView(AsyncResult.initial(true), null)).toEqual({ phase: "loading" });
    expect(datasetListView(succeeded(listed("eicu")), null)).toEqual({
      phase: "listed",
      datasets: [dataset("eicu")],
      actions: null,
      refreshProblem: null,
    });
  });

  it("passes on what the server can do, and nothing from a server that does not say", () => {
    const actions = { define: true, remove: false };
    const withActions: LinceiResponse = { _tag: "ClinicalDatasets", datasets: [], actions };
    expect(datasetListView(succeeded(withActions), null)).toMatchObject({ actions });
    expect(datasetListView(succeeded(listed()), null)).toMatchObject({ actions: null });
    expect(datasetActionOutcome(succeeded(withActions))).toMatchObject({ actions });
  });

  it("gives a failed first read its reason, so there is something to retry", () => {
    expect(datasetListView(failed(broken), null)).toEqual({ phase: "failed", ...problem });
    expect(datasetListView(failed(refused), null)).toEqual({
      phase: "failed",
      message: CLINICAL_ACCESS_REFUSED,
      detail: null,
    });
  });

  it("keeps the old list and says so when a later read fails", () => {
    expect(datasetListView(failed(broken, succeeded(listed("eicu"))), null)).toEqual({
      phase: "listed",
      datasets: [dataset("eicu")],
      actions: null,
      refreshProblem: problem,
    });
  });

  it("prefers the list a command returned until a later read arrives", () => {
    const answer = { datasets: [dataset("mimic-iv")], actions: null, at: 2_000 };
    expect(datasetListView(succeeded(listed("eicu"), 1_000), answer)).toMatchObject({
      datasets: [dataset("mimic-iv")],
    });
    expect(datasetListView(succeeded(listed("eicu"), 3_000), answer)).toMatchObject({
      datasets: [dataset("eicu")],
    });
  });

  it("reports tools that turned out not to be installed instead of waiting forever", () => {
    expect(datasetListView(succeeded(clinical), null)).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("not set up yet"),
    });
  });
});

describe("studyHistoryView", () => {
  const history = (state: StudyHistory["state"]): StudyHistory => ({
    state,
    message: state,
    leftOut: [],
  });
  const read = (state: StudyHistory["state"], timestamp: number) =>
    succeeded({ _tag: "StudyHistory", history: history(state) }, timestamp);

  it("shows the switch as the newest answer has it, from a command or a read", () => {
    // The researcher turned it on; an older read still says off.
    const answer = { history: history("on"), at: 2_000 };
    expect(studyHistoryView(read("off", 1_000), answer)).toEqual({
      phase: "known",
      answer: history("on"),
    });
    // The server started it by itself later on, or someone else turned it off.
    expect(studyHistoryView(read("off", 3_000), answer)).toEqual({
      phase: "known",
      answer: history("off"),
    });
  });

  it("says why a read failed, and waits through an interruption", () => {
    expect(studyHistoryView(failed(broken), null)).toEqual({ phase: "failed", ...problem });
    expect(studyHistoryView(failed(Cause.interrupt()), null)).toEqual({ phase: "loading" });
  });
});

describe("datasetActionOutcome", () => {
  it("accepts with the list as it is after the command", () => {
    expect(datasetActionOutcome(succeeded(listed("eicu")))).toEqual({
      accepted: true,
      datasets: [dataset("eicu")],
      actions: null,
    });
  });

  it("passes on the server's reason when it refuses", () => {
    const rejected = Cause.fail(
      new LinceiRequestError({
        message: "That folder does not exist on the computer Lincei runs on.",
      }),
    );
    expect(datasetActionOutcome(failed(rejected))).toEqual({
      accepted: false,
      message: "That folder does not exist on the computer Lincei runs on.",
    });
  });

  it("is silent about a dropped request and plain about missing tools", () => {
    expect(datasetActionOutcome(failed(Cause.interrupt()))).toEqual({
      accepted: false,
      message: null,
    });
    expect(datasetActionOutcome(succeeded(clinical))).toMatchObject({
      accepted: false,
      message: expect.stringContaining("not set up yet"),
    });
  });
});
