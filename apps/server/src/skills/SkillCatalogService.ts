// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as crypto from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_SERVER_SETTINGS,
  type LinceiCanonicalSkill,
  type LinceiSkillSettings,
  type ManagedSkillActivationPolicy,
  type ManagedSkillDescriptor,
  type ManagedSkillFileDescriptor,
  type ManagedSkillKind,
  type ServerProvider,
  type ServerProviderSkill,
  type SessionSkillSelection,
  type SkillBundlePin,
  type SkillCatalogSnapshot,
} from "@t3tools/contracts";
import {
  applyLinceiSkillSettings,
  bundledLinceiSkills,
  isExternalProviderSkill,
  workflowById,
} from "@t3tools/shared/linceiSkills";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import { M4Cli } from "../datasets/M4Cli.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const M4_CATALOG_SCHEMA_VERSION = 1;
const M4_CATALOG_SUPPORTED_VERSION_RANGE = ">=0.5.4 <0.6";
const M4_MANIFEST_FILE_NAME = ".m4-skills-manifest.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SKILLS = 512;
const MAX_FILES = 4096;
const MAX_SKILL_FILES = 256;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const M4_CATALOG_TIMEOUT = Duration.seconds(30);

const M4FileDescriptor = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  contentDigest: Schema.String,
});

const M4SkillDescriptor = Schema.Struct({
  id: Schema.String,
  publisher: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: Schema.optional(Schema.String),
  category: Schema.String,
  tier: Schema.String,
  bundleVersion: Schema.String,
  contentDigest: Schema.String,
  treeDigest: Schema.String,
  relativeRoot: Schema.String,
  files: Schema.Array(M4FileDescriptor),
});

const M4CatalogManifest = Schema.Struct({
  schemaVersion: Schema.Number,
  publisher: Schema.String,
  packageVersion: Schema.String,
  bundleDigest: Schema.String,
  skills: Schema.Array(M4SkillDescriptor),
});

type M4CatalogManifest = typeof M4CatalogManifest.Type;
type M4CatalogSkill = M4CatalogManifest["skills"][number];
const decodeM4CatalogManifest = Schema.decodeUnknownSync(M4CatalogManifest);

export interface RuntimeManagedSkill {
  readonly canonical: LinceiCanonicalSkill;
  readonly descriptor: ManagedSkillDescriptor;
  readonly assetRoot?: string | undefined;
}

interface CatalogRuntimeState {
  readonly snapshot: SkillCatalogSnapshot;
  readonly runtimeSkills: ReadonlyArray<RuntimeManagedSkill>;
  readonly m4Manifest?: M4CatalogManifest | undefined;
}

export interface ProviderDelivery {
  readonly state: ManagedSkillDescriptor["deliveryState"];
  readonly nativeTreeDigest?: string | undefined;
  readonly nativePath?: string | undefined;
}

export interface SkillCatalogServiceShape {
  readonly getSnapshot: Effect.Effect<SkillCatalogSnapshot>;
  readonly refresh: Effect.Effect<SkillCatalogSnapshot>;
  readonly reconcileProvider: (provider: ServerProvider) => Effect.Effect<ServerProvider>;
  readonly pinSession: (input: {
    readonly workflowId?: string | undefined;
    readonly workflowVersion?: string | undefined;
    readonly explicitSkillIds?: ReadonlyArray<string> | undefined;
  }) => Effect.Effect<SessionSkillSelection>;
  readonly getPinnedRuntimeSkills: (
    selection: SessionSkillSelection,
  ) => Effect.Effect<ReadonlyArray<RuntimeManagedSkill>>;
  readonly getProviderDelivery: (
    providerInstanceId: string,
    skillId: string,
  ) => Effect.Effect<ProviderDelivery | undefined>;
}

export class SkillCatalogService extends Context.Service<
  SkillCatalogService,
  SkillCatalogServiceShape
>()("t3/skills/SkillCatalogService") {}

