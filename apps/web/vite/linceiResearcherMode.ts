import type { HtmlTagDescriptor } from "vite-plus";

import {
  TECHIE_ATTRIBUTE,
  TECHIE_ATTRIBUTE_ON,
  TECHIE_STORAGE_KEY,
} from "../src/lincei/mode/attribute.ts";

/**
 * A developer control that is hidden unless Techie mode is on.
 *
 * Upstream has few test ids, so most selectors lean on an aria-label or a
 * data attribute that upstream may reword. `anchors` is the source text each
 * selector depends on: `node scripts/lincei/identity.ts check` fails when one
 * is gone. At run time a selector that no longer matches hides nothing, so a
 * broken rule means the control reappears, never that something else
 * disappears.
 */
export interface HiddenControl {
  readonly what: string;
  readonly selector: string;
  readonly anchors: ReadonlyArray<{ readonly file: string; readonly text: string }>;
}

export const HIDDEN_UNLESS_TECHIE: ReadonlyArray<HiddenControl> = [
  {
    what: "Header: thread details toggle",
    selector: 'button[aria-label="Toggle thread details panel"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/PanelLayoutControls.tsx",
        text: 'aria-label="Toggle thread details panel"',
      },
    ],
  },
  {
    what: "Header: terminal toggle",
    selector:
      '[data-panel-layout-controls] span:has(> button[aria-label="Toggle terminal drawer"])',
    anchors: [
      {
        file: "apps/web/src/components/chat/PanelLayoutControls.tsx",
        text: 'aria-label="Toggle terminal drawer"',
      },
      {
        file: "apps/web/src/components/chat/PanelLayoutControls.tsx",
        text: "data-panel-layout-controls",
      },
    ],
  },
  {
    what: "Thread details card: git, editors, project scripts",
    selector: "[data-thread-details-panel]",
    anchors: [
      {
        file: "apps/web/src/components/chat/ThreadDetailsCard.tsx",
        text: 'data-thread-details-panel="inline"',
      },
      {
        file: "apps/web/src/components/chat/ThreadDetailsCard.tsx",
        text: 'data-thread-details-panel="popover"',
      },
    ],
  },
  {
    what: "Open in editor picker",
    selector: '[role="group"][aria-label="Open in editor"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/OpenInPicker.tsx",
        text: 'aria-label="Open in editor"',
      },
    ],
  },
  {
    what: "Composer: runtime mode (access) control",
    selector: '[data-resting-block="mode"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/ChatComposer.tsx",
        text: "data-resting-block={def.id}",
      },
    ],
  },
  {
    what: "Composer: overflow menu while it only holds the runtime mode",
    selector: '[data-resting-controls-overflow]:has(> [data-composer-shortcut="composer.mode"])',
    anchors: [
      {
        file: "apps/web/src/components/chat/ChatComposer.tsx",
        text: "data-resting-controls-overflow",
      },
      {
        file: "apps/web/src/components/chat/ChatComposer.tsx",
        text: 'data-composer-shortcut="composer.mode"',
      },
    ],
  },
  {
    what: "Composer: provider slash commands",
    selector: '[data-composer-item-id^="provider-slash-command:"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/ChatComposer.tsx",
        text: "id: `provider-slash-command:${selectedProvider}:${command.name}`",
      },
      {
        file: "apps/web/src/components/chat/ComposerCommandMenu.tsx",
        text: "data-composer-item-id={props.item.id}",
      },
    ],
  },
  {
    what: "Composer: pull requests in the # menu",
    selector: '[data-composer-item-id^="pull-request:"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/ComposerCommandMenu.tsx",
        text: "data-composer-item-id={props.item.id}",
      },
    ],
  },
  {
    what: "Timeline: changed-files card",
    selector: "[data-changed-files-state]",
    anchors: [
      {
        file: "apps/web/src/components/chat/ChangedFilesTree.tsx",
        text: "data-changed-files-state=",
      },
    ],
  },
  {
    what: "Timeline: run a code block in the terminal",
    selector: 'button[aria-label="Run in terminal"]',
    anchors: [
      { file: "apps/web/src/components/ChatMarkdown.tsx", text: 'aria-label="Run in terminal"' },
    ],
  },
  {
    what: "Timeline: open diff from a file-edit row",
    selector: '[data-v2-item-inspector="file_change"] button',
    anchors: [
      {
        file: "apps/web/src/components/chat/V2ItemInspector.tsx",
        text: "data-v2-item-inspector={item.type}",
      },
    ],
  },
  {
    what: "Composer banner: branch changed",
    selector:
      '[data-slot="composer-banner"]:has(button[aria-label="Dismiss branch change notice"])',
    anchors: [
      {
        file: "apps/web/src/components/chat/ComposerBanner.tsx",
        text: 'data-slot="composer-banner"',
      },
      { file: "apps/web/src/components/ChatView.tsx", text: "Dismiss branch change notice" },
    ],
  },
  {
    what: "Timeline: worktree setup card",
    selector: '[data-timeline-row-kind="worktree-setup"]',
    anchors: [
      {
        file: "apps/web/src/components/chat/MessagesTimeline.tsx",
        text: "data-timeline-row-kind={row.kind}",
      },
    ],
  },
  {
    what: "Right panel: unavailable entries of the + menu",
    selector: '[data-slot="menu-item"][aria-keyshortcuts][data-disabled]',
    anchors: [{ file: "apps/web/src/components/RightPanelTabs.tsx", text: "aria-keyshortcuts" }],
  },
  {
    what: "Right panel: unavailable rows of the empty-panel launcher",
    selector: '[data-surface-launcher-keys] [aria-disabled="true"]',
    anchors: [
      { file: "apps/web/src/components/RightPanelTabs.tsx", text: "data-surface-launcher-keys=" },
    ],
  },
  {
    what: "Right panel: body of a diff tab left open",
    selector: '[data-right-panel-surface-content]:has(button[aria-label^="Diff scope: "])',
    anchors: [
      {
        file: "apps/web/src/components/RightPanelTabs.tsx",
        text: "data-right-panel-surface-content",
      },
      {
        file: "apps/web/src/components/DiffPanel.tsx",
        text: "aria-label={`Diff scope: ${selectedScopeLabel}`}",
      },
    ],
  },
  {
    what: "Right panel: body of a terminal tab left open",
    selector: 'aside[data-thread-terminal-drawer][data-terminal-owner="right-panel"]',
    anchors: [
      {
        file: "apps/web/src/components/ThreadTerminalDrawer.tsx",
        text: 'data-terminal-owner={isPanel ? "right-panel" : "drawer"}',
      },
    ],
  },
  {
    what: "Terminal drawer",
    selector: 'aside[data-thread-terminal-drawer][data-terminal-owner="drawer"]',
    anchors: [
      {
        file: "apps/web/src/components/ThreadTerminalDrawer.tsx",
        text: 'data-terminal-owner={isPanel ? "right-panel" : "drawer"}',
      },
    ],
  },
  {
    what: "Browser: preview menu (DevTools, hard reload, device toolbar, cache)",
    selector: 'button[aria-label="Preview menu"]',
    anchors: [
      {
        file: "apps/web/src/components/preview/PreviewMoreMenu.tsx",
        text: 'aria-label="Preview menu"',
      },
    ],
  },
  {
    what: "Browser: device toolbar",
    selector: "[data-browser-device-toolbar]",
    anchors: [
      {
        file: "apps/web/src/browser/BrowserDeviceToolbar.tsx",
        text: "data-browser-device-toolbar",
      },
    ],
  },
  {
    what: "Browser: viewport resize rails",
    selector: 'button[aria-label^="Resize browser viewport from"]',
    anchors: [
      {
        file: "apps/web/src/browser/BrowserViewportResizeHandles.tsx",
        text: 'label="Resize browser viewport from left edge"',
      },
    ],
  },
  {
    what: "Sidebar: Pull Requests",
    selector:
      '[data-app-sidebar] li[data-sidebar="menu-item"]:has(> button[aria-label="Pull Requests"])',
    anchors: [
      { file: "apps/web/src/components/sidebar/SidebarChrome.tsx", text: 'label="Pull Requests"' },
      { file: "apps/web/src/components/AppSidebarLayout.tsx", text: 'data-app-sidebar=""' },
    ],
  },
  {
    what: "Sidebar: worktree icon on a thread row",
    selector: '[data-testid^="thread-worktree-"]',
    anchors: [
      {
        file: "apps/web/src/components/ThreadStatusIndicators.tsx",
        text: "data-testid={`thread-worktree-${thread.id}`}",
      },
    ],
  },
  {
    what: "Sidebar: worktree label on a thread row",
    selector: 'span[role="img"][aria-label^="Worktree: "]',
    anchors: [
      {
        file: "apps/web/src/components/ThreadStatusIndicators.tsx",
        text: "`Worktree: ${displayPath}`",
      },
    ],
  },
  {
    what: "Sidebar: terminal-running icon",
    selector: '[data-testid^="sidebar-terminal-status-"]',
    anchors: [
      {
        file: "apps/web/src/components/Sidebar.tsx",
        text: "data-testid={`sidebar-terminal-status-${thread.id}`}",
      },
    ],
  },
  {
    what: "Sidebar: pull request badge",
    selector: '[data-app-sidebar] a[target="_blank"]',
    anchors: [
      { file: "apps/web/src/components/AppSidebarLayout.tsx", text: 'data-app-sidebar=""' },
    ],
  },
  {
    what: "Settings: Permissions default",
    selector: "#default-permissions",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "default-permissions",',
      },
    ],
  },
  {
    what: "Settings: Workspace: checkout or worktree",
    selector: "#new-threads",
    anchors: [
      { file: "apps/web/src/components/settings/settingsSearch.ts", text: 'id: "new-threads",' },
    ],
  },
  {
    what: "Settings: Worktree submodules",
    selector: "#worktree-submodules",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "worktree-submodules",',
      },
    ],
  },
  {
    what: "Settings: Project grouping by repository",
    selector: "#project-grouping",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "project-grouping",',
      },
    ],
  },
  {
    what: "Settings: Auto-settle merged threads",
    selector: "#auto-settle-merged-threads",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "auto-settle-merged-threads",',
      },
    ],
  },
  {
    what: "Settings: Diff: hide whitespace changes",
    selector: "#hide-whitespace-changes",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "hide-whitespace-changes",',
      },
    ],
  },
  {
    what: "Settings: Diff: default file state",
    selector: "#default-diff-file-state",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "default-diff-file-state",',
      },
    ],
  },
  {
    what: "Settings: Diff layout",
    selector: "#diff-layout",
    anchors: [
      { file: "apps/web/src/components/settings/settingsSearch.ts", text: 'id: "diff-layout",' },
    ],
  },
  {
    what: "Settings: Proactive panels",
    selector: "#proactive-panels",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "proactive-panels",',
      },
    ],
  },
  {
    what: "Settings: Background activity",
    selector: "#background-activity",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "background-activity",',
      },
    ],
  },
  {
    what: "Settings: Start worktrees from origin",
    selector: "#start-from-origin",
    anchors: [
      {
        file: "apps/web/src/components/settings/settingsSearch.ts",
        text: 'id: "start-from-origin",',
      },
    ],
  },
  {
    what: "Settings: t3 command",
    selector: "#cli-command",
    anchors: [
      { file: "apps/web/src/components/settings/settingsSearch.ts", text: 'id: "cli-command",' },
    ],
  },
  {
    what: "Settings: Diagnostics",
    selector: "#diagnostics",
    anchors: [
      { file: "apps/web/src/components/settings/settingsSearch.ts", text: 'id: "diagnostics",' },
    ],
  },
  {
    what: "Settings: legacy features",
    selector: "section#legacy-features",
    anchors: [
      {
        file: "apps/web/src/components/settings/SettingsPanels.tsx",
        text: '<section id="legacy-features"',
      },
    ],
  },
  {
    what: "Settings: project and environment scope sentence",
    selector: 'p:has([aria-label^="Project scope:"])',
    anchors: [
      {
        file: "apps/web/src/components/settings/SettingsScopeSentence.tsx",
        text: 'ariaLabel="Project scope"',
      },
    ],
  },
];

