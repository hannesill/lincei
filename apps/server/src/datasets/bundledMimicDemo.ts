// @effect-diagnostics nodeBuiltinImport:off - Bundled dataset archives are verified and unpacked with Node stdlib.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";
import { promisify } from "node:util";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { DatasetRpcError, type DatasetStatusResult } from "@t3tools/contracts";

const gunzip = promisify(NodeZlib.gunzip);

const BUNDLED_DEMO_DATASET_ID = "mimic-iv-demo";
const BUNDLED_DEMO_MANIFEST_FILE = "mimic-iv-demo.asset.json";
const SENTINEL_DIR = ".lincei-bundled-datasets";
const SENTINEL_FILE = "mimic-iv-demo.json";

const HexSha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

export const BundledMimicDemoAssetManifest = Schema.Struct({
  assetId: Schema.Literal("mimic-iv-demo"),
  datasetId: Schema.Literal("mimic-iv-demo"),
  sourceName: Schema.String,
  sourceVersion: Schema.String,
  sourceUrl: Schema.String,
  license: Schema.String,
  archiveFile: Schema.String,
  archiveSha256: HexSha256,
  assetVersion: Schema.String,
  createdAt: Schema.String,
  rootEntries: Schema.Array(Schema.String),
});
export type BundledMimicDemoAssetManifest = typeof BundledMimicDemoAssetManifest.Type;

const BundledMimicDemoSentinel = Schema.Struct({
  assetId: Schema.Literal("mimic-iv-demo"),
  datasetId: Schema.Literal("mimic-iv-demo"),
  sourceVersion: Schema.String,
  assetVersion: Schema.String,
  archiveSha256: HexSha256,
  seededAt: Schema.String,
  rootEntries: Schema.Array(Schema.String),
});
type BundledMimicDemoSentinel = typeof BundledMimicDemoSentinel.Type;

const decodeManifestJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(BundledMimicDemoAssetManifest),
);
const decodeSentinelJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(BundledMimicDemoSentinel),
);
const encodeSentinelJson = Schema.encodeEffect(Schema.fromJsonString(BundledMimicDemoSentinel));

export interface BundledMimicDemoAsset {
  readonly manifest: BundledMimicDemoAssetManifest;
  readonly manifestPath: string;
  readonly archivePath: string;
}

function bundledDatasetError(detail: string): DatasetRpcError {
  return new DatasetRpcError({
    code: "dataset_initialization_failed",
    detail,
    actionableMessage: "Lincei could not seed the bundled MIMIC-IV Demo dataset.",
  });
}

function invalidAssetError(detail: string): DatasetRpcError {
  return new DatasetRpcError({
    code: "settings_error",
    detail,
    actionableMessage: "The bundled MIMIC-IV Demo asset is invalid or incomplete.",
  });
}

function normalizeRootEntry(entry: string): string | null {
  const normalized = entry.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("..") ||
    NodePath.isAbsolute(entry)
  ) {
    return null;
  }
  return normalized;
}

function shouldSeedDemo(status: DatasetStatusResult, sentinel: BundledMimicDemoSentinel | null) {
  const demo = status.datasets.find(
    (dataset) => dataset.datasetId === BUNDLED_DEMO_DATASET_ID && dataset.backendId === "duckdb",
  );
  if (sentinel !== null) {
    return true;
  }
  return demo?.readiness !== "ready" || demo.initialized !== true;
}

function markBundled(status: DatasetStatusResult, bundled: boolean): DatasetStatusResult {
  if (!bundled) {
    return status;
  }
  return {
    ...status,
    datasets: status.datasets.map((dataset) =>
      dataset.datasetId === BUNDLED_DEMO_DATASET_ID && dataset.backendId === "duckdb"
        ? { ...dataset, bundled: true }
        : dataset,
    ),
  };
}

