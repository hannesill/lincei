import type { DemoCard, DemoScenario } from "./schema.ts";

const modelSelection = {
  instanceId: "codex",
  model: "gpt-5-codex",
} as const;

type DemoCommand = Record<string, unknown>;
type DemoResearchCard = Record<string, unknown>;

function timestamp(baseTimestamp: string, offsetMinutes: number): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00\.000Z$/.exec(baseTimestamp);
  if (!match) return baseTimestamp;
  const date = match[1] ?? "2026-05-18";
  const baseHour = Number(match[2] ?? "0");
  const baseMinute = Number(match[3] ?? "0");
  const totalMinutes = baseHour * 60 + baseMinute + offsetMinutes;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function commandId(id: string, salt: string | undefined): string {
  return `cmd-${salt ? `${salt}-` : ""}${id}`;
}

function turnId(id: string | null | undefined): string | null {
  return id ?? null;
}

function reviewActions() {
  return [
    { id: "accept", label: "Accept" },
    { id: "request_changes", label: "Request changes" },
    { id: "reject", label: "Reject" },
  ];
}

function artifactKindForCardType(card: DemoCard): string {
  return card.type === "chart" || card.type === "image"
    ? "visual"
    : card.type === "table"
      ? "table"
      : card.type === "markdown"
        ? "markdown"
        : "other";
}

