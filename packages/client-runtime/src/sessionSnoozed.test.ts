import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  canSnoozeSession,
  effectiveSessionSnoozed,
  sessionRaisedHandWhileSnoozed,
  sessionWokeAt,
  type SessionSnoozeShell,
} from "./sessionLifecycle.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const SNOOZED_AT = "2026-04-10T09:00:00.000Z";
const FUTURE_WAKE = "2026-04-11T09:00:00.000Z";
const PAST_WAKE = "2026-04-10T10:00:00.000Z";

function makeShell(input: {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly sessionStatus?: "starting" | "running" | "ready" | "error";
  readonly pending?: "approval" | "user-input";
  readonly turnCompletedAt?: string | null;
}): SessionSnoozeShell {
  return {
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt:
      input.snoozedAt ??
      (input.snoozedUntil === undefined || input.snoozedUntil === null ? null : SNOOZED_AT),
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    session:
      input.sessionStatus === undefined
        ? null
        : {
            status: input.sessionStatus,
            updatedAt: "2026-04-10T11:00:00.000Z",
          },
    latestTurn:
      input.turnCompletedAt === undefined
        ? null
        : {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: SNOOZED_AT,
            startedAt: null,
            completedAt: input.turnCompletedAt,
            assistantMessageId: null,
          },
  };
}

describe("effectiveSessionSnoozed", () => {
  it("hides a session until its derived timer wake", () => {
    expect(effectiveSessionSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE }), { now: NOW })).toBe(
      true,
    );
    expect(effectiveSessionSnoozed(makeShell({ snoozedUntil: PAST_WAKE }), { now: NOW })).toBe(
      false,
    );
  });

  it("never hides missing or malformed snooze state", () => {
    expect(effectiveSessionSnoozed(makeShell({}), { now: NOW })).toBe(false);
    expect(effectiveSessionSnoozed(makeShell({ snoozedUntil: "not-a-date" }), { now: NOW })).toBe(
      false,
    );
  });

  it("wakes early when the provider is blocked on the user", () => {
    expect(
      effectiveSessionSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" }), {
        now: NOW,
      }),
    ).toBe(false);
    expect(
      effectiveSessionSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it("wakes only for failures newer than the snooze", () => {
    expect(
      effectiveSessionSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }), {
        now: NOW,
      }),
    ).toBe(false);
    expect(
      effectiveSessionSnoozed(
        makeShell({
          snoozedUntil: FUTURE_WAKE,
          sessionStatus: "error",
          snoozedAt: "2026-04-10T11:30:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("keeps running work snoozed without pausing it", () => {
    expect(
      effectiveSessionSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "running" }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it("wakes only for completed turns newer than the snooze", () => {
    expect(
      effectiveSessionSnoozed(
        makeShell({
          snoozedUntil: FUTURE_WAKE,
          turnCompletedAt: "2026-04-10T10:30:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      effectiveSessionSnoozed(
        makeShell({
          snoozedUntil: FUTURE_WAKE,
          turnCompletedAt: "2026-04-10T08:00:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe(true);
  });
});

describe("sessionRaisedHandWhileSnoozed", () => {
  it("distinguishes quiet snoozes from approval, input, and failure wakes", () => {
    expect(sessionRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE }))).toBe(false);
    expect(
      sessionRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" })),
    ).toBe(true);
    expect(
      sessionRaisedHandWhileSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" }),
      ),
    ).toBe(true);
    expect(
      sessionRaisedHandWhileSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }),
      ),
    ).toBe(true);
  });
});

describe("canSnoozeSession", () => {
  it("allows quiet and running sessions", () => {
    expect(canSnoozeSession({ ...makeShell({}), latestUserMessageAt: null }, { now: NOW })).toBe(
      true,
    );
    expect(
      canSnoozeSession(
        { ...makeShell({ sessionStatus: "running" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("refuses approval, input, and fresh queued-turn work", () => {
    expect(
      canSnoozeSession(
        { ...makeShell({ pending: "approval" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSnoozeSession(
        { ...makeShell({ pending: "user-input" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSnoozeSession(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T11:59:30.000Z" },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSnoozeSession(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T11:00:00.000Z" },
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("expires queued state for a message more than two minutes in the future", () => {
    expect(
      canSnoozeSession(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T12:03:00.000Z" },
        { now: NOW },
      ),
    ).toBe(true);
    expect(
      canSnoozeSession(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T12:01:00.000Z" },
        { now: NOW },
      ),
    ).toBe(false);
  });
});

describe("sessionWokeAt", () => {
  it("is null before wake and reports the timer after wake", () => {
    expect(sessionWokeAt(makeShell({}), { now: NOW })).toBe(null);
    expect(sessionWokeAt(makeShell({ snoozedUntil: FUTURE_WAKE }), { now: NOW })).toBe(null);
    expect(sessionWokeAt(makeShell({ snoozedUntil: PAST_WAKE }), { now: NOW })).toBe(PAST_WAKE);
  });

  it("reports authoritative early wake timestamps", () => {
    expect(
      sessionWokeAt(
        makeShell({
          snoozedUntil: FUTURE_WAKE,
          turnCompletedAt: "2026-04-10T10:30:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe("2026-04-10T10:30:00.000Z");
    expect(
      sessionWokeAt(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }), {
        now: NOW,
      }),
    ).toBe("2026-04-10T11:00:00.000Z");
    expect(
      sessionWokeAt(
        makeShell({
          snoozedUntil: PAST_WAKE,
          turnCompletedAt: "2026-04-10T09:30:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe("2026-04-10T09:30:00.000Z");
  });
});