const RESEARCHER_ROOT = `html:not([${TECHIE_ATTRIBUTE}="${TECHIE_ATTRIBUTE_ON}"])`;

/** One rule per control, outside any cascade layer so it wins over upstream's layered styles. */
export function researcherModeStylesheet(
  controls: ReadonlyArray<HiddenControl> = HIDDEN_UNLESS_TECHIE,
): string {
  return controls
    .map(
      (control) =>
        `/* ${control.what} */\n${RESEARCHER_ROOT} ${control.selector} { display: none !important; }`,
    )
    .join("\n");
}

/** Sets the root attribute from the cached mode before anything paints. */
const BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(TECHIE_STORAGE_KEY)})===${JSON.stringify(TECHIE_ATTRIBUTE_ON)})document.documentElement.setAttribute(${JSON.stringify(TECHIE_ATTRIBUTE)},${JSON.stringify(TECHIE_ATTRIBUTE_ON)})}catch{}`;

export function researcherModeHeadTags(): Array<HtmlTagDescriptor> {
  return [
    { tag: "script", children: BOOT_SCRIPT, injectTo: "head-prepend" },
    {
      tag: "style",
      attrs: { id: "lincei-researcher-mode" },
      children: researcherModeStylesheet(),
      injectTo: "head",
    },
  ];
}
