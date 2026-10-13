import type { CopyRule } from "./linceiCopy.ts";

/**
 * Lincei's default look outside the stylesheet (apps/web/src/lincei/theme.css).
 *
 * Upstream repeats its stock colours in three places CSS cannot reach: the boot
 * script and inline style of index.html, which paint before the stylesheet
 * loads; the stock palette as theme roles, which seeds the theme editor and is
 * handed to agent HTML renders; and the preview colours of the Appearance page.
 * Each `from` is exact source text that must occur once:
 * `node scripts/lincei/identity.ts check` and the build fail when upstream
 * changes it.
 */

/** The build appends this import to the source of the host stylesheet. */
export const THEME_STYLESHEET = {
  host: "apps/web/src/index.css",
  specifier: "./lincei/theme.css",
} as const;

const BOOT = "apps/web/index.html";
const ROLES = "packages/shared/src/themePalettes.ts";
const PREVIEW = "packages/shared/src/themePreview.ts";
const CARDS = "apps/web/src/components/settings/ThemePreviewCircles.tsx";

/**
 * theme.css as upstream's theme roles, translucent tokens flattened over the
 * surface they sit on. Regenerate with the contrast script when theme.css changes.
 */
const LIGHT_ROLES = {
  canvas: "#f7f5ef",
  chrome: "#f7f5ef",
  toolbar: "#f7f5ef",
  toolbarForeground: "#211f1b",
  toolbarBorder: "#d9d6cc",
  toolbarControl: "#fefdfb",
  toolbarControlForeground: "#211f1b",
  toolbarControlHover: "#e9e6dd",
  surface: "#fefdfb",
  surfaceRaised: "#f8f7f2",
  surfaceOverlay: "#fefdfb",
  text: "#211f1b",
  textMuted: "#3a3831",
  border: "#d9d6cc",
  input: "#89867e",
  focus: "#1c5e6f",
  accent: "#1c5e6f",
  accentForeground: "#fdfcf9",
  secondary: "#f0eee6",
  secondaryForeground: "#211f1b",
  muted: "#f0eee6",
  mutedForeground: "#3a3831",
  placeholder: "#4a4740",
  secondaryLabel: "#3a3831",
  iconMuted: "#3a3831",
  error: "#b7191c",
  errorForeground: "#971b1a",
  errorSurface: "#f2e3de",
  warning: "#8d5406",
  warningForeground: "#7c4607",
  warningSurface: "#efe8dc",
  update: "#1c5e6f",
  updateForeground: "#1c5e6f",
  updateSurface: "#dde3e0",
  accentSurface: "#e9e6dd",
  accentSurfaceForeground: "#181612",
  messageSurface: "#e9e6dd",
  messageForeground: "#211f1b",
  messageAction: "#1c5e6f",
  messageActionForeground: "#fdfcf9",
  messageActionHover: "#316d7c",
  codeBackground: "#fdfcfa",
  codeForeground: "#211f1b",
  sidebar: "#f0eee6",
  sidebarForeground: "#211f1b",
  sidebarMutedForeground: "#3a3831",
  sidebarControlSurface: "#e9e6dd",
  sidebarRowHover: "#f7f5ef",
  sidebarRowActive: "#fefdfb",
  sidebarRowSelected: "#fefdfb",
  sidebarBorder: "#d9d6cc",
  terminalBackground: "#f7f5ef",
  terminalForeground: "#211f1b",
  terminalCursor: "#1c5e6f",
  terminalSelection: "#cbd7d6",
  terminalScrollbar: "#cac7bf",
  terminalScrollbarHover: "#adaba2",
};