class SkillCatalogRefreshError extends Data.TaggedError("SkillCatalogRefreshError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function toSkillCatalogRefreshError(cause: unknown): SkillCatalogRefreshError {
  return new SkillCatalogRefreshError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function sha256(contents: Uint8Array | string): string {
  return `sha256:${crypto.createHash("sha256").update(contents).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
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

function requireSafeRelativePath(value: string, label: string): string {
  if (!value || path.posix.isAbsolute(value) || value.includes("\\")) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function titleCase(value: string): string {
  return value
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function requireSafeSegment(value: string, label: string): string {
  if (value === "." || value === ".." || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function bundleDigestSegment(bundleDigest: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(bundleDigest);
  if (!match?.[1]) {
    throw new Error(`Invalid M4 bundle digest: ${bundleDigest}`);
  }
  return match[1];
}

function resolveContained(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) {
    throw new Error(`Unsafe absolute or empty bundle path: ${relative}`);
  }
  const segments = relative.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe bundle path: ${relative}`);
  }
  const candidate = path.resolve(root, ...segments);
  const relativeToRoot = path.relative(root, candidate);
  if (
    !relativeToRoot ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Bundle path escapes managed root: ${relative}`);
  }
  return candidate;
}

function decodeM4Manifest(value: unknown): M4CatalogManifest {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("M4 skill manifest exceeds the supported size limit");
  }
  const manifest = decodeM4CatalogManifest(value);
  if (manifest.schemaVersion !== M4_CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported M4 skill schema ${String(manifest.schemaVersion)}; supported schema is ${String(M4_CATALOG_SCHEMA_VERSION)}`,
    );
  }
  if (!satisfiesSemverRange(manifest.packageVersion, M4_CATALOG_SUPPORTED_VERSION_RANGE)) {
    throw new Error(
      `Unsupported M4 package ${manifest.packageVersion}; catalog integration requires ${M4_CATALOG_SUPPORTED_VERSION_RANGE}`,
    );
  }
  if (manifest.publisher !== "m4") {
    throw new Error(`Unexpected M4 skill publisher: ${manifest.publisher}`);
  }
  if (manifest.skills.length > MAX_SKILLS) {
    throw new Error(`M4 manifest declares too many skills: ${String(manifest.skills.length)}`);
  }
  const names = new Set<string>();
  const relativeRoots = new Set<string>();
  let fileCount = 0;
  for (const skill of manifest.skills) {
    if (
      skill.id !== `m4:${skill.name}` ||
      skill.publisher !== "m4" ||
      skill.bundleVersion !== manifest.packageVersion ||
      names.has(skill.name)
    ) {
      throw new Error(`Invalid or duplicate M4 skill identity: ${skill.id}`);
    }
    names.add(skill.name);
    requireSafeSegment(skill.name, "M4 skill name");
    requireSafeRelativePath(skill.relativeRoot, `relative root for ${skill.id}`);
    if (relativeRoots.has(skill.relativeRoot)) {
      throw new Error(`Duplicate M4 skill relative root: ${skill.relativeRoot}`);
    }
    relativeRoots.add(skill.relativeRoot);
    if (skill.files.length === 0 || skill.files.length > MAX_SKILL_FILES) {
      throw new Error(`Invalid file count for M4 skill ${skill.id}`);
    }
    fileCount += skill.files.length;
    if (fileCount > MAX_FILES) {
      throw new Error("M4 manifest declares too many files");
    }
    if (!skill.files.some((file) => file.path === "SKILL.md")) {
      throw new Error(`M4 skill ${skill.id} does not declare SKILL.md`);
    }
    const filePaths = new Set<string>();
    for (const file of skill.files) {
      requireSafeRelativePath(file.path, `file path for ${skill.id}`);
      if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_BYTES ||
        !/^sha256:[a-f0-9]{64}$/.test(file.contentDigest) ||
        filePaths.has(file.path)
      ) {
        throw new Error(`Invalid file descriptor in M4 skill ${skill.id}: ${file.path}`);
      }
      filePaths.add(file.path);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(skill.contentDigest)) {
      throw new Error(`Invalid content digest for M4 skill ${skill.id}`);
    }
    const skillBody = skill.files.find((file) => file.path === "SKILL.md");
    if (skillBody?.contentDigest !== skill.contentDigest) {
      throw new Error(`M4 skill content digest does not match SKILL.md: ${skill.id}`);
    }
    if (sha256(canonicalJson(skill.files)) !== skill.treeDigest) {
      throw new Error(`M4 skill tree digest mismatch: ${skill.id}`);
    }
  }
  bundleDigestSegment(manifest.bundleDigest);
  requireSafeSegment(manifest.packageVersion, "M4 package version");
  const computedBundleDigest = sha256(
    canonicalJson({
      schemaVersion: manifest.schemaVersion,
      publisher: manifest.publisher,
      packageVersion: manifest.packageVersion,
      skills: manifest.skills,
    }),
  );
  if (computedBundleDigest !== manifest.bundleDigest) {
    throw new Error("M4 bundle digest mismatch");
  }
  return manifest;
}

