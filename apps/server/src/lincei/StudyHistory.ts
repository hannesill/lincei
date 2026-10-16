/**
 * StudyHistory - a history of a project's folder, so that the agent's changes
 * to it can be undone.
 *
 * Upstream checkpoints a project after every turn, and "Edit from here"
 * restores a checkpoint, but only in a git repository, and a checkpoint copies
 * every file git does not ignore. A research folder is usually plain and holds
 * data, so Lincei makes the repository itself, with `.git/info/exclude` as its
 * own (`studyFolders.ts`):
 *
 * - Files over `largeFileBytes` are kept out by name too, found when the
 *   history starts and again before every checkpoint (`withStudyHistory`).
 *   Git neither restores nor cleans an excluded file, so undo never touches one.
 * - A folder whose history would keep more than `maxKeptFiles` files or
 *   `maxKeptBytes` is refused, and checkpoints are refused, with the reason in
 *   the status, while a history's folder is over those limits.
 * - The repository is built inside the folder and moved into place whole, so
 *   no checkpoint sees it without its rules, and a refusal never has to delete
 *   a `.git`, which might be one an agent has just made.
 * - It starts with an empty commit: upstream resets the index to `HEAD` after
 *   a restore, and without one a later restore deletes a file that has since
 *   grown too large to keep.
 *
 * Only project folders, and of those only the ones `whyNoHistory` allows.
 * Repositories Lincei did not make (`lincei.studyHistory` in their config) are
 * never changed. Turning a history off moves its `.git` into Lincei's home,
 * and turning it on moves it back. In researcher mode a project's folder gets
 * its history by itself when upstream first asks whether it is a repository,
 * before a turn's baseline checkpoint, unless the researcher turned it off.
 *
 * @module StudyHistory
 */
import * as NodeOS from "node:os";

import { type StudyHistory as StudyHistoryInfo, VcsProcessExitError } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { clinicalPaths } from "./clinicalPaths.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";
import {
  excludeFile,
  iCloudDesktopAndDocuments,
  leftOutIn,
  RULES,
  whyNoHistory,
} from "./studyFolders.ts";

export interface StudyHistoryLimits {
  /** A file larger than this is kept out by its name. */
  readonly largeFileBytes: number;
  readonly maxKeptFiles: number;
  readonly maxKeptBytes: number;
}

