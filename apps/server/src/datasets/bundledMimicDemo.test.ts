// @effect-diagnostics nodeBuiltinImport:off - Test fixtures build tiny tar archives with Node stdlib.

import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { DatasetStatusResult } from "@t3tools/contracts";

import {
  discoverBundledMimicDemoAsset,
  markBundledMimicDemoFromSentinel,
  seedBundledMimicDemo,
} from "./bundledMimicDemo.ts";

const gzip = promisify(NodeZlib.gzip);

function statusResult(
  readiness: "ready" | "not_initialized" = "not_initialized",
): DatasetStatusResult {
  return {
    runtime: {
      available: true,
      command: "uvx --from 'm4-infra>=0.5.4,<0.6' m4",
      checkedAt: "2026-05-31T00:00:00.000Z",
    },
    credentials: {
      physioNet: { stored: false },
      bigQuery: {
        stored: false,
        serviceAccountJsonStored: false,
        applicationDefaultCredentials: false,
      },
    },
    datasets: [
      {
        datasetId: "mimic-iv-demo",
        backendId: "duckdb",
        readiness,
        initialized: readiness === "ready",
        tables: [],
        lastCheckedAt: "2026-05-31T00:00:00.000Z",
      },
    ],
    appReadiness: {
      selectedDatasetId: "mimic-iv-demo",
      selectedBackendId: "duckdb",
      readiness,
      clinicalDataReady: readiness === "ready",
      lastCheckedAt: "2026-05-31T00:00:00.000Z",
    },
  };
}

function writeOctal(value: number, width: number): Buffer {
  const output = Buffer.alloc(width, 0);
  output.write(value.toString(8).padStart(width - 1, "0"), 0, "ascii");
  return output;
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name).copy(header, 0);
  writeOctal(0o644, 8).copy(header, 100);
  writeOctal(0, 8).copy(header, 108);
  writeOctal(0, 8).copy(header, 116);
  writeOctal(size, 12).copy(header, 124);
  writeOctal(0, 12).copy(header, 136);
  header.fill(" ", 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar", 257, "ascii");
  header.write("00", 263, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(checksum, 8).copy(header, 148);
  header[155] = 0x20;
  return header;
}

async function makeArchive(files: Record<string, string>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents);
    chunks.push(tarHeader(name, bytes.length), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzip(Buffer.concat(chunks));
}

const makeAsset = Effect.fn("test.makeBundledAsset")(function* (
  files: Record<string, string>,
  assetVersion = "mimic-iv-demo-2.2-test",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-bundled-demo-asset-" });
  const archive = yield* Effect.promise(() => makeArchive({ ".m4/state.json": "{}", ...files }));
  const archiveSha256 = NodeCrypto.createHash("sha256").update(archive).digest("hex");
  yield* fs.writeFile(path.join(dir, "mimic-iv-demo.tar.gz"), archive);
  yield* fs.writeFileString(
    path.join(dir, "mimic-iv-demo.asset.json"),
    // @effect-diagnostics-next-line preferSchemaOverJson:off - Small test manifest fixture.
    JSON.stringify({
      assetId: "mimic-iv-demo",
      datasetId: "mimic-iv-demo",
      sourceName: "MIMIC-IV Clinical Database Demo",
      sourceVersion: "2.2",
      sourceUrl: "https://physionet.org/content/mimic-iv-demo/2.2/",
      license: "Open Data Commons Open Database License v1.0",
      archiveFile: "mimic-iv-demo.tar.gz",
      archiveSha256,
      assetVersion,
      createdAt: "2026-05-31T00:00:00.000Z",
      rootEntries: ["hosp", ".m4"],
    }),
  );
  const asset = yield* discoverBundledMimicDemoAsset(dir);
  if (asset === null) {
    return yield* Effect.die("expected test asset");
  }
  return asset;
});

describe("bundled MIMIC-IV Demo seeding", () => {
  it.layer(NodeServices.layer)("extracts a bundled asset on first status access", (it) => {
    it.effect("seeds missing demo data and marks the snapshot as bundled", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-demo-workspace-" });
        const asset = yield* makeAsset({
          "hosp/patients.csv": "subject_id\n10000032\n",
          ".m4/state.json": "{}",
        });

        const seeded = yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset,
          currentStatus: statusResult(),
        });
        const marked = yield* markBundledMimicDemoFromSentinel(workspace, statusResult("ready"));

        assert.equal(seeded, true);
        assert.equal(
          yield* fs.readFileString(path.join(workspace, "hosp/patients.csv")),
          "subject_id\n10000032\n",
        );
        expect(marked.datasets[0]).toEqual(expect.objectContaining({ bundled: true }));
      }),
    );

    it.effect("does not extract again when the current sentinel is present", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-demo-workspace-" });
        const asset = yield* makeAsset({ "hosp/patients.csv": "first\n" });

        yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset,
          currentStatus: statusResult(),
        });
        yield* fs.writeFileString(path.join(workspace, "hosp/patients.csv"), "user-edit\n");
        const seededAgain = yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset,
          currentStatus: statusResult("ready"),
        });

        assert.equal(seededAgain, false);
        assert.equal(
          yield* fs.readFileString(path.join(workspace, "hosp/patients.csv")),
          "user-edit\n",
        );
      }),
    );

    it.effect("replaces an older bundled sentinel copy", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-demo-workspace-" });
        const oldAsset = yield* makeAsset({ "hosp/patients.csv": "old\n" }, "old");
        const newAsset = yield* makeAsset({ "hosp/patients.csv": "new\n" }, "new");

        yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset: oldAsset,
          currentStatus: statusResult(),
        });
        const replaced = yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset: newAsset,
          currentStatus: statusResult("ready"),
        });

        assert.equal(replaced, true);
        assert.equal(yield* fs.readFileString(path.join(workspace, "hosp/patients.csv")), "new\n");
      }),
    );

    it.effect("preserves user-managed ready demo data without a Lincei sentinel", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-demo-workspace-" });
        const asset = yield* makeAsset({ "hosp/patients.csv": "bundled\n" });
        yield* fs.makeDirectory(path.join(workspace, "hosp"), { recursive: true });
        yield* fs.writeFileString(path.join(workspace, "hosp/patients.csv"), "user\n");

        const seeded = yield* seedBundledMimicDemo({
          workspacePath: workspace,
          asset,
          currentStatus: statusResult("ready"),
        });

        assert.equal(seeded, false);
        assert.equal(yield* fs.readFileString(path.join(workspace, "hosp/patients.csv")), "user\n");
      }),
    );
  });
});
