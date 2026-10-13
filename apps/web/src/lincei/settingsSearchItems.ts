/**
 * What Settings search, and the command palette that searches the same list,
 * find for Lincei's own settings: Clinical Data and the Techie mode switch.
 * `settingsSearch.ts` spreads these into upstream's catalog, which is the one
 * change that file needs.
 */
import type { SettingsSearchItem } from "~/components/settings/settingsSearch";

/** The anchors on the Clinical Data page that a search result scrolls to. */
export const CLINICAL_SETTINGS = {
  tools: { id: "clinical-tools", title: "Clinical research tools" },
  location: { id: "clinical-dataset-location", title: "Dataset location" },
  datasets: { id: "clinical-datasets", title: "Datasets" },
} as const;

/** The row on Settings, General that switches between researcher mode and upstream's full feature set. */
export const TECHIE_MODE_SETTING = { id: "techie-mode", title: "Techie mode" } as const;

export const LINCEI_SETTINGS_SEARCH_ITEMS = [
  {
    // Found by what it brings back: in researcher mode those settings are not
    // in the list, so their names lead here instead of nowhere.
    ...TECHIE_MODE_SETTING,
    to: "/settings/general",
    searchTerms: [
      "techie mode developer researcher advanced code terminal git branch worktree diff pull request source control keybindings keyboard shortcuts connections remote",
    ],
  },
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
