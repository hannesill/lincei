export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 720;
export const COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX =
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  return shouldUseCompactComposerFooterForMeasuredLayout({
    formWidth: width,
    hasWideActions: options?.hasWideActions ?? false,
    hasOverflow: false,
  });
}

export function shouldUseCompactComposerFooterForMeasuredLayout(input: {
  formWidth: number | null;
  hasWideActions?: boolean;
  hasOverflow?: boolean;
}): boolean {
  const breakpoint = input.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  if (input.hasOverflow) {
    return true;
  }
  return input.formWidth !== null && input.formWidth < breakpoint;
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX;
}
