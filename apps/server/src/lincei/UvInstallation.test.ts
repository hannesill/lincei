// @effect-diagnostics nodeBuiltinImport:off - The test needs the digest of the archive it serves.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import * as NodeCrypto from "node:crypto";

import * as ProcessRunner from "../processRunner.ts";
import * as UvInstallation from "./UvInstallation.ts";

const ARCHIVE = new TextEncoder().encode("a pretend uv release archive");
const RELEASE: UvInstallation.UvRelease = {
  url: "https://example.test/uv.tar.gz",
  sha256: NodeCrypto.createHash("sha256").update(ARCHIVE).digest("hex"),
  archiveBytes: ARCHIVE.byteLength,
};

const exited = (code: number): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr: "",
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/**
 * Runs `ensure` on a machine described by `input`: whether uv is on PATH, and
 * which release the download is checked against. `tar` unpacks a working uv,
 * and a uv binary answers `--version` once it exists on disk.
 */
const ensureOn = (input: {
  readonly uvOnPath: boolean;
  readonly release?: UvInstallation.UvRelease;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const managedDirectory = path.join(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-uv-test-" }),
      "bin",
    );
    const commands: Array<string> = [];
    let downloads = 0;

    const processRunner = ProcessRunner.ProcessRunner.of({
      run: (run) =>
        Effect.gen(function* () {
          commands.push(run.command === "uv" || run.command === "tar" ? run.command : "managed-uv");
          if (run.command === "tar") {
            const staging = run.args[run.args.indexOf("-C") + 1] ?? "";
            yield* fileSystem.writeFileString(path.join(staging, "uv"), "").pipe(Effect.orDie);
            return exited(0);
          }
          const present =
            run.command === "uv"
              ? input.uvOnPath
              : yield* fileSystem.exists(run.command).pipe(Effect.orDie);
          if (present) return exited(0);
          return yield* new ProcessRunner.ProcessSpawnError({
            command: run.command,
            argumentCount: run.args.length,
            cause: new Error("ENOENT"),
          });
        }),
    });
    const httpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        downloads++;
        return HttpClientResponse.fromWeb(request, new Response(ARCHIVE));
      }),
    );

    const result = yield* UvInstallation.ensure({
      managedDirectory,
      release: input.release ?? RELEASE,
    }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.result,
    );
    return {
      result,
      commands,
      managedUv: path.join(managedDirectory, "uv"),
      downloads: () => downloads,
      leftovers: yield* fileSystem
        .readDirectory(managedDirectory)
        .pipe(Effect.orElseSucceed((): Array<string> => [])),
    };
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcessPlatform, "darwin"),
        Layer.succeed(HostProcessArchitecture, "arm64"),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

describe("UvInstallation", () => {
  it.effect("uses the uv already on PATH without downloading anything", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({ uvOnPath: true });
      expect(machine.result).toMatchObject({ _tag: "Success", success: "uv" });
      expect(machine.downloads()).toBe(0);
    }),
  );

  it.effect("downloads its own uv when the machine has none", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({ uvOnPath: false });
      expect(machine.result).toMatchObject({ _tag: "Success", success: machine.managedUv });
      expect(machine.commands).toEqual(["uv", "managed-uv", "tar"]);
      // Only the binary stays behind: the archive and staging directory are gone.
      expect(machine.leftovers).toEqual(["uv"]);
    }),
  );

  it.effect("installs nothing when the download does not match the pinned digest", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({
        uvOnPath: false,
        release: { ...RELEASE, sha256: "0".repeat(64) },
      });
      expect(machine.result).toMatchObject({
        _tag: "Failure",
        failure: { detail: expect.stringContaining("SHA-256") },
      });
      expect(machine.commands).not.toContain("tar");
      expect(machine.leftovers).toEqual([]);
    }),
  );
});
