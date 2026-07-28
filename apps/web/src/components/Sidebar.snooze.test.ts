import { describe, expect, it } from "vitest";

import { resolveSnoozePresets, snoozeWakeDescription, snoozeWakeLabel } from "./Sidebar.snooze";

describe("Sidebar snooze presentation", () => {
  it("offers deterministic future presets without duplicate evening choices", () => {
    const morning = new Date("2026-07-29T08:00:00.000Z");
    const presets = resolveSnoozePresets(morning);

    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    expect(presets.every((preset) => Date.parse(preset.snoozedUntil) > morning.getTime())).toBe(
      true,
    );

    const late = resolveSnoozePresets(new Date("2026-07-29T17:30:00.000Z"));
    expect(late.map((preset) => preset.id)).toEqual(["hour", "tomorrow", "next-week"]);
  });

  it("formats compact wake countdowns", () => {
    const now = new Date("2026-07-29T08:00:00.000Z");
    expect(snoozeWakeLabel("2026-07-29T08:00:01.000Z", now)).toBe("1m");
    expect(snoozeWakeLabel("2026-07-29T10:00:00.000Z", now)).toBe("2h");
    expect(snoozeWakeLabel("2026-08-01T08:00:00.000Z", now)).toBe("3d");
    expect(snoozeWakeLabel("invalid", now)).toBe("now");
  });

  it("describes wake times without exposing invalid values", () => {
    const now = new Date("2026-07-29T08:00:00.000Z");
    expect(snoozeWakeDescription("invalid", now)).toBe("");
    expect(snoozeWakeDescription("2026-07-30T09:00:00.000Z", now)).toContain("tomorrow");
  });
});
