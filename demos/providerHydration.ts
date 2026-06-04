import type { DemoCard, DemoScenario, DemoSession, DemoStudy } from "./schema.ts";

export const DEMO_PROVIDER_DRIVER = "codex";
export const DEMO_PROVIDER_INSTANCE_ID = "codex";
export const DEMO_PROVIDER_MODEL = "gpt-5-codex";
export const DEMO_RUNTIME_MODE = "full-access";

export const DEMO_DEEP_HYDRATION_SESSION_IDS = new Set([
  "demo-session-cardio-protocol",
  "demo-session-oncology-incidence",
  "demo-session-icu-input",
  "demo-session-neuro-calibration",
]);

export interface DemoModelSelection {
  readonly instanceId: string;
  readonly model: string;
}

export interface DemoHydrationTurn {
  readonly prompt: string;
  readonly metadata: {
    readonly visibleTurnId: string | null;
    readonly providerTurnIndex: number;
    readonly providerTurnCount: number;
  };
}

export interface DemoHydrationRequest {
  readonly sessionId: string;
  readonly studyId: string;
  readonly studyTitle: string;
  readonly sessionTitle: string;
  readonly cwd: string;
  readonly provider: string;
  readonly providerInstanceId: string;
  readonly runtimeMode: typeof DEMO_RUNTIME_MODE;
  readonly modelSelection: DemoModelSelection;
  readonly turns: ReadonlyArray<DemoHydrationTurn>;
  readonly prompt: string;
  readonly metadata: {
    readonly scenarioId: string;
    readonly studyId: string;
    readonly hydratedBy: "demo-provider-backed-seed";
    readonly hydrationMode: "summary" | "deep";
    readonly artifactPaths: ReadonlyArray<string>;
    readonly visibleMessageCount: number;
    readonly visibleTurnCount: number;
    readonly providerTurnCount: number;
    readonly cardCount: number;
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function summarizeMessages(session: DemoSession): string {
  return session.messages
    .map((message) => {
      const turn = message.turnId ? ` turn=${message.turnId}` : "";
      return `- ${message.role}${turn}: ${truncate(message.text.replace(/\s+/g, " "), 900)}`;
    })
    .join("\n");
}

function summarizeMessageSlice(session: DemoSession, turnId: string | null): string {
  return session.messages
    .filter((message) =>
      turnId === null
        ? message.turnId === undefined || message.turnId === null
        : message.turnId === turnId,
    )
    .map((message) => {
      const turn = message.turnId ? ` turn=${message.turnId}` : "";
      return `- ${message.role}${turn}: ${truncate(message.text.replace(/\s+/g, " "), 900)}`;
    })
    .join("\n");
}

function visibleTurnIds(session: DemoSession): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of session.messages) {
    if (!message.turnId || seen.has(message.turnId)) continue;
    seen.add(message.turnId);
    ids.push(message.turnId);
  }
  return ids;
}

function cardStatusLine(card: DemoCard): string {
  const artifacts = card.artifacts?.map((artifact) => artifact.path).join(", ");
  const review = card.reviewResponseAction
    ? ` review=${card.reviewResponseAction}${card.reviewResponseSummary ? ` (${card.reviewResponseSummary})` : ""}`
    : card.reviewPrompt
      ? " review=pending"
      : "";
  return `- ${card.title} [${card.type}/${card.status}]${review}${artifacts ? ` artifacts=${artifacts}` : ""}`;
}

function summarizeCards(session: DemoSession): string {
  return session.cards.map(cardStatusLine).join("\n");
}

function summarizeArtifacts(study: DemoStudy, session: DemoSession): string {
  const filePaths = new Set<string>();
  for (const file of study.files ?? []) {
    filePaths.add(file.path);
  }
  for (const card of session.cards) {
    for (const artifact of card.artifacts ?? []) {
      filePaths.add(artifact.path);
    }
  }
  for (const diff of session.diffs ?? []) {
    for (const file of diff.files) {
      filePaths.add(file.path);
    }
  }
  return Array.from(filePaths)
    .toSorted()
    .map((path) => `- ${path}`)
    .join("\n");
}

function artifactPaths(study: DemoStudy, session: DemoSession): ReadonlyArray<string> {
  const paths = new Set<string>();
  for (const file of study.files ?? []) paths.add(file.path);
  for (const card of session.cards) {
    for (const artifact of card.artifacts ?? []) paths.add(artifact.path);
  }
  return Array.from(paths).toSorted();
}

