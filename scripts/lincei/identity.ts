// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone maintenance script: synchronous file rewrites, no Effect runtime.
/**
 * Lincei's identity, written as edits to upstream T3 Code files.
 *
 * Lincei must never share a bundle id, URL scheme, data directory, background
 * service, or release feed with a T3 Code install on the same machine, and
 * upstream spells those values as literals. Rather than hand-editing them (and
 * re-resolving the same conflicts on every upstream merge), the edits live
 * here and are applied by this script:
 *
 *   node scripts/lincei/identity.ts apply   rewrite the governed files
 *   node scripts/lincei/identity.ts check   fail if any governed file is stale
 *
 * After `git merge` reports a conflict in a governed file, take upstream's
 * side (`git checkout --theirs <file>`) and run `apply`. A rule that no longer
 * matches means upstream changed that line: update the rule here.
 *
 * Display copy ("T3 Code" in UI strings) is not governed here; the web build
 * rewrites it (apps/web/vite/linceiBrand.ts). What that build relies on in
 * upstream's source is checked here, though: the developer copy it replaces
 * (linceiCopy.ts), the attributes its researcher-mode stylesheet selects on
 * (linceiResearcherMode.ts), and the colours and selectors of the default look
 * (linceiTheme.ts, theme.css). Those files are never edited, so `check` is the
 * only thing that notices upstream rewording one.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { COPY_RULES } from "../../apps/web/vite/linceiCopy.ts";
import { HIDDEN_UNLESS_TECHIE } from "../../apps/web/vite/linceiResearcherMode.ts";
import {
  THEME_SELECTORS,
  THEME_SOURCE_RULES,
  THEME_STYLESHEET,
} from "../../apps/web/vite/linceiTheme.ts";

type Replacement = readonly [from: string | RegExp, to: string];

/** Upstream's spellings of the product's identity. */
const BUNDLE_ID: ReadonlyArray<Replacement> = [
  ["com.t3tools.T3Code", "studio.lincei.Lincei"],
  ["com.t3tools.t3code", "studio.lincei.app"],
];
const REPOSITORY: ReadonlyArray<Replacement> = [["pingdotgg/t3code", "hannesill/lincei"]];
const NAME: ReadonlyArray<Replacement> = [
  ["T3-Code-", "Lincei-"],
  ["T3 Code", "Lincei"],
];
const SCHEME: ReadonlyArray<Replacement> = [
  ["t3code-dev://", "lincei-dev://"],
  ["t3code://", "lincei://"],
  ['"t3code-dev:"', '"lincei-dev:"'],
  ['"t3code:"', '"lincei:"'],
];
// Profile directories, schemes, and service names; not the `t3code/<rule>` lint directives.
const SLUG: ReadonlyArray<Replacement> = [
  [/t3code(?!\/(?:no|prefer|require|namespace)-)/g, "lincei"],
];
// The `.t3` home directory, but not `.t3Home`, `t3.json`, or `app.t3.codes`.
const HOME: ReadonlyArray<Replacement> = [[/(?<![\w-])\.t3(?![\w.-])/g, ".lincei"]];
/** Most specific first, so a longer spelling is not broken up by a shorter one. */
const EVERY_TOKEN = [...BUNDLE_ID, ...REPOSITORY, ...NAME, ...SLUG, ...HOME];

interface Rules {
  /** Rewritten wherever they occur. */
  readonly tokens?: ReadonlyArray<Replacement>;
  /** Exact text that must be present until it has been replaced. */
  readonly exact?: ReadonlyArray<readonly [from: string, to: string]>;
}

