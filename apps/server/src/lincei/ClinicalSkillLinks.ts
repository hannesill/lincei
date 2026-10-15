/**
 * ClinicalSkillLinks - M4's skills, where agents look for skills.
 *
 * T3 Code's skill picker lists what each provider finds on disk, and Claude
 * and Codex load their user skills from `~/.claude/skills` and
 * `~/.agents/skills`. Lincei keeps M4's skills in its own home, so it links
 * each one into those folders: the picker then offers them by name, and the
 * agent loads one when its description matches the task.
 *
 * The folders belong to the user. A skill of theirs with the same name is left
 * alone and wins. Lincei's links are recognised by pointing into its own
 * bundle, which is how stale ones are removed and how a user can tell them
 * apart. `LINCEI_CLINICAL_SKILL_DIRS` replaces the folders; empty keeps Lincei
 * out of them altogether.
 *
 * On Windows the links are directory junctions: a symlink there needs
 * Developer Mode or an administrator, a junction needs neither, and both
 * providers follow it like a symlink. Windows compares paths without case.
 *
 * @module ClinicalSkillLinks
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off -- FileSystem.symlink takes no link type, and Windows needs a junction.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { parse as parseYaml } from "yaml";

/** The user-scope skill folders of the providers that load skills by name. */
export const defaultSkillDirectories = (input: {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
}): ReadonlyArray<string> => {
  const { path, environment } = input;
  const override = environment.LINCEI_CLINICAL_SKILL_DIRS;
  if (override !== undefined) {
    return override
      .split(input.platform === "win32" ? ";" : ":")
      .filter((entry) => entry.trim().length > 0);
  }
  // The home Claude and Codex resolve: on Windows the user profile, even
  // where something has set HOME (Git for Windows, some managed PCs).
  const home =
    (input.platform === "win32" ? environment.USERPROFILE : environment.HOME) || NodeOS.homedir();
  const claudeConfigDir = environment.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
  return [path.join(claudeConfigDir, "skills"), path.join(home, ".agents", "skills")];
};

/** The skills in M4's materialized bundle, laid out as `<category>/<name>/SKILL.md`. */
const bundledSkills = Effect.fn("ClinicalSkillLinks.bundledSkills")(function* (bundle: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skills = new Map<string, string>();
  const categories = yield* fileSystem
    .readDirectory(bundle)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  for (const category of [...categories].sort()) {
    const names = yield* fileSystem
      .readDirectory(path.join(bundle, category))
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const name of [...names].sort()) {
      const directory = path.join(bundle, category, name);
      const isSkill = yield* fileSystem
        .exists(path.join(directory, "SKILL.md"))
        .pipe(Effect.orElseSucceed(() => false));
      if (isSkill && !skills.has(name)) skills.set(name, directory);
    }
  }
  return skills;
});

/**
 * A path as this platform compares it. Windows ignores case, and reads a
 * symlink's target back with the `\\?\` prefix Node wrote it with.
 */
const comparable = (platform: NodeJS.Platform, target: string) =>
  platform === "win32" ? target.replace(/^\\\\\?\\/, "").toLowerCase() : target;

/**
 * Where a link in a skills folder points, in `comparable` form, when it points
 * into `bundle` (a resolved path).
 */
const ownedTarget = (link: string, bundle: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcessPlatform;
    const inBundle = comparable(platform, bundle + path.sep);
    return yield* fileSystem.readLink(link).pipe(
      Effect.map((target) => comparable(platform, path.resolve(path.dirname(link), target))),
      Effect.map((target) => (target.startsWith(inBundle) ? target : undefined)),
      Effect.orElseSucceed(() => undefined),
    );
  });

/** Whether anything is at `link`, including a link that leads nowhere. */
const occupied = (link: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (yield* fileSystem.exists(link).pipe(Effect.orElseSucceed(() => false))) return true;
    return Option.isSome(yield* Effect.option(fileSystem.readLink(link)));
  });

/** Links `link` to the skill folder `source`: a junction on Windows, a symlink elsewhere. */
const linkSkill = (source: string, link: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if ((yield* HostProcessPlatform) !== "win32") return yield* fileSystem.symlink(source, link);
    return yield* Effect.tryPromise(() => NodeFSP.symlink(source, link, "junction"));
  });

/** Resolved, because links are compared by resolved path and macOS reaches a home through a symlink. */
const resolvedBundle = (bundle: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    fileSystem.realPath(bundle).pipe(Effect.orElseSucceed(() => bundle)),
  );