async function walkFiles(root: string): Promise<ReadonlySet<string>> {
  const files = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Managed skill bundles may not contain symlinks: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported managed bundle entry: ${entryPath}`);
      }
      const relative = path.relative(root, entryPath).split(path.sep).join("/");
      if (relative !== M4_MANIFEST_FILE_NAME) {
        files.add(relative);
        if (files.size > MAX_FILES) {
          throw new Error("Managed skill bundle contains too many files");
        }
      }
    }
  }
  return files;
}

async function readVerifiedM4Bundle(
  bundleRoot: string,
  expectedManifest?: M4CatalogManifest | undefined,
): Promise<{
  readonly manifest: M4CatalogManifest;
  readonly bodies: ReadonlyMap<string, string>;
}> {
  const rootStat = await fs.lstat(bundleRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Managed M4 bundle root is not a real directory: ${bundleRoot}`);
  }
  const manifestPath = path.join(bundleRoot, M4_MANIFEST_FILE_NAME);
  const manifestStat = await fs.lstat(manifestPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    manifestStat.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error(`Invalid managed M4 manifest: ${manifestPath}`);
  }
  const manifest = decodeM4Manifest(JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown);
  if (
    expectedManifest &&
    (manifest.bundleDigest !== expectedManifest.bundleDigest ||
      manifest.packageVersion !== expectedManifest.packageVersion)
  ) {
    throw new Error("Materialized M4 bundle does not match the requested catalog");
  }

  const declared = new Set<string>();
  const bodies = new Map<string, string>();
  let totalBytes = 0;
  for (const skill of manifest.skills) {
    for (const file of skill.files) {
      const relative = `${skill.relativeRoot}/${file.path}`;
      const filePath = resolveContained(bundleRoot, relative);
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) {
        throw new Error(`Invalid managed M4 file: ${relative}`);
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_BUNDLE_BYTES) {
        throw new Error("Managed M4 bundle exceeds the supported total size");
      }
      const contents = await fs.readFile(filePath);
      if (sha256(contents) !== file.contentDigest) {
        throw new Error(`Managed M4 file digest mismatch: ${relative}`);
      }
      declared.add(relative);
      if (file.path === "SKILL.md") {
        bodies.set(skill.id, contents.toString("utf8"));
      }
    }
  }
  const actual = await walkFiles(bundleRoot);
  if (actual.size !== declared.size || [...actual].some((relative) => !declared.has(relative))) {
    throw new Error("Managed M4 bundle contains missing or undeclared files");
  }
  return { manifest, bodies };
}

function deriveKind(skill: M4CatalogSkill): ManagedSkillKind {
  const kind = skill.kind;
  if (
    kind === "domain" ||
    kind === "methodology" ||
    kind === "integration" ||
    kind === "workflow" ||
    kind === "maintenance" ||
    kind === "authoring"
  ) {
    return kind;
  }
  return skill.category === "clinical" ? "domain" : "integration";
}

