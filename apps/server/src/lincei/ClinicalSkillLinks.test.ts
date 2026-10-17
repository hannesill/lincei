import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ClinicalSkillLinks from "./ClinicalSkillLinks.ts";

/** A bundle laid out as M4 materializes it, and an empty home for agent folders. */
const withBundle = <A, E>(
  skills: ReadonlyArray<string>,
  use: (context: {
    readonly bundle: string;
    readonly home: string;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-skill-links-" });
    const bundle = path.join(root, "lincei", "skills");
    yield* fileSystem.makeDirectory(bundle, { recursive: true });
    yield* fileSystem.writeFileString(path.join(bundle, ".m4-skills-manifest.json"), "{}");
    for (const skill of skills) {
      yield* fileSystem.makeDirectory(path.join(bundle, skill), { recursive: true });
      yield* fileSystem.writeFileString(path.join(bundle, skill, "SKILL.md"), `# ${skill}`);
    }
    return yield* use({ bundle, home: path.join(root, "home"), fileSystem, path });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("ClinicalSkillLinks", () => {
  it.effect("links each skill by its name, whatever its category", () =>
    withBundle(["clinical/sofa-score", "system/m4-api"], ({ bundle, home, fileSystem, path }) =>
      Effect.gen(function* () {
        const directory = path.join(home, ".claude", "skills");
        const result = yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });

        expect(result.shadowed).toEqual([]);
        expect((yield* fileSystem.readDirectory(directory)).toSorted()).toEqual([
          "m4-api",
          "sofa-score",
        ]);
        expect(
          yield* fileSystem.readFileString(path.join(directory, "sofa-score", "SKILL.md")),
        ).toBe("# clinical/sofa-score");
      }),
    ),
  );

  it.effect("leaves a skill of the user's alone and reports it", () =>
    withBundle(["clinical/sofa-score", "system/m4-api"], ({ bundle, home, fileSystem, path }) =>
      Effect.gen(function* () {
        const directory = path.join(home, ".claude", "skills");
        const own = path.join(directory, "sofa-score", "SKILL.md");
        yield* fileSystem.makeDirectory(path.dirname(own), { recursive: true });
        yield* fileSystem.writeFileString(own, "# mine");

        const result = yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });

        expect(result.shadowed).toEqual(["sofa-score"]);
        expect(yield* fileSystem.readFileString(own)).toBe("# mine");
        expect(yield* fileSystem.exists(path.join(directory, "m4-api", "SKILL.md"))).toBe(true);
      }),
    ),
  );

  it.effect.skipIf(!symlinksSupported)(
    "removes its links to skills the bundle dropped, and nothing else",
    () =>
      withBundle(
        ["clinical/sofa-score", "clinical/old-score"],
        ({ bundle, home, fileSystem, path }) =>
          Effect.gen(function* () {
            const directory = path.join(home, ".agents", "skills");
            yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });
            yield* fileSystem.makeDirectory(path.join(directory, "my-skill"));
            const elsewhere = path.join(home, "elsewhere");
            yield* fileSystem.makeDirectory(elsewhere);
            yield* fileSystem.symlink(elsewhere, path.join(directory, "linked-by-user"));

            yield* fileSystem.remove(path.join(bundle, "clinical", "old-score"), {
              recursive: true,
            });
            yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });

            expect((yield* fileSystem.readDirectory(directory)).toSorted()).toEqual([
              "linked-by-user",
              "my-skill",
              "sofa-score",
            ]);
          }),
      ),
  );

  it.effect.skipIf(!symlinksSupported)(
    "treats a folder that links to another as the same folder",
    () =>
      withBundle(["clinical/sofa-score"], ({ bundle, home, fileSystem, path }) =>
        Effect.gen(function* () {
          const shared = path.join(home, ".agents", "skills");
          const alias = path.join(home, ".claude", "skills");
          yield* fileSystem.makeDirectory(shared, { recursive: true });
          yield* fileSystem.makeDirectory(path.dirname(alias), { recursive: true });
          yield* fileSystem.symlink(shared, alias);

          const result = yield* ClinicalSkillLinks.sync({ bundle, directories: [alias, shared] });

          // The second folder's link is the first one's, not a user skill in its way.
          expect(result.shadowed).toEqual([]);
          expect(yield* fileSystem.readDirectory(shared)).toEqual(["sofa-score"]);
        }),
      ),
  );

  it.effect("touches no folder when there is no bundle", () =>
    withBundle([], ({ bundle, home, fileSystem, path }) =>
      Effect.gen(function* () {
        const directory = path.join(home, ".claude", "skills");
        yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });
        expect(yield* fileSystem.exists(directory)).toBe(false);
      }),
    ),
  );

  it.effect("looks where Claude and Codex load user skills, unless told otherwise", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const directories = (environment: NodeJS.ProcessEnv) =>
        ClinicalSkillLinks.defaultSkillDirectories({ path, platform: "darwin", environment });

      expect(directories({ HOME: "/home/ada" })).toEqual([
        "/home/ada/.claude/skills",
        "/home/ada/.agents/skills",
      ]);
      expect(directories({ HOME: "/home/ada", CLAUDE_CONFIG_DIR: "/work/claude" })).toEqual([
        "/work/claude/skills",
        "/home/ada/.agents/skills",
      ]);
      expect(directories({ HOME: "/home/ada", LINCEI_CLINICAL_SKILL_DIRS: "/a:/b" })).toEqual([
        "/a",
        "/b",
      ]);
      expect(directories({ HOME: "/home/ada", LINCEI_CLINICAL_SKILL_DIRS: "" })).toEqual([]);
    }).pipe(Effect.provide(NodePath.layerPosix)),
  );

  it.effect("looks in the Windows user profile, whatever HOME says", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const directories = (environment: NodeJS.ProcessEnv) =>
        ClinicalSkillLinks.defaultSkillDirectories({ path, platform: "win32", environment });

      // Git Bash and some managed PCs set HOME; Claude and Codex use the profile.
      expect(directories({ HOME: "/c/Users/ada", USERPROFILE: "C:\\Users\\ada" })).toEqual([
        "C:\\Users\\ada\\.claude\\skills",
        "C:\\Users\\ada\\.agents\\skills",
      ]);
      // Separated like PATH, which on Windows means a semicolon.
      expect(
        directories({ USERPROFILE: "C:\\Users\\ada", LINCEI_CLINICAL_SKILL_DIRS: "C:\\a;D:\\b" }),
      ).toEqual(["C:\\a", "D:\\b"]);
    }).pipe(Effect.provide(NodePath.layerWin32)),
  );

  // On a Windows host these are real junctions; elsewhere Node makes a symlink.
  it.effect("links with junctions on Windows and knows them as its own afterwards", () =>
    withBundle(
      ["clinical/sofa-score", "clinical/old-score"],
      ({ bundle, home, fileSystem, path }) =>
        Effect.gen(function* () {
          const directory = path.join(home, ".claude", "skills");
          expect(yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] })).toEqual({
            shadowed: [],
          });
          expect(
            yield* fileSystem.readFileString(path.join(directory, "sofa-score", "SKILL.md")),
          ).toBe("# clinical/sofa-score");

          yield* fileSystem.remove(path.join(bundle, "clinical", "old-score"), { recursive: true });
          // Its own links are neither the user's skills nor in the way.
          expect(yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] })).toEqual({
            shadowed: [],
          });
          expect(yield* fileSystem.readDirectory(directory)).toEqual(["sofa-score"]);
          expect(
            yield* ClinicalSkillLinks.describe({ bundle, directories: [directory] }),
          ).toMatchObject([{ name: "sofa-score", shadowed: false }]);
        }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
    ),
  );

  it.effect.skipIf(!symlinksSupported)(
    "on Windows, knows a link of its own whatever case its target is spelled in",
    () =>
      withBundle(["clinical/sofa-score"], ({ bundle, home, fileSystem, path }) =>
        Effect.gen(function* () {
          const directory = path.join(home, ".claude", "skills");
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          const source = path.join(yield* fileSystem.realPath(bundle), "clinical", "sofa-score");
          yield* fileSystem.symlink(source.toUpperCase(), path.join(directory, "sofa-score"));

          expect(yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] })).toEqual({
            shadowed: [],
          });
        }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
      ),
  );
  it.effect("describes each skill and says which ones a skill of the user's replaces", () =>
    withBundle(["clinical/sofa-score", "system/m4-api"], ({ bundle, home, fileSystem, path }) =>
      Effect.gen(function* () {
        yield* fileSystem.writeFileString(
          path.join(bundle, "clinical", "sofa-score", "SKILL.md"),
          "---\nname: sofa-score\ndescription: >\n  Calculate SOFA\n  for ICU patients.\n---\n# SOFA",
        );
        const claude = path.join(home, ".claude", "skills");
        const agents = path.join(home, ".agents", "skills");
        yield* ClinicalSkillLinks.sync({ bundle, directories: [claude, agents] });
        // The user's own m4-api, in one of the two folders, after Lincei linked its own.
        yield* fileSystem.remove(path.join(agents, "m4-api"));
        yield* fileSystem.makeDirectory(path.join(agents, "m4-api"));

        const skills = yield* ClinicalSkillLinks.describe({
          bundle,
          directories: [claude, agents],
        });

        expect(skills).toEqual([
          {
            name: "sofa-score",
            category: "clinical",
            description: "Calculate SOFA for ICU patients.",
            shadowed: false,
          },
          { name: "m4-api", category: "system", description: "", shadowed: true },
        ]);
      }),
    ),
  );

  it.effect("reads a skill's text by its name, and nothing outside the bundle", () =>
    withBundle(["clinical/sofa-score"], ({ bundle, home, fileSystem, path }) =>
      Effect.gen(function* () {
        const outside = path.join(home, "secret");
        yield* fileSystem.makeDirectory(outside, { recursive: true });
        yield* fileSystem.writeFileString(path.join(outside, "SKILL.md"), "not a skill");

        expect(yield* ClinicalSkillLinks.readSkill({ bundle, name: "sofa-score" })).toEqual(
          Option.some("# clinical/sofa-score"),
        );
        for (const name of ["../../home/secret", "secret", ""]) {
          expect(yield* ClinicalSkillLinks.readSkill({ bundle, name })).toEqual(Option.none());
        }
      }),
    ),
  );
});
