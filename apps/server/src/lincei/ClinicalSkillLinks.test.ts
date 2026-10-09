import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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

  it.effect("removes its links to skills the bundle dropped, and nothing else", () =>
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

          yield* fileSystem.remove(path.join(bundle, "clinical", "old-score"), { recursive: true });
          yield* ClinicalSkillLinks.sync({ bundle, directories: [directory] });

          expect((yield* fileSystem.readDirectory(directory)).toSorted()).toEqual([
            "linked-by-user",
            "my-skill",
            "sofa-score",
          ]);
        }),
    ),
  );

  it.effect("treats a folder that links to another as the same folder", () =>
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
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
