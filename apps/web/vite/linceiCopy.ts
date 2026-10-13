/**
 * Upstream copy that speaks to developers, and what a researcher reads
 * instead. Applied to upstream's source as the web bundle is built
 * (linceiBrand.ts), so the source stays upstream's.
 *
 * `from` is exact source text and must occur exactly once in `file`:
 * `node scripts/lincei/identity.ts check` fails otherwise, and so does the
 * build. When upstream rewords a string, update `from` here.
 */
export interface CopyRule {
  /** Repository path of the upstream file. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export const COPY_RULES: ReadonlyArray<CopyRule> = [];
