import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../checkpointing/Utils.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as CheckpointRollbackService from "../orchestration-v2/CheckpointRollbackService.ts";
import * as CheckpointService from "../orchestration-v2/CheckpointService.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import { RuntimePolicyV2 } from "../orchestration-v2/RuntimePolicy.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";
import * as StudyHistory from "./StudyHistory.ts";

const ref = (turn: number) => checkpointRefForThreadTurn(ThreadId.make("thread-study"), turn);

/** The server's projects, by folder: only these may have a history. */
const projectsAt = (folders: ReadonlySet<string>) =>
  Layer.succeed(
    ProjectStore.ProjectStoreV2,
    ProjectStore.ProjectStoreV2.of({
      apply: () => Effect.void,
      get: () => Effect.succeedNone,
      list: () => Effect.succeed([]),
      findActiveByWorkspaceRoot: (workspaceRoot) =>
        Effect.succeed(
          folders.has(workspaceRoot)
            ? Option.some({
                projectId: ProjectId.make("project-study"),
                title: "Study",
                workspaceRoot,
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                createdAt: "2026-10-16T00:00:00.000Z",
                updatedAt: "2026-10-16T00:00:00.000Z",
                deletedAt: null,
              })
            : Option.none(),
        ),
      getShell: () => Effect.succeedNone,
      listShells: () => Effect.succeed([]),
    }),
  );

type Services =
  | StudyHistory.StudyHistory
  | CheckpointStore.CheckpointStore
  | ProjectStore.ProjectStoreV2
  | LinceiPreferences.LinceiPreferences
  | ProcessRunner.ProcessRunner
  | FileSystem.FileSystem
  | Path.Path;

interface Study {
  /** A project's plain folder, by its real path. */
  readonly folder: string;
  readonly home: string;
  /** Where Lincei keeps histories that are off. */
  readonly archiveDir: string;
  /** Makes `folder` a project's folder. */
  readonly addProject: (folder: string) => void;
  readonly write: (file: string, contents: string) => Effect.Effect<void, PlatformError>;
  readonly read: (file: string) => Effect.Effect<string, PlatformError>;
  readonly exists: (file: string) => Effect.Effect<boolean, PlatformError>;
  readonly git: (
    args: ReadonlyArray<string>,
  ) => Effect.Effect<string, ProcessRunner.ProcessRunError, ProcessRunner.ProcessRunner>;
  /** The files in a checkpoint. */
  readonly files: (
    turn: number,
  ) => Effect.Effect<
    ReadonlyArray<string>,
    ProcessRunner.ProcessRunError,
    ProcessRunner.ProcessRunner
  >;
}

/**
 * Lincei's histories around upstream's real checkpoint store, with a Lincei
 * home, a user's home, and one project folder of the test's own.
 */
