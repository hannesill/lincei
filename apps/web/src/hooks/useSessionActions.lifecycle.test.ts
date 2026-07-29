import { EnvironmentId, ProjectId, SessionId, type EnvironmentApi } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  dispatchSessionLifecycleAction,
  resolvePostArchiveNewSessionOptions,
  type SessionLifecycleDispatchDependencies,
} from "./useSessionActions";
import type { SidebarSessionSummary } from "../types";

const environmentId = EnvironmentId.make("target-environment");
const sessionId = SessionId.make("session");
const target = { environmentId, sessionId };

function makeSession(overrides: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary {
  return {
    id: sessionId,
    environmentId,
    projectId: ProjectId.make("project"),
    title: "Lifecycle session",
    interactionMode: "default",
    workflowId: null,
    workflowVersion: null,
    session: null,
    createdAt: "2026-07-29T08:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    updatedAt: "2026-07-29T09:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: "2026-07-29T09:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingRequestRaisedAt: null,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeDependencies(input: {
  readSession?: SessionLifecycleDispatchDependencies["readSession"];
  settlementSupported?: boolean;
  snoozeSupported?: boolean;
}) {
  const dispatchCommand = vi.fn<EnvironmentApi["orchestration"]["dispatchCommand"]>(async () => ({
    sequence: 1,
  }));
  const environmentSupportsSessionSettlement = vi.fn(() => input.settlementSupported ?? true);
  const environmentSupportsSessionSnooze = vi.fn(() => input.snoozeSupported ?? true);
  const dependencies: SessionLifecycleDispatchDependencies = {
    readEnvironmentApi: () => ({
      orchestration: { dispatchCommand },
    }),
    readSession: input.readSession ?? (() => makeSession()),
    environmentSupportsSessionSettlement,
    environmentSupportsSessionSnooze,
    now: () => "2026-07-29T10:00:00.000Z",
  };
  return {
    dependencies,
    dispatchCommand,
    environmentSupportsSessionSettlement,
    environmentSupportsSessionSnooze,
  };
}

describe("session lifecycle action dispatch", () => {
  it("resets archived session workspace context while retaining the sidebar default mode", () => {
    expect(resolvePostArchiveNewSessionOptions("worktree")).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "worktree",
    });
  });

  it("dispatches only the lifecycle commands with explicit user wake reasons", async () => {
    const { dependencies, dispatchCommand } = makeDependencies({});
    const snoozedUntil = "2026-07-30T10:00:00.000Z";

    await expect(
      dispatchSessionLifecycleAction({ action: "settle", target }, dependencies),
    ).resolves.toBe(true);
    await expect(
      dispatchSessionLifecycleAction({ action: "unsettle", target }, dependencies),
    ).resolves.toBe(true);
    await expect(
      dispatchSessionLifecycleAction({ action: "snooze", target, snoozedUntil }, dependencies),
    ).resolves.toBe(true);
    await expect(
      dispatchSessionLifecycleAction({ action: "unsnooze", target }, dependencies),
    ).resolves.toBe(true);

    expect(dispatchCommand.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "session.settle",
        commandId: expect.any(String),
        sessionId,
      },
      {
        type: "session.unsettle",
        commandId: expect.any(String),
        sessionId,
        reason: "user",
      },
      {
        type: "session.snooze",
        commandId: expect.any(String),
        sessionId,
        snoozedUntil,
      },
      {
        type: "session.unsnooze",
        commandId: expect.any(String),
        sessionId,
        reason: "user",
      },
    ]);
  });

  it("re-reads actionability at dispatch time", async () => {
    let session = makeSession();
    const { dependencies, dispatchCommand } = makeDependencies({
      readSession: () => session,
    });

    await expect(
      dispatchSessionLifecycleAction(
        {
          action: "snooze",
          target,
          snoozedUntil: "2026-07-30T10:00:00.000Z",
        },
        dependencies,
      ),
    ).resolves.toBe(true);

    session = makeSession({ hasPendingApprovals: true });
    await expect(
      dispatchSessionLifecycleAction(
        {
          action: "snooze",
          target,
          snoozedUntil: "2026-07-30T10:00:00.000Z",
        },
        dependencies,
      ),
    ).resolves.toBe(false);

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
  });

  it("uses the target environment capability gates and treats unsupported as false", async () => {
    const {
      dependencies,
      dispatchCommand,
      environmentSupportsSessionSettlement,
      environmentSupportsSessionSnooze,
    } = makeDependencies({
      settlementSupported: false,
      snoozeSupported: false,
    });

    await expect(
      dispatchSessionLifecycleAction({ action: "settle", target }, dependencies),
    ).resolves.toBe(false);
    await expect(
      dispatchSessionLifecycleAction(
        {
          action: "snooze",
          target,
          snoozedUntil: "2026-07-30T10:00:00.000Z",
        },
        dependencies,
      ),
    ).resolves.toBe(false);

    expect(environmentSupportsSessionSettlement).toHaveBeenCalledWith(environmentId);
    expect(environmentSupportsSessionSnooze).toHaveBeenCalledWith(environmentId);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("does not dispatch after the target session disappears", async () => {
    const { dependencies, dispatchCommand } = makeDependencies({
      readSession: () => undefined,
    });

    await expect(
      dispatchSessionLifecycleAction({ action: "unsnooze", target }, dependencies),
    ).resolves.toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });
});
