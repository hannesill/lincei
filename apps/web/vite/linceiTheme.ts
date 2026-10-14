import type { CopyRule } from "./linceiCopy.ts";

/**
 * Lincei's default look outside the stylesheet (apps/web/src/lincei/theme.css), and the
 * upstream text that stylesheet's selectors depend on.
 *
 * Upstream repeats its stock colours where CSS cannot reach them: the stock palette as theme
 * roles, which seeds the theme editor and is handed to agent HTML renders, and the preview
 * colours of the Appearance page. Each `from` is exact source text that must occur once:
 * `node scripts/lincei/identity.ts check` and the build fail when upstream changes it. The
 * canvas is upstream's own white and near-black, so the boot script in index.html and the
 * colour Electron paints before the page exists need no rule.
 */

/** The build appends this import to the source of the host stylesheet. */
export const THEME_STYLESHEET = {
  host: "apps/web/src/index.css",
  specifier: "./lincei/theme.css",
  file: "apps/web/src/lincei/theme.css",
} as const;

const ROLES = "packages/shared/src/themePalettes.ts";
const PREVIEW = "packages/shared/src/themePreview.ts";
const CARDS = "apps/web/src/components/settings/ThemePreviewCircles.tsx";

/**
 * theme.css as upstream's theme roles, translucent tokens flattened over the surface they
 * sit on. Regenerate with the contrast script when theme.css changes.
 */
const LIGHT_ROLES = {
  canvas: "#ffffff",
  chrome: "#ffffff",
  toolbar: "#ffffff",
  toolbarForeground: "#1a1a1a",
  toolbarBorder: "#dedede",
  toolbarControl: "#ffffff",
  toolbarControlForeground: "#1a1a1a",
  toolbarControlHover: "#ebebeb",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceOverlay: "#ffffff",
  text: "#1a1a1a",
  textMuted: "#333333",
  border: "#dedede",
  input: "#1a1a1a",
  focus: "#1a1a1a",
  accent: "#1a1a1a",
  accentForeground: "#ffffff",
  secondary: "#f2f2f2",
  secondaryForeground: "#1a1a1a",
  muted: "#f2f2f2",
  mutedForeground: "#333333",
  placeholder: "#474747",
  secondaryLabel: "#333333",
  iconMuted: "#333333",
  error: "#b81d1d",
  errorForeground: "#a31b1b",
  errorSurface: "#f9eded",
  warning: "#8a5a00",
  warningForeground: "#764c00",
  warningSurface: "#f6f2eb",
  update: "#1a1a1a",
  updateForeground: "#1a1a1a",
  updateSurface: "#e4e4e4",
  accentSurface: "#ebebeb",
  accentSurfaceForeground: "#1a1a1a",
  messageSurface: "#ebebeb",
  messageForeground: "#1a1a1a",
  messageAction: "#1a1a1a",
  messageActionForeground: "#ffffff",
  messageActionHover: "#313131",
  codeBackground: "#f7f7f7",
  codeForeground: "#1a1a1a",
  sidebar: "#f5f5f5",
  sidebarForeground: "#1a1a1a",
  sidebarMutedForeground: "#333333",
  sidebarControlSurface: "#ebebeb",
  sidebarRowHover: "#ebebeb",
  sidebarRowActive: "#e3e3e3",
  sidebarRowSelected: "#ebebeb",
  sidebarBorder: "#dedede",
  terminalBackground: "#ffffff",
  terminalForeground: "#1a1a1a",
  terminalCursor: "#1a1a1a",
  terminalSelection: "#d6d6d6",
  terminalScrollbar: "#d4d4d4",
  terminalScrollbarHover: "#b3b3b3",
};