/**
 * Links every skill of the bundle at `bundle` into each of `directories`, and
 * removes links into the bundle for skills it no longer has. Returns the names
 * left out because the user has their own skill of that name. Does nothing
 * without a bundle, so a failed setup never empties the folders.
 */
export const sync = Effect.fn("ClinicalSkillLinks.sync")(function* (input: {
  readonly bundle: string;
  readonly directories: ReadonlyArray<string>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const bundle = yield* resolvedBundle(input.bundle);
  const skills = yield* bundledSkills(bundle);
  const shadowed = new Set<string>();
  if (skills.size === 0) return { shadowed: [] };
  const seen = new Set<string>();
  const sourceOf = (name: string) => {
    const source = skills.get(name);
    return source === undefined ? undefined : comparable(platform, source);
  };

  for (const requested of input.directories) {
    yield* fileSystem.makeDirectory(requested, { recursive: true });
    // `~/.claude/skills` is often itself a link to `~/.agents/skills`.
    const directory = yield* fileSystem.realPath(requested);
    if (seen.has(directory)) continue;
    seen.add(directory);

    for (const entry of yield* fileSystem.readDirectory(directory)) {
      const link = path.join(directory, entry);
      const target = yield* ownedTarget(link, bundle);
      if (target !== undefined && sourceOf(entry) !== target) yield* fileSystem.remove(link);
    }
    for (const [name, source] of skills) {
      const link = path.join(directory, name);
      if ((yield* ownedTarget(link, bundle)) === sourceOf(name)) continue;
      yield* linkSkill(source, link).pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            // Anything else by that name is the user's, including a link that leads nowhere.
            if (yield* occupied(link)) return void shadowed.add(name);
            return yield* cause;
          }),
        ),
      );
    }
  }
  return { shadowed: [...shadowed].sort() };
});

/** One skill of the bundle, as Settings shows what agents get. */
export interface BundledSkill {
  readonly name: string;
  /** M4's grouping: the bundle's folder it sits in, such as `clinical` or `system`. */
  readonly category: string;
  /** The `description` of its frontmatter, which is what an agent matches a task against. */
  readonly description: string;
  /**
   * Whether a skills folder holds something else by this name. Agents that
   * load skills from that folder get the user's skill instead of this one.
   */
  readonly shadowed: boolean;
}

/** The frontmatter's `description`, or nothing when the file has none that reads. */
const frontmatterDescription = (contents: string): string => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents)?.[1];
  if (frontmatter === undefined) return "";
  try {
    const parsed: unknown = parseYaml(frontmatter);
    if (typeof parsed !== "object" || parsed === null || !("description" in parsed)) return "";
    return typeof parsed.description === "string" ? parsed.description.trim() : "";
  } catch {
    return "";
  }
};

/**
 * The bundle's skills with their descriptions, and whether something of the
 * user's takes each one's place in `directories`. Reads only; an absent
 * bundle has no skills.
 */
export const describe = Effect.fn("ClinicalSkillLinks.describe")(function* (input: {
  readonly bundle: string;
  readonly directories: ReadonlyArray<string>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const bundle = yield* resolvedBundle(input.bundle);
  const skills = yield* bundledSkills(bundle);
  const described: Array<BundledSkill> = [];
  for (const [name, source] of skills) {
    let shadowed = false;
    for (const directory of input.directories) {
      const link = path.join(directory, name);
      if (
        (yield* occupied(link)) &&
        (yield* ownedTarget(link, bundle)) !== comparable(platform, source)
      ) {
        shadowed = true;
      }
    }
    const contents = yield* fileSystem
      .readFileString(path.join(source, "SKILL.md"))
      .pipe(Effect.orElseSucceed(() => ""));
    described.push({
      name,
      category: path.basename(path.dirname(source)),
      description: frontmatterDescription(contents),
      shadowed,
    });
  }
  return described;
});

/** The `SKILL.md` of the bundle's skill called `name`, if the bundle has one by that name. */
export const readSkill = Effect.fn("ClinicalSkillLinks.readSkill")(function* (input: {
  readonly bundle: string;
  readonly name: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Looked up among the bundle's own skills, so a name can never lead outside it.
  const source = (yield* bundledSkills(yield* resolvedBundle(input.bundle))).get(input.name);
  if (source === undefined) return Option.none<string>();
  return yield* fileSystem.readFileString(path.join(source, "SKILL.md")).pipe(Effect.option);
});
