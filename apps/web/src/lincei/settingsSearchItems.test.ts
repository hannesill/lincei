import { describe, expect, it } from "vite-plus/test";

import { searchSettings } from "~/components/settings/settingsSearch";

import { withoutTechieSettings } from "./mode/researcherFilters";
import { CLINICAL_SETTINGS, LINCEI_SETTINGS_SEARCH_ITEMS } from "./settingsSearchItems";

/** Where the first result for a query leads, as the sidebar and the palette would go. */
const firstResult = (query: string) => {
  const [first] = searchSettings(query);
  return first === undefined ? null : { to: first.to, anchor: first.targetId ?? first.id };
};

describe("Clinical Data in settings search", () => {
  it("is found by the words a researcher would type", () => {
    for (const query of ["dataset", "clinical", "physionet", "mimic", "eicu", "research board"]) {
      expect(firstResult(query)?.to, query).toBe("/settings/clinical");
    }
  });

  it("leads to the part of the page the words are about", () => {
    expect(firstResult("physionet")?.anchor).toBe(CLINICAL_SETTINGS.datasets.id);
    expect(firstResult("dataset location")?.anchor).toBe(CLINICAL_SETTINGS.location.id);
    expect(firstResult("research board")?.anchor).toBe(CLINICAL_SETTINGS.tools.id);
    expect(firstResult("vitrine")?.to).toBe("/settings/clinical");
  });

  it("only points at anchors the page renders", () => {
    const anchors = new Set<string>(Object.values(CLINICAL_SETTINGS).map(({ id }) => id));
    for (const item of LINCEI_SETTINGS_SEARCH_ITEMS) {
      expect(anchors.has("targetId" in item ? item.targetId : item.id), item.id).toBe(true);
    }
  });

  it("stays in researcher mode, which filters developer settings out", () => {
    expect(withoutTechieSettings(LINCEI_SETTINGS_SEARCH_ITEMS)).toHaveLength(
      LINCEI_SETTINGS_SEARCH_ITEMS.length,
    );
  });
});