function activationPolicy(skill: M4CatalogSkill): ManagedSkillActivationPolicy {
  if (skill.name === "clinical-research-session") return "suppressed";
  if (skill.name === "clinical-research-pitfalls") return "workflow-required";
  const kind = deriveKind(skill);
  if (kind === "maintenance" || kind === "authoring") return "opt-in";
  if (skill.tier === "community" && skill.name !== "m4-api" && skill.name !== "vitrine-api") {
    return "opt-in";
  }
  return "eligible";
}

function toCanonicalSkill(input: {
  readonly descriptor: ManagedSkillDescriptor;
  readonly body: string;
}): LinceiCanonicalSkill {
  return {
    id: input.descriptor.id,
    title: input.descriptor.title,
    description: input.descriptor.description,
    category: input.descriptor.kind === "methodology" ? "clinical-methods" : "provider-native",
    tier: "provider-native",
    version: input.descriptor.bundleVersion,
    source: "provider-native",
    enabled: input.descriptor.enabled,
    body: input.body,
    contentHash: input.descriptor.contentDigest,
    upstreamId: input.descriptor.id,
    upstreamVersion: input.descriptor.bundleVersion,
  };
}

function applySettings(
  runtimeSkills: ReadonlyArray<RuntimeManagedSkill>,
  settings: Readonly<Record<string, LinceiSkillSettings | undefined>>,
): ReadonlyArray<RuntimeManagedSkill> {
  return runtimeSkills.map((skill) => {
    const configured = settings[skill.descriptor.id];
    const enabled =
      configured?.enabled ??
      (skill.descriptor.activationPolicy !== "opt-in" &&
        skill.descriptor.activationPolicy !== "suppressed");
    return {
      ...skill,
      canonical: { ...skill.canonical, enabled },
      descriptor: { ...skill.descriptor, enabled },
    };
  });
}

function linceiRuntimeSkills(
  settings: Readonly<Record<string, LinceiSkillSettings | undefined>>,
): ReadonlyArray<RuntimeManagedSkill> {
  return applyLinceiSkillSettings(bundledLinceiSkills(), settings).map((canonical) => ({
    canonical,
    descriptor: {
      id: canonical.id,
      publisher: "lincei",
      name: "context",
      title: canonical.title,
      description: canonical.description,
      kind: "integration",
      category: "lincei",
      tier: canonical.tier,
      bundleVersion: canonical.version,
      contentDigest: canonical.contentHash,
      treeDigest: canonical.contentHash,
      relativeRoot: "context",
      files: [],
      source: "bundled",
      enabled: canonical.enabled,
      activationPolicy: "workflow-required",
      deliveryState: "managed-cache",
      stale: false,
      body: canonical.body,
    },
  }));
}

function m4RuntimeSkills(input: {
  readonly bundleRoot: string;
  readonly manifest: M4CatalogManifest;
  readonly bodies: ReadonlyMap<string, string>;
  readonly stale: boolean;
}): ReadonlyArray<RuntimeManagedSkill> {
  return input.manifest.skills.map((skill) => {
    const files = skill.files.map(
      (file): ManagedSkillFileDescriptor => ({
        path: file.path,
        size: file.size,
        contentDigest: file.contentDigest,
      }),
    );
    const body = input.bodies.get(skill.id);
    if (body === undefined) {
      throw new Error(`Materialized M4 skill is missing a body: ${skill.id}`);
    }
    const policy = activationPolicy(skill);
    const descriptor: ManagedSkillDescriptor = {
      id: skill.id,
      publisher: "m4",
      name: skill.name,
      title: titleCase(skill.name),
      description: skill.description,
      kind: deriveKind(skill),
      category: skill.category,
      tier: skill.tier,
      bundleVersion: skill.bundleVersion,
      contentDigest: skill.contentDigest,
      treeDigest: skill.treeDigest,
      relativeRoot: skill.relativeRoot,
      files,
      source: "managed-cache",
      enabled: policy !== "opt-in" && policy !== "suppressed",
      activationPolicy: policy,
      deliveryState: input.stale ? "stale" : "managed-cache",
      stale: input.stale,
      body,
    };
    return {
      descriptor,
      canonical: toCanonicalSkill({ descriptor, body }),
      assetRoot: resolveContained(input.bundleRoot, skill.relativeRoot),
    };
  });
}

