// @effect-diagnostics nodeBuiltinImport:off - Shim tests execute the generated local command.
import { spawn } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ensureLinceiCliShim, resolveLinceiCliEntrypoint } from "./linceiCliShim.ts";

const decodeStringArrayJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const runShim = (command: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv) =>
  Effect.promise<void>(
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
          env,
          stdio: "ignore",
          shell: process.platform === "win32",
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`Shim exited with code ${code ?? "unknown"}.`));
        });
      }),
  );

it.layer(NodeServices.layer)("ensureLinceiCliShim", (it) => {
  it.effect("creates an executable shim", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-shim-" });
      const cliEntrypoint = path.join(dir, "lincei.mjs");
      yield* fs.writeFileString(cliEntrypoint, "process.exit(0);\n");

      const shim = yield* ensureLinceiCliShim({
        binDir: path.join(dir, "bin"),
        cliEntrypoint,
      });

      assert.isTrue(yield* fs.exists(shim.shimPath));
      if (process.platform !== "win32") {
        const mode = (yield* fs.stat(shim.shimPath)).mode & 0o777;
        assert.equal(mode & 0o111, 0o111);
      }
    }),
  );

  it.effect("is idempotent when setup runs repeatedly", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-shim-" });
      const cliEntrypoint = path.join(dir, "lincei.mjs");
      yield* fs.writeFileString(cliEntrypoint, "process.exit(0);\n");

      const first = yield* ensureLinceiCliShim({
        binDir: path.join(dir, "bin"),
        cliEntrypoint,
      });
      const firstContents = yield* fs.readFileString(first.shimPath);
      const second = yield* ensureLinceiCliShim({
        binDir: path.join(dir, "bin"),
        cliEntrypoint,
      });
      const secondContents = yield* fs.readFileString(second.shimPath);

      assert.equal(second.shimPath, first.shimPath);
      assert.equal(secondContents, firstContents);
    }),
  );

  it.effect("handles paths with spaces safely", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "lincei-shim-" });
      const spacedDir = path.join(dir, "cli assets with spaces");
      const binDir = path.join(dir, "bin with spaces");
      const cliEntrypoint = path.join(spacedDir, "lincei cli.mjs");
      const outputPath = path.join(dir, "shim-output.json");

      yield* fs.makeDirectory(spacedDir, { recursive: true });
      yield* fs.writeFileString(
        cliEntrypoint,
        [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync(process.env.SHIM_OUTPUT_PATH, JSON.stringify(process.argv.slice(2)));",
          "",
        ].join("\n"),
      );

      const shim = yield* ensureLinceiCliShim({
        binDir,
        cliEntrypoint,
      });

      yield* runShim(shim.shimPath, ["alpha beta", "gamma"], {
        ...process.env,
        SHIM_OUTPUT_PATH: outputPath,
      });

      assert.deepStrictEqual(decodeStringArrayJson(yield* fs.readFileString(outputPath)), [
        "alpha beta",
        "gamma",
      ]);
    }),
  );
});

it("resolves the bundled CLI entrypoint from built server modules", () => {
  assert.equal(
    resolveLinceiCliEntrypoint("/tmp/lincei/apps/server/dist"),
    "/tmp/lincei/apps/server/dist/lincei.mjs",
  );
});