const DARK_ROLES = {
  canvas: "#131b1e",
  chrome: "#131b1e",
  toolbar: "#131b1e",
  toolbarForeground: "#e8e6e0",
  toolbarBorder: "#2d3335",
  toolbarControl: "#192226",
  toolbarControlForeground: "#e8e6e0",
  toolbarControlHover: "#242b2e",
  surface: "#192226",
  surfaceRaised: "#192226",
  surfaceOverlay: "#192226",
  text: "#e8e6e0",
  textMuted: "#acb6b9",
  border: "#2d3335",
  input: "#657176",
  focus: "#7ec4d7",
  accent: "#7ec4d7",
  accentForeground: "#0f1b20",
  secondary: "#20272a",
  secondaryForeground: "#e8e6e0",
  muted: "#20272a",
  mutedForeground: "#acb6b9",
  placeholder: "#acb6b9",
  secondaryLabel: "#acb6b9",
  iconMuted: "#acb6b9",
  error: "#f47b74",
  errorForeground: "#fb9890",
  errorSurface: "#372a2c",
  warning: "#e8b458",
  warningForeground: "#eec469",
  warningSurface: "#353327",
  update: "#7ec4d7",
  updateForeground: "#7ec4d7",
  updateSurface: "#26393f",
  accentSurface: "#242b2e",
  accentSurfaceForeground: "#e8e6e0",
  messageSurface: "#242b2e",
  messageForeground: "#e8e6e0",
  messageAction: "#7ec4d7",
  messageActionForeground: "#0f1b20",
  messageActionHover: "#74b3c5",
  codeBackground: "#0b1013",
  codeForeground: "#e8e6e0",
  sidebar: "#0e1416",
  sidebarForeground: "#e8e6e0",
  sidebarMutedForeground: "#acb6b9",
  sidebarControlSurface: "#1b2023",
  sidebarRowHover: "#1f2527",
  sidebarRowActive: "#262b2d",
  sidebarRowSelected: "#1d2325",
  sidebarBorder: "#282d2f",
  terminalBackground: "#131b1e",
  terminalForeground: "#e8e6e0",
  terminalCursor: "#7ec4d7",
  terminalSelection: "#2e454c",
  terminalScrollbar: "#2d3335",
  terminalScrollbarHover: "#3e4345",
};

const swap = (file: string, from: string, to: string): CopyRule => ({ file, from, to });

export const THEME_SOURCE_RULES: ReadonlyArray<CopyRule> = [
  // What the page paints before the stylesheet arrives.
  swap(BOOT, 'content="#0a0a0a"', 'content="#131b1e"'),
  swap(BOOT, 'LIGHT_BACKGROUND = "#ffffff"', 'LIGHT_BACKGROUND = "#f7f5ef"'),
  swap(BOOT, 'DARK_BACKGROUND = "#0a0a0a"', 'DARK_BACKGROUND = "#131b1e"'),
  swap(BOOT, 'background: "#ffffff"', 'background: "#f7f5ef"'),
  swap(BOOT, 'foreground: "#262626"', 'foreground: "#211f1b"'),
  swap(BOOT, 'accent: "#4f46e5"', 'accent: "#1c5e6f"'),
  swap(BOOT, 'background: "#0a0a0a"', 'background: "#131b1e"'),
  swap(BOOT, 'foreground: "#f5f5f5"', 'foreground: "#e8e6e0"'),
  swap(BOOT, 'accent: "#818cf8"', 'accent: "#7ec4d7"'),
  swap(BOOT, "background: #ffffff;", "background: #f7f5ef;"),
  swap(BOOT, "color: #262626;", "color: #211f1b;"),
  swap(BOOT, "background: #0a0a0a;", "background: #131b1e;"),
  swap(BOOT, "color: #f5f5f5;", "color: #e8e6e0;"),

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

  // The stock card and the mode tiles on Settings, Appearance.
  swap(PREVIEW, 'canvas: "#fcfcfc",', 'canvas: "#f7f5ef",'),
  swap(PREVIEW, 'accent: "#f4f4f5",', 'accent: "#e9e6dd",'),
  swap(PREVIEW, 'messageAction: "#4f46e5",', 'messageAction: "#1c5e6f",'),
  swap(PREVIEW, 'canvas: "#0a0a0a",', 'canvas: "#131b1e",'),
  swap(PREVIEW, 'accent: "#1c1c1f",', 'accent: "#242b2e",'),
  swap(PREVIEW, 'messageAction: "#8b9cff",', 'messageAction: "#7ec4d7",'),
  swap(CARDS, 'sidebar: "#fafafa",', 'sidebar: "#f0eee6",'),
  swap(CARDS, 'surface: "#ffffff",', 'surface: "#fefdfb",'),
  swap(CARDS, 'accentSurface: "#f4f4f5",', 'accentSurface: "#e9e6dd",'),
  swap(CARDS, 'messageSurface: "#e4e4e7",', 'messageSurface: "#e9e6dd",'),
  swap(CARDS, 'sidebar: "#0f0f10",', 'sidebar: "#0e1416",'),
  swap(CARDS, 'surface: "#121212",', 'surface: "#192226",'),
  swap(CARDS, 'accentSurface: "#27272a",', 'accentSurface: "#242b2e",'),
  swap(CARDS, 'messageSurface: "#27272a",', 'messageSurface: "#242b2e",'),
];