function makeSnapshot(input: {
  readonly runtimeSkills: ReadonlyArray<RuntimeManagedSkill>;
  readonly m4Status: SkillCatalogSnapshot["sources"][number];
}): SkillCatalogSnapshot {
  return {
    schemaVersion: 1,
    refreshedAt: new Date().toISOString(),
    skills: input.runtimeSkills.map((skill) => skill.descriptor),
    sources: [
      {
        publisher: "lincei",
        state: "ready",
        bundleVersion: bundledLinceiSkills()[0]!.version,
        bundleDigest: bundledLinceiSkills()[0]!.contentHash,
      },
      input.m4Status,
    ],
  };
}

async function findLastKnownM4Bundle(m4Root: string): Promise<
  | {
      readonly bundleRoot: string;
      readonly manifest: M4CatalogManifest;
      readonly bodies: ReadonlyMap<string, string>;
    }
  | undefined
> {
  let versions: ReadonlyArray<Dirent>;
  try {
    versions = await fs.readdir(m4Root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const candidates: Array<{
    readonly bundleRoot: string;
    readonly modifiedAt: number;
  }> = [];
  for (const version of versions) {
    if (!version.isDirectory() || version.isSymbolicLink()) continue;
    const versionRoot = path.join(m4Root, version.name);
    for (const digest of await fs.readdir(versionRoot, { withFileTypes: true })) {
      if (!digest.isDirectory() || digest.isSymbolicLink()) continue;
      const bundleRoot = path.join(versionRoot, digest.name);
      try {
        const stat = await fs.stat(path.join(bundleRoot, M4_MANIFEST_FILE_NAME));
        candidates.push({ bundleRoot, modifiedAt: stat.mtimeMs });
      } catch {
        // Ignore incomplete cache entries.
      }
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const candidate of candidates) {
    try {
      const verified = await readVerifiedM4Bundle(candidate.bundleRoot);
      return { bundleRoot: candidate.bundleRoot, ...verified };
    } catch {
      // Keep looking for the most recent valid bundle.
    }
  }
  return undefined;
}

async function digestNativeSkill(skillPath: string): Promise<string | undefined> {
  const root =
    path.basename(skillPath).toLowerCase() === "skill.md" ? path.dirname(skillPath) : skillPath;
  let rootStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    rootStat = await fs.lstat(root);
  } catch {
    return undefined;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return undefined;

  const files: Array<ManagedSkillFileDescriptor> = [];
  let totalBytes = 0;
  const pending: Array<{ readonly absolute: string; readonly relative: string }> = [
    { absolute: root, relative: "" },
  ];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory.absolute, { withFileTypes: true })) {
      const absolute = path.join(directory.absolute, entry.name);
      const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) return undefined;
      if (entry.isDirectory()) {
        pending.push({ absolute, relative });
        continue;
      }
      if (!entry.isFile()) return undefined;
      if (files.length >= MAX_SKILL_FILES) return undefined;
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) return undefined;
      totalBytes += stat.size;
      if (totalBytes > MAX_BUNDLE_BYTES) return undefined;
      const contents = await fs.readFile(absolute);
      files.push({
        path: relative,
        size: stat.size,
        contentDigest: sha256(contents),
      });
    }
  }
  const orderedFiles = files.toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return sha256(canonicalJson(orderedFiles));
}

function canonicalProviderSkill(
  descriptor: ManagedSkillDescriptor,
  delivery: ProviderDelivery,
): ServerProviderSkill {
  return {
    name: descriptor.id,
    displayName: descriptor.title,
    description: descriptor.description,
    shortDescription: descriptor.description,
    path: delivery.nativePath ?? `lincei://${descriptor.source}/${descriptor.id}`,
    scope: "system",
    enabled: descriptor.enabled,
    linceiSkillId: descriptor.id,
    linceiSource: descriptor.source,
    linceiSyncStatus: delivery.state,
    linceiAvailability:
      delivery.state === "provider-native"
        ? "provider-native"
        : delivery.state === "local-override"
          ? "local override"
          : delivery.state,
    linceiPublisher: descriptor.publisher,
    linceiBundleVersion: descriptor.bundleVersion,
    linceiTier: descriptor.tier,
    linceiCategory: descriptor.category,
    linceiKind: descriptor.kind,
    linceiTreeDigest: descriptor.treeDigest,
    ...(delivery.nativeTreeDigest !== undefined
      ? { linceiNativeTreeDigest: delivery.nativeTreeDigest }
      : {}),
  };
}

