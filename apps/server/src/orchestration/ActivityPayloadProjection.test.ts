import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  SessionId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationSessionActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  projectActivityEvent,
  projectActivityPayload,
  projectSessionDetailSnapshot,
} from "./ActivityPayloadProjection.ts";

function makeActivity(
  id: string,
  itemType: string,
  data: Record<string, unknown>,
): OrchestrationSessionActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind: "tool.completed",
    summary: `Completed ${itemType}`,
    payload: {
      itemType,
      title: itemType,
      detail: `${itemType} detail`,
      status: "completed",
      requestKind: "command",
      data,
    },
    turnId: TurnId.make(`turn-${id}`),
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function makeSession(
  activities: ReadonlyArray<OrchestrationSessionActivity>,
): OrchestrationSession {
  return {
    id: SessionId.make("session-projection"),
    projectId: ProjectId.make("project-projection"),
    title: "Activity projection",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    workflowId: null,
    workflowVersion: null,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: null,
  };
}

const fixtures = [
  makeActivity("command", "command_execution", {
    item: {
      command: ["bash", "-lc", "bun run test"],
      input: { command: "fallback input", ignored: "input bulk" },
      result: { command: "fallback result", aggregatedOutput: "x".repeat(10_000) },
      commandActions: [{ type: "unknown", output: "y".repeat(5_000) }],
    },
    command: "fallback data",
    kind: "execute",
    toolCallId: "tool-command",
    rawOutput: {
      content: "\n```\nfirst useful line\nsecond line",
      stdout: "unused stdout",
      ignored: "raw bulk",
    },
    ignored: "top-level bulk",
  }),
  makeActivity("file-change", "file_change", {
    item: {
      changes: [
        { oldPath: "src/old.ts", newPath: "src/new.ts", patch: "large patch".repeat(1_000) },
        { filePath: "src/second.ts" },
      ],
    },
    ignored: "top-level bulk",
  }),
  makeActivity("dynamic", "dynamic_tool_call", {
    toolCallId: "tool-dynamic",
    rawOutput: {
      stdout: "dynamic summary\nlong output".repeat(1_000),
    },
    ignored: "top-level bulk",
  }),
  makeActivity("collab", "collab_agent_tool_call", {
    kind: "delegate",
    rawOutput: {
      content: "``` \n```",
      stdout: "must not be used when content is present",
    },
    ignored: "top-level bulk",
  }),
  makeActivity("mcp", "mcp_tool_call", {
    item: {
      server: "repository",
      tool: "search",
      arguments: { query: "activity projection" },
      aggregatedOutput: "mcp payload remains available",
    },
    ignored: "MCP data is rendered verbatim",
  }),
  makeActivity("search", "web_search", {
    rawOutput: {
      totalFiles: 42,
      truncated: true,
      content: "ignored because totalFiles wins",
    },
    ignored: "top-level bulk",
  }),
  makeActivity("image", "image_view", {
    ignored: "top-level bulk",
  }),
] satisfies ReadonlyArray<OrchestrationSessionActivity>;

describe("projectActivityPayload", () => {
  it("drops unread bulk while retaining command, file, tool, and summary inputs", () => {
    const projected = projectActivityPayload(fixtures[0]!);
    expect(projected.payload).toEqual({
      itemType: "command_execution",
      title: "command_execution",
      detail: "command_execution detail",
      status: "completed",
      requestKind: "command",
      data: {
        item: {
          command: ["bash", "-lc", "bun run test"],
          input: { command: "fallback input" },
          result: { command: "fallback result" },
        },
        command: "fallback data",
        toolCallId: "tool-command",
        kind: "execute",
        rawOutput: { content: "first useful line" },
      },
    });

    expect(projectActivityPayload(fixtures[1]!).payload).toMatchObject({
      data: {
        files: [{ path: "src/new.ts" }, { path: "src/old.ts" }, { path: "src/second.ts" }],
      },
    });
  });

  it("passes MCP tool data through unchanged", () => {
    expect(projectActivityPayload(fixtures[4]!)).toBe(fixtures[4]);
  });

  it("retains every payload field read by the current web work-log derivation", () => {
    const projected = fixtures.map(projectActivityPayload);
    for (let index = 0; index < fixtures.length; index += 1) {
      const sourcePayload = fixtures[index]!.payload as Record<string, unknown>;
      const projectedPayload = projected[index]!.payload as Record<string, unknown>;
      expect(projectedPayload).toMatchObject({
        itemType: sourcePayload.itemType,
        title: sourcePayload.title,
        detail: sourcePayload.detail,
        requestKind: sourcePayload.requestKind,
      });
    }

    expect((projected[1]!.payload as Record<string, unknown>).data).toEqual({
      files: [{ path: "src/new.ts" }, { path: "src/old.ts" }, { path: "src/second.ts" }],
    });
    expect((projected[2]!.payload as Record<string, unknown>).data).toEqual({
      toolCallId: "tool-dynamic",
      rawOutput: { content: "dynamic summary" },
    });
    expect((projected[3]!.payload as Record<string, unknown>).data).toEqual({
      kind: "delegate",
      rawOutput: { content: "2 lines" },
    });
    expect((projected[5]!.payload as Record<string, unknown>).data).toEqual({
      rawOutput: { totalFiles: 42, truncated: true },
    });
    expect((projected[6]!.payload as Record<string, unknown>).data).toEqual({});
  });

  it("substantially reduces serialized non-MCP activity payloads", () => {
    const nonMcpFixtures = fixtures.filter(
      (activity) =>
        (activity.payload as { readonly itemType?: string }).itemType !== "mcp_tool_call",
    );
    const originalSize = JSON.stringify(nonMcpFixtures).length;
    const projectedSize = JSON.stringify(nonMcpFixtures.map(projectActivityPayload)).length;
    expect(projectedSize).toBeLessThan(originalSize / 2);
  });

  it("projects snapshot and event transports without mutating their sources", () => {
    const activity = fixtures[0]!;
    const session = makeSession([activity]);
    const snapshot = { snapshotSequence: 7, session };
    const projectedSnapshot = projectSessionDetailSnapshot(snapshot);

    expect(projectedSnapshot.session.activities[0]).not.toBe(activity);
    expect(snapshot.session.activities[0]).toBe(activity);

    const event = {
      sequence: 8,
      eventId: EventId.make("event-activity"),
      aggregateKind: "session",
      aggregateId: session.id,
      occurredAt: "2026-07-27T00:00:01.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "session.activity-appended",
      payload: {
        sessionId: session.id,
        activity,
      },
    } satisfies Extract<OrchestrationEvent, { type: "session.activity-appended" }>;

    const projectedEvent = projectActivityEvent(event);
    expect(projectedEvent).not.toBe(event);
    expect(
      projectedEvent.type === "session.activity-appended"
        ? projectedEvent.payload.activity
        : undefined,
    ).toEqual(projectActivityPayload(activity));
    expect(event.payload.activity).toBe(activity);
  });
});
