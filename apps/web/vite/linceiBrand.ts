import type { Plugin } from "vite-plus";

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

/**
 * Rebrands the web client's own source in dev and production builds. Tests
 * run against upstream's strings, so upstream's assertions pass unmodified.
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
      const next = rebrand(code);
      return next === null ? null : { code: next, map: null };
    },
    transformIndexHtml(html) {
      return enabled ? (rebrand(html) ?? html) : html;
    },
  };
}