export const makeSkillCatalogService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const m4 = yield* M4Cli;
  const settingsService = yield* ServerSettingsService;
  const stateRef = yield* Ref.make<CatalogRuntimeState | undefined>(undefined);
  const deliveryRef = yield* Ref.make(new Map<string, ReadonlyMap<string, ProviderDelivery>>());
  const refreshSemaphore = yield* Semaphore.make(1);
  const m4Root = path.join(config.skillBundlesDir, "m4");

  const buildRuntimeState = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
    );
    const linceiSkills = linceiRuntimeSkills(settings.linceiSkills);

    const current = yield* m4
      .json({
        cwd: config.cwd,
        args: ["skills", "catalog", "--json"],
        timeout: M4_CATALOG_TIMEOUT,
      })
      .pipe(
        Effect.flatMap((output) =>
          Effect.tryPromise({
            try: async () => {
              const manifest = decodeM4Manifest(output.json);
              const bundleRoot = path.join(
                m4Root,
                requireSafeSegment(manifest.packageVersion, "M4 package version"),
                bundleDigestSegment(manifest.bundleDigest),
              );
              try {
                const verified = await readVerifiedM4Bundle(bundleRoot, manifest);
                return { bundleRoot, ...verified };
              } catch {
                await fs.rm(bundleRoot, { recursive: true, force: true });
              }
              await m4
                .json({
                  cwd: config.cwd,
                  args: ["skills", "materialize", "--target", bundleRoot, "--json"],
                  timeout: M4_CATALOG_TIMEOUT,
                })
                .pipe(Effect.runPromise);
              const verified = await readVerifiedM4Bundle(bundleRoot, manifest);
              return { bundleRoot, ...verified };
            },
            catch: toSkillCatalogRefreshError,
          }),
        ),
        Effect.result,
      );

    if (current._tag === "Success") {
      const runtimeSkills = applySettings(
        [
          ...linceiSkills,
          ...m4RuntimeSkills({
            bundleRoot: current.success.bundleRoot,
            manifest: current.success.manifest,
            bodies: current.success.bodies,
            stale: false,
          }),
        ],
        settings.linceiSkills,
      );
      return {
        snapshot: makeSnapshot({
          runtimeSkills,
          m4Status: {
            publisher: "m4",
            state: "ready",
            bundleVersion: current.success.manifest.packageVersion,
            bundleDigest: current.success.manifest.bundleDigest,
          },
        }),
        runtimeSkills,
        m4Manifest: current.success.manifest,
      } satisfies CatalogRuntimeState;
    }

    const cached = yield* Effect.tryPromise({
      try: () => findLastKnownM4Bundle(m4Root),
      catch: toSkillCatalogRefreshError,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (cached) {
      const runtimeSkills = applySettings(
        [
          ...linceiSkills,
          ...m4RuntimeSkills({
            bundleRoot: cached.bundleRoot,
            manifest: cached.manifest,
            bodies: cached.bodies,
            stale: true,
          }),
        ],
        settings.linceiSkills,
      );
      return {
        snapshot: makeSnapshot({
          runtimeSkills,
          m4Status: {
            publisher: "m4",
            state: "stale",
            bundleVersion: cached.manifest.packageVersion,
            bundleDigest: cached.manifest.bundleDigest,
            message: "M4 is unavailable; using the last verified cached bundle.",
          },
        }),
        runtimeSkills,
        m4Manifest: cached.manifest,
      } satisfies CatalogRuntimeState;
    }

    return {
      snapshot: makeSnapshot({
        runtimeSkills: linceiSkills,
        m4Status: {
          publisher: "m4",
          state: "unavailable",
          message: `M4 skills are unavailable and no verified cached bundle exists. ${current.failure.message}`,
        },
      }),
      runtimeSkills: linceiSkills,
      m4Manifest: undefined,
    } satisfies CatalogRuntimeState;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to refresh skill catalog", { cause }).pipe(
        Effect.map(() => {
          const runtimeSkills = linceiRuntimeSkills(DEFAULT_SERVER_SETTINGS.linceiSkills);
          return {
            snapshot: makeSnapshot({
              runtimeSkills,
              m4Status: {
                publisher: "m4",
                state: "unavailable",
                message: "Skill catalog refresh failed.",
              },
            }),
            runtimeSkills,
            m4Manifest: undefined,
          } satisfies CatalogRuntimeState;
        }),
      ),
    ),
  );

  const refreshState = refreshSemaphore.withPermits(1)(
    buildRuntimeState.pipe(Effect.tap((state) => Ref.set(stateRef, state))),
  );

  const getState = Effect.flatMap(Ref.get(stateRef), (state) =>
    state ? Effect.succeed(state) : refreshState,
  );

  const getSnapshot = Effect.gen(function* () {
    const state = yield* getState;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
    );
    const runtimeSkills = applySettings(state.runtimeSkills, settings.linceiSkills);
    return {
      ...state.snapshot,
      skills: runtimeSkills.map((skill) => skill.descriptor),
    };
  });

  const refresh = Effect.map(refreshState, (state) => state.snapshot);

  const reconcileProvider: SkillCatalogServiceShape["reconcileProvider"] = (provider) =>
    Effect.gen(function* () {
      if (!provider.enabled || provider.availability === "unavailable") return provider;
      const state = yield* getState;
      const settings = yield* settingsService.getSettings.pipe(
        Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
      );
      const runtimeSkills = applySettings(state.runtimeSkills, settings.linceiSkills);
      const nativeSkills = provider.skills.filter(isExternalProviderSkill);
      const nativeByName = new Map(nativeSkills.map((skill) => [skill.name, skill] as const));
      const delivery = new Map<string, ProviderDelivery>();
      const logicalSkills: ServerProviderSkill[] = [];
      const consumedNative = new Set<ServerProviderSkill>();

      for (const managed of runtimeSkills) {
        const native = nativeByName.get(managed.descriptor.name);
        if (!native) {
          const state =
            managed.descriptor.deliveryState === "stale"
              ? "stale"
              : managed.descriptor.deliveryState === "unavailable"
                ? "unavailable"
                : "managed-cache";
          const resolved = { state } satisfies ProviderDelivery;
          delivery.set(managed.descriptor.id, resolved);
          logicalSkills.push(canonicalProviderSkill(managed.descriptor, resolved));
          continue;
        }
        consumedNative.add(native);
        const nativeTreeDigest = yield* Effect.tryPromise({
          try: () => digestNativeSkill(native.path),
          catch: toSkillCatalogRefreshError,
        }).pipe(Effect.orElseSucceed(() => undefined));
        const exact = nativeTreeDigest === managed.descriptor.treeDigest;
        const resolved: ProviderDelivery = {
          state: exact ? "provider-native" : "local-override",
          nativePath: native.path,
          ...(nativeTreeDigest !== undefined ? { nativeTreeDigest } : {}),
        };
        delivery.set(managed.descriptor.id, resolved);
        logicalSkills.push(canonicalProviderSkill(managed.descriptor, resolved));
      }

      for (const native of nativeSkills) {
        if (consumedNative.has(native)) continue;
        logicalSkills.push({
          ...native,
          linceiSource: "provider-native",
          linceiSyncStatus: "provider-native",
          linceiAvailability: "external provider skill",
        });
      }
      yield* Ref.update(deliveryRef, (current) => {
        const next = new Map(current);
        next.set(provider.instanceId, delivery);
        return next;
      });
      return { ...provider, skills: logicalSkills };
    });

  const pinSession: SkillCatalogServiceShape["pinSession"] = (input) =>
    Effect.gen(function* () {
      const state = yield* getState;
      const settings = yield* settingsService.getSettings.pipe(
        Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
      );
      const workflow = workflowById(input.workflowId);
      const workflowEnabled = settings.linceiWorkflows[workflow.id]?.enabled ?? true;
      const skillIds = [
        ...(workflowEnabled ? workflow.skillIds : []),
        ...(input.explicitSkillIds ?? []),
      ].filter((id, index, values) => values.indexOf(id) === index);
      const bundlePins: SkillBundlePin[] = [];
      const linceiBundle = state.runtimeSkills.find(
        (skill) => skill.descriptor.publisher === "lincei",
      );
      if (linceiBundle && skillIds.some((id) => id.startsWith("lincei:"))) {
        bundlePins.push({
          publisher: "lincei",
          bundleVersion: linceiBundle.descriptor.bundleVersion,
          bundleDigest: linceiBundle.descriptor.contentDigest,
        });
      }
      if (state.m4Manifest && skillIds.some((id) => id.startsWith("m4:"))) {
        bundlePins.push({
          publisher: "m4",
          bundleVersion: state.m4Manifest.packageVersion,
          bundleDigest: state.m4Manifest.bundleDigest,
        });
      }
      return {
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
        ...(input.workflowVersion !== undefined ? { workflowVersion: input.workflowVersion } : {}),
        bundlePins,
        skillIds,
      };
    });

  const getPinnedRuntimeSkills: SkillCatalogServiceShape["getPinnedRuntimeSkills"] = (selection) =>
    Effect.gen(function* () {
      const state = yield* getState;
      const m4Pin = selection.bundlePins.find((pin) => pin.publisher === "m4");
      let runtimeSkills = m4Pin
        ? state.runtimeSkills
        : state.runtimeSkills.filter((skill) => skill.descriptor.publisher !== "m4");
      if (
        m4Pin &&
        (state.m4Manifest?.packageVersion !== m4Pin.bundleVersion ||
          state.m4Manifest.bundleDigest !== m4Pin.bundleDigest)
      ) {
        const bundleRoot = path.join(
          m4Root,
          requireSafeSegment(m4Pin.bundleVersion, "pinned M4 package version"),
          bundleDigestSegment(m4Pin.bundleDigest),
        );
        const pinned = yield* Effect.tryPromise({
          try: () => readVerifiedM4Bundle(bundleRoot),
          catch: toSkillCatalogRefreshError,
        }).pipe(Effect.option);
        if (pinned._tag === "Some") {
          const settings = yield* settingsService.getSettings.pipe(
            Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
          );
          runtimeSkills = applySettings(
            [
              ...linceiRuntimeSkills(settings.linceiSkills),
              ...m4RuntimeSkills({
                bundleRoot,
                manifest: pinned.value.manifest,
                bodies: pinned.value.bodies,
                stale: true,
              }),
            ],
            settings.linceiSkills,
          );
        } else {
          runtimeSkills = runtimeSkills.filter((skill) => skill.descriptor.publisher !== "m4");
          yield* Effect.logWarning("pinned M4 skill bundle is unavailable", {
            bundleVersion: m4Pin.bundleVersion,
            bundleDigest: m4Pin.bundleDigest,
          });
        }
      }
      const selected = new Set(selection.skillIds);
      return runtimeSkills.filter(
        (skill) => selected.has(skill.descriptor.id) && skill.canonical.enabled,
      );
    });

  const getProviderDelivery: SkillCatalogServiceShape["getProviderDelivery"] = (
    providerInstanceId,
    skillId,
  ) =>
    Effect.map(Ref.get(deliveryRef), (delivery) => delivery.get(providerInstanceId)?.get(skillId));

  return SkillCatalogService.of({
    getSnapshot,
    refresh,
    reconcileProvider,
    pinSession,
    getPinnedRuntimeSkills,
    getProviderDelivery,
  });
});

export const layer = Layer.effect(SkillCatalogService, makeSkillCatalogService);
