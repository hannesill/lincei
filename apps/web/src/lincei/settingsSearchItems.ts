/**
 * What Settings search, and the command palette that searches the same list,
 * find for Clinical Data. `settingsSearch.ts` spreads these into upstream's
 * catalog, which is the one change that file needs.
 */
import type { SettingsSearchItem } from "~/components/settings/settingsSearch";

/** The anchors on the Clinical Data page that a search result scrolls to. */
export const CLINICAL_SETTINGS = {
  tools: { id: "clinical-tools", title: "Clinical research tools" },
  location: { id: "clinical-dataset-location", title: "Dataset location" },
  datasets: { id: "clinical-datasets", title: "Datasets" },
} as const;

export const LINCEI_SETTINGS_SEARCH_ITEMS = [
  {
    ...CLINICAL_SETTINGS.tools,
    to: "/settings/clinical",
    searchTerms: ["clinical data setup install reinstall repair m4 vitrine python skills tools"],
  },
  {
    ...CLINICAL_SETTINGS.datasets,
    to: "/settings/clinical",
    searchTerms: [
      "clinical data dataset mimic mimic-iv mimic iv note eicu physionet demo download add folder credentialed login password access",
    ],
  },
  {
    ...CLINICAL_SETTINGS.location,
    to: "/settings/clinical",
    searchTerms: ["clinical data dataset storage folder path disk space where kept"],
  },
  {
    // The board has no settings of its own; what it needs is the tools.
    id: "clinical-research-board",
    title: "Research board",
    to: "/settings/clinical",
    targetId: CLINICAL_SETTINGS.tools.id,
    searchTerms: ["clinical research board vitrine cards results figures tables flask panel"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
