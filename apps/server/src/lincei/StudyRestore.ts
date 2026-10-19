/**
 * StudyRestore - when "Edit from here" may undo files in a study's folder.
 *
 * A checkpoint is the whole folder, so restoring one also undoes whatever
 * other conversations changed there afterwards. Upstream therefore restores
 * files only for a conversation in a worktree of its own
 * (`CheckpointRestoreSafety.ts`), which refuses every researcher conversation:
 * they all run in the project's folder. In a history Lincei keeps
 * (`StudyHistory.ts`) the restore is allowed when no other conversation that
 * still exists, archived ones included, can lose work by it:
 *
 * - none has a checkpoint in the folder from the moment this conversation's
 *   first checkpoint there was taken, or later. Upstream's check is not told
 *   which checkpoint is being restored, so this conversation's first one
 *   stands in for it. It is never later than the one restored, so the rule
 *   can refuse a safe restore after conversations took turns, never allow an
 *   unsafe one; and
 * - none is working in the folder now: a turn not yet finished, or a session
 *   starting, running, waiting, or failed with its stream still open.
 *
 * Anywhere else upstream's answer stands. Like upstream's check, this reads
 * only projections and the file system (the folder's `.git/config`), so it
 * works where upstream calls it, when the command is admitted too.
 *
 * @module StudyRestore
 */
import type { OrchestrationV2AppThread, OrchestrationV2CheckpointScope } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";

import type { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import type * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

/** Whether a repository's config marks it as one of Lincei's study histories. */
export const isStudyHistory = (config: string): boolean => {
  let section = "";
  for (const line of config.split(/\r?\n/).map((text) => text.trim())) {
    const header = /^\[([^\]\s"]+)/.exec(line);
    if (header !== null) section = header[1]!.toLowerCase();
    else if (section === "lincei" && /^studyhistory\s*=\s*true$/i.test(line)) return true;
  }
  return false;
};

const FINISHED_RUNS = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
const WORKING_SESSIONS = new Set(["starting", "running", "waiting", "error"]);

/** True when restoring files of `thread` in `scope` is safe in a Lincei study history. */
export const allows = Effect.fn("lincei.StudyRestore.allows")(function* (
  thread: Pick<OrchestrationV2AppThread, "id">,
  scope: Pick<OrchestrationV2CheckpointScope, "cwd">,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly projections: ProjectionStoreV2["Service"];
    readonly projects: ProjectStore.ProjectStoreV2["Service"];
    readonly path: Path.Path;
  },
) {
  const { fileSystem, projections, projects, path } = dependencies;
  const resolve = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => path.resolve(target)));
  const cwd = yield* resolve(scope.cwd);
  const config = yield* fileSystem
    .readFileString(path.join(cwd, ".git", "config"))
    .pipe(Effect.orElseSucceed(() => ""));
  if (!isStudyHistory(config)) return false;

  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (!path.isAbsolute(relative) && !relative.startsWith(".."));
  };
  const inFolder = (candidate: string | null) =>
    candidate === null
      ? Effect.succeed(false)
      : Effect.map(resolve(candidate), (other) => contains(cwd, other) || contains(other, cwd));
  /** The ids of a thread's checkpoint scopes in the folder. */
  const scopesInFolder = (
    scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "id" | "cwd">>,
  ) =>
    Effect.map(
      Effect.forEach(scopes, (candidate) => inFolder(candidate.cwd)),
      (inside) => new Set(scopes.filter((_, index) => inside[index]).map(({ id }) => id)),
    );

  const own = yield* projections.getThreadRecords(thread.id, ["checkpoints", "checkpointScopes"]);
  const ownScopes = yield* scopesInFolder(own.checkpointScopes);
  const since = Math.min(
    ...own.checkpoints
      .filter((checkpoint) => ownScopes.has(checkpoint.scopeId))
      .map((checkpoint) => DateTime.toEpochMillis(checkpoint.capturedAt)),
  );
  if (!Number.isFinite(since)) return false;

  const shell = yield* projections.getShellSnapshot();
  for (const other of [...shell.threads, ...shell.archivedThreads]) {
    if (other.id === thread.id || other.deletedAt !== null) continue;
    const records = yield* projections.getThreadRecords(other.id, [
      "runs",
      "checkpoints",
      "checkpointScopes",
      "providerSessions",
    ]);
    const scopes = yield* scopesInFolder(records.checkpointScopes);
    const changedSince = records.checkpoints.some(
      (checkpoint) =>
        scopes.has(checkpoint.scopeId) && DateTime.toEpochMillis(checkpoint.capturedAt) >= since,
    );
    if (changedSince) return false;

    // A session shared by several threads keeps the folder it was opened in,
    // often another thread's, so only a thread's own session says where it works.
    const sessions = records.providerSessions.filter(
      (session) =>
        WORKING_SESSIONS.has(session.status) &&
        !session.capabilities.sessions.supportsMultipleProviderThreadsPerSession,
    );
    if (sessions.length === 0 && records.runs.every((run) => FINISHED_RUNS.has(run.status))) {
      continue;
    }
    const workspace =
      other.worktreePath === null
        ? Option.getOrNull(
            Option.map(
              yield* projects.get(other.projectId, { includeDeleted: true }),
              (project) => project.workspaceRoot,
            ),
          )
        : other.worktreePath;
    const folders = [workspace, ...sessions.map((session) => session.cwd)];
    const here = yield* Effect.forEach(folders, inFolder);
    if (scopes.size > 0 || here.some(Boolean)) return false;
  }
  return true;
});
