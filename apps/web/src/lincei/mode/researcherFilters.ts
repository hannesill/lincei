/**
 * What researcher mode removes from upstream's data-driven surfaces: the
 * command palette, keyboard shortcuts, context menus, and settings search.
 *
 * The stylesheet (apps/web/vite/linceiResearcherMode.ts) hides controls that
 * are on screen. These surfaces are built from data and act from data, so a
 * hidden row would still run on Enter; they are filtered instead. Everything
 * here is a pure function over upstream's own shapes.
 */
import type { ContextMenuItem, KeybindingCommand } from "@t3tools/contracts";

import type { CommandPaletteGroup } from "~/components/CommandPalette.logic";

/** Shortcuts whose only purpose is a developer surface. Typed, so an upstream rename fails typecheck. */
export const TECHIE_KEYBINDING_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "diff.toggle",
  "editor.openFavorite",
  "composer.branch",
  "composer.previousWorktree",
  "composer.mode",
  "composer.workspace",
  "composer.host",
  "composer.cycleHost",
  "thread.copyReference",
  "threadPanel.toggle",
  "themeEditor.toggle",
  "pullRequest.copyNumber",
] satisfies ReadonlyArray<KeybindingCommand>);

export function withoutTechieKeybindings<Rule extends { readonly command: KeybindingCommand }>(
  rules: ReadonlyArray<Rule>,
): ReadonlyArray<Rule> {
  return rules.filter((rule) => !TECHIE_KEYBINDING_COMMANDS.has(rule.command));
}

const TECHIE_PALETTE_VALUES: ReadonlySet<string> = new Set([
  "action:pull-requests",
  "action:link-pull-request",
  "action:open-thread-pull-requests",
  "action:copy-thread-reference",
  "action:theme-editor",
  "action:add-project:wsl-folder",
]);
/** "Add project" from anything but a folder on this computer or a new name: clone sources. */
const TECHIE_ADD_PROJECT_SOURCE = /^action:add-project:[^:]+:(?!(?:local|new)$).+$/;

export const isTechiePaletteValue = (value: string): boolean =>
  TECHIE_PALETTE_VALUES.has(value) || TECHIE_ADD_PROJECT_SOURCE.test(value);

export function withoutTechiePaletteItems(
  groups: ReadonlyArray<CommandPaletteGroup>,
): ReadonlyArray<CommandPaletteGroup> {
  const filtered: Array<CommandPaletteGroup> = [];
  for (const group of groups) {
    const items: Array<CommandPaletteGroup["items"][number]> = [];
    for (const item of group.items) {
      if (isTechiePaletteValue(item.value)) continue;
      items.push(
        item.kind === "submenu"
          ? { ...item, groups: withoutTechiePaletteItems(item.groups) }
          : item,
      );
    }
    if (items.length > 0) filtered.push({ ...group, items });
  }
  return filtered;
}

const TECHIE_CONTEXT_MENU_IDS: ReadonlySet<string> = new Set([
  "new-thread-on-branch",
  "copy-branch",
  "copy-branch-name",
  "copy-thread-id",
  "open-with",
  "link-to-thread",
  "unlink-from-thread",
]);

const isTechieContextMenuItem = (id: string): boolean =>
  TECHIE_CONTEXT_MENU_IDS.has(id) || id.startsWith("editor:");

/** Drops developer items and keeps the dividers where a reader expects them. */
export function withoutTechieContextMenuItems<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
): Array<ContextMenuItem<T>> {
  const kept: Array<ContextMenuItem<T>> = [];
  let dividerOwed = false;
  for (const item of items) {
    if (isTechieContextMenuItem(item.id)) {
      dividerOwed ||= item.separatorBefore === true;
      continue;
    }
    const separatorBefore = (item.separatorBefore === true || dividerOwed) && kept.length > 0;
    dividerOwed = false;
    const { separatorBefore: _dropped, ...rest } = item;
    kept.push(separatorBefore ? { ...rest, separatorBefore } : rest);
  }
  return kept;
}

/** Settings pages that only exist in Techie mode. */
export const TECHIE_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/keybindings",
  "/settings/source-control",
  "/settings/storage",
  "/settings/connections",
]);

/**
 * Settings rows the stylesheet hides, by search id. Kept beside the paths so
 * search never lists a row that is not on screen.
 */
export const TECHIE_SETTINGS_IDS: ReadonlySet<string> = new Set([
  "default-permissions",
  "new-threads",
  "worktree-submodules",
  "project-grouping",
  "auto-settle-merged-threads",
  "hide-whitespace-changes",
  "default-diff-file-state",
  "diff-layout",
  "proactive-panels",
  "background-activity",
  "start-from-origin",
  "cli-command",
  "diagnostics",
  "diff-color-scheme",
  "composer-context",
  "terminal-font",
  "usage-providers",
  "cursor-keychain-usage",
  "provider-health-check-interval",
  "browser-profiles",
  "browser-default-viewport",
  "browser-auto-show-floating-preview",
  "browser-recording-frame-rate",
  "browser-recording-key-presses",
  "browser-recording-mouse-presses",
  "device-hub",
  "device-platform-support",
  "agent-device-access",
  "device-hosts",
  "project-actions",
  "browser-default-profile",
  "legacy-plan-mode",
  "legacy-context-window-indicator",
  "legacy-sidebar",
]);

export function withoutTechieSettings<Item extends { readonly id: string; readonly to: string }>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  return items.filter(
    (item) => !TECHIE_SETTINGS_PATHS.has(item.to) && !TECHIE_SETTINGS_IDS.has(item.id),
  );
}