function readUInt64Octal(buffer: Buffer, offset: number, length: number): number {
  const raw = readTarString(buffer, offset, length).trim();
  if (!raw) return 0;
  const value = Number.parseInt(raw, 8);
  return Number.isFinite(value) ? value : 0;
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  const value = buffer.subarray(offset, offset + length).toString("utf8");
  const nullIndex = value.indexOf(String.fromCharCode(0));
  return nullIndex === -1 ? value : value.slice(0, nullIndex);
}

function assertSafeArchivePath(name: string): string {
  const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || NodePath.isAbsolute(name)) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return normalized;
}

async function extractTarGz(archivePath: string, targetDir: string) {
  const compressed = await NodeFS.readFile(archivePath);
  const tar = await gunzip(compressed);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const pathName = assertSafeArchivePath(prefix ? `${prefix}/${name}` : name);
    const size = readUInt64Octal(header, 124, 12);
    const typeFlag = readTarString(header, 156, 1) || "0";
    const destination = NodePath.join(targetDir, pathName);

    if (typeFlag === "5") {
      await NodeFS.mkdir(destination, { recursive: true });
    } else if (typeFlag === "0" || typeFlag === "") {
      await NodeFS.mkdir(NodePath.dirname(destination), { recursive: true });
      await NodeFS.writeFile(destination, tar.subarray(offset + 512, offset + 512 + size));
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  const bytes = await NodeFS.readFile(filePath);
  hash.update(bytes);
  return hash.digest("hex");
}

export const discoverBundledMimicDemoAsset = Effect.fn("datasets.bundledMimicDemo.discover")(
  function* (
    bundledDatasetsDir: string | undefined,
  ): Effect.fn.Return<
    BundledMimicDemoAsset | null,
    DatasetRpcError,
    FileSystem.FileSystem | Path.Path
  > {
    if (!bundledDatasetsDir?.trim()) {
      return null;
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifestPath = path.join(bundledDatasetsDir, BUNDLED_DEMO_MANIFEST_FILE);
    const manifestExists = yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false));
    if (!manifestExists) {
      return null;
    }

    const manifest = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((error) => invalidAssetError(`Could not read ${manifestPath}: ${error}`)),
      Effect.flatMap((raw) =>
        decodeManifestJson(raw).pipe(
          Effect.mapError((error) =>
            invalidAssetError(`Could not decode ${manifestPath}: ${error.message}`),
          ),
        ),
      ),
    );
    const archivePath = path.join(bundledDatasetsDir, manifest.archiveFile);
    const archiveExists = yield* fs.exists(archivePath).pipe(Effect.orElseSucceed(() => false));
    if (!archiveExists) {
      return yield* invalidAssetError(`Missing bundled dataset archive at ${archivePath}.`);
    }
    const actualSha256 = yield* Effect.tryPromise({
      try: () => sha256File(archivePath),
      catch: (error) =>
        invalidAssetError(
          `Could not hash bundled dataset archive ${archivePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    if (actualSha256 !== manifest.archiveSha256) {
      return yield* invalidAssetError(
        `Bundled dataset archive checksum mismatch for ${archivePath}.`,
      );
    }

    return { manifest, manifestPath, archivePath };
  },
);

const readSentinel = Effect.fn("datasets.bundledMimicDemo.readSentinel")(function* (
  sentinelPath: string,
): Effect.fn.Return<BundledMimicDemoSentinel | null, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(sentinelPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return null;
  return yield* fs.readFileString(sentinelPath).pipe(
    Effect.flatMap((raw) => decodeSentinelJson(raw)),
    Effect.option,
    Effect.map((option) => (option._tag === "Some" ? option.value : null)),
  );
});

const removeManagedEntries = Effect.fn("datasets.bundledMimicDemo.removeManagedEntries")(function* (
  workspacePath: string,
  entries: ReadonlyArray<string>,
): Effect.fn.Return<void, DatasetRpcError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of entries) {
    const normalized = normalizeRootEntry(entry);
    if (!normalized) continue;
    yield* fs
      .remove(path.join(workspacePath, normalized), { recursive: true, force: true })
      .pipe(
        Effect.mapError((error) =>
          bundledDatasetError(`Could not remove old bundled dataset entry ${entry}: ${error}`),
        ),
      );
  }
});

export const seedBundledMimicDemo = Effect.fn("datasets.bundledMimicDemo.seed")(function* (input: {
  readonly workspacePath: string;
  readonly asset: BundledMimicDemoAsset;
  readonly currentStatus: DatasetStatusResult;
}): Effect.fn.Return<boolean, DatasetRpcError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sentinelDir = path.join(input.workspacePath, SENTINEL_DIR);
  const sentinelPath = path.join(sentinelDir, SENTINEL_FILE);
  const sentinel = yield* readSentinel(sentinelPath);
  const isCurrentBundledCopy =
    sentinel?.assetVersion === input.asset.manifest.assetVersion &&
    sentinel.archiveSha256 === input.asset.manifest.archiveSha256;
  if (isCurrentBundledCopy) {
    return false;
  }
  if (!shouldSeedDemo(input.currentStatus, sentinel)) {
    return false;
  }

  const rootEntries = input.asset.manifest.rootEntries.map(normalizeRootEntry);
  if (rootEntries.some((entry) => entry === null)) {
    return yield* invalidAssetError("Bundled dataset manifest contains unsafe root entries.");
  }

  const tempDir = yield* fs
    .makeTempDirectory({ prefix: "lincei-mimic-demo-seed-" })
    .pipe(
      Effect.mapError((error) =>
        bundledDatasetError(`Could not create temporary extraction directory: ${error}`),
      ),
    );
  yield* Effect.tryPromise({
    try: () => extractTarGz(input.asset.archivePath, tempDir),
    catch: (error) =>
      bundledDatasetError(
        `Could not extract bundled MIMIC-IV Demo asset: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  });

  if (sentinel !== null) {
    yield* removeManagedEntries(input.workspacePath, sentinel.rootEntries);
  }

  for (const entry of rootEntries) {
    if (!entry) continue;
    const from = path.join(tempDir, entry);
    const to = path.join(input.workspacePath, entry);
    const exists = yield* fs.exists(from).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return yield* invalidAssetError(`Bundled dataset archive is missing ${entry}.`);
    }
    yield* fs
      .copy(from, to)
      .pipe(
        Effect.mapError((error) =>
          bundledDatasetError(`Could not copy bundled dataset entry ${entry}: ${error}`),
        ),
      );
  }

  const seededAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const sentinelJson = yield* encodeSentinelJson({
    assetId: "mimic-iv-demo",
    datasetId: "mimic-iv-demo",
    sourceVersion: input.asset.manifest.sourceVersion,
    assetVersion: input.asset.manifest.assetVersion,
    archiveSha256: input.asset.manifest.archiveSha256,
    seededAt,
    rootEntries: rootEntries.filter((entry): entry is string => entry !== null),
  }).pipe(
    Effect.mapError((error) =>
      bundledDatasetError(`Could not encode bundled dataset sentinel: ${error.message}`),
    ),
  );
  yield* fs
    .makeDirectory(sentinelDir, { recursive: true })
    .pipe(
      Effect.mapError((error) =>
        bundledDatasetError(`Could not create bundled dataset sentinel directory: ${error}`),
      ),
    );
  yield* fs
    .writeFileString(sentinelPath, `${sentinelJson}\n`)
    .pipe(
      Effect.mapError((error) =>
        bundledDatasetError(`Could not write bundled dataset sentinel: ${error}`),
      ),
    );
  yield* fs.remove(tempDir, { recursive: true, force: true }).pipe(Effect.ignore);
  return true;
});

export const markBundledMimicDemoFromSentinel = Effect.fn(
  "datasets.bundledMimicDemo.markFromSentinel",
)(function* (
  workspacePath: string,
  status: DatasetStatusResult,
): Effect.fn.Return<DatasetStatusResult, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const sentinel = yield* readSentinel(path.join(workspacePath, SENTINEL_DIR, SENTINEL_FILE));
  return markBundled(status, sentinel !== null);
});