const GOVERNED_FILES: Readonly<Record<string, Rules>> = {
  // Files that only spell identity: every token in them is rewritten.
  "apps/desktop/src/app/DesktopEarlyElectronStartup.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopEnvironment.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopLegacyLocalStorage.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopStatePaths.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopUserData.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/electron/ElectronProtocol.ts": { tokens: EVERY_TOKEN },
  "apps/server/src/cli/browser.ts": { tokens: EVERY_TOKEN },
  "apps/server/src/cloud/bootService.ts": { tokens: EVERY_TOKEN },
  "apps/server/src/http.ts": { tokens: EVERY_TOKEN },
  "apps/server/src/os-jank.ts": { tokens: EVERY_TOKEN },

  // Files that mix identity with names other code depends on.
  "apps/desktop/package.json": {
    exact: [['"productName": "T3 Code (Alpha)"', '"productName": "Lincei (Alpha)"']],
  },
  "apps/desktop/scripts/electron-launcher.mjs": {
    exact: [
      ['"T3 Code (Dev)" : "T3 Code (Alpha)"', '"Lincei (Dev)" : "Lincei (Alpha)"'],
      ["`com.t3tools.t3code.dev.${", "`studio.lincei.app.dev.${"],
      [': "com.t3tools.t3code";', ': "studio.lincei.app";'],
      ['? ["t3code-dev"] : ["t3code"]', '? ["lincei-dev"] : ["lincei"]'],
    ],
  },
  // Telemetry stays off unless a Lincei analytics project is configured, and
  // upstream's project never receives Lincei usage.
  "apps/server/src/telemetry/AnalyticsService.ts": {
    exact: [
      [
        'Config.withDefault("phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m")',
        'Config.withDefault("")',
      ],
      [
        'Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(true))',
        'Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(false))',
      ],
    ],
  },
  "packages/shared/src/codexAuthHandoff.ts": { tokens: [...SCHEME, ...SLUG] },
  "packages/shared/src/providerAuthReturnUrl.ts": { tokens: SCHEME },
  "packages/shared/src/cliRelease.ts": {
    exact: [
      [
        'CLI_RELEASE_REPOSITORY = "pingdotgg/t3code"',
        'CLI_RELEASE_REPOSITORY = "hannesill/lincei"',
      ],
    ],
  },
  "scripts/build-desktop-artifact.ts": {
    exact: [
      ['DESKTOP_APP_ID = "com.t3tools.t3code"', 'DESKTOP_APP_ID = "studio.lincei.app"'],
      ['? "T3 Code (Nightly)"', '? "Lincei (Nightly)"'],
      [
        '(desktopPackageJson.productName ?? "T3 Code")',
        '(desktopPackageJson.productName ?? "Lincei")',
      ],
      ['artifactName: "T3-Code-${version}', 'artifactName: "Lincei-${version}'],
      ['"T3 Code captures the active window', '"Lincei captures the active window'],
      ['name: "T3 Code",', 'name: "Lincei",'],
      ['schemes: ["t3code", "t3code-dev"]', 'schemes: ["lincei", "lincei-dev"]'],
      ['executableName: "t3code"', 'executableName: "lincei"'],
      ['StartupWMClass: "t3code"', 'StartupWMClass: "lincei"'],
      // The packaged app's own package.json. Electron derives the keychain
      // entry that encrypts saved secrets from this name ("<name> Safe
      // Storage"), so sharing it would have Lincei ask for T3 Code's entry.
      [
        '    name: "t3code",\n    version: appVersion,',
        '    name: "lincei",\n    version: appVersion,',
      ],
      [
        '"T3 Code is an open-source desktop app for coding agents. Work with your existing agent subscriptions, review code changes, and run commands in your projects. Connect from desktop, web, or mobile to continue working remotely."',
        '"Lincei is an agentic clinical research environment. Direct coding agents at clinical datasets, stay in the loop while they work, and review what they produce as research cards."',
      ],
      ['homepage: "https://t3.codes",', 'homepage: "https://github.com/hannesill/lincei",'],
      ['author: "T3 Tools",', 'author: "Lincei",'],
      // Upstream only ships signed builds. A build without a Developer ID is
      // signed ad hoc instead of not at all: Apple Silicon reports a bundle
      // with no valid signature as "damaged", which the user cannot override.
      [
        '...(signed ? { sign: path.join(repoRoot, "scripts/sign-macos.ts") } : {}),',
        [
          "...(signed",
          '        ? { sign: path.join(repoRoot, "scripts/sign-macos.ts") }',
          '        : { identity: "-", hardenedRuntime: false }),',
        ].join("\n"),
      ],
    ],
  },
  "scripts/dev-runner.ts": {
    exact: [['path.join(NodeOS.homedir(), ".t3")', 'path.join(NodeOS.homedir(), ".lincei")']],
  },

  // Text a researcher reads that the web build's display-name rewrite cannot
  // reach, because the server and the desktop shell are built separately: the
  // page shown after signing in with ChatGPT, the macOS permission helper, the
  // launcher's own messages, provider status, and the README of a new project.
  "apps/server/src/provider/CodexAuthCallbackPage.ts": { tokens: NAME },
  "apps/desktop/src/permissions/MacPermissionHelper.ts": { tokens: NAME },
  "apps/desktop/src/app/DesktopCliShim.ts": { tokens: NAME },
  // An agent that is not signed in. The wizard and Settings show this beside
  // their own Sign in button, so the sentence says what to do there instead of
  // naming a command to type.
  "apps/server/src/provider/ClaudeProvider.ts": {
    exact: [
      ['"Claude is disabled in T3 Code settings."', '"Claude is disabled in Lincei settings."'],
      [
        '"Claude Code is not authenticated. Run `claude auth login` and try again."',
        '"Sign in with your Claude account to use it."',
      ],
    ],
  },
  "apps/server/src/provider/CodexProvider.ts": {
    exact: [
      ['"Codex is disabled in T3 Code settings."', '"Codex is disabled in Lincei settings."'],
      [
        '"Codex CLI is not authenticated. Run `codex login` and try again."',
        '"Sign in with your ChatGPT account to use it."',
      ],
    ],
  },
  "apps/server/src/project/ManagedProjectFolders.ts": {
    exact: [['"Created in [T3 Code](https://t3.codes)."', '"Created in Lincei."']],
  },

  // What upstream tells users about itself that is false for Lincei: it
  // collects no usage data and has no hosted privacy policy. These are checked
  // here, not left to the display-name rewrite, so that an upstream rewording
  // fails `check` instead of quietly shipping T3 Code's notice under Lincei's name.
  "apps/web/src/legalLinks.ts": {
    exact: [['"https://t3.codes/privacy-policy"', '"https://github.com/hannesill/lincei#readme"']],
  },
  "apps/web/src/components/onboarding/WelcomeWizard.tsx": {
    exact: [
      [
        'T3 Code collects anonymous usage data to help us improve it. To read more about how your\n          data is used and how to opt out, see our{" "}',
        'Lincei collects no usage data. Agents send what they read, including query results, to the\n          model provider you choose. More in the{" "}',
      ],
      ["            privacy policy\n", "            README\n"],
      ['aria-label="T3 Code">', 'aria-label="Lincei">'],
      // The wizard's header in a researcher's words, with Lincei's own last
      // step, which apps/web/src/lincei/LinceiWelcomeWizard.tsx shows after
      // upstream's three. That file repeats the list.
      [
        'const ONBOARDING_STAGES = ["Connect", "Agents", "Projects"] as const;',
        'const ONBOARDING_STAGES = ["Computer", "Agent", "Import", "Data"] as const;',
      ],
      [
        "                Code\n              </span>",
        "                Lincei\n              </span>",
      ],
    ],
  },
  "apps/web/src/components/settings/SettingsPanels.tsx": {
    exact: [
      [
        'description="How we handle your data, including the anonymous usage data T3 Code collects."',
        'description="Lincei collects no usage data. Agents send what they read to your model provider."',
      ],
    ],
  },

  // Upstream tests that assert the values above. When an upstream merge brings
  // a test that fails only on an identity literal, add it with the tokens it pins.
  "apps/desktop/src/app/DesktopAppIdentity.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopCliShim.test.ts": { tokens: NAME },
  "apps/desktop/src/permissions/MacPermissionHelper.test.ts": { tokens: NAME },
  "apps/server/src/provider/ProviderRegistry.test.ts": {
    tokens: [
      ["Codex is disabled in T3 Code settings.", "Codex is disabled in Lincei settings."],
      [
        "Codex CLI is not authenticated. Run `codex login` and try again.",
        "Sign in with your ChatGPT account to use it.",
      ],
    ],
  },
  "apps/server/src/provider/providerStatusCache.test.ts": {
    tokens: [["Codex is disabled in T3 Code settings.", "Codex is disabled in Lincei settings."]],
  },
  "apps/desktop/src/app/DesktopClerk.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopEarlyElectronStartup.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopEnvironment.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopLinuxUrlHandler.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopPreReadyFileSystem.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopPreReadyPlatform.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/app/DesktopUserData.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/window/DesktopApplicationMenu.test.ts": { tokens: EVERY_TOKEN },
  "apps/desktop/src/window/DesktopWindow.test.ts": { tokens: SCHEME },
  "apps/server/src/cli/app.test.ts": { tokens: HOME },
  "apps/server/src/cloud/bootService.test.ts": { tokens: EVERY_TOKEN },
  "packages/shared/src/cliRelease.test.ts": { tokens: REPOSITORY },
  "packages/shared/src/codexAuthHandoff.test.ts": { tokens: SCHEME },
  "packages/shared/src/providerAuthReturnUrl.test.ts": { tokens: [...SCHEME, ...SLUG] },
  "packages/ssh/src/tunnel.test.ts": { tokens: REPOSITORY },
  "scripts/build-desktop-artifact.test.ts": {
    tokens: [...BUNDLE_ID, ...NAME],
    exact: [['schemes: ["t3code", "t3code-dev"]', 'schemes: ["lincei", "lincei-dev"]']],
  },
};

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

