import { describe, expect, it } from "vitest";
import type { OrchestrationLatestTurn } from "@t3tools/contracts";

import {
  canSettleSession,
  effectiveSessionSettled,
  hasQueuedSessionTurnStart,
  type SessionLifecycleShell,
} from "./sessionLifecycle.ts";

const NOW = "2026-07-28T12:00:00.000Z";

const completedTurn = {
  turnId: "turn-1",
  state: "completed",
  requestedAt: "2026-07-28T10:00:00.000Z",
  startedAt: "2026-07-28T10:00:01.000Z",
  completedAt: "2026-07-28T10:01:00.000Z",
  assistantMessageId: null,
} as OrchestrationLatestTurn;

function makeShell(overrides: Partial<SessionLifecycleShell> = {}): SessionLifecycleShell {
  return {
    latestUserMessageAt: "2026-07-28T10:00:00.000Z",
    latestTurn: completedTurn,
    session: {
      status: "ready",
      updatedAt: "2026-07-28T10:01:00.000Z",
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    settledOverride: null,
    settledAt: null,
    ...overrides,
  };
}

describe("session settled lifecycle", () => {
  it("keeps every form of active work visible", () => {
    expect(canSettleSession(makeShell({ hasPendingApprovals: true }), { now: NOW })).toBe(false);
    expect(canSettleSession(makeShell({ hasPendingUserInput: true }), { now: NOW })).toBe(false);
    expect(
      canSettleSession(
        makeShell({
          session: {
            status: "running",
            updatedAt: NOW,
          },
        }),
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSettleSession(
        makeShell({
          session: {
            status: "starting",
            updatedAt: NOW,
          },
        }),
        { now: NOW },
      ),
    ).toBe(false);

    for (const blockers of [
      { hasPendingApprovals: true },
      { hasPendingUserInput: true },
      {
        session: {
          status: "running",
          updatedAt: NOW,
        },
      },
    ] satisfies ReadonlyArray<Partial<SessionLifecycleShell>>) {
      expect(
        effectiveSessionSettled(
          makeShell({
            settledOverride: "settled",
            settledAt: "2026-07-28T11:00:00.000Z",
            ...blockers,
          }),
          {
            now: NOW,
            autoSettleAfterDays: 3,
            changeRequestState: "merged",
          },
        ),
      ).toBe(false);
    }
  });

  it("detects only fresh user messages not yet adopted by a turn", () => {
    const queued = makeShell({
      latestUserMessageAt: "2026-07-28T11:59:30.000Z",
      latestTurn: completedTurn,
    });
    expect(hasQueuedSessionTurnStart(queued, { now: NOW })).toBe(true);
    expect(canSettleSession(queued, { now: NOW })).toBe(false);

    expect(
      hasQueuedSessionTurnStart(
        {
          ...queued,
          latestUserMessageAt: "2026-07-28T11:55:00.000Z",
        },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      hasQueuedSessionTurnStart(
        {
          ...queued,
          session: {
            status: "error",
            updatedAt: NOW,
          },
        },
        { now: NOW },
      ),
    ).toBe(false);
  });

  it("honors server-adjudicated manual overrides", () => {
    const queuedAfterSettledAt = makeShell({
      latestUserMessageAt: "2026-07-28T11:59:30.000Z",
      settledOverride: "settled",
      settledAt: "2026-07-28T11:59:00.000Z",
    });
    expect(
      effectiveSessionSettled(queuedAfterSettledAt, {
        now: NOW,
        autoSettleAfterDays: 3,
      }),
    ).toBe(false);

    expect(
      effectiveSessionSettled(
        {
          ...queuedAfterSettledAt,
          settledAt: "2026-07-28T11:59:45.000Z",
        },
        {
          now: NOW,
          autoSettleAfterDays: 3,
        },
      ),
    ).toBe(true);

    expect(
      effectiveSessionSettled(makeShell({ settledOverride: "active" }), {
        now: NOW,
        autoSettleAfterDays: 3,
        changeRequestState: "merged",
      }),
    ).toBe(false);
  });

  it("settles merged or closed change requests immediately at the final cutoff", () => {
    const fresh = makeShell();
    expect(
      effectiveSessionSettled(fresh, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequestState: "merged",
      }),
    ).toBe(true);
    expect(
      effectiveSessionSettled(fresh, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequestState: "closed",
      }),
    ).toBe(true);
    expect(
      effectiveSessionSettled(fresh, {
        now: NOW,
        autoSettleAfterDays: null,
        changeRequestState: "open",
      }),
    ).toBe(false);
  });

  it("uses inactivity only when automatic settling is enabled", () => {
    const inactive = makeShell({
      latestUserMessageAt: "2026-07-20T10:00:00.000Z",
      latestTurn: {
        ...completedTurn,
        requestedAt: "2026-07-20T10:00:00.000Z",
        startedAt: "2026-07-20T10:00:01.000Z",
        completedAt: "2026-07-20T10:01:00.000Z",
      },
    });
    expect(
      effectiveSessionSettled(inactive, {
        now: NOW,
        autoSettleAfterDays: 3,
      }),
    ).toBe(true);
    expect(
      effectiveSessionSettled(inactive, {
        now: NOW,
        autoSettleAfterDays: null,
      }),
    ).toBe(false);
  });
});
