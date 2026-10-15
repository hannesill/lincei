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
const releaseOf = (archive: Uint8Array): UvInstallation.UvRelease => ({
  url: "https://example.test/uv-release",
  sha256: NodeCrypto.createHash("sha256").update(archive).digest("hex"),
  archiveBytes: archive.byteLength,
});
const RELEASE = releaseOf(ARCHIVE);

/** A zip laid out like uv's Windows releases: `uv.exe` and `uvx.exe` at its root. */
const WINDOWS_ZIP = Uint8Array.from(
  atob(
    "UEsDBAoAAAAAAGWaT104dZL/DAAAAAwAAAAGAAAAdXYuZXhlYSBwcmV0ZW5kIHV2UEsDBAoAAAAAAGWaT12DFtyMAQAAAAEAAAAHAAAAdXZ4LmV4ZXhQSwECHgMKAAAAAABlmk9dOHWS/wwAAAAMAAAABgAAAAAAAAABAAAApIEAAAAAdXYuZXhlUEsBAh4DCgAAAAAAZZpPXYMW3IwBAAAAAQAAAAcAAAAAAAAAAQAAAKSBMAAAAHV2eC5leGVQSwUGAAAAAAIAAgBpAAAAVgAAAAAA",
  ),
  (character) => character.charCodeAt(0),
);

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

const isTar = (command: string) => /(?:^|[\\/])tar(?:\.exe)?$/.test(command);

/**
 * Runs `ensure` on a machine described by `input`: its kind, whether uv is on
 * PATH, and which release the download is checked against. `tar` unpacks a
 * working uv, and a uv binary answers `--version` once it exists on disk.
 */
const ensureOn = (input: {
  readonly uvOnPath: boolean;
  /** Replaces the release pinned for the machine; `"pinned"` keeps it. */
  readonly release?: UvInstallation.UvRelease | "pinned";
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = input.platform ?? "darwin";
    const uvName = platform === "win32" ? "uv.exe" : "uv";
    const managedDirectory = path.join(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-uv-test-" }),
      "bin",
    );
    const commands: Array<string> = [];
    const unpacked: Array<ProcessRunner.ProcessRunInput> = [];
    const downloaded: Array<string> = [];

    const processRunner = ProcessRunner.ProcessRunner.of({
      run: (run) =>
        Effect.gen(function* () {
          if (isTar(run.command)) {
            commands.push("tar");
            unpacked.push(run);
            const staging = run.args[run.args.indexOf("-C") + 1] ?? "";
            yield* fileSystem.writeFileString(path.join(staging, uvName), "").pipe(Effect.orDie);
            return exited(0);
          }
          commands.push(run.command === "uv" ? "uv" : "managed-uv");
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
        downloaded.push(request.url);
        return HttpClientResponse.fromWeb(request, new Response(ARCHIVE));
      }),
    );

    const release = input.release ?? RELEASE;
    const result = yield* UvInstallation.ensure({
      managedDirectory,
      ...(release === "pinned" ? {} : { release }),
    }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.result,
    );
    return {
      result,
      commands,
      unpacked,
      downloaded,
      managedUv: path.join(managedDirectory, uvName),
      leftovers: yield* fileSystem
        .readDirectory(managedDirectory)
        .pipe(Effect.orElseSucceed((): Array<string> => [])),
    };
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcessPlatform, input.platform ?? "darwin"),
        Layer.succeed(HostProcessArchitecture, input.arch ?? "arm64"),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

describe("UvInstallation", () => {
  it.effect("uses the uv already on PATH without downloading anything", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({ uvOnPath: true });
      expect(machine.result).toMatchObject({ _tag: "Success", success: "uv" });
      expect(machine.downloaded).toEqual([]);
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
        failure: {
          reason: "verification",
          // For the researcher: what happened and what to do. For whoever helps: the rest.
          message: expect.stringContaining("so nothing was installed. Try again"),
          detail: expect.stringContaining("SHA-256"),
        },
      });
      expect(machine.commands).not.toContain("tar");
      expect(machine.leftovers).toEqual([]);
    }),
  );

  it.effect("unpacks the Windows zip with Windows' own tar, not whichever is on PATH", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({ uvOnPath: false, platform: "win32", arch: "x64" });
      expect(machine.result).toMatchObject({ _tag: "Success", success: machine.managedUv });
      expect(machine.commands).toEqual(["uv", "managed-uv", "tar"]);
      const [tar] = machine.unpacked;
      expect(tar?.command).toMatch(/[\\/]System32[\\/]tar\.exe$/);
      // The zip has no top-level folder to strip, and is not gzipped.
      expect(tar?.args.slice(0, 2)).toEqual(["-xf", expect.stringMatching(/uv\.zip$/)]);
      expect(tar?.args).not.toContain("--strip-components=1");
      expect(machine.leftovers).toEqual(["uv.exe"]);
    }),
  );

  it.effect("has a pinned uv for Windows PCs, on x64 and on ARM", () =>
    Effect.gen(function* () {
      for (const [arch, target] of [
        ["x64", "x86_64-pc-windows-msvc"],
        ["arm64", "aarch64-pc-windows-msvc"],
      ] as const) {
        const machine = yield* ensureOn({
          uvOnPath: false,
          release: "pinned",
          platform: "win32",
          arch,
        });
        expect(machine.downloaded).toEqual([
          expect.stringMatching(new RegExp(`/uv-${target}\\.zip$`)),
        ]);
        // The pretend archive is not the release that was pinned.
        expect(machine.result).toMatchObject({
          _tag: "Failure",
          failure: { reason: "verification" },
        });
      }
    }),
  );

  it.effect("does not send a researcher off to install uv where Lincei has none to fetch", () =>
    Effect.gen(function* () {
      const machine = yield* ensureOn({ uvOnPath: false, release: "pinned", platform: "freebsd" });
      expect(machine.result).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: "unsupported-platform",
          message:
            "Lincei cannot install the clinical research tools on this kind of computer yet. It can on a Mac, on a Windows PC, and on most Linux computers.",
        },
      });
      expect(machine.downloaded).toEqual([]);
    }),
  );

  // Only a Windows host has the tar.exe a Windows PC unpacks uv with.
  it.effect.skipIf(process.platform !== "win32")(
    "unpacks a real Windows zip with the system's tar",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const managedDirectory = path.join(
          yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-uv-zip-" }),
          "bin",
        );
        // No uv on PATH, whatever the runner has installed. Windows' tar is
        // run by its full path and needs none.
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const saved = process.env.PATH;
            process.env.PATH = "";
            return saved;
          }),
          (saved) =>
            Effect.sync(() => {
              process.env.PATH = saved;
            }),
        );
        const managed = yield* UvInstallation.ensure({
          managedDirectory,
          release: releaseOf(WINDOWS_ZIP),
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, new Response(WINDOWS_ZIP))),
            ),
          ),
        );
        expect(managed).toBe(path.join(managedDirectory, "uv.exe"));
        expect(yield* fileSystem.readFileString(managed)).toBe("a pretend uv");
        expect(yield* fileSystem.readDirectory(managedDirectory)).toEqual(["uv.exe"]);
      }).pipe(
        Effect.scoped,
        Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
  );
});