export const DEFAULT_LIMITS: StudyHistoryLimits = {
  largeFileBytes: 10 * 1024 ** 2,
  maxKeptFiles: 10_000,
  maxKeptBytes: 1024 ** 3,
};

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${Math.round(bytes / 1024 ** 3)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
const TRY_AGAIN =
  "Lincei could not work with this folder's history. Try again; if it keeps failing, quit Lincei and open it again.";
const NO_GIT =
  "Lincei needs git to keep a history, and git is not installed on the computer Lincei runs on.";

export class StudyHistoryError extends Schema.TaggedError<StudyHistoryError>()(
  "StudyHistoryError",
  {
    /** What went wrong and what to do next, in words for the researcher. */
    message: Schema.String,
    /** What git or the disk reported, for whoever helps them. */
    detail: Schema.optional(Schema.String),
  },
) {}

const fail = (message: string, detail?: string) =>
  new StudyHistoryError({ message, ...(detail === undefined ? {} : { detail }) });

/** Histories are kept only for project folders, which the server's project read model knows. */
type Projects = ProjectStore.ProjectStoreV2;

export class StudyHistory extends Context.Service<
  StudyHistory,
  {
    /** Whether Lincei keeps a history of a project's folder. Changes nothing. */
    readonly status: (
      folder: string,
    ) => Effect.Effect<StudyHistoryInfo, StudyHistoryError, Projects>;
    /** Starts or stops it. Acts only on plain folders and on histories Lincei made. */
    readonly update: (
      folder: string,
      on: boolean,
    ) => Effect.Effect<StudyHistoryInfo, StudyHistoryError, Projects>;
    /**
     * Starts the history of a project's plain folder in researcher mode, once
     * per folder and run, unless the researcher turned it off. True if it did.
     */
    readonly adopt: (folder: string) => Effect.Effect<boolean, never, Projects>;
    /** Brings the rules of a history Lincei made up to date before upstream checkpoints `cwd`. */
    readonly prepareCapture: (cwd: string) => Effect.Effect<void, StudyHistoryError>;
  }
>()("t3/lincei/StudyHistory") {}

/** A folder as Lincei finds it. */
type Found =
  | { readonly state: "on"; readonly real: string; readonly gitDir: string }
  | { readonly state: "off"; readonly real: string }
  | { readonly state: "own" | "unavailable"; readonly message: string };

export const makeWith = (limits: StudyHistoryLimits) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const preferences = yield* LinceiPreferences.LinceiPreferences;
    const environment = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const { studyHistoryDir } = clinicalPaths({
      baseDir: config.baseDir,
      platform,
      environment,
      join: path.join,
    });
    // Windows programs take the profile as home, whatever HOME says.
    const home =
      (platform === "win32" ? environment.USERPROFILE : environment.HOME) || NodeOS.homedir();
    const locks = yield* KeyedLock.make<string>();
    /** Project folders adoption tried this run, with why it could not start their history. */
    const adopted = new Map<string, string | null>();
    /** Histories, by git directory, whose last checkpoint was refused, with the reason. */
    const refused = new Map<string, string>();

    // Every run gets input, even if empty: git waits for the end of it.
    const run = (cwd: string, args: ReadonlyArray<string>, maxOutputBytes = 1024 ** 2) =>
      processRunner
        .run({ command: "git", args, cwd, stdin: "", timeout: "30 seconds", maxOutputBytes })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "ProcessOutputLimitError"
              ? error
              : fail(error._tag === "ProcessSpawnError" ? NO_GIT : TRY_AGAIN, error.message),
          ),
        );

    /** Runs git, and fails unless it succeeds. */
    const git = (cwd: string, args: ReadonlyArray<string>) =>
      run(cwd, args).pipe(
        Effect.catchTags({ ProcessOutputLimitError: (error) => fail(TRY_AGAIN, error.message) }),
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output.stdout.trim())
            : fail(TRY_AGAIN, `git ${args.join(" ")}: ${output.stderr.trim()}`),
        ),
      );

    const ours = (cwd: string) =>
      git(cwd, ["config", "--get", "--bool", "lincei.studyHistory"]).pipe(
        Effect.map((value) => value === "true"),
        Effect.orElseSucceed(() => false),
      );

    /** The repository `cwd` is in, and whether `cwd` is its top. */
    const repositoryAt = (cwd: string) =>
      git(cwd, ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--show-prefix"]).pipe(
        Effect.map((output) => {
          const [root = "", gitDir = "", prefix = ""] = output.split("\n");
          return Option.some({ root, gitDir, atTop: prefix === "" });
        }),
        Effect.orElseSucceed(Option.none),
      );

    const realPath = (target: string) =>
      fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => path.resolve(target)));

    const find = Effect.fn("StudyHistory.find")(function* (
      folder: string,
    ): Effect.fn.Return<Found> {
      const isDirectory = yield* fileSystem.stat(folder).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
      if (!path.isAbsolute(folder) || !isDirectory) {
        return {
          state: "unavailable",
          message: "Lincei cannot find this folder on the computer it runs on.",
        };
      }
      const real = yield* realPath(folder);
      const repository = yield* repositoryAt(real);
      if (Option.isSome(repository)) {
        const { root, gitDir, atTop } = repository.value;
        if (atTop && (yield* ours(real))) return { state: "on", real, gitDir };
        return {
          state: "own",
          message: atTop
            ? "This folder is a git repository, so it keeps its own history, and undo works with it. Lincei leaves it as it is."
            : `This folder is inside the git repository at ${root}, which keeps its history. Lincei leaves it as it is.`,
        };
      }
      // A `.git` git cannot read stays: moving a history into place never replaces one.
      const realHome = yield* realPath(home);
      const alsoSynced =
        platform === "darwin"
          ? yield* iCloudDesktopAndDocuments(realHome).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
            )
          : [];
      const why = whyNoHistory({
        folder: real,
        home: realHome,
        platform,
        environment,
        path,
        alsoSynced,
      });
      return why === null ? { state: "off", real } : { state: "unavailable", message: why };
    });

    /** Where a folder's history waits while it is off: one place per folder. */
    const crypto = yield* Crypto.Crypto;
    const archiveOf = (real: string) => {
      const name = path
        .basename(real)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
      return crypto.digest("SHA-256", new TextEncoder().encode(real)).pipe(
        Effect.map((digest) =>
          path.join(studyHistoryDir, `${name}-${Hex.encode(digest).slice(0, 12)}`),
        ),
        Effect.orDie,
      );
    };
    const isArchived = (real: string) =>
      archiveOf(real).pipe(
        Effect.flatMap((archive) => fileSystem.exists(archive)),
        Effect.orElseSucceed(() => false),
      );
    const readExclude = (gitDir: string) =>
      fileSystem
        .readFileString(path.join(gitDir, "info", "exclude"))
        .pipe(Effect.orElseSucceed(() => ""));

    /**
     * Looks at what the history of `folder` would keep under the rules, and
     * writes the rules into `gitDir` with the files too large to keep. A
     * refusal when the history would keep too much, else null.
     */
    const applyRules = Effect.fn("StudyHistory.applyRules")(function* (
      gitDir: string,
      folder: string,
    ): Effect.fn.Return<string | null, StudyHistoryError> {
      const tooMany = `This folder holds more than ${limits.maxKeptFiles.toLocaleString("en")} files besides data, more than a study's history should copy. Keep the study in a folder of its own, or move what does not belong to it elsewhere.`;
      const listed = yield* run(
        folder,
        [
          `--git-dir=${gitDir}`,
          `--work-tree=${folder}`,
          "ls-files",
          "-z",
          "--cached",
          "--others",
          // The rules alone, not the names kept out last time: a file that has
          // shrunk is kept again, and one that is gone is forgotten.
          "--exclude-per-directory=.gitignore",
          ...RULES.flatMap((rule) => ["-x", rule]),
        ],
        limits.maxKeptFiles * 1024,
      ).pipe(Effect.catchTags({ ProcessOutputLimitError: () => Effect.succeed(null) }));
      if (listed === null) return tooMany;
      if (listed.code !== 0) return yield* fail(TRY_AGAIN, `git ls-files: ${listed.stderr.trim()}`);
      const files = listed.stdout.split("\0").filter((file) => file.length > 0);
      if (files.length > limits.maxKeptFiles) return tooMany;
      const sizes = yield* Effect.forEach(
        files,
        (file) =>
          fileSystem.stat(path.join(folder, file)).pipe(
            Effect.map((info) => (info.type === "File" ? Number(info.size) : 0)),
            Effect.orElseSucceed(() => 0),
          ),
        { concurrency: 32 },
      );
      const large = files.filter((_, index) => sizes[index]! > limits.largeFileBytes);
      const keptBytes = sizes.reduce(
        (sum, bytes) => (bytes > limits.largeFileBytes ? sum : sum + bytes),
        0,
      );
      if (keptBytes > limits.maxKeptBytes) {
        return `Besides data, this folder holds more than ${size(limits.maxKeptBytes)} of files, which its history would copy. Move large files that are not data elsewhere, or keep the study in a folder of its own.`;
      }
      const contents = excludeFile(large);
      if (contents !== (yield* readExclude(gitDir))) {
        yield* writeFileStringAtomically({
          filePath: path.join(gitDir, "info", "exclude"),
          contents,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError((error) => fail(TRY_AGAIN, error.message)),
        );
      }
      return null;
    });

    /**
     * Moves a directory, also to another disk: there it is copied next to its
     * destination first, so the destination appears whole or not at all.
     */
    const move = (from: string, to: string) =>
      fileSystem.rename(from, to).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            const moving = `${to}.lincei-moving-${yield* Clock.currentTimeMillis}`;
            yield* fileSystem.copy(from, moving).pipe(
              Effect.andThen(fileSystem.rename(moving, to)),
              Effect.tapError(() =>
                fileSystem.remove(moving, { recursive: true, force: true }).pipe(Effect.ignore),
              ),
            );
            yield* fileSystem.remove(from, { recursive: true });
          }),
        ),
        Effect.mapError((error) => fail(TRY_AGAIN, error.message)),
      );

    const turnOn = Effect.fn("StudyHistory.turnOn")(function* (real: string) {
      const archived = yield* isArchived(real);
      // Built inside the folder, so that git sets it up for the folder's disk.
      const staging = archived
        ? null
        : path.join(real, `.lincei-history-${yield* Clock.currentTimeMillis}`);
      yield* Effect.gen(function* () {
        let gitDir = yield* archiveOf(real);
        if (staging !== null) {
          yield* git(real, ["-c", "init.defaultBranch=main", "init", "--quiet", staging]);
          // A checkpoint every turn would ask for a signature each time, and
          // undo restores files byte for byte, whatever the system's git converts.
          for (const [key, value] of [
            ["lincei.studyHistory", "true"],
            ["commit.gpgSign", "false"],
            ["core.autocrlf", "false"],
          ] as const) {
            yield* git(staging, ["config", key, value]);
          }
          const tree = yield* git(staging, ["mktree"]);
          const commit = yield* git(staging, [
            "-c",
            "user.name=Lincei",
            "-c",
            "user.email=lincei@localhost",
            "commit-tree",
            tree,
            "-m",
            "Lincei keeps this study's history from here.",
          ]);
          yield* git(staging, ["update-ref", "HEAD", commit]);
          gitDir = path.join(staging, ".git");
        }
        const refusal = yield* applyRules(gitDir, real);
        if (refusal !== null) return yield* fail(refusal);
        yield* move(gitDir, path.join(real, ".git"));
      }).pipe(
        Effect.ensuring(
          staging === null
            ? Effect.void
            : fileSystem.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
      );
      yield* Effect.logInfo("Lincei keeps the history of a study folder", {
        folder: real,
        restored: archived,
      });
    });

    const projectFolder = (folder: string) =>
      Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
        projects.findActiveByWorkspaceRoot(folder),
      ).pipe(
        Effect.mapError((error) => fail(TRY_AGAIN, error.message)),
        Effect.flatMap((project) =>
          Option.isSome(project)
            ? Effect.void
            : fail(
                "Lincei keeps a history only of a project's folder. Add the folder as a project first.",
              ),
        ),
      );

    const status: StudyHistory["Service"]["status"] = (folder) =>
      Effect.gen(function* () {
        yield* projectFolder(folder);
        const found = yield* find(folder);
        if (found.state === "on") {
          return {
            state: "on",
            message:
              refused.get(found.gitDir) ??
              `Lincei keeps a history of this folder, so you can undo the assistant's changes to your scripts, notes, and figures. Data files and files over ${size(limits.largeFileBytes)} stay out of it, and undo leaves them as they are.`,
            leftOut: leftOutIn(yield* readExclude(found.gitDir)),
          };
        }
        if (found.state !== "off")
          return { state: found.state, message: found.message, leftOut: [] };
        const reason = adopted.get(folder);
        const message = reason
          ? `Lincei did not start a history here by itself. ${reason}`
          : "Turn this on to be able to undo the assistant's changes to your scripts, notes, and figures. Data files stay out of the history.";
        return {
          state: "off",
          message: (yield* isArchived(found.real))
            ? `${message} Turning it on brings back the history Lincei kept before.`
            : message,
          leftOut: [],
        };
      });

    const update: StudyHistory["Service"]["update"] = (folder, on) =>
      Effect.gen(function* () {
        yield* projectFolder(folder);
        yield* locks.withLock(
          folder,
          Effect.gen(function* () {
            const found = yield* find(folder);
            if (found.state === "own") {
              return yield* fail(
                "This folder's history is its own git repository, which Lincei never changes.",
              );
            }
            if (on && found.state === "unavailable") return yield* fail(found.message);
            if (on && found.state === "off") {
              yield* turnOn(found.real);
              adopted.delete(folder);
            }
            if (!on && found.state === "on") {
              yield* fileSystem
                .makeDirectory(studyHistoryDir, { recursive: true })
                .pipe(Effect.mapError((error) => fail(TRY_AGAIN, error.message)));
              yield* move(path.join(found.real, ".git"), yield* archiveOf(found.real));
              refused.delete(found.gitDir);
            }
          }),
        );
        return yield* status(folder);
      });

    const adopt: StudyHistory["Service"]["adopt"] = (folder) =>
      Effect.gen(function* () {
        if (adopted.has(folder) || (yield* preferences.get).techieMode) return false;
        if (Option.isNone(yield* Effect.option(projectFolder(folder)))) return false;
        adopted.set(folder, null);
        return yield* locks.withLock(
          folder,
          Effect.gen(function* () {
            const found = yield* find(folder);
            // A history that is waiting was turned off by the researcher.
            if (found.state !== "off" || (yield* isArchived(found.real))) return false;
            yield* turnOn(found.real);
            return true;
          }),
        );
      }).pipe(
        Effect.catch((error) => {
          adopted.set(folder, error.message);
          return Effect.logWarning("Lincei did not start the history of a study folder", {
            folder,
            reason: error.message,
            detail: error.detail,
          }).pipe(Effect.as(false));
        }),
      );

    const prepareCapture: StudyHistory["Service"]["prepareCapture"] = (cwd) =>
      Effect.gen(function* () {
        // One process for every other repository; upstream's capture runs several.
        if (!(yield* ours(cwd))) return;
        const repository = yield* repositoryAt(cwd);
        if (Option.isNone(repository)) return;
        const { root, gitDir } = repository.value;
        const refusal = yield* applyRules(gitDir, root);
        if (refusal === null) return void refused.delete(gitDir);
        refused.set(gitDir, `The history is paused. ${refusal}`);
        return yield* fail(`The history is paused. ${refusal}`);
      });

    return StudyHistory.of({ status, update, adopt, prepareCapture });
  });

