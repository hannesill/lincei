import type { Plugin } from "vite-plus";

import { COPY_RULES, type CopyRule } from "./linceiCopy.ts";
import { researcherModeHeadTags } from "./linceiResearcherMode.ts";

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

/** The copy rules for one module, by the repository path its id ends with. */
function copyRulesFor(id: string): ReadonlyArray<CopyRule> {
  const path = id.split("?")[0] ?? id;
  return COPY_RULES.filter((rule) => path.endsWith(`/${rule.file}`));
}

/**
 * Builds Lincei's web client out of upstream's source, in dev and production:
 *
 * - names Lincei wherever upstream names itself;
 * - replaces the developer copy listed in linceiCopy.ts with a researcher's
 *   words, and fails the build when upstream has reworded one of those
 *   strings, so the old text cannot ship unnoticed;
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
      if (!enabled || id.includes("/node_modules/") || !SOURCE_FILE.test(id)) return null;
      let next = code;
      for (const rule of copyRulesFor(id)) {
        if (!next.includes(rule.from)) {
          this.error(
            `${rule.file} no longer contains ${JSON.stringify(rule.from)}. ` +
              "Upstream reworded or moved it; update apps/web/vite/linceiCopy.ts.",
          );
        }
        next = next.replace(rule.from, rule.to);
      }
      next = rebrand(next) ?? next;
      return next === code ? null : { code: next, map: null };
    },
    transformIndexHtml(html) {
      if (!enabled) return html;
      return { html: rebrand(html) ?? html, tags: researcherModeHeadTags() };
    },
  };
}