function cardToResearchCard(
  scenario: DemoScenario,
  sessionId: string,
  card: DemoCard,
): DemoResearchCard {
  const createdAt = timestamp(scenario.baseTimestamp, card.createdAtOffsetMinutes);
  const artifacts = card.artifacts?.map((artifact, index) => ({
    id: artifact.id ?? `${card.id}-artifact-${index + 1}`,
    kind: artifact.kind,
    path: artifact.path,
    label: artifact.label ?? card.title,
    ...(artifact.role ? { role: artifact.role } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    createdAt,
  })) ?? [
    {
      id: `${card.id}-artifact`,
      kind: artifactKindForCardType(card),
      path: `studies/${sessionId}/${card.id}.json`,
      label: card.title,
      createdAt,
    },
  ];

  return {
    id: card.id,
    type: card.type,
    status: card.status === "superseded" ? "proposed" : card.status,
    title: card.title,
    ...(card.preview !== undefined ? { preview: card.preview } : {}),
    artifacts,
    provenance: [
      {
        sessionId,
        turnId: card.turnId ?? undefined,
        source: "demo-scenario",
        dataset: "synthetic-clinical-demo",
        timestamp: createdAt,
      },
    ],
    ...(card.reviewPrompt
      ? {
          review: {
            prompt: card.reviewPrompt,
            actions: reviewActions(),
          },
        }
      : {}),
    turnId: turnId(card.turnId),
    createdAt,
    updatedAt: createdAt,
  };
}

export function demoProjectIds(scenario: DemoScenario): string[] {
  return scenario.studies.map((study) => study.id);
}

export function buildDemoScenarioCommands(
  scenario: DemoScenario,
  options: { readonly purgeFirst?: boolean; readonly commandIdSalt?: string } = {},
): DemoCommand[] {
  const commands: DemoCommand[] = [];

  if (options.purgeFirst) {
    for (const study of scenario.studies) {
      commands.push({
        type: "project.purge",
        commandId: commandId(`${study.id}-purge`, options.commandIdSalt),
        projectId: study.id,
        createdAt: timestamp(scenario.baseTimestamp, 0),
      });
    }
  }

  for (const study of scenario.studies) {
    const projectId = study.id;
    commands.push({
      type: "project.create",
      commandId: commandId(`${study.id}-create`, options.commandIdSalt),
      projectId,
      title: study.title,
      workspaceRoot: study.workspaceRoot,
      defaultModelSelection: modelSelection,
      createdAt: timestamp(scenario.baseTimestamp, 0),
    });

    for (const session of study.sessions) {
      const sessionId = session.id;
      commands.push({
        type: "session.create",
        commandId: commandId(`${session.id}-create`, options.commandIdSalt),
        sessionId,
        projectId,
        title: session.title,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: timestamp(scenario.baseTimestamp, 1),
      });

      for (const message of session.messages) {
        commands.push({
          type: "session.message.append",
          commandId: commandId(`${message.id}-append`, options.commandIdSalt),
          sessionId,
          messageId: message.id,
          role: message.role,
          text: message.text,
          turnId: turnId(message.turnId),
          streaming: false,
          createdAt: timestamp(scenario.baseTimestamp, message.createdAtOffsetMinutes),
        });
      }

      const replacementCardIds = new Set<string>();
      for (let index = 0; index < session.cards.length; index += 1) {
        const card = session.cards[index];
        if (!card) continue;
        if (replacementCardIds.has(card.id)) continue;
        const researchCard = cardToResearchCard(scenario, session.id, card);
        commands.push({
          type: "session.research-card.propose",
          commandId: commandId(`${card.id}-propose`, options.commandIdSalt),
          sessionId,
          researchCard,
          createdAt: researchCard.createdAt,
        });

        if (card.status === "review-requested") {
          commands.push({
            type: "session.research-card.lifecycle",
            commandId: commandId(`${card.id}-request-review`, options.commandIdSalt),
            sessionId,
            cardId: card.id,
            action: "request_review",
            createdAt: timestamp(scenario.baseTimestamp, card.createdAtOffsetMinutes + 1),
          });
        }

        if (card.reviewResponseAction) {
          commands.push({
            type: "session.research-card.review",
            commandId: commandId(`${card.id}-review`, options.commandIdSalt),
            sessionId,
            cardId: card.id,
            response: {
              action: card.reviewResponseAction,
              ...(card.reviewResponseSummary ? { summary: card.reviewResponseSummary } : {}),
              timestamp: timestamp(scenario.baseTimestamp, card.createdAtOffsetMinutes + 2),
            },
            createdAt: timestamp(scenario.baseTimestamp, card.createdAtOffsetMinutes + 2),
          });
        }

        if (card.status === "superseded") {
          const replacement = session.cards[index + 1];
          if (replacement) {
            replacementCardIds.add(replacement.id);
            commands.push({
              type: "session.research-card.supersede",
              commandId: commandId(`${card.id}-supersede`, options.commandIdSalt),
              sessionId,
              cardId: card.id,
              replacementCard: cardToResearchCard(scenario, session.id, replacement),
              createdAt: timestamp(scenario.baseTimestamp, card.createdAtOffsetMinutes + 2),
            });
          }
        }
      }

      for (const activity of session.activities) {
        commands.push({
          type: "session.activity.append",
          commandId: commandId(`${activity.id}-append`, options.commandIdSalt),
          sessionId,
          activity: {
            id: activity.id,
            tone: activity.tone,
            kind: activity.kind,
            summary: activity.summary,
            payload: activity.payload,
            turnId: turnId(activity.turnId),
            ...(activity.sequence !== undefined ? { sequence: activity.sequence } : {}),
            createdAt: timestamp(scenario.baseTimestamp, activity.createdAtOffsetMinutes),
          },
          createdAt: timestamp(scenario.baseTimestamp, activity.createdAtOffsetMinutes),
        });
      }

      for (const diff of session.diffs ?? []) {
        commands.push({
          type: "session.turn.diff.complete",
          commandId: commandId(`${session.id}-${diff.turnId}-diff`, options.commandIdSalt),
          sessionId,
          turnId: diff.turnId,
          checkpointRef: diff.checkpointRef,
          status: diff.status,
          files: diff.files,
          assistantMessageId: diff.assistantMessageId,
          checkpointTurnCount: diff.checkpointTurnCount,
          completedAt: timestamp(scenario.baseTimestamp, diff.completedAtOffsetMinutes),
          createdAt: timestamp(scenario.baseTimestamp, diff.completedAtOffsetMinutes),
        });
      }

      if (session.runtimeState) {
        commands.push({
          type: "session.session.set",
          commandId: commandId(`${session.id}-runtime`, options.commandIdSalt),
          sessionId,
          session: {
            sessionId,
            status: session.runtimeState.status,
            providerName: session.runtimeState.providerName,
            providerInstanceId: "codex",
            runtimeMode: "full-access",
            activeTurnId: turnId(session.runtimeState.activeTurnId),
            lastError: session.runtimeState.lastError,
            updatedAt: timestamp(
              scenario.baseTimestamp,
              session.runtimeState.updatedAtOffsetMinutes,
            ),
          },
          createdAt: timestamp(scenario.baseTimestamp, session.runtimeState.updatedAtOffsetMinutes),
        });
      }
    }
  }

  return commands;
}