const DARK_ROLES = {
  canvas: "#0a0a0a",
  chrome: "#0a0a0a",
  toolbar: "#0a0a0a",
  toolbarForeground: "#f5f5f5",
  toolbarBorder: "#2a2a2a",
  toolbarControl: "#1a1a1a",
  toolbarControlForeground: "#f5f5f5",
  toolbarControlHover: "#202020",
  surface: "#1a1a1a",
  surfaceRaised: "#1a1a1a",
  surfaceOverlay: "#1a1a1a",
  text: "#f5f5f5",
  textMuted: "#b8b8b8",
  border: "#2a2a2a",
  input: "#717171",
  focus: "#f5f5f5",
  accent: "#f5f5f5",
  accentForeground: "#0a0a0a",
  secondary: "#191919",
  secondaryForeground: "#f5f5f5",
  muted: "#191919",
  mutedForeground: "#b8b8b8",
  placeholder: "#b8b8b8",
  secondaryLabel: "#b8b8b8",
  iconMuted: "#b8b8b8",
  error: "#f2857d",
  errorForeground: "#f7a39c",
  errorSurface: "#2f1e1c",
  warning: "#dcae55",
  warningForeground: "#e8c27a",
  warningSurface: "#2c2416",
  update: "#f5f5f5",
  updateForeground: "#f5f5f5",
  updateSurface: "#343434",
  accentSurface: "#202020",
  accentSurfaceForeground: "#f5f5f5",
  messageSurface: "#202020",
  messageForeground: "#f5f5f5",
  messageAction: "#f5f5f5",
  messageActionForeground: "#0a0a0a",
  messageActionHover: "#dedede",
  codeBackground: "#181818",
  codeForeground: "#f5f5f5",
  sidebar: "#000000",
  sidebarForeground: "#f5f5f5",
  sidebarMutedForeground: "#b8b8b8",
  sidebarControlSurface: "#0f0f0f",
  sidebarRowHover: "#141414",
  sidebarRowActive: "#1f1f1f",
  sidebarRowSelected: "#141414",
  sidebarBorder: "#212121",
  terminalBackground: "#0a0a0a",
  terminalForeground: "#f5f5f5",
  terminalCursor: "#f5f5f5",
  terminalSelection: "#3e3e3e",
  terminalScrollbar: "#2c2c2c",
  terminalScrollbarHover: "#404040",
};

const swap = (file: string, from: string, to: string): CopyRule => ({ file, from, to });

export const THEME_SOURCE_RULES: ReadonlyArray<CopyRule> = [
  // The stock palette as roles. A spread at the end of each object overrides upstream's keys.
  swap(
    ROLES,
    '  terminalScrollbarHover: "#bdbdbd",\n};',
    `  terminalScrollbarHover: "#bdbdbd",\n  ...${JSON.stringify(LIGHT_ROLES)},\n};`,
  ),
  swap(
    ROLES,
    '  terminalScrollbarHover: "#363636",\n};',
    `  terminalScrollbarHover: "#363636",\n  ...${JSON.stringify(DARK_ROLES)},\n};`,
  ),

  // The stock card and the mode tiles on Settings, Appearance. Values that are already
  // Lincei's (white surfaces, the dark canvas) have no rule.
  swap(PREVIEW, 'canvas: "#fcfcfc",', 'canvas: "#ffffff",'),
  swap(PREVIEW, 'accent: "#f4f4f5",', 'accent: "#ebebeb",'),
  swap(PREVIEW, 'messageAction: "#4f46e5",', 'messageAction: "#1a1a1a",'),
  swap(PREVIEW, 'accent: "#1c1c1f",', 'accent: "#202020",'),
  swap(PREVIEW, 'messageAction: "#8b9cff",', 'messageAction: "#f5f5f5",'),
  swap(CARDS, 'sidebar: "#fafafa",', 'sidebar: "#f5f5f5",'),
  swap(CARDS, 'accentSurface: "#f4f4f5",', 'accentSurface: "#ebebeb",'),
  swap(CARDS, 'messageSurface: "#e4e4e7",', 'messageSurface: "#ebebeb",'),
  swap(CARDS, 'sidebar: "#0f0f10",', 'sidebar: "#000000",'),
  swap(CARDS, 'surface: "#121212",', 'surface: "#1a1a1a",'),
  swap(CARDS, 'accentSurface: "#27272a",', 'accentSurface: "#202020",'),
  swap(CARDS, 'messageSurface: "#27272a",', 'messageSurface: "#202020",'),
];

/** Upstream source text a selector in theme.css depends on. */
export interface ThemeAnchor {
  readonly file: string;
  readonly text: string;
}

export interface ThemeSelector {
  readonly what: string;
  /** As written in theme.css; whitespace may differ. */
  readonly selector: string;
  readonly anchors: ReadonlyArray<ThemeAnchor>;
}

const INDEX_CSS = "apps/web/src/index.css";
const UI = "apps/web/src/components/ui";
const COMPOSER = "apps/web/src/components/chat/ComposerSurface.tsx";
const ui = (component: string, text: string): ThemeAnchor => ({
  file: `${UI}/${component}.tsx`,
  text,
});
const slot = (component: string, name: string): ThemeAnchor => ui(component, `data-slot="${name}"`);

/**
 * Every selector in theme.css, with the upstream text it relies on. `node
 * scripts/lincei/identity.ts check` fails when an anchor is gone, when a selector listed here
 * is no longer in theme.css, and when theme.css selects on an attribute or class that no
 * entry names. At run time a selector that stops matching brings back upstream's look for
 * that component (rounded corners, a blurred shadow, a hairline), except where an entry
 * says otherwise; nothing disappears.
 */