export const layerWith = (limits: StudyHistoryLimits) =>
  Layer.effect(StudyHistory, makeWith(limits));

export const layer = layerWith(DEFAULT_LIMITS);

/**
 * Upstream's checkpoint store with study histories around it: a project's
 * plain folder is adopted when upstream asks whether it is a repository, and
 * the rules are brought up to date before every checkpoint. `server.ts` wraps
 * its store in this; upstream's tests build upstream's alone.
 */
export const withStudyHistory = <E, R>(
  upstream: Layer.Layer<CheckpointStore.CheckpointStore, E, R>,
): Layer.Layer<CheckpointStore.CheckpointStore, E, R | StudyHistory | Projects> =>
  Layer.effect(
    CheckpointStore.CheckpointStore,
    Effect.gen(function* () {
      const store = yield* CheckpointStore.CheckpointStore;
      const studyHistory = yield* StudyHistory;
      const projects = yield* ProjectStore.ProjectStoreV2;
      return CheckpointStore.CheckpointStore.of({
        ...store,
        isGitRepository: (cwd) =>
          Effect.flatMap(store.isGitRepository(cwd), (isRepository) =>
            isRepository
              ? Effect.succeed(true)
              : studyHistory.adopt(cwd).pipe(
                  Effect.provideService(ProjectStore.ProjectStoreV2, projects),
                  Effect.flatMap((started) =>
                    started ? store.isGitRepository(cwd) : Effect.succeed(false),
                  ),
                ),
          ),
        captureCheckpoint: (input) =>
          studyHistory.prepareCapture(input.cwd).pipe(
            Effect.mapError(
              (error) =>
                new VcsProcessExitError({
                  operation: "Lincei.StudyHistory.prepareCapture",
                  command: "git ls-files",
                  cwd: input.cwd,
                  exitCode: 1,
                  detail: error.detail ?? error.message,
                }),
            ),
            Effect.andThen(store.captureCheckpoint(input)),
          ),
      });
    }),
  ).pipe(Layer.provide(upstream));