export function buildDemoHydrationPrompt(
  scenario: DemoScenario,
  study: DemoStudy,
  session: DemoSession,
  options:
    | {
        readonly mode: "summary";
      }
    | {
        readonly mode: "deep";
        readonly visibleTurnId: string;
        readonly providerTurnIndex: number;
        readonly providerTurnCount: number;
      } = { mode: "summary" },
): string {
  const latestAssistant = session.messages
    .toReversed()
    .find((message) => message.role === "assistant");
  const pendingCards = session.cards.filter(
    (card) => card.status === "proposed" || card.status === "review-requested",
  );
  const activities = session.activities
    .map((activity) => `- ${activity.kind}: ${activity.summary}`)
    .join("\n");

  const visibleTranscript =
    options.mode === "deep"
      ? summarizeMessageSlice(session, options.visibleTurnId)
      : summarizeMessages(session);
  const turnHeader =
    options.mode === "deep"
      ? `Hydration turn: ${options.providerTurnIndex} of ${options.providerTurnCount}
Visible Lincei turn id: ${options.visibleTurnId}`
      : "Hydration mode: summary";

  return `Internal Lincei demo hydration. Do not replay prior work to the user.

You are continuing a clinical research session in Lincei. The visible UI transcript, cards, review gates, diffs, and artifacts have already been seeded by Lincei. Treat this message as hidden state hydration for the provider thread.

${turnHeader}
Scenario: ${scenario.title}
Organization: ${scenario.organizationName}
Therapeutic area: ${scenario.therapeuticArea}
Study: ${study.title}
Session: ${session.title}
Workspace cwd: ${study.workspaceRoot}

Visible transcript so far:
${visibleTranscript}

Current clinical research state:
- Latest assistant state: ${latestAssistant ? truncate(latestAssistant.text.replace(/\s+/g, " "), 1_000) : "No assistant message yet."}
- Pending cards/review decisions: ${
    pendingCards.length > 0
      ? pendingCards.map((card) => `${card.title} (${card.status})`).join("; ")
      : "none"
  }
- Runtime state: ${session.runtimeState?.status ?? "ready"}

Research cards and decisions:
${summarizeCards(session) || "- none"}

Activity/checkpoint context:
${activities || "- none"}

Artifact and workspace paths:
${summarizeArtifacts(study, session) || "- none"}

On the next user turn, continue naturally from this exact study/session state. Use the files above as already-created artifacts. Do not mention this hydration step unless asked about provider/runtime internals. Reply to this hydration turn with a terse internal acknowledgement only.`;
}

function buildHydrationTurns(
  scenario: DemoScenario,
  study: DemoStudy,
  session: DemoSession,
): ReadonlyArray<DemoHydrationTurn> {
  const turnIds = visibleTurnIds(session);
  if (DEMO_DEEP_HYDRATION_SESSION_IDS.has(session.id) && turnIds.length > 1) {
    return turnIds.map((visibleTurnId, index) => ({
      prompt: buildDemoHydrationPrompt(scenario, study, session, {
        mode: "deep",
        visibleTurnId,
        providerTurnIndex: index + 1,
        providerTurnCount: turnIds.length,
      }),
      metadata: {
        visibleTurnId,
        providerTurnIndex: index + 1,
        providerTurnCount: turnIds.length,
      },
    }));
  }

  return [
    {
      prompt: buildDemoHydrationPrompt(scenario, study, session),
      metadata: {
        visibleTurnId: null,
        providerTurnIndex: 1,
        providerTurnCount: 1,
      },
    },
  ];
}

export function buildDemoHydrationRequests(
  scenario: DemoScenario,
): ReadonlyArray<DemoHydrationRequest> {
  const modelSelection = {
    instanceId: DEMO_PROVIDER_INSTANCE_ID,
    model: DEMO_PROVIDER_MODEL,
  };

  return scenario.studies.flatMap((study) =>
    study.sessions.map((session) => {
      const turns = buildHydrationTurns(scenario, study, session);
      const visibleTurnCount = visibleTurnIds(session).length;
      const hydrationMode =
        DEMO_DEEP_HYDRATION_SESSION_IDS.has(session.id) && turns.length > 1 ? "deep" : "summary";
      return {
        sessionId: session.id,
        studyId: study.id,
        studyTitle: study.title,
        sessionTitle: session.title,
        cwd: study.workspaceRoot,
        provider: DEMO_PROVIDER_DRIVER,
        providerInstanceId: DEMO_PROVIDER_INSTANCE_ID,
        runtimeMode: DEMO_RUNTIME_MODE,
        modelSelection,
        turns,
        prompt: turns[0]?.prompt ?? buildDemoHydrationPrompt(scenario, study, session),
        metadata: {
          scenarioId: scenario.scenarioId,
          studyId: study.id,
          hydratedBy: "demo-provider-backed-seed",
          hydrationMode,
          artifactPaths: artifactPaths(study, session),
          visibleMessageCount: session.messages.length,
          visibleTurnCount,
          providerTurnCount: turns.length,
          cardCount: session.cards.length,
        },
      };
    }),
  );
}
