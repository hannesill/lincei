// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone maintenance script: drives git synchronously, no Effect runtime.
/**
 * Merges upstream T3 Code into Lincei and resolves the conflicts that follow
 * from Lincei's identity, leaving only the ones that need judgment.
 *
 *   node scripts/lincei/merge-upstream.ts [--ref t3code/main] [--no-fetch]
 *
 * Run it on a clean branch. It never commits. Run it again during a merge to
 * resolve what is left after a manual step (it then skips fetching and
 * merging). docs/lincei/README.md, "Pulling in upstream", says what to do with
 * what it reports.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { GOVERNED_FILES, rewrite } from "./identity.ts";

/** Files that are Lincei's own content under upstream's name. */
export const LINCEI_CONTENT = new Set([
  "README.md",
  "apps/web/src/components/T3Wordmark.tsx",
  "apps/desktop/resources/dmg/dmg-background-latest.svg",
]);
/** Drawn by scripts/lincei/icons.ts into upstream's icon files. */
const ICON_FILE = /^(?:assets\/|apps\/web\/public\/).*\.(?:png|ico|icns|svg)$/;
const ROUTE_TREE = "apps/web/src/routeTree.gen.ts";

const PROTOCOL_FILE = "packages/contracts/src/environment.ts";

/**
 * The orchestration protocol version a contracts source declares. Upstream's
 * mobile app connects only to a server with exactly its own version.
 */
export function orchestrationProtocolVersion(source: string | null): number | null {
  const match = source?.match(/ORCHESTRATION_PROTOCOL_VERSION = (\d+);/);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Upstream spellings of identity. The `.t3` forms are T3 Code's home directory. */
export const IDENTITY_LITERAL =
  /t3code:\/\/|t3code-dev|"t3code"|t3code\.service|com\.t3tools|pingdotgg\/t3code|T3 Code \(|T3SnapShot|snap-shot@t3\.codes|\.t3\/|"\.t3"/;

export type ConflictKind = "governed" | "lincei-content" | "icon" | "route-tree" | "other";

export function classifyConflict(file: string): ConflictKind {
  if (file in GOVERNED_FILES) return "governed";
  if (LINCEI_CONTENT.has(file)) return "lincei-content";
  if (ICON_FILE.test(file)) return "icon";
  if (file === ROUTE_TREE) return "route-tree";
  return "other";
}

/**
 * Resolves the conflict hunks of a file written with diff3 markers where both
 * sides only added lines at the same place (the common ancestor's part is
 * empty), as when both append to the same list: upstream's lines, then
 * Lincei's. Hunks where either side changed existing lines stay as they are.
 */
export function joinAddedLines(text: string): {
  readonly text: string;
  readonly unresolved: number;
} {
  const hunk = /^<{7} [^\n]*\n([\s\S]*?)^\|{7} [^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} [^\n]*\n/gm;
  let unresolved = 0;
  const next = text.replace(hunk, (whole, ours: string, base: string, theirs: string) => {
    if (base !== "") {
      unresolved += 1;
      return whole;
    }
    return theirs + ours;
  });
  return { text: next, unresolved };
}

/** Identity literals on added lines of a unified diff, by file, outside the governed files. */
export function addedIdentityLiterals(
  diff: string,
): ReadonlyArray<{ readonly file: string; readonly line: string }> {
  const found: Array<{ file: string; line: string }> = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : "";
      continue;
    }
    if (!file || file in GOVERNED_FILES || !line.startsWith("+")) continue;
    if (IDENTITY_LITERAL.test(line)) found.push({ file, line: line.slice(1).trim() });
  }
  return found;
}

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

