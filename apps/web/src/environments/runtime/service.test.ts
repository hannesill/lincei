import { describe, expect, it } from "vitest";

import {
  shouldApplyProjectionEvent,
  shouldApplyProjectionSnapshot,
  shouldApplyTerminalEvent,
} from "./service";

describe("shouldApplyTerminalEvent", () => {
  it("applies terminal events for draft-only sessions", () => {
    expect(
      shouldApplyTerminalEvent({
        serverSessionArchivedAt: undefined,
        hasDraftSession: true,
      }),
    ).toBe(true);
  });

  it("drops terminal events for unknown sessions", () => {
    expect(
      shouldApplyTerminalEvent({
        serverSessionArchivedAt: undefined,
        hasDraftSession: false,
      }),
    ).toBe(false);
  });

  it("drops terminal events for archived server sessions even if a draft exists", () => {
    expect(
      shouldApplyTerminalEvent({
        serverSessionArchivedAt: "2026-04-09T00:00:00.000Z",
        hasDraftSession: true,
      }),
    ).toBe(false);
  });

  it("applies terminal events for active server sessions", () => {
    expect(
      shouldApplyTerminalEvent({
        serverSessionArchivedAt: null,
        hasDraftSession: false,
      }),
    ).toBe(true);
  });
});

describe("shouldApplyProjectionSnapshot", () => {
  it("accepts the first snapshot for an environment", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: null,
        next: {
          snapshotSequence: 1,
          updatedAt: "2026-04-22T10:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("drops snapshots with an older sequence", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 4,
          updatedAt: "2026-04-22T10:06:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("drops snapshots with the same sequence and older timestamp", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 5,
          updatedAt: "2026-04-22T10:04:59.000Z",
        },
      }),
    ).toBe(false);
  });

  it("accepts snapshots with the same sequence and a newer timestamp", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 5,
          updatedAt: "2026-04-22T10:05:01.000Z",
        },
      }),
    ).toBe(true);
  });
});

describe("shouldApplyProjectionEvent", () => {
  it("accepts the first event for an environment", () => {
    expect(
      shouldApplyProjectionEvent({
        current: null,
        sequence: 1,
      }),
    ).toBe(true);
  });

  it("drops stale or duplicate events", () => {
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 5,
      }),
    ).toBe(false);
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 4,
      }),
    ).toBe(false);
  });

  it("accepts newer events", () => {
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 6,
      }),
    ).toBe(true);
  });
});
