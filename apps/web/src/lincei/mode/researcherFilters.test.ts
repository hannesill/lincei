import type { ContextMenuItem } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { CommandPaletteGroup } from "~/components/CommandPalette.logic";
import { SETTINGS_SEARCH_ITEMS } from "~/components/settings/settingsSearch";

import {
  TECHIE_SETTINGS_IDS,
  TECHIE_SETTINGS_PATHS,
  isTechiePaletteValue,
  withoutTechieContextMenuItems,
  withoutTechieKeybindings,
  withoutTechiePaletteItems,
  withoutTechieSettings,
} from "./researcherFilters";

const action = (value: string): CommandPaletteGroup["items"][number] => ({
  kind: "action",
  value,
  searchTerms: [],
  title: value,
  icon: null,
  run: async () => undefined,
});

describe("researcher mode filters", () => {
  it("keeps adding a local folder or a new project and drops clone sources", () => {
    expect(isTechiePaletteValue("action:add-project:env-1:local")).toBe(false);
    expect(isTechiePaletteValue("action:add-project:env-1:new")).toBe(false);
    expect(isTechiePaletteValue("action:add-project:env-1:github")).toBe(true);
    expect(isTechiePaletteValue("action:add-project:env-1:gitlab:not-ready")).toBe(true);
    expect(isTechiePaletteValue("action:new-thread")).toBe(false);
  });

  it("filters submenus and drops a group left empty", () => {
    const groups: ReadonlyArray<CommandPaletteGroup> = [
      {
        value: "actions",
        label: "Actions",
        items: [
          action("action:new-thread"),
          action("action:pull-requests"),
          {
            ...action("action:add-project"),
            kind: "submenu",
            addonIcon: null,
            groups: [
              {
                value: "sources",
                label: "Sources",
                items: [
                  action("action:add-project:env-1:local"),
                  action("action:add-project:env-1:url"),
                ],
              },
            ],
          } as CommandPaletteGroup["items"][number],
        ],
      },
      { value: "dev", label: "Dev", items: [action("action:theme-editor")] },
    ];

    const filtered = withoutTechiePaletteItems(groups);

    expect(filtered.map((group) => group.value)).toEqual(["actions"]);
    expect(filtered[0]?.items.map((item) => item.value)).toEqual([
      "action:new-thread",
      "action:add-project",
    ]);
    const submenu = filtered[0]?.items[1];
    expect(
      submenu?.kind === "submenu" ? submenu.groups[0]?.items.map((item) => item.value) : null,
    ).toEqual(["action:add-project:env-1:local"]);
  });

  it("removes shortcuts to hidden surfaces and keeps the rest", () => {
    const rules = [
      { command: "terminal.toggle", key: "mod+j" },
      { command: "sidebar.toggle", key: "mod+b" },
      { command: "diff.toggle", key: "mod+d" },
    ] as const;
    expect(withoutTechieKeybindings(rules).map((rule) => rule.command)).toEqual(["sidebar.toggle"]);
  });

  it("moves a divider to the next kept context-menu item", () => {
    const items: ReadonlyArray<ContextMenuItem> = [
      { id: "rename", label: "Rename" },
      { id: "copy-branch", label: "Copy branch", separatorBefore: true },
      { id: "editor:vscode", label: "VS Code" },
      { id: "delete", label: "Delete", destructive: true },
    ];
    expect(withoutTechieContextMenuItems(items)).toEqual([
      { id: "rename", label: "Rename" },
      { id: "delete", label: "Delete", destructive: true, separatorBefore: true },
    ]);
  });

  it("does not leave a divider at the top of a context menu", () => {
    const items: ReadonlyArray<ContextMenuItem> = [
      { id: "open-with", label: "Open with" },
      { id: "copy-path", label: "Copy path", separatorBefore: true },
    ];
    expect(withoutTechieContextMenuItems(items)).toEqual([{ id: "copy-path", label: "Copy path" }]);
  });

  it("drops settings on hidden pages and hidden rows from search", () => {
    const visible = withoutTechieSettings(SETTINGS_SEARCH_ITEMS);
    expect(visible.some((item) => item.to === "/settings/keybindings")).toBe(false);
    expect(visible.some((item) => item.id === "diff-layout")).toBe(false);
    expect(visible.some((item) => item.id === "default-model")).toBe(true);
  });

  // Upstream renaming a settings id or moving a page must fail here, because
  // the stylesheet and these lists would otherwise stop matching silently.
  it("only names settings ids and pages that upstream still has", () => {
    const ids = new Set<string>(SETTINGS_SEARCH_ITEMS.map((item) => item.id));
    const targets = new Set<string>(
      SETTINGS_SEARCH_ITEMS.flatMap((item) => ("targetId" in item ? [item.targetId] : [])),
    );
    const paths = new Set<string>(SETTINGS_SEARCH_ITEMS.map((item) => item.to));
    expect([...TECHIE_SETTINGS_IDS].filter((id) => !ids.has(id) && !targets.has(id))).toEqual([]);
    expect([...TECHIE_SETTINGS_PATHS].filter((path) => !paths.has(path))).toEqual([]);
  });
});