function git(args: ReadonlyArray<string>, options: { readonly allowFailure?: boolean } = {}) {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

const lines = (text: string) => text.split("\n").filter((line) => line !== "");
const show = (revision: string, file: string): string | null => {
  const result = git(["show", `${revision}:${file}`], { allowFailure: true });
  return result.ok ? result.stdout : null;
};

/**
 * Whether Lincei's version of a governed file is exactly what the identity
 * rules make of upstream's. Anything else is an edit by hand, which taking
 * upstream's side would drop.
 */
function governedFileIsRuleOnly(file: string, base: string): boolean {
  const upstream = show(base, file);
  const lincei = show("HEAD", file);
  if (upstream === null || lincei === null) return upstream === lincei;
  const problems: Array<string> = [];
  const rules = GOVERNED_FILES[file];
  return rules !== undefined && rewrite(file, rules, upstream, problems) === lincei;
}

function runNode(script: string, args: ReadonlyArray<string>) {
  const result = NodeChildProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

function main(argv: ReadonlyArray<string>): number {
  const refIndex = argv.indexOf("--ref");
  const ref = refIndex >= 0 ? argv[refIndex + 1] : "t3code/main";
  if (!ref) {
    console.error("Usage: node scripts/lincei/merge-upstream.ts [--ref <ref>] [--no-fetch]");
    return 2;
  }

  const merging = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allowFailure: true }).ok;
  if (!merging) {
    if (lines(git(["status", "--porcelain", "--untracked-files=no"]).stdout).length > 0) {
      console.error("The working tree has changes. Commit or set them aside first.");
      return 1;
    }
    if (!argv.includes("--no-fetch")) {
      const [remote, ...branch] = ref.split("/");
      if (remote && branch.length > 0) git(["fetch", remote, branch.join("/")]);
    }
    const merge = git(["merge", "--no-commit", "--no-ff", ref], { allowFailure: true });
    if (!git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allowFailure: true }).ok) {
      console.log(merge.ok ? "Already up to date." : merge.stderr.trim());
      return merge.ok ? 0 : 1;
    }
  }
  const base = git(["merge-base", "HEAD", "MERGE_HEAD"]).stdout.trim();
  const upstream = git(["rev-parse", "--short", "MERGE_HEAD"]).stdout.trim();
  const baseDate = git(["log", "-1", "--format=%cs", base]).stdout.trim();
  console.log(
    `Merging upstream ${upstream}; the last merged upstream commit is ${base.slice(0, 10)} (${baseDate}).`,
  );
  console.log("If a later upstream merge landed as a squash, stop: see docs/lincei/README.md.\n");

  const handEdited = Object.keys(GOVERNED_FILES).filter(
    (file) => !governedFileIsRuleOnly(file, base),
  );
  const resolved: Array<string> = [];
  const joined: Array<string> = [];
  const left: Array<{ file: string; why: string }> = [];
  let redrawIcons = false;
  let rebuildRoutes = false;

  for (const file of lines(git(["diff", "--name-only", "--diff-filter=U"]).stdout)) {
    const kind = classifyConflict(file);
    const deletedUpstream = show("MERGE_HEAD", file) === null;
    if (kind === "lincei-content") {
      git(["checkout", "--ours", "--", file]);
    } else if (deletedUpstream) {
      left.push({ file, why: "upstream deleted or moved it" });
      continue;
    } else if (kind === "governed" && handEdited.includes(file)) {
      left.push({
        file,
        why: "governed, but not what the identity rules make of upstream's version (a hand edit, or a rule changed since the last merge)",
      });
      continue;
    } else if (kind === "governed" || kind === "icon" || kind === "route-tree") {
      git(["checkout", "--theirs", "--", file]);
      redrawIcons ||= kind === "icon";
      rebuildRoutes ||= kind === "route-tree";
    } else {
      git(["checkout", "--conflict=diff3", "--", file]);
      const absolutePath = NodePath.join(repoRoot, file);
      const result = joinAddedLines(NodeFS.readFileSync(absolutePath, "utf8"));
      if (result.unresolved > 0) {
        git(["checkout", "--conflict=merge", "--", file]);
        left.push({ file, why: "both sides changed the same lines" });
        continue;
      }
      NodeFS.writeFileSync(absolutePath, result.text);
      joined.push(file);
    }
    git(["add", "--", file]);
    resolved.push(file);
  }

  const apply = runNode("scripts/lincei/identity.ts", ["apply"]);
  const governedChanged = Object.keys(GOVERNED_FILES).filter(
    (file) => NodeFS.existsSync(NodePath.join(repoRoot, file)) && !handEdited.includes(file),
  );
  if (governedChanged.length > 0) git(["add", "--", ...governedChanged]);
  if (redrawIcons) {
    const icons = runNode("scripts/lincei/icons.ts", []);
    if (!icons.ok) console.log(`icons.ts failed:\n${icons.output}\n`);
    git(["add", "--", "assets", "apps/web/public"]);
  }

  console.log(`Resolved ${resolved.length} conflicts.`);
  for (const file of joined) {
    console.log(`  kept both sides' added lines in ${file}; check the order`);
  }
  if (handEdited.length > 0) {
    console.log("\nGoverned files that differ from what the identity rules make of upstream's:");
    for (const file of handEdited) console.log(`  ${file}`);
  }
  if (left.length > 0) {
    console.log("\nLeft for you (Lincei's lines in a file: git diff <old base> HEAD -- <file>):");
    for (const { file, why } of left) console.log(`  ${file}: ${why}`);
    console.log(`  old base: ${base}`);
  }
  if (!apply.ok) console.log(`\nidentity.ts apply:\n${apply.output}`);

  const literals = addedIdentityLiterals(
    git([
      "diff",
      base,
      "MERGE_HEAD",
      "--",
      "apps",
      "packages",
      "scripts",
      ":!apps/mobile",
      ":!apps/marketing",
      ":!*.md",
    ]).stdout,
  );
  const sourceLiterals = literals.filter(({ file }) => !/\.test\.tsx?$/.test(file));
  if (sourceLiterals.length > 0) {
    console.log("\nIdentity literals upstream added outside the governed files (tests left out):");
    for (const { file, line } of sourceLiterals) console.log(`  ${file}: ${line.slice(0, 140)}`);
  }

  const protocolBefore = orchestrationProtocolVersion(show(base, PROTOCOL_FILE));
  const protocolAfter = orchestrationProtocolVersion(show("MERGE_HEAD", PROTOCOL_FILE));
  if (protocolBefore !== protocolAfter) {
    console.log(
      [
        "",
        `!! The orchestration protocol changes from ${protocolBefore} to ${protocolAfter}.`,
        "!! T3 Code's mobile app connects only to servers with its own version. Release Lincei once",
        "!! T3 Code's app update with this version is out: before, today's app stops connecting;",
        "!! long after, the updated app cannot connect. See docs/lincei/README.md.",
      ].join("\n"),
    );
  }

  const check = runNode("scripts/lincei/identity.ts", ["check"]);
  console.log(check.ok ? "\nidentity.ts check passes." : `\nidentity.ts check:\n${check.output}`);
  if (rebuildRoutes) {
    console.log(
      "Build the web app once (vp run --filter @t3tools/web build) to regenerate the route tree.",
    );
  }
  console.log("Then run the finish checklist in docs/lincei/README.md and commit the merge.");
  return left.length === 0 && apply.ok && check.ok ? 0 : 1;
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
