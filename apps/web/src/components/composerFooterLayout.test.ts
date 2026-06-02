import { describe, expect, it } from "vitest";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerFooterForMeasuredLayout,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerFooterForMeasuredLayout", () => {
  it("stays expanded without a measured width", () => {
    expect(
      shouldUseCompactComposerFooterForMeasuredLayout({
        formWidth: null,
        hasOverflow: false,
      }),
    ).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(
      shouldUseCompactComposerFooterForMeasuredLayout({
        formWidth: COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1,
        hasOverflow: false,
      }),
    ).toBe(true);
  });

  it("switches to compact mode when measured footer controls overflow above the breakpoint", () => {
    expect(
      shouldUseCompactComposerFooterForMeasuredLayout({
        formWidth: COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48,
        hasOverflow: true,
      }),
    ).toBe(true);
  });

  it("stays expanded above the breakpoint when measured footer controls fit", () => {
    expect(
      shouldUseCompactComposerFooterForMeasuredLayout({
        formWidth: COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48,
        hasOverflow: false,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX).toBe(
      COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
    );
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});
