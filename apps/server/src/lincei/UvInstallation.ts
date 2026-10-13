// @effect-diagnostics nodeBuiltinImport:off - Effect has no incremental digest.
/**
 * UvInstallation - finds or fetches uv, the tool Lincei builds its Python
 * environment with.
 *
 * A clinical researcher's machine rarely has uv, and sending them to a
 * terminal to install it defeats a setup that is meant to need no terminal. A
 * uv already on PATH is used as it is. Otherwise Lincei downloads the release
 * pinned below into its own home and checks it against the pinned digest
 * before running it.
 *
 * To adopt a newer uv, replace UV_VERSION and each size and digest. The
 * release lists them next to every asset:
 *
 *   gh api repos/astral-sh/uv/releases/tags/<version> \
 *     -q '.assets[] | "\(.name) \(.size) \(.digest)"'
 *
 * @module UvInstallation
 */
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as NodeCrypto from "node:crypto";

import * as ProcessRunner from "../processRunner.ts";

const UV_VERSION = "0.12.24";

export interface UvRelease {
  readonly url: string;
  readonly sha256: string;
  readonly archiveBytes: number;
}

const pinned = (target: string, archiveBytes: number, sha256: string): UvRelease => ({
  url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`,
  sha256,
  archiveBytes,
});

const RELEASES: Readonly<Record<string, UvRelease>> = {
  "darwin-arm64": pinned(
    "aarch64-apple-darwin",
    14650202,
    "0c4346de7abdb49495b393b9ec809fe387aa43e586be20fecb972216c1e71732",
  ),
  "darwin-x64": pinned(
    "x86_64-apple-darwin",
    18120254,
    "4fa82e37cb94767661f532b001e470b67a186c7260e305bd84ddb78fd545c0b6",
  ),
  "linux-arm64": pinned(
    "aarch64-unknown-linux-gnu",
    16478994,
    "5231be65f496304623895dacdbf1de8504fec90303684bdf05805aa34414dd21",
  ),
  "linux-x64": pinned(
    "x86_64-unknown-linux-gnu",
    17249236,
    "b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6",
  ),
};

/**
 * Why there is no uv to run, in words for a researcher who has never heard of
 * it: clinical setup shows these as they are.
 */
const MESSAGES = {
  "unsupported-platform":
    "Lincei cannot install the clinical research tools on this kind of computer yet. It can on a Mac and on most Linux computers.",
  download:
    "Lincei could not download the installer for the clinical research tools. Check the internet connection, then try again. Some hospital and university networks block this download; if it keeps failing, try another network.",
  verification:
    "The installer Lincei downloaded is not the one it expects, so nothing was installed. Try again; if it keeps happening, the network may be altering downloads, so try another network.",
  storage:
    "Lincei could not save the installer for the clinical research tools on this computer. Check that the disk has free space, then try again.",
} as const;

export class UvInstallationError extends Schema.TaggedError<UvInstallationError>()(
  "UvInstallationError",
  {
    reason: Schema.Literals(["unsupported-platform", "download", "verification", "storage"]),
    /** The technical account, for whoever helps the user. */
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return MESSAGES[this.reason];
  }
}

const isInstallationError = Schema.is(UvInstallationError);

/** Reports whatever one stage of the installation fails with as that stage's failure. */
const failingAs =
  (reason: UvInstallationError["reason"], detail: string) =>
  <A, E, R>(stage: Effect.Effect<A, E, R>) =>
    stage.pipe(
      Effect.mapError((cause) =>
        isInstallationError(cause) ? cause : new UvInstallationError({ reason, detail, cause }),
      ),
    );

/**
 * Resolves the uv command to run: the one on PATH, or Lincei's own copy in
 * `managedDirectory`, which is downloaded first when neither exists.
 */
export const ensure = Effect.fn("UvInstallation.ensure")(function* (input: {
  readonly managedDirectory: string;
  /** Replaces the release pinned for this platform. */
  readonly release?: UvRelease | undefined;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const arch = yield* HostProcessArchitecture;

  const runs = (command: string) =>
    processRunner
      .run({
        command,
        args: ["--version"],
        timeout: "30 seconds",
        outputMode: "truncate",
        maxOutputBytes: 4096,
      })
      .pipe(
        Effect.map((output) => Number(output.code) === 0),
        Effect.orElseSucceed(() => false),
      );

  if (yield* runs("uv")) return "uv";
  const managed = path.join(input.managedDirectory, platform === "win32" ? "uv.exe" : "uv");
  if (yield* runs(managed)) return managed;

  const release = input.release ?? RELEASES[`${platform}-${arch}`];
  if (release === undefined) {
    return yield* new UvInstallationError({
      reason: "unsupported-platform",
      detail: `uv is not on PATH, and no uv release is pinned for ${platform}-${arch}.`,
    });
  }

  return yield* Effect.gen(function* () {
    const staging = yield* fileSystem
      .makeDirectory(input.managedDirectory, { recursive: true })
      .pipe(
        Effect.andThen(
          fileSystem.makeTempDirectoryScoped({
            directory: input.managedDirectory,
            prefix: ".install-",
          }),
        ),
        failingAs("storage", "The folder for Lincei's own tools could not be written."),
      );
    const archivePath = path.join(staging, "uv.tar.gz");
    const hash = NodeCrypto.createHash("sha256");
    let downloadedBytes = 0;
    yield* http.execute(HttpClientRequest.get(release.url)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) =>
        response.stream.pipe(
          Stream.tap((chunk) => {
            downloadedBytes += chunk.byteLength;
            if (downloadedBytes > release.archiveBytes) {
              return Effect.fail(
                new UvInstallationError({
                  reason: "verification",
                  detail: `The uv download was larger than the pinned release (${release.archiveBytes} bytes).`,
                }),
              );
            }
            hash.update(chunk);
            return Effect.void;
          }),
          Stream.run(fileSystem.sink(archivePath, { flag: "wx", mode: 0o600 })),
        ),
      ),
      Effect.timeout("15 minutes"),
      failingAs("download", `Downloading uv ${UV_VERSION} from its GitHub release did not finish.`),
    );
    if (downloadedBytes !== release.archiveBytes || hash.digest("hex") !== release.sha256) {
      return yield* new UvInstallationError({
        reason: "verification",
        detail: `The uv download (${downloadedBytes} bytes) does not match the size and SHA-256 digest of the pinned release.`,
      });
    }

    // The archive holds one directory with `uv` and `uvx` in it.
    const unpacked = yield* processRunner
      .run({
        command: "tar",
        args: ["-xzf", archivePath, "-C", staging, "--strip-components=1"],
        timeout: "2 minutes",
        outputMode: "truncate",
        maxOutputBytes: 4096,
      })
      .pipe(failingAs("storage", "tar could not be run on the uv archive."));
    if (Number(unpacked.code) !== 0) {
      return yield* new UvInstallationError({
        reason: "storage",
        detail: "tar could not unpack the uv archive.",
      });
    }
    yield* fileSystem
      .rename(path.join(staging, path.basename(managed)), managed)
      .pipe(failingAs("storage", "The unpacked uv could not be moved into place."));
    return managed;
  }).pipe(Effect.scoped);
});