const withStudy = <A, E>(
  limits: Partial<StudyHistory.StudyHistoryLimits>,
  use: (study: Study) => Effect.Effect<A, E, Services>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const temporary = (prefix: string) =>
      Effect.flatMap(fileSystem.makeTempDirectoryScoped({ prefix }), fileSystem.realPath);
    const baseDir = yield* temporary("lincei-history-home-");
    const home = yield* temporary("lincei-history-user-");
    const folder = yield* temporary("lincei-history-study-");
    const projects = new Set([folder]);
    const git: Study["git"] = (args) =>
      Effect.flatMap(ProcessRunner.ProcessRunner, (runner) =>
        runner.run({ command: "git", args, cwd: folder }),
      ).pipe(
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output.stdout.trim())
            : Effect.die(`git ${args.join(" ")}: ${output.stderr}`),
        ),
      );
    const inFolder = (file: string) => path.join(folder, file);
    const study: Study = {
      folder,
      home,
      archiveDir: path.join(baseDir, "clinical", "study-history"),
      addProject: (added) => void projects.add(added),
      write: (file, contents) =>
        fileSystem
          .makeDirectory(path.dirname(inFolder(file)), { recursive: true })
          .pipe(Effect.andThen(fileSystem.writeFileString(inFolder(file), contents))),
      read: (file) => fileSystem.readFileString(inFolder(file)),
      exists: (file) => fileSystem.exists(inFolder(file)),
      git,
      files: (turn) =>
        Effect.map(git(["ls-tree", "-r", "--name-only", ref(turn)]), (listing) =>
          listing.split("\n").filter((line) => line.length > 0),
        ),
    };
    const dependencies = Layer.mergeAll(
      ServerConfig.layerTest(process.cwd(), baseDir),
      // Both, so the test's home is the home on every platform.
      Layer.succeed(HostProcess.Environment, { ...process.env, HOME: home, USERPROFILE: home }),
      ProcessRunner.layer,
      projectsAt(projects),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    const studyHistory = StudyHistory.layerWith({ ...StudyHistory.DEFAULT_LIMITS, ...limits }).pipe(
      Layer.provideMerge(LinceiPreferences.layer),
      Layer.provideMerge(dependencies),
    );
    const layer = StudyHistory.withStudyHistory(CheckpointStore.layer).pipe(
      Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
      Layer.provideMerge(studyHistory),
    );
    return yield* use(study).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const capture = (folder: string, turn: number) =>
  Effect.flatMap(CheckpointStore.CheckpointStore, (store) =>
    store.captureCheckpoint({ cwd: folder, checkpointRef: ref(turn) }),
  );
const restore = (folder: string, turn: number) =>
  Effect.flatMap(CheckpointStore.CheckpointStore, (store) =>
    store.restoreCheckpoint({ cwd: folder, checkpointRef: ref(turn) }),
  );
const bytes = (count: number) => "x".repeat(count);

describe("StudyHistory", () => {
  it.effect("keeps data, Vitrine's store, and environments out of every checkpoint", () =>
    withStudy({}, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* study.write("analysis.py", "print('cohort')\n");
        yield* study.write("notes/plan.md", "# Plan\n");
        yield* study.write("cohort.csv", "id,age\n1,70\n");
        yield* study.write("exports/SUMMARY.CSV", "n\n12\n");
        yield* study.write("tables/vitals.parquet", "PAR1");
        yield* study.write(".vitrine/studies/sepsis/index.json", "{}");
        yield* study.write(".venv/lib/site.py", "");

        expect((yield* history.status(study.folder)).state).toBe("off");
        expect(yield* history.update(study.folder, true)).toMatchObject({
          state: "on",
          leftOut: [],
        });
        expect(yield* study.git(["config", "--get", "lincei.studyHistory"])).toBe("true");
        // Built aside and moved in whole: nothing of the build is left behind.
        expect((yield* fileSystem.readDirectory(study.folder)).toSorted()).toEqual([
          ".git",
          ".venv",
          ".vitrine",
          "analysis.py",
          "cohort.csv",
          "exports",
          "notes",
          "tables",
        ]);

        yield* capture(study.folder, 1);
        expect(yield* study.files(1)).toEqual(["analysis.py", "notes/plan.md"]);
      }),
    ),
  );

  it.effect("undoes changes to scripts and leaves data files as they are", () =>
    withStudy({}, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        yield* study.write("analysis.py", "first\n");
        yield* study.write("cohort.csv", "first\n");
        yield* history.update(study.folder, true);
        yield* capture(study.folder, 0);
        yield* study.write("analysis.py", "second\n");
        yield* study.write("extra.py", "new\n");
        yield* study.write("cohort.csv", "second\n");
        yield* capture(study.folder, 1);

        expect(yield* restore(study.folder, 0)).toBe(true);
        // Byte for byte, also where the system's git converts line endings.
        expect(yield* study.read("analysis.py")).toBe("first\n");
        expect(yield* study.exists("extra.py")).toBe(false);
        expect(yield* study.read("cohort.csv")).toBe("second\n");
        yield* restore(study.folder, 1);
        expect(yield* study.read("extra.py")).toBe("new\n");
        expect(yield* study.read("cohort.csv")).toBe("second\n");
      }),
    ),
  );

  it.effect("never deletes a file that grew too large to keep when undoing", () =>
    withStudy({ largeFileBytes: 1024 }, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        yield* study.write("results.txt", "small\n");
        yield* history.update(study.folder, true);
        yield* capture(study.folder, 0);
        yield* restore(study.folder, 0);

        yield* study.write("results.txt", bytes(2048));
        yield* capture(study.folder, 1);
        expect(yield* study.files(1)).toEqual([]);
        // Without the empty first commit the index still holds the restored
        // file, and this restore deletes it.
        yield* restore(study.folder, 1);
        expect(yield* study.read("results.txt")).toBe(bytes(2048));
      }),
    ),
  );

  it.effect("keeps out large files, also ones written after the history started", () =>
    withStudy({ largeFileBytes: 1024 }, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        yield* study.write("analysis.py", "print('model')\n");
        yield* study.write("model.bin", bytes(2048));
        expect((yield* history.update(study.folder, true)).leftOut).toEqual(["model.bin"]);

        // An agent writes more during a turn, one with characters that mean
        // something to git (and that Windows allows in a name).
        yield* study.write("outputs/weights.bin", bytes(4096));
        yield* study.write("outputs/#run [1] !final .bin", bytes(4096));
        yield* study.write("outputs/summary.txt", "done\n");
        yield* capture(study.folder, 1);

        expect(yield* study.files(1)).toEqual(["analysis.py", "outputs/summary.txt"]);
        expect((yield* history.status(study.folder)).leftOut).toEqual([
          "model.bin",
          "outputs/#run [1] !final .bin",
          "outputs/weights.bin",
        ]);
      }),
    ),
  );

  it.effect("refuses checkpoints while the folder holds more than a history should", () =>
    withStudy({ maxKeptFiles: 3 }, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* study.write("analysis.py", "");
        // Data files do not count.
        for (const part of [1, 2, 3, 4, 5]) yield* study.write(`data/part-${part}.csv`, "");
        yield* history.update(study.folder, true);

        for (const plot of [1, 2, 3]) yield* study.write(`figures/plot-${plot}.svg`, "");
        expect((yield* Effect.flip(capture(study.folder, 1)))._tag).toBe("VcsProcessExitError");
        expect((yield* history.status(study.folder)).message).toMatch(
          /^The history is paused\. This folder holds more than 3 files/,
        );

        yield* fileSystem.remove(path.join(study.folder, "figures"), { recursive: true });
        yield* capture(study.folder, 1);
        expect(yield* study.files(1)).toEqual(["analysis.py"]);
        expect((yield* history.status(study.folder)).message).not.toMatch(/paused/);
      }),
    ),
  );

  it.effect("leaves a repository it did not make, and its rules, as they are", () =>
    withStudy({}, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const store = yield* CheckpointStore.CheckpointStore;
        const path = yield* Path.Path;
        yield* study.git(["init", "--quiet"]);
        yield* study.write(".git/info/exclude", "scratch/\n");
        yield* study.write("sub/notes.md", "");
        const config = yield* study.read(".git/config");

        expect((yield* history.status(study.folder)).state).toBe("own");
        expect((yield* Effect.flip(history.update(study.folder, true)))._tag).toBe(
          "StudyHistoryError",
        );
        expect((yield* Effect.flip(history.update(study.folder, false)))._tag).toBe(
          "StudyHistoryError",
        );
        const sub = path.join(study.folder, "sub");
        study.addProject(sub);
        expect((yield* history.status(sub)).message).toContain("inside the git repository at");
        // Upstream still checkpoints it, through Lincei's store.
        expect(yield* store.isGitRepository(study.folder)).toBe(true);
        yield* capture(study.folder, 1);

        expect(yield* study.read(".git/info/exclude")).toBe("scratch/\n");
        expect(yield* study.read(".git/config")).toBe(config);
      }),
    ),
  );

  it.effect("refuses folders that are not a project's, home, a disk, too large, or synced", () =>
    withStudy({ maxKeptFiles: 3, maxKeptBytes: 1000 }, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const refusal = (folder: string, on = true) =>
          Effect.map(Effect.flip(history.update(folder, on)), (error) => error.message);

        expect(yield* refusal(study.home)).toContain("only of a project's folder");
        expect(yield* Effect.flip(history.status(study.home))).toMatchObject({
          message: expect.stringContaining("only of a project's folder"),
        });

        study.addProject(study.home);
        expect(yield* refusal(study.home)).toContain("your home folder");
        const top = path.parse(study.folder).root;
        study.addProject(top);
        expect(yield* refusal(top)).toContain("the top of a disk");
        // Dropbox keeps its folder in the home folder on every platform.
        const synced = path.join(study.home, "Dropbox", "sepsis");
        yield* fileSystem.makeDirectory(synced, { recursive: true });
        study.addProject(synced);
        expect(yield* history.status(synced)).toMatchObject({
          state: "unavailable",
          message: expect.stringContaining("synced by Dropbox"),
        });
        expect(yield* refusal(synced)).toContain("outside cloud sync");

        for (const script of [1, 2, 3, 4]) yield* study.write(`script-${script}.py`, "");
        expect(yield* refusal(study.folder)).toContain("more than 3 files besides data");
        yield* fileSystem.remove(path.join(study.folder, "script-4.py"));
        yield* study.write("script-3.py", bytes(1200));
        expect(yield* refusal(study.folder)).toContain("Besides data, this folder holds more than");

        // Every refused folder is left as it was found.
        expect((yield* fileSystem.readDirectory(study.folder)).toSorted()).toEqual([
          "script-1.py",
          "script-2.py",
          "script-3.py",
        ]);
        expect(yield* fileSystem.exists(path.join(study.home, ".git"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(synced, ".git"))).toBe(false);

        // A `.git` that git cannot read, such as a worktree's whose repository
        // is gone, is never replaced.
        const broken = path.join(study.home, "broken");
        yield* fileSystem.makeDirectory(broken);
        yield* fileSystem.writeFileString(path.join(broken, ".git"), "gitdir: ../gone\n");
        study.addProject(broken);
        yield* Effect.flip(history.update(broken, true));
        expect(yield* fileSystem.readDirectory(broken)).toEqual([".git"]);
        expect(yield* fileSystem.readFileString(path.join(broken, ".git"))).toBe(
          "gitdir: ../gone\n",
        );
      }),
    ),
  );

  it.effect("turning the history off keeps it, and turning it on again brings it back", () =>
    withStudy({}, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const store = yield* CheckpointStore.CheckpointStore;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* study.write("analysis.py", "first\n");
        yield* history.update(study.folder, true);
        yield* capture(study.folder, 1);

        const off = yield* history.update(study.folder, false);
        expect(off).toMatchObject({ state: "off" });
        expect(off.message).toContain("brings back the history");
        expect(yield* study.exists(".git")).toBe(false);
        expect(yield* fileSystem.readDirectory(study.archiveDir)).toHaveLength(1);
        // The researcher turned it off: researcher mode does not start it again.
        expect(yield* store.isGitRepository(study.folder)).toBe(false);
        expect(yield* study.exists(".git")).toBe(false);

        yield* study.write("analysis.py", "second\n");
        expect((yield* history.update(study.folder, true)).state).toBe("on");
        expect(yield* fileSystem.readDirectory(study.archiveDir)).toHaveLength(0);
        yield* restore(study.folder, 1);
        expect(yield* study.read("analysis.py")).toBe("first\n");
      }),
    ),
  );

  it.effect("lets upstream's rollback undo a researcher's files and leave the data", () =>
    withStudy({}, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const store = yield* CheckpointStore.CheckpointStore;
        const projects = yield* ProjectStore.ProjectStoreV2;
        yield* study.write("analysis.py", "first\n");
        yield* study.write("cohort.csv", "first\n");
        yield* history.update(study.folder, true);
        yield* capture(study.folder, 0);
        yield* study.write("analysis.py", "second\n");
        yield* study.write("extra.py", "new\n");
        yield* study.write("cohort.csv", "second\n");

        // A conversation in the project's own folder, as every researcher's is.
        const threadId = ThreadId.make("thread-study");
        const providerThread = {
          id: ProviderThreadId.make("provider-thread-study"),
          providerSessionId: ProviderSessionId.make("provider-session-study"),
          providerInstanceId: ProviderInstanceId.make("provider-study"),
        };
        const checkpointId = CheckpointId.make("checkpoint-study");
        const scopeId = CheckpointScopeId.make("scope-study");
        const projection = {
          thread: {
            id: threadId,
            projectId: ProjectId.make("project-study"),
            worktreePath: null,
            activeProviderThreadId: providerThread.id,
            modelSelection: { instanceId: providerThread.providerInstanceId, model: "test" },
          },
          providerThreads: [providerThread],
          providerSessions: [],
          providerTurns: [],
          nodes: [],
          attempts: [],
          checkpoints: [
            {
              id: checkpointId,
              scopeId,
              status: "ready",
              appRunOrdinal: null,
              ref: ref(0),
              capturedAt: yield* DateTime.now,
            },
          ],
          checkpointScopes: [{ id: scopeId, cwd: study.folder }],
          runs: [{ id: "later-run", ordinal: 1, status: "completed", rootNodeId: null }],
        } as unknown as OrchestrationV2ThreadProjection;
        const rollback = CheckpointRollbackService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              CheckpointService.layer.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    Layer.succeed(CheckpointStore.CheckpointStore, store),
                    IdAllocator.layer,
                  ),
                ),
              ),
              Layer.succeed(ProjectStore.ProjectStoreV2, projects),
              ThreadCommandExecutor.layer,
              IdAllocator.layer,
              Layer.mock(GitWorkflowService.GitWorkflowService)({}),
              Layer.mock(ProjectionStoreV2)({
                getThreadRecords: () => Effect.succeed(projection),
                getShellSnapshot: () =>
                  Effect.succeed({ threads: [], archivedThreads: [] } as never),
              }),
              Layer.mock(EventSinkV2)({ write: () => Effect.succeed([]) }),
              Layer.mock(ProviderSessionManagerV2)({
                open: () =>
                  Effect.succeed({
                    rollbackThread: () => Effect.succeed({ providerThread }),
                  } as never),
              }),
              Layer.mock(RuntimePolicyV2)({ resolve: () => Effect.succeed({} as never) }),
            ),
          ),
          Layer.provide(NodeServices.layer),
        );
        yield* Effect.flatMap(CheckpointRollbackService.CheckpointRollbackServiceV2, (service) =>
          service.execute({
            threadId,
            providerThreadId: providerThread.id,
            checkpointId,
            scopeId,
            restoreFiles: true,
          }),
        ).pipe(Effect.provide(rollback));

        expect(yield* study.read("analysis.py")).toBe("first\n");
        expect(yield* study.exists("extra.py")).toBe(false);
        expect(yield* study.read("cohort.csv")).toBe("second\n");
      }),
    ),
  );

  it.effect("starts a project's history by itself in researcher mode only", () =>
    withStudy({ maxKeptFiles: 3 }, (study) =>
      Effect.gen(function* () {
        const history = yield* StudyHistory.StudyHistory;
        const store = yield* CheckpointStore.CheckpointStore;
        const preferences = yield* LinceiPreferences.LinceiPreferences;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* study.write("analysis.py", "");

        yield* preferences.update({ techieMode: true });
        expect(yield* store.isGitRepository(study.folder)).toBe(false);
        expect(yield* study.exists(".git")).toBe(false);

        yield* preferences.update({ techieMode: false });
        // A folder that is no project's, such as a scratch thread's, stays plain.
        const scratch = path.join(study.home, "scratch");
        yield* fileSystem.makeDirectory(scratch);
        expect(yield* store.isGitRepository(scratch)).toBe(false);
        expect(yield* fileSystem.exists(path.join(scratch, ".git"))).toBe(false);

        expect(yield* store.isGitRepository(study.folder)).toBe(true);
        expect((yield* history.status(study.folder)).state).toBe("on");

        // A project folder it cannot keep stays plain and says why.
        const crowded = path.join(study.home, "crowded");
        for (const script of [1, 2, 3, 4]) {
          yield* fileSystem.makeDirectory(crowded, { recursive: true });
          yield* fileSystem.writeFileString(path.join(crowded, `script-${script}.py`), "");
        }
        study.addProject(crowded);
        expect(yield* store.isGitRepository(crowded)).toBe(false);
        expect((yield* history.status(crowded)).message).toContain(
          "Lincei did not start a history here by itself.",
        );
      }),
    ),
  );
});