export const THEME_SELECTORS: ReadonlyArray<ThemeSelector> = [
  {
    what: "Scope of everything beyond theme-mapped tokens: no theme chosen",
    selector: "html:not([data-theme-id])",
    anchors: [
      { file: INDEX_CSS, text: 'html[data-theme-id]:not([data-theme-id=""]) {' },
      { file: "apps/web/src/themePalette.ts", text: "delete root.dataset.themeId;" },
    ],
  },
  {
    what: "Sidebar subtree tokens",
    selector: "[data-app-sidebar]",
    anchors: [
      { file: INDEX_CSS, text: "[data-app-sidebar] {" },
      { file: "apps/web/src/components/AppSidebarLayout.tsx", text: 'data-app-sidebar=""' },
    ],
  },
  {
    what: "Square corners on every element; depends on no upstream text",
    selector: "html:not([data-theme-id]) *",
    anchors: [],
  },
  {
    // Stops matching: radios turn square like everything else.
    what: "Radio buttons stay round",
    selector: ':is([data-slot="radio"], [data-slot="radio-indicator"])',
    anchors: [slot("radio-group", "radio"), slot("radio-group", "radio-indicator")],
  },
  {
    what: "Floating layer: menus",
    selector: '[data-slot="menu-popup"]',
    anchors: [slot("menu", "menu-popup")],
  },
  {
    what: "Floating layer: selects (the bordered surface inside the popup)",
    selector: '[data-slot="select-popup"] > :has(> [data-slot="select-list"])',
    anchors: [slot("select", "select-popup"), slot("select", "select-list")],
  },
  {
    what: "Floating layer: comboboxes",
    selector: '[data-slot="combobox-popup"]',
    anchors: [slot("combobox", "combobox-popup")],
  },
  {
    what: "Floating layer: autocompletes",
    selector: '[data-slot="autocomplete-popup"]',
    anchors: [slot("autocomplete", "autocomplete-popup")],
  },
  {
    // The exclusion stops matching: the transparent panel (Techie mode only) casts a shadow.
    what: "Floating layer: popovers, but not the thread details panel, which has no surface of its own",
    selector: '[data-slot="popover-popup"]:not(:has([data-thread-details-panel]))',
    anchors: [
      slot("popover", "popover-popup"),
      {
        file: "apps/web/src/components/chat/ThreadDetailsCard.tsx",
        text: 'data-thread-details-panel="popover"',
      },
    ],
  },
  {
    what: "Floating layer: preview cards",
    selector: '[data-slot="preview-card-popup"]',
    anchors: [slot("preview-card", "preview-card-popup")],
  },
  {
    what: "Floating layer: stacked toasts (each is a child of the viewport)",
    selector: '[data-slot="toast-viewport"] > *',
    anchors: [slot("toast", "toast-viewport"), ui("toast", "<Toast.Root")],
  },
  {
    what: "Floating layer: anchored toasts",
    selector: '[data-slot="toast-popup"]',
    anchors: [slot("toast", "toast-popup")],
  },
  {
    // The exclusion stops matching: the image preview gets a frame and a shadow.
    what: "Floating layer: dialogs, but not the frameless image preview",
    selector:
      '[data-slot="dialog-popup"]:not(:has([aria-label^="Close "][aria-label$=" preview"]))',
    anchors: [
      slot("dialog", "dialog-popup"),
      {
        file: "apps/web/src/components/chat/ExpandedImageDialog.tsx",
        text: "aria-label={`Close ${mediaLabel} preview`}",
      },
    ],
  },
  {
    what: "Floating layer: confirmation dialogs",
    selector: '[data-slot="alert-dialog-popup"]',
    anchors: [slot("alert-dialog", "alert-dialog-popup")],
  },
  {
    what: "Floating layer: command palette",
    selector: '[data-slot="command-dialog-popup"]',
    anchors: [slot("command", "command-dialog-popup")],
  },
  {
    what: "Floating layer: tooltips",
    selector: '[data-slot="tooltip-popup"]',
    anchors: [slot("tooltip", "tooltip-popup")],
  },
  {
    what: "Composer: ink outline, through the variable upstream draws it with",
    selector: '[data-slot="composer-shell"]',
    anchors: [
      { file: COMPOSER, text: 'data-slot="composer-shell"' },
      { file: COMPOSER, text: "[--chat-composer-outline:" },
    ],
  },
  {
    what: "Composer: no blurred drop shadow",
    selector: ':is([data-slot="composer-host"], [data-chat-composer-main-surface])',
    anchors: [
      { file: COMPOSER, text: 'data-slot="composer-host"' },
      { file: COMPOSER, text: 'data-chat-composer-main-surface="true"' },
    ],
  },
  {
    what: "Composer: the strip below it, outlined like the composer",
    selector: '[data-slot="composer-context-strip"]::before',
    anchors: [{ file: COMPOSER, text: 'data-slot="composer-context-strip"' }],
  },
  {
    what: "Composer: the backdrop shared with the strip, clipped square",
    selector: '[data-slot="composer-shell"][data-with-context]::before',
    anchors: [
      { file: COMPOSER, text: "data-with-context={contextStrip || undefined}" },
      { file: COMPOSER, text: "before:[clip-path:shape(from_0_22px," },
      { file: COMPOSER, text: "[--chat-composer-context-extension:" },
      { file: COMPOSER, text: "[--chat-composer-drawer-inset:" },
    ],
  },
  // The next four replace fills upstream takes from --input, which is ink in this look. A
  // selector here that stops matching brings back that ink fill rather than upstream's look:
  // an unchecked switch then looks like a checked one, a pressed toggle turns mid grey under
  // ink text, a segmented track turns mid grey. Fix them before shipping a merge.
  {
    what: "Switch, off: ink outline and thumb instead of upstream's --input fill",
    selector: '[data-slot="switch"][data-unchecked] > [data-slot="switch-thumb"]',
    anchors: [
      slot("switch", "switch"),
      slot("switch", "switch-thumb"),
      ui("switch", "data-unchecked:bg-input"),
    ],
  },
  {
    what: "Toggle, pressed: the hover grey instead of upstream's --input fill",
    selector: '[data-slot="toggle"][data-pressed]:not([data-variant="segmented"])',
    anchors: [
      slot("toggle", "toggle"),
      ui("toggle", "data-pressed:bg-input/64"),
      ui("toggle-group", "data-variant={resolvedVariant}"),
    ],
  },
  {
    what: "Segmented toggle group: a grey track instead of upstream's --input fill",
    selector: '[data-slot="toggle-group"][data-variant="segmented"]',
    anchors: [
      slot("toggle-group", "toggle-group"),
      ui("toggle-group", "data-variant={variant}"),
      ui("toggle-group", "bg-input/40"),
    ],
  },
  {
    what: "Segmented toggle group: the chosen segment outlined in ink",
    selector:
      '[data-slot="toggle-group"][data-variant="segmented"] [data-slot="toggle"][data-pressed]',
    anchors: [slot("toggle", "toggle"), ui("toggle-group", "data-variant={resolvedVariant}")],
  },
  {
    what: "Links in chat: underlined, since they are ink like the prose",
    selector:
      ".chat-markdown a:not(.chat-markdown-file-link, [data-footnote-ref], [data-footnote-backref])",
    anchors: [
      { file: INDEX_CSS, text: ".chat-markdown a:not(.chat-markdown-file-link) {" },
      { file: INDEX_CSS, text: ".chat-markdown a[data-footnote-ref]," },
      { file: INDEX_CSS, text: ".chat-markdown a[data-footnote-backref] {" },
    ],
  },
  {
    what: "Code blocks in chat on the code tokens",
    selector: ":is(.chat-markdown, .composer-tiptap) .chat-markdown-codeblock",
    anchors: [
      {
        file: INDEX_CSS,
        text: "html[data-theme-id] :is(.chat-markdown, .composer-tiptap) .chat-markdown-codeblock {",
      },
    ],
  },
  {
    what: "Preformatted text in chat on the code tokens",
    selector: ".chat-markdown pre",
    anchors: [{ file: INDEX_CSS, text: "html[data-theme-id] .chat-markdown pre {" }],
  },
  {
    // The one rule keyed on utility classes: nothing else marks white text on a status
    // fill. When a class string changes, the dark fill falls back to the light status
    // colour and white text on it no longer reaches 4.5:1.
    what: "Dark: a deeper red under upstream's hard-coded white text",
    selector: ":is(.bg-destructive, .bg-destructive\\/90).text-white",
    anchors: [
      ui("button", "bg-destructive text-white"),
      ui("badge", "bg-destructive text-white"),
      {
        file: "apps/web/src/components/chat/ComposerPrimaryActions.tsx",
        text: "bg-destructive/90 text-white",
      },
    ],
  },
  {
    what: "Dark: a grey under upstream's hard-coded white text on the info fill",
    selector: ".bg-info.text-white",
    anchors: [
      {
        file: "apps/web/src/components/pullRequest/PullRequestComposer.tsx",
        text: "bg-info px-1 text-3xs font-semibold tabular-nums text-white",
      },
      {
        file: "apps/web/src/components/device/DeviceStreamView.tsx",
        text: "bg-info px-1 text-3xs leading-3.5 text-white",
      },
    ],
  },
];
