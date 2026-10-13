import type { Plugin } from "vite-plus";

import { COPY_RULES, type CopyRule } from "./linceiCopy.ts";
import { researcherModeHeadTags } from "./linceiResearcherMode.ts";
import { THEME_SOURCE_RULES, THEME_STYLESHEET } from "./linceiTheme.ts";

/**
 * Upstream display strings and what Lincei shows instead. Upstream writes its
 * product name into UI copy directly, so editing each string would conflict on
 * every merge; rewriting them as the web bundle is built keeps that copy
 * untouched in source.
 */
const BRAND_REPLACEMENTS = [
  ["T3 Code", "Lincei"],
  ["https://github.com/pingdotgg/t3code/releases", "https://github.com/hannesill/lincei/releases"],
] as const;

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)(?:\?|$)/;

/** Returns the rebranded text, or null when nothing in it names upstream. */
function rebrand(text: string): string | null {
  let next = text;
  for (const [upstream, lincei] of BRAND_REPLACEMENTS) {
    next = next.replaceAll(upstream, lincei);
  }
  return next === text ? null : next;
}

/** Exact upstream text and what the build puts in its place: wording, and the default look's colours. */
const SOURCE_RULES: ReadonlyArray<CopyRule> = [...COPY_RULES, ...THEME_SOURCE_RULES];
const INDEX_HTML = "apps/web/index.html";

/** The rules for one module, by the repository path its id ends with. */
function sourceRulesFor(id: string): ReadonlyArray<CopyRule> {
  const path = id.split("?")[0] ?? id;
  return SOURCE_RULES.filter((rule) => path.endsWith(`/${rule.file}`));
}

const reworded = (rule: CopyRule) =>
  `${rule.file} no longer contains ${JSON.stringify(rule.from)}. ` +
  "Upstream reworded or moved it; update the rule in apps/web/vite/linceiCopy.ts or linceiTheme.ts.";

/**
 * Builds Lincei's web client out of upstream's source, in dev and production:
 *
 * - names Lincei wherever upstream names itself;
 * - replaces the developer copy listed in linceiCopy.ts with a researcher's
 *   words, and fails the build when upstream has reworded one of those
 *   strings, so the old text cannot ship unnoticed;
 * - gives the app Lincei's default look: theme.css joins upstream's
 *   stylesheet as its last rules, and the stock colours upstream repeats
 *   outside CSS are replaced the same way as copy (linceiTheme.ts);
 * - adds the stylesheet and boot script of researcher mode to the page
 *   (linceiResearcherMode.ts).
 *
 * Tests run against upstream's strings, so upstream's assertions pass
 * unmodified.
 */
export function linceiBrandPlugin(): Plugin {
  let enabled = true;
  return {
    name: "lincei:brand",
    enforce: "pre",
    configResolved(config) {
      enabled = config.mode !== "test";
    },
    transform(code, id) {
      if (!enabled || id.includes("/node_modules/")) return null;
      if ((id.split("?")[0] ?? id).endsWith(`/${THEME_STYLESHEET.host}`)) {
        // Tailwind compiles this source next and resolves the import, so
        // theme.css is compiled with upstream's stylesheet, comes last at the
        // same specificity, and is watched in dev. A tag in index.html would
        // come before the app's stylesheet and lose every tie.
        return { code: `${code}\n@import "${THEME_STYLESHEET.specifier}";\n`, map: null };
      }
      if (!SOURCE_FILE.test(id)) return null;
      let next = code;
      for (const rule of sourceRulesFor(id)) {
        if (!next.includes(rule.from)) this.error(reworded(rule));
        next = next.replace(rule.from, rule.to);
      }
      next = rebrand(next) ?? next;
      return next === code ? null : { code: next, map: null };
    },
    transformIndexHtml: {
      // Before Vite touches the page, so the rules see upstream's source text.
      order: "pre",
      handler(html) {
        if (!enabled) return html;
        let next = html;
        for (const rule of SOURCE_RULES.filter((rule) => rule.file === INDEX_HTML)) {
          if (!next.includes(rule.from)) throw new Error(reworded(rule));
          next = next.replace(rule.from, rule.to);
        }
        return { html: rebrand(next) ?? next, tags: researcherModeHeadTags() };
      },
    },
  };
}