function rewrite(file: string, rules: Rules, text: string, problems: Array<string>): string {
  let next = text;
  for (const [from, to] of rules.tokens ?? []) next = next.replaceAll(from, to);
  for (const [from, to] of rules.exact ?? []) {
    if (next.includes(from)) next = next.replaceAll(from, to);
    else if (!next.includes(to)) {
      problems.push(`${file}: neither "${from}" nor its replacement is present; update the rule.`);
    }
  }
  return next;
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/** What the web build needs upstream's source to still say. */
function checkBuildTimeRules(problems: Array<string>): void {
  const read = (file: string): string | null => {
    const absolutePath = NodePath.join(repoRoot, file);
    return NodeFS.existsSync(absolutePath) ? NodeFS.readFileSync(absolutePath, "utf8") : null;
  };
  for (const rule of [...COPY_RULES, ...THEME_SOURCE_RULES]) {
    const text = read(rule.file);
    const found = text === null ? 0 : occurrences(text, rule.from);
    if (found === 1) continue;
    problems.push(
      `${rule.file}: expected ${JSON.stringify(rule.from)} once, found it ${found} times; ` +
        "upstream reworded or moved it, update the rule in apps/web/vite/linceiCopy.ts or linceiTheme.ts.",
    );
  }
  for (const control of HIDDEN_UNLESS_TECHIE) {
    for (const anchor of control.anchors) {
      const text = read(anchor.file);
      if (text !== null && text.includes(anchor.text)) continue;
      problems.push(
        `${anchor.file}: ${JSON.stringify(anchor.text)} is gone, so "${control.what}" is no longer ` +
          "hidden in researcher mode; update apps/web/vite/linceiResearcherMode.ts.",
      );
    }
  }
  checkThemeSelectors(read(THEME_STYLESHEET.file) ?? "", read, problems);
}

const collapse = (text: string): string => text.replace(/\s+/g, " ");

/**
 * The default look's selectors (theme.css) against their list in linceiTheme.ts: every anchor
 * is still in upstream's source, every listed selector is still in the stylesheet, and every
 * attribute or class the stylesheet selects on is listed.
 */
function checkThemeSelectors(
  stylesheet: string,
  read: (file: string) => string | null,
  problems: Array<string>,
): void {
  const css = collapse(stylesheet.replace(/\/\*[\s\S]*?\*\//g, ""));
  const listed = THEME_SELECTORS.map((entry) => ({ entry, selector: collapse(entry.selector) }));
  for (const { entry, selector } of listed) {
    if (!css.includes(selector)) {
      problems.push(
        `${THEME_STYLESHEET.file} no longer contains ${JSON.stringify(entry.selector)}; ` +
          `drop "${entry.what}" from THEME_SELECTORS in apps/web/vite/linceiTheme.ts.`,
      );
    }
    for (const anchor of entry.anchors) {
      const text = read(anchor.file);
      if (text !== null && text.includes(anchor.text)) continue;
      problems.push(
        `${anchor.file}: ${JSON.stringify(anchor.text)} is gone, so the selector for ` +
          `"${entry.what}" may no longer match; update theme.css and its entry in ` +
          "apps/web/vite/linceiTheme.ts, which says what a broken one does.",
      );
    }
  }
  // Attribute selectors and class names, outside comments; numbers such as `.5rem` start with a digit.
  const selectedOn = new Set(css.match(/\[[^\]]+\]|\.(?:[A-Za-z_-]|\\.)(?:[\w-]|\\.)*/g) ?? []);
  for (const part of selectedOn) {
    if (listed.some(({ selector }) => selector.includes(part))) continue;
    problems.push(
      `${THEME_STYLESHEET.file} selects on ${part}, which no entry of THEME_SELECTORS in ` +
        "apps/web/vite/linceiTheme.ts names; add it with the upstream text it depends on.",
    );
  }
}

function run(mode: "apply" | "check"): number {
  const problems: Array<string> = [];
  const stale: Array<string> = [];
  checkBuildTimeRules(problems);
  for (const [file, rules] of Object.entries(GOVERNED_FILES)) {
    const absolutePath = NodePath.join(repoRoot, file);
    if (!NodeFS.existsSync(absolutePath)) {
      problems.push(`${file}: missing; upstream moved or removed it, update the list.`);
      continue;
    }
    const current = NodeFS.readFileSync(absolutePath, "utf8");
    const next = rewrite(file, rules, current, problems);
    if (next === current) continue;
    stale.push(file);
    if (mode === "apply") NodeFS.writeFileSync(absolutePath, next);
  }
  for (const file of stale) {
    console.log(mode === "apply" ? `rebranded ${file}` : `stale     ${file}`);
  }
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) return 1;
  if (mode === "check" && stale.length > 0) {
    console.error("Run `node scripts/lincei/identity.ts apply`.");
    return 1;
  }
  return 0;
}

const mode = process.argv[2];
if (mode !== "apply" && mode !== "check") {
  console.error("Usage: node scripts/lincei/identity.ts <apply|check>");
  process.exit(2);
}
process.exit(run(mode));
