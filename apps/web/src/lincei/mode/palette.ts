import { filterCommandPaletteGroups as filterUpstreamGroups } from "~/components/CommandPalette.logic";

import { withoutTechiePaletteItems } from "./researcherFilters";
import { isTechieMode } from "./techieMode";

/**
 * Upstream's palette filter, minus developer commands in researcher mode.
 * CommandPalette.tsx imports this in place of the original: palette rows run
 * from data, so hiding one with a stylesheet would leave it reachable by Enter.
 */
export function filterCommandPaletteGroups(
  input: Parameters<typeof filterUpstreamGroups>[0],
): ReturnType<typeof filterUpstreamGroups> {
  if (isTechieMode()) return filterUpstreamGroups(input);
  return filterUpstreamGroups({
    ...input,
    activeGroups: withoutTechiePaletteItems(input.activeGroups),
  });
}
