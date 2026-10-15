// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone maintenance script: renders a few files, no Effect runtime.
/**
 * Lincei's app icons and favicons, drawn here and written to upstream's icon paths.
 *
 * Upstream draws its icons in Icon Composer (`assets/<variant>/app-icon.icon`) and exports them
 * with `vp run icons:export`, which would write T3 Code's icons back: do not run it. Lincei's
 * icons are plain geometry instead, rendered with sharp to the files upstream's builds already
 * read (`BRAND_ASSET_PATHS`), so no build script changes:
 *
 *   node scripts/lincei/icons.ts
 *
 * The mark is a square card with an ink outline and a hard shadow, holding a serif L: the card
 * style of Vitrine's research boards, in black and white. `FRAME_PATH` and `SERIF_L` are also
 * drawn in `apps/web/src/components/T3Wordmark.tsx` and in
 * `apps/desktop/resources/dmg/dmg-background-latest.svg`; change them together.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "../lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "../lib/icon-export.ts";

/**
 * The mark on a 16-unit grid: the card (0–14) with a one-unit outline and a two-unit hard shadow,
 * the proportions of Vitrine's buttons. Each path is filled even-odd.
 */
const FRAME_PATH = "M0 0h14v14H0Zm1 1v12h12V1ZM14 2h2v14H2v-2h12Z";
/** The inside of the card, filled so the mark reads on any background. */
const CARD_FACE = "M1 1h12v12H1Z";
/** The serif L, drawn smooth for sizes where its curve shows. */
const SERIF_L =
  "M3.58 3v1.024h1.088v5.952H3.58V11h7.04V8.024h-.832q-.192 1.728-1.024 1.92H6.588V4.024h1.088V3Z";
/** The same L on whole pixels, for 32 pixels and below, where a curve only blurs. */
const PIXEL_L = "M4 3h4v1H7v6h3V8h1v3H4v-1h1V4H4Z";
const MARK_UNITS = 16;

interface Palette {
  readonly ink: string;
  readonly paper: string;
}
/** Installed builds: ink on white. */
const RELEASE: Palette = { ink: "#1a1a1a", paper: "#ffffff" };
/** Development builds: the same mark inverted, so a dev build is told apart in the Dock. */
const DEVELOPMENT: Palette = { ink: "#ffffff", paper: "#1a1a1a" };

/** The mark scaled to `size` units and placed with its top-left corner at `x`, `y`. */
function mark(palette: Palette, x: number, y: number, size: number): string {
  const transform = `translate(${x} ${y}) scale(${size / MARK_UNITS})`;
  const letter = size <= 2 * MARK_UNITS ? PIXEL_L : SERIF_L;
  return (
    `<g transform="${transform}">` +
    `<path d="${CARD_FACE}" fill="${palette.paper}"/>` +
    `<path d="${FRAME_PATH}" fill="${palette.ink}" fill-rule="evenodd"/>` +
    `<path d="${letter}" fill="${palette.ink}"/>` +
    `</g>`
  );
}

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

/**
 * A tile with the mark on it, `markShare` of the tile wide. The tile's centre falls halfway
 * between the card's centre and the centre of card and shadow together, which looks balanced.
 */
function onTile(palette: Palette, x: number, size: number, markShare: number): string {
  const markSize = size * markShare;
  const offset = x + size / 2 - (markSize * 7.5) / MARK_UNITS;
  return mark(palette, offset, offset, markSize);
}

/**
 * macOS: Apple's pre-Tahoe grid, an 824-point rounded square inset 100 points with the system's
 * soft shadow, so the icon sits at the same size as its neighbours in the Dock.
 */
function macosIcon(palette: Palette): string {
  return svg(
    1024,
    `<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/>` +
      `</filter></defs>` +
      `<rect x="100" y="100" width="824" height="824" rx="185" fill="${palette.paper}" filter="url(#shadow)"/>` +
      onTile(palette, 100, 824, 0.6),
  );
}

/** Home-screen icon: opaque, square, the platform rounds it. Also the web app's splash image. */
const touchIcon = (palette: Palette) =>
  svg(
    180,
    `<rect width="180" height="180" fill="${palette.paper}"/>` + onTile(palette, 0, 180, 0.62),
  );

/** Favicons and Windows: the card alone on a transparent canvas, as large as it fits. */
const bareMark = (palette: Palette, size: number) => svg(size, mark(palette, 0, 0, size));

// Drawn at the output size, so edges on whole pixels stay sharp.
const render = (source: string) =>
  sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toBuffer();

async function variantFiles(
  palette: Palette,
  paths: {
    readonly macos: string;
    readonly universal: string;
    readonly windowsIco: string;
    readonly faviconIco: string;
    readonly favicon16: string;
    readonly favicon32: string;
    readonly touchIcon: string;
  },
): Promise<ReadonlyArray<readonly [string, Buffer]>> {
  const macos = await render(macosIcon(palette));
  const ico = encodePngIco(
    await Promise.all(
      WINDOWS_ICON_SIZES.map(async (size) => ({
        size,
        contents: await render(bareMark(palette, size)),
      })),
    ),
  );
  return [
    [paths.macos, macos],
    [paths.universal, macos],
    [paths.windowsIco, ico],
    [paths.faviconIco, ico],
    [paths.favicon16, await render(bareMark(palette, 16))],
    [paths.favicon32, await render(bareMark(palette, 32))],
    [paths.touchIcon, await render(touchIcon(palette))],
  ];
}

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// The iOS exports (`*-ios-1024.png`) and the Android artwork stay upstream's: Lincei ships no
// mobile app.
const files = new Map<string, Buffer>([
  ...(await variantFiles(RELEASE, {
    macos: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    touchIcon: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  })),
  ...(await variantFiles(RELEASE, {
    macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    touchIcon: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  })),
  ...(await variantFiles(DEVELOPMENT, {
    macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    touchIcon: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  })),
]);
// The web app's own public folder holds copies of the development favicons, as upstream's export does.
for (const { sourceRelativePath, targetRelativePath } of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
  const contents = files.get(sourceRelativePath);
  if (contents === undefined) throw new Error(`No icon was drawn for ${sourceRelativePath}.`);
  files.set(targetRelativePath, contents);
}

let changed = 0;
for (const [file, contents] of files) {
  const absolutePath = NodePath.join(repoRoot, file);
  const current = NodeFS.existsSync(absolutePath) ? NodeFS.readFileSync(absolutePath) : undefined;
  if (current?.equals(contents)) continue;
  NodeFS.writeFileSync(absolutePath, contents);
  changed += 1;
}
console.log(`${changed} of ${files.size} icon files updated.`);
