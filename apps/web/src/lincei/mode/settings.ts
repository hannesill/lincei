import { useMemo } from "react";

import { TECHIE_SETTINGS_PATHS, withoutTechieSettings } from "./researcherFilters";
import { useTechieMode } from "./techieMode";

/**
 * Settings search results for the current mode. The settings sidebar and the
 * command palette both search this list, so a row the stylesheet hides is not
 * offered by either.
 */
export function useLinceiSettingsSearchItems<
  Item extends { readonly id: string; readonly to: string },
>(items: ReadonlyArray<Item>): ReadonlyArray<Item> {
  const techie = useTechieMode();
  return useMemo(() => (techie ? items : withoutTechieSettings(items)), [items, techie]);
}

/** Settings pages for the current mode. */
export function useLinceiSettingsNav<Item extends { readonly to: string }>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  const techie = useTechieMode();
  return useMemo(
    () => (techie ? items : items.filter((item) => !TECHIE_SETTINGS_PATHS.has(item.to))),
    [items, techie],
  );
}
