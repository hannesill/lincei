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
 * @module ClinicalSkillLinks
 */
import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

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
  const home = environment.HOME || environment.USERPROFILE || NodeOS.homedir();
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
  // Links are compared by resolved path, and macOS reaches a home through a symlink.
  const bundle = yield* fileSystem
    .realPath(input.bundle)
    .pipe(Effect.orElseSucceed(() => input.bundle));
  const skills = yield* bundledSkills(bundle);
  const shadowed = new Set<string>();
  if (skills.size === 0) return { shadowed: [] };
  const seen = new Set<string>();

  /** Where a symlink in a skills folder points, when it points into the bundle. */
  const ownedTarget = (link: string) =>
    fileSystem.readLink(link).pipe(
      Effect.map((target) => path.resolve(path.dirname(link), target)),
      Effect.map((target) => (target.startsWith(bundle + path.sep) ? target : undefined)),
      Effect.orElseSucceed(() => undefined),
    );

  for (const requested of input.directories) {
    yield* fileSystem.makeDirectory(requested, { recursive: true });
    // `~/.claude/skills` is often itself a link to `~/.agents/skills`.
    const directory = yield* fileSystem.realPath(requested);
    if (seen.has(directory)) continue;
    seen.add(directory);

    for (const entry of yield* fileSystem.readDirectory(directory)) {
      const link = path.join(directory, entry);
      const target = yield* ownedTarget(link);
      if (target !== undefined && skills.get(entry) !== target) yield* fileSystem.remove(link);
    }
    for (const [name, source] of skills) {
      const link = path.join(directory, name);
      if ((yield* ownedTarget(link)) === source) continue;
      // Anything else by that name is the user's, including a link that leads nowhere.
      yield* fileSystem
        .symlink(source, link)
        .pipe(Effect.orElseSucceed(() => void shadowed.add(name)));
    }
  }
  return { shadowed: [...shadowed].sort() };
});
