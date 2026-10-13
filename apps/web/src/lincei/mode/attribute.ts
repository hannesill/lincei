/**
 * How the page knows Techie mode is on. The attribute is set on `<html>`
 * before first paint from the cached value (see the boot script the build
 * injects, apps/web/vite/linceiResearcherMode.ts) and kept in step with the
 * server's stored mode afterwards. Absent means researcher mode, so a page
 * that failed to boot is the calm one.
 */
export const TECHIE_ATTRIBUTE = "data-lincei-techie";
export const TECHIE_ATTRIBUTE_ON = "true";
export const TECHIE_STORAGE_KEY = "lincei:techie-mode";
