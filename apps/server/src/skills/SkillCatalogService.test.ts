// @effect-diagnostics nodeBuiltinImport:off - Fixtures emulate M4 materialization with Node stdlib.
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DatasetRpcError,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { M4Cli, type M4CliShape } from "../datasets/M4Cli.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { SkillCatalogService, layer as SkillCatalogServiceLive } from "./SkillCatalogService.ts";

const MANIFEST_FILE_NAME = ".m4-skills-manifest.json";
const PUBLISHED_M4_CATALOG_V1_PATH = path.resolve(
  import.meta.dirname,
  "../../integration/fixtures/m4-skills-catalog-v1.json",
);
const PUBLISHED_M4_CATALOG_V1_ROOT = path.resolve(
  import.meta.dirname,
  "../../integration/fixtures/m4-skills-catalog-v1",
);

function sha256(contents: Uint8Array | string): string {
  return `sha256:${crypto.createHash("sha256").update(contents).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).toSorted(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface FakeBundle {
  readonly manifest: {
    readonly schemaVersion: number;
    readonly publisher: string;
    readonly packageVersion: string;
    readonly bundleDigest: string;
    readonly skills: ReadonlyArray<{
      readonly id: string;
      readonly publisher: string;
      readonly name: string;
      readonly description: string;
      readonly kind: string;
      readonly category: string;
      readonly tier: string;
      readonly bundleVersion: string;
      readonly contentDigest: string;
      readonly treeDigest: string;
      readonly relativeRoot: string;
      readonly files: ReadonlyArray<{
        readonly path: string;
        readonly size: number;
        readonly contentDigest: string;
      }>;
    }>;
  };
  readonly contents: Readonly<Record<string, Uint8Array>>;
}

function makeBundle(version: string, body: string): FakeBundle {
  const skillBody = Buffer.from(body);
  const sql = Buffer.from("select 1;\n");
  const files = [
    { path: "SKILL.md", size: skillBody.length, contentDigest: sha256(skillBody) },
    { path: "assets/example.sql", size: sql.length, contentDigest: sha256(sql) },
  ];
  const skills = [
    {
      id: "m4:example-clinical",
      publisher: "m4",
      name: "example-clinical",
      description: "Validated example clinical guidance.",
      kind: "domain",
      category: "clinical",
      tier: "validated",
      bundleVersion: version,
      contentDigest: files[0]!.contentDigest,
      treeDigest: sha256(canonicalJson(files)),
      relativeRoot: "clinical/example-clinical",
      files,
    },
  ];
  const catalogIdentity = {
    schemaVersion: 1,
    publisher: "m4",
    packageVersion: version,
    skills,
  };
  return {
    manifest: {
      ...catalogIdentity,
      bundleDigest: sha256(canonicalJson(catalogIdentity)),
    },
    contents: {
      "clinical/example-clinical/SKILL.md": skillBody,
      "clinical/example-clinical/assets/example.sql": sql,
    },
  };
}

async function loadPublishedM4CatalogV1Fixture(): Promise<FakeBundle> {
  const manifest = JSON.parse(
    await fs.readFile(PUBLISHED_M4_CATALOG_V1_PATH, "utf8"),
  ) as FakeBundle["manifest"];
  const contents: Record<string, Uint8Array> = {};
  for (const skill of manifest.skills) {
    for (const file of skill.files) {
      const relative = `${skill.relativeRoot}/${file.path}`;
      contents[relative] = await fs.readFile(path.join(PUBLISHED_M4_CATALOG_V1_ROOT, relative));
    }
  }
  return { manifest, contents };
}

function m4Error(detail: string): DatasetRpcError {
  return new DatasetRpcError({
    code: "m4_unavailable",
    detail,
    actionableMessage: detail,
    command: "m4 skills catalog --json",
  });
}

function makeFakeM4(input: {
  readonly current: () => FakeBundle;
  readonly catalogError?: () => DatasetRpcError | undefined;
}): M4CliShape {
  const unused = () => Effect.die(new Error("Unexpected fake M4 command"));
  return {
    defaultCommand: "m4",
    resolveCommand: (configuredCommand) => ({
      command: configuredCommand || "m4",
      prefixArgs: [],
    }),
    exec: unused,
    status: unused,
    initialize: unused,
    initializeDerived: unused,
    backend: unused,
    json: (command) => {
      if (command.args.join(" ") === "skills catalog --json") {
        const error = input.catalogError?.();
        return error
          ? Effect.fail(error)
          : Effect.succeed({
              command: "m4 skills catalog --json",
              json: input.current().manifest,
              stdout: "",
            });
      }
      if (
        command.args[0] === "skills" &&
        command.args[1] === "materialize" &&
        command.args[2] === "--target"
      ) {
        const target = command.args[3];
        if (!target) return Effect.fail(m4Error("Missing materialization target"));
        return Effect.tryPromise({
          try: async () => {
            const bundle = input.current();
            for (const [relative, contents] of Object.entries(bundle.contents)) {
              const destination = path.join(target, ...relative.split("/"));
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.writeFile(destination, contents);
            }
            await fs.writeFile(
              path.join(target, MANIFEST_FILE_NAME),
              // @effect-diagnostics-next-line preferSchemaOverJson:off - Fake external CLI fixture.
              `${JSON.stringify(bundle.manifest, null, 2)}\n`,
            );
            return {
              command: "m4 skills materialize",
              json: {
                schemaVersion: 1,
                publisher: "m4",
                bundleDigest: bundle.manifest.bundleDigest,
                target,
              },
              stdout: "",
            };
          },
          catch: (cause) => m4Error(cause instanceof Error ? cause.message : String(cause)),
        });
      }
      return Effect.fail(m4Error(`Unexpected M4 arguments: ${command.args.join(" ")}`));
    },
  };
}

function makeLayer(baseDir: string, m4: M4CliShape) {
  return SkillCatalogServiceLive.pipe(
    Layer.provide(Layer.succeed(M4Cli, M4Cli.of(m4))),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
}

function makeProvider(skills: ServerProvider["skills"]): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: "2026-07-28T10:00:00.000Z",
    version: "1.0.0",
    models: [],
    slashCommands: [],
    skills,
  };
}

it.layer(NodeServices.layer)("SkillCatalogService", (it) => {
  it.effect("consumes, verifies, and pins the M4-published schema v1 fixture", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-ready-",
      });
      const bundle = yield* Effect.promise(loadPublishedM4CatalogV1Fixture);

      const result = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        const snapshot = yield* catalog.getSnapshot;
        const selection = yield* catalog.pinSession({
          workflowId: "structured-clinical-study",
          workflowVersion: "3.0.0",
          explicitSkillIds: ["m4:example-clinical"],
        });
        const selected = yield* catalog.getPinnedRuntimeSkills(selection);
        return { snapshot, selection, selected };
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => bundle }))));

      assert.strictEqual(result.snapshot.sources[1]?.state, "ready");
      assert.deepEqual(
        result.snapshot.skills.map((skill) => skill.id),
        ["lincei:context", "m4:example-clinical"],
      );
      assert.strictEqual(result.snapshot.skills[1]?.files.length, 2);
      assert.deepEqual(
        result.selection.bundlePins.map((pin) => pin.publisher),
        ["lincei", "m4"],
      );
      assert.isTrue(result.selection.skillIds.includes("m4:clinical-research-pitfalls"));
      assert.strictEqual(
        result.selected.find((skill) => skill.descriptor.id === "m4:example-clinical")?.canonical
          .body,
        "---\nname: example-clinical\ndescription: Minimal managed catalog compatibility fixture.\ntier: validated\ncategory: clinical\nkind: domain\n---\n\n# Example clinical skill\n\nUse this fixture to verify the managed M4 skill catalog contract.\n",
      );
      assert.strictEqual(result.snapshot.sources[1]?.bundleVersion, "0.5.4");
      assert.isTrue(
        result.selected
          .find((skill) => skill.descriptor.id === "m4:example-clinical")
          ?.assetRoot?.startsWith(baseDir),
      );
    }),
  );

  it.effect("deduplicates exact native copies and labels modified copies as overrides", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-native-",
      });
      const nativeRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-native-skill-",
      });
      const bundle = makeBundle("0.5.4", "# Example v1\n");
      for (const [relative, contents] of Object.entries(bundle.contents)) {
        const skillRelative = relative.replace("clinical/example-clinical/", "");
        const destination = path.join(nativeRoot, ...skillRelative.split("/"));
        yield* Effect.promise(() => fs.mkdir(path.dirname(destination), { recursive: true }));
        yield* Effect.promise(() => fs.writeFile(destination, contents));
      }

      const result = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        const exact = yield* catalog.reconcileProvider(
          makeProvider([
            {
              name: "example-clinical",
              path: nativeRoot,
              enabled: true,
            },
          ]),
        );
        yield* Effect.promise(() =>
          fs.writeFile(path.join(nativeRoot, "SKILL.md"), "# Locally modified\n"),
        );
        const modified = yield* catalog.reconcileProvider(
          makeProvider([
            {
              name: "example-clinical",
              path: nativeRoot,
              enabled: true,
            },
          ]),
        );
        return { exact, modified };
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => bundle }))));

      assert.strictEqual(
        result.exact.skills.filter((skill) => skill.name === "m4:example-clinical").length,
        1,
      );
      assert.strictEqual(
        result.exact.skills.find((skill) => skill.name === "m4:example-clinical")?.linceiSyncStatus,
        "provider-native",
      );
      assert.strictEqual(
        result.modified.skills.find((skill) => skill.name === "m4:example-clinical")
          ?.linceiSyncStatus,
        "local-override",
      );
    }),
  );

  it.effect("uses only a verified stale bundle when M4 becomes unavailable", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-stale-",
      });
      const bundle = makeBundle("0.5.4", "# Example v1\n");

      yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        yield* catalog.getSnapshot;
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => bundle }))));

      const stale = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        return yield* catalog.getSnapshot;
      }).pipe(
        Effect.provide(
          makeLayer(
            baseDir,
            makeFakeM4({
              current: () => bundle,
              catalogError: () => m4Error("M4 unavailable"),
            }),
          ),
        ),
      );

      assert.strictEqual(stale.sources[1]?.state, "stale");
      assert.strictEqual(
        stale.skills.find((skill) => skill.id === "m4:example-clinical")?.deliveryState,
        "stale",
      );
    }),
  );

  it.effect("keeps active sessions on their pinned bundle after a catalog upgrade", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-pin-",
      });
      let current = makeBundle("0.5.4", "# Example v1\n");
      const m4 = makeFakeM4({ current: () => current });

      const result = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        yield* catalog.getSnapshot;
        const selection = yield* catalog.pinSession({
          explicitSkillIds: ["m4:example-clinical"],
        });
        current = makeBundle("0.5.5", "# Example v2\n");
        const refreshed = yield* catalog.refresh;
        const pinned = yield* catalog.getPinnedRuntimeSkills(selection);
        const m4Pin = selection.bundlePins.find((pin) => pin.publisher === "m4")!;
        yield* Effect.promise(() =>
          fs.rm(
            path.join(
              baseDir,
              "skill-bundles",
              "m4",
              m4Pin.bundleVersion,
              m4Pin.bundleDigest.replace("sha256:", ""),
            ),
            { recursive: true },
          ),
        );
        const missingPinned = yield* catalog.getPinnedRuntimeSkills(selection);
        return { refreshed, pinned, missingPinned };
      }).pipe(Effect.provide(makeLayer(baseDir, m4)));

      assert.strictEqual(result.refreshed.sources[1]?.bundleVersion, "0.5.5");
      const pinnedM4 = result.pinned.find((skill) => skill.descriptor.id === "m4:example-clinical");
      assert.strictEqual(pinnedM4?.canonical.body, "# Example v1\n");
      assert.strictEqual(pinnedM4?.descriptor.bundleVersion, "0.5.4");
      assert.isFalse(result.missingPinned.some((skill) => skill.descriptor.publisher === "m4"));
    }),
  );

  it.effect("rejects cache-path package versions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-path-",
      });
      const bundle = makeBundle("..", "# Unsafe path\n");

      const snapshot = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        return yield* catalog.getSnapshot;
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => bundle }))));

      assert.strictEqual(snapshot.sources[1]?.state, "unavailable");
      assert.deepEqual(
        snapshot.skills.map((skill) => skill.id),
        ["lincei:context"],
      );
    }),
  );

  it.effect("rejects M4 releases that predate the managed catalog contract", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-version-",
      });
      const bundle = makeBundle("0.5.3", "# Unsupported version\n");

      const snapshot = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        return yield* catalog.getSnapshot;
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => bundle }))));

      assert.strictEqual(snapshot.sources[1]?.state, "unavailable");
      assert.match(snapshot.sources[1]?.message ?? "", /requires >=0\.5\.4 <0\.6/);
      assert.deepEqual(
        snapshot.skills.map((skill) => skill.id),
        ["lincei:context"],
      );
    }),
  );

  it.effect("fails closed for unsupported or corrupt manifests without a cache", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "lincei-skill-catalog-invalid-",
      });
      const bundle = makeBundle("0.5.4", "# Example v1\n");
      const invalid = {
        ...bundle,
        manifest: {
          ...bundle.manifest,
          schemaVersion: 2,
          bundleDigest: `sha256:${"0".repeat(64)}`,
        },
      };

      const snapshot = yield* Effect.gen(function* () {
        const catalog = yield* SkillCatalogService;
        return yield* catalog.getSnapshot;
      }).pipe(Effect.provide(makeLayer(baseDir, makeFakeM4({ current: () => invalid }))));

      assert.strictEqual(snapshot.sources[1]?.state, "unavailable");
      assert.deepEqual(
        snapshot.skills.map((skill) => skill.id),
        ["lincei:context"],
      );
    }),
  );
});
