#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Asset preparation streams and archives local files with Node stdlib.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodeHTTPS from "node:https";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";
import { promisify } from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const gzip = promisify(NodeZlib.gzip);
const SOURCE_BASE_URL = "https://physionet.org/files/mimic-iv-demo/2.2/";
const SOURCE_CONTENT_URL = "https://physionet.org/content/mimic-iv-demo/2.2/";
const DEFAULT_OUTPUT_DIR = "assets/datasets/mimic-iv-demo";
const ARCHIVE_FILE = "mimic-iv-demo.tar.gz";
const MANIFEST_FILE = "mimic-iv-demo.asset.json";
const M4_COMMAND = process.env.LINCEI_M4_COMMAND?.trim() || "uvx --from 'm4-infra>=0.5.4,<0.6' m4";

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

class PrepareAssetError extends Data.TaggedError("PrepareAssetError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function prepareAssetError(message: string, cause?: unknown): PrepareAssetError {
  return new PrepareAssetError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function throwPrepareAssetError(message: string): never {
  throw prepareAssetError(message);
}

function unknownToPrepareAssetError(message: string) {
  return (cause: unknown) => {
    if (cause instanceof PrepareAssetError) {
      return cause;
    }
    return prepareAssetError(message, cause);
  };
}

interface SourceFile {
  readonly path: string;
  readonly sha256: string;
}

function splitCommand(command: string): ReadonlyArray<string> {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

async function download(url: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    NodeHTTPS.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        download(new URL(response.headers.location, url).href).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(prepareAssetError(`Download failed for ${url}: HTTP ${response.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

function sha256(bytes: Buffer): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256(await NodeFS.readFile(filePath));
}

function parseChecksums(raw: string): ReadonlyArray<SourceFile> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-f0-9]{64})\s+(.+)$/i.exec(line);
      if (!match?.[1] || !match[2]) {
        throwPrepareAssetError(`Invalid SHA256SUMS line: ${line}`);
      }
      const filePath = match[2].trim();
      if (filePath.includes("..") || NodePath.isAbsolute(filePath)) {
        throwPrepareAssetError(`Unsafe source file path in SHA256SUMS: ${filePath}`);
      }
      return { sha256: match[1].toLowerCase(), path: filePath };
    });
}

async function downloadAndVerifySource(workspaceDir: string): Promise<ReadonlyArray<SourceFile>> {
  const checksums = await download(new URL("SHA256SUMS.txt", SOURCE_BASE_URL).href);
  const files = parseChecksums(checksums.toString("utf8"));
  await NodeFS.writeFile(NodePath.join(workspaceDir, "SHA256SUMS.txt"), checksums);
  for (const file of files) {
    const bytes = await download(new URL(file.path, SOURCE_BASE_URL).href);
    const actual = sha256(bytes);
    if (actual !== file.sha256) {
      throwPrepareAssetError(`Checksum mismatch for ${file.path}.`);
    }
    const destination = NodePath.join(workspaceDir, file.path);
    await NodeFS.mkdir(NodePath.dirname(destination), { recursive: true });
    await NodeFS.writeFile(destination, bytes);
  }
  return files;
}

function writeOctal(value: number, width: number): Buffer {
  const output = Buffer.alloc(width, 0);
  const text = value.toString(8).padStart(width - 1, "0");
  output.write(text, 0, "ascii");
  return output;
}

function tarHeader(input: {
  readonly name: string;
  readonly size: number;
  readonly mode: number;
  readonly type: "0" | "5";
  readonly mtime: number;
}): Buffer {
  const header = Buffer.alloc(512, 0);
  const normalizedName = input.name.replaceAll("\\", "/");
  const nameBytes = Buffer.from(normalizedName);
  if (nameBytes.length > 100) {
    throwPrepareAssetError(`Tar path is too long: ${normalizedName}`);
  }
  nameBytes.copy(header, 0);
  writeOctal(input.mode, 8).copy(header, 100);
  writeOctal(0, 8).copy(header, 108);
  writeOctal(0, 8).copy(header, 116);
  writeOctal(input.size, 12).copy(header, 124);
  writeOctal(input.mtime, 12).copy(header, 136);
  header.fill(" ", 148, 156);
  header.write(input.type, 156, "ascii");
  header.write("ustar", 257, "ascii");
  header.write("00", 263, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(checksum, 8).copy(header, 148);
  header[155] = 0x20;
  return header;
}

async function listFiles(root: string): Promise<ReadonlyArray<string>> {
  const out: string[] = [];
  async function walk(current: string) {
    const entries = await NodeFS.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = NodePath.join(current, entry.name);
      const relative = NodePath.relative(root, absolute).replaceAll(NodePath.sep, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        out.push(relative);
      }
    }
  }
  await walk(root);
  return out.toSorted();
}

async function createTarGz(sourceDir: string, archivePath: string): Promise<ReadonlyArray<string>> {
  const files = await listFiles(sourceDir);
  const chunks: Buffer[] = [];
  for (const file of files) {
    const absolute = NodePath.join(sourceDir, file);
    const stat = await NodeFS.stat(absolute);
    const content = await NodeFS.readFile(absolute);
    chunks.push(
      tarHeader({
        name: file,
        size: content.length,
        mode: 0o644,
        type: "0",
        mtime: Math.floor(stat.mtimeMs / 1000),
      }),
      content,
    );
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const compressed = await gzip(Buffer.concat(chunks), { level: 9 });
  await NodeFS.writeFile(archivePath, compressed);
  return [
    ...new Set(
      files
        .map((file) => file.split("/")[0])
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ].toSorted();
}

const runCommand = Effect.fn("prepareMimicDemoAsset.runCommand")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      shell: process.platform === "win32",
    }),
  );
  const exitCode = yield* child.exitCode;
  if (exitCode !== 0) {
    return yield* prepareAssetError(`${[command, ...args].join(" ")} exited with ${exitCode}.`);
  }
});

const prepareAsset = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const outputDir = path.resolve(
    repoRoot,
    process.env.LINCEI_MIMIC_IV_DEMO_ASSET_DIR ?? DEFAULT_OUTPUT_DIR,
  );
  const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-mimic-demo-asset-" });
  const workspaceDir = path.join(tempRoot, "workspace");
  yield* fs.makeDirectory(workspaceDir, { recursive: true });

  yield* Effect.log("[mimic-demo-asset] Downloading and verifying PhysioNet source files...");
  yield* Effect.tryPromise({
    try: () => downloadAndVerifySource(workspaceDir),
    catch: unknownToPrepareAssetError("Could not download and verify PhysioNet source files."),
  });

  const [m4Command, ...m4PrefixArgs] = splitCommand(M4_COMMAND);
  if (!m4Command) {
    return yield* prepareAssetError("LINCEI_M4_COMMAND resolved to no command.");
  }

  yield* Effect.log("[mimic-demo-asset] Initializing M4 workspace...");
  yield* runCommand(
    m4Command,
    [...m4PrefixArgs, "init", "mimic-iv-demo", "--json", "--events", "ndjson", "--no-interactive"],
    workspaceDir,
  );

  yield* fs.makeDirectory(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, ARCHIVE_FILE);
  const rootEntries = yield* Effect.tryPromise({
    try: () => createTarGz(workspaceDir, archivePath),
    catch: unknownToPrepareAssetError("Could not create bundled MIMIC-IV Demo archive."),
  });
  const archiveSha256 = yield* Effect.tryPromise({
    try: () => sha256File(archivePath),
    catch: unknownToPrepareAssetError("Could not hash bundled MIMIC-IV Demo archive."),
  });
  const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const manifestJson = yield* encodeJsonString({
    assetId: "mimic-iv-demo",
    datasetId: "mimic-iv-demo",
    sourceName: "MIMIC-IV Clinical Database Demo",
    sourceVersion: "2.2",
    sourceUrl: SOURCE_CONTENT_URL,
    license: "Open Data Commons Open Database License v1.0",
    archiveFile: ARCHIVE_FILE,
    archiveSha256,
    assetVersion: `mimic-iv-demo-2.2-${archiveSha256.slice(0, 12)}`,
    createdAt,
    rootEntries,
  });
  yield* fs.writeFileString(path.join(outputDir, MANIFEST_FILE), `${manifestJson}\n`);
  yield* Effect.log(`[mimic-demo-asset] Wrote ${archivePath}`);
});

const runtimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

if (import.meta.main) {
  prepareAsset.pipe(Effect.scoped, Effect.provide(runtimeLayer), NodeRuntime.runMain);
}
