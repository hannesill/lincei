import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { isCheckpointRestoreIsolated } from "../orchestration-v2/CheckpointRestoreSafety.ts";
import { isStudyHistory } from "./StudyRestore.ts";

const minute = (value: number) =>
  DateTime.makeUnsafe(`2026-10-19T09:${String(value).padStart(2, "0")}:00Z`);

/** What one conversation has done, in projection records. */
interface Conversation {
  readonly id: string;
  /** When it took checkpoints, each in the folder unless `elsewhere`. */
  readonly checkpoints?: ReadonlyArray<number>;
  readonly elsewhere?: boolean;
  readonly worktreePath?: string | null;
  readonly runs?: ReadonlyArray<string>;
  readonly sessions?: ReadonlyArray<string>;
  readonly archived?: boolean;
  readonly deleted?: boolean;
}

const LINCEI_CONFIG = "[core]\n\tbare = false\n[lincei]\n\tstudyHistory = true\n";

/**
 * Upstream's check, with Lincei's hook, for the first conversation restoring
 * files in a project folder whose `.git/config` is `config`.
 */
const restoreAllowed = (config: string | null, conversations: ReadonlyArray<Conversation>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-study-restore-" });
    const elsewhere = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-elsewhere-" });
    if (config !== null) {
      yield* fileSystem.makeDirectory(path.join(folder, ".git"));
      yield* fileSystem.writeFileString(path.join(folder, ".git", "config"), config);
    }
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const records = (id: string) => {
      const conversation = byId.get(id)!;
      const scopeId = `${id}-scope`;
      return {
        thread: { id, projectId: ProjectId.make("study"), worktreePath: null },
        checkpointScopes: [{ id: scopeId, cwd: conversation.elsewhere ? elsewhere : folder }],
        checkpoints: (conversation.checkpoints ?? []).map((at) => ({
          scopeId,
          capturedAt: minute(at),
        })),
        runs: (conversation.runs ?? []).map((status) => ({ status })),
        providerSessions: (conversation.sessions ?? []).map((status) => ({
          status,
          cwd: folder,
          capabilities: { sessions: { supportsMultipleProviderThreadsPerSession: false } },
        })),
      };
    };
    const threads = conversations.slice(1).map((conversation) => ({
      id: conversation.id,
      projectId: ProjectId.make("study"),
      worktreePath: conversation.worktreePath ?? null,
      deletedAt: conversation.deleted ? minute(59) : null,
      archived: conversation.archived === true,
    }));
    return yield* isCheckpointRestoreIsolated(
      { id: ThreadId.make(conversations[0]!.id), worktreePath: null },
      { cwd: folder },
      {
        fileSystem,
        path,
        projections: {
          getThreadRecords: (id: string) => Effect.succeed(records(id)),
          getShellSnapshot: () =>
            Effect.succeed({
              threads: threads.filter((thread) => !thread.archived),
              archivedThreads: threads.filter((thread) => thread.archived),
            }),
        } as never,
        projects: {
          get: () => Effect.succeed(Option.some({ workspaceRoot: folder })),
        } as never,
      },
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("restoring files in a study folder", () => {
  it.effect("is allowed in Lincei's history when no other conversation can lose work", () =>
    Effect.gen(function* () {
      expect(yield* restoreAllowed(LINCEI_CONFIG, [{ id: "this", checkpoints: [10, 20] }])).toBe(
        true,
      );
      // Earlier conversations, ones that worked elsewhere, idle or stopped
      // sessions, and deleted conversations take nothing from this one.
      expect(
        yield* restoreAllowed(LINCEI_CONFIG, [
          { id: "this", checkpoints: [10, 20] },
          { id: "yesterday", checkpoints: [1, 5], runs: ["completed"], sessions: ["ready"] },
          { id: "elsewhere", checkpoints: [15], elsewhere: true, worktreePath: "/elsewhere" },
          { id: "archived", checkpoints: [2], archived: true, sessions: ["stopped"] },
          { id: "deleted", checkpoints: [30], deleted: true },
        ]),
      ).toBe(true);
    }),
  );

  it.effect("is refused once another conversation has changed the folder since", () =>
    Effect.gen(function* () {
      const after = (other: Conversation) =>
        restoreAllowed(LINCEI_CONFIG, [{ id: "this", checkpoints: [10, 20] }, other]);
      expect(yield* after({ id: "later", checkpoints: [5, 15] })).toBe(false);
      expect(yield* after({ id: "archived", checkpoints: [12], archived: true })).toBe(false);
    }),
  );

  it.effect("is refused while another conversation is working in the folder", () =>
    Effect.gen(function* () {
      const working = (other: Conversation) =>
        restoreAllowed(LINCEI_CONFIG, [{ id: "this", checkpoints: [10] }, other]);
      expect(yield* working({ id: "turn", checkpoints: [5], runs: ["running"] })).toBe(false);
      expect(yield* working({ id: "session", sessions: ["running"] })).toBe(false);
      expect(yield* working({ id: "errored", sessions: ["error"] })).toBe(false);
    }),
  );

  it.effect("keeps upstream's refusal outside Lincei's histories", () =>
    Effect.gen(function* () {
      const alone = [{ id: "this", checkpoints: [10] }];
      // The researcher's own repository, and a folder with no repository.
      expect(yield* restoreAllowed("[core]\n\tbare = false\n", alone)).toBe(false);
      expect(yield* restoreAllowed(null, alone)).toBe(false);
      expect(yield* restoreAllowed("[lincei]\n\tstudyHistory = false\n", alone)).toBe(false);
    }),
  );

  it("reads Lincei's mark however git wrote the config", () => {
    expect(isStudyHistory('[lincei]\n\tstudyHistory = true\n[remote "origin"]\n')).toBe(true);
    expect(isStudyHistory("[LINCEI]\r\n  studyhistory=true\r\n")).toBe(true);
    expect(isStudyHistory("[core]\n\tstudyHistory = true\n")).toBe(false);
  });
});
