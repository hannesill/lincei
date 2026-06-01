import { CheckpointRef, ProjectId, SessionId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import {
  ProjectionSnapshotQuery,
  type ProjectionSessionCheckpointContext,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForSessionTurn } from "../Utils.ts";
import { CheckpointDiffQueryLive } from "./CheckpointDiffQuery.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointDiffQuery } from "../Services/CheckpointDiffQuery.ts";

function makeSessionCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ProjectionSessionCheckpointContext {
  return {
    sessionId: input.sessionId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("uses the narrow full-session context lookup for all-turns diffs", async () => {
    const projectId = ProjectId.make("project-full-session");
    const sessionId = SessionId.make("session-full-session");
    const toCheckpointRef = checkpointRefForSessionTurn(sessionId, 4);
    let getSessionCheckpointContextCalls = 0;
    let getFullSessionDiffContextCalls = 0;
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
      readonly ignoreWhitespace: boolean;
    }> = [];

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({
            fromCheckpointRef,
            toCheckpointRef,
            cwd,
            ignoreWhitespace,
          });
          return "full session diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.die("CheckpointDiffQuery should not request the command read model"),
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getArchivedShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
          getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
          getCounts: () => Effect.succeed({ projectCount: 0, sessionCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveSessionIdByProjectId: () => Effect.succeed(Option.none()),
          getSessionCheckpointContext: () =>
            Effect.sync(() => {
              getSessionCheckpointContextCalls += 1;
              return Option.none();
            }),
          getFullSessionDiffContext: () =>
            Effect.sync(() => {
              getFullSessionDiffContextCalls += 1;
              return Option.some({
                sessionId,
                projectId,
                workspaceRoot: "/tmp/workspace",
                worktreePath: "/tmp/worktree",
                latestCheckpointTurnCount: 4,
                toCheckpointRef,
              });
            }),
          getSessionShellById: () => Effect.succeed(Option.none()),
          getSessionDetailById: () => Effect.succeed(Option.none()),
          getResearchCardDetail: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getFullSessionDiff({
          sessionId,
          toTurnCount: 4,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(getSessionCheckpointContextCalls).toBe(0);
    expect(getFullSessionDiffContextCalls).toBe(1);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/worktree",
        fromCheckpointRef: checkpointRefForSessionTurn(sessionId, 0),
        toCheckpointRef,
        ignoreWhitespace: true,
      },
    ]);
    expect(result).toEqual({
      sessionId,
      fromTurnCount: 0,
      toTurnCount: 4,
      diff: "full session diff patch",
    });
  });

  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const projectId = ProjectId.make("project-1");
    const sessionId = SessionId.make("session-1");
    const toCheckpointRef = checkpointRefForSessionTurn(sessionId, 1);
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
      readonly ignoreWhitespace: boolean;
    }> = [];

    const sessionCheckpointContext = makeSessionCheckpointContext({
      projectId,
      sessionId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({
            fromCheckpointRef,
            toCheckpointRef,
            cwd,
            ignoreWhitespace,
          });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.die("CheckpointDiffQuery should not request the command read model"),
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getArchivedShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
          getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
          getCounts: () => Effect.succeed({ projectCount: 0, sessionCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveSessionIdByProjectId: () => Effect.succeed(Option.none()),
          getSessionCheckpointContext: () => Effect.succeed(Option.some(sessionCheckpointContext)),
          getFullSessionDiffContext: () => Effect.die("unused"),
          getSessionShellById: () => Effect.succeed(Option.none()),
          getSessionDetailById: () => Effect.succeed(Option.none()),
          getResearchCardDetail: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          sessionId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer)),
    );

    const expectedFromRef = checkpointRefForSessionTurn(sessionId, 0);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
        ignoreWhitespace: true,
      },
    ]);
    expect(result).toEqual({
      sessionId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("defaults to hide whitespace changes", async () => {
    const projectId = ProjectId.make("project-default-whitespace");
    const sessionId = SessionId.make("session-default-whitespace");
    const toCheckpointRef = checkpointRefForSessionTurn(sessionId, 1);
    const diffCheckpointsCalls: Array<{ readonly ignoreWhitespace: boolean }> = [];

    const sessionCheckpointContext = makeSessionCheckpointContext({
      projectId,
      sessionId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ ignoreWhitespace }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({ ignoreWhitespace });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.die("CheckpointDiffQuery should not request the command read model"),
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getArchivedShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
          getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
          getCounts: () => Effect.succeed({ projectCount: 0, sessionCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveSessionIdByProjectId: () => Effect.succeed(Option.none()),
          getSessionCheckpointContext: () => Effect.succeed(Option.some(sessionCheckpointContext)),
          getFullSessionDiffContext: () => Effect.die("unused"),
          getSessionShellById: () => Effect.succeed(Option.none()),
          getSessionDetailById: () => Effect.succeed(Option.none()),
          getResearchCardDetail: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          sessionId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(diffCheckpointsCalls).toEqual([{ ignoreWhitespace: true }]);
  });

  it("does not preflight checkpoint refs before diffing", async () => {
    const projectId = ProjectId.make("project-no-preflight");
    const sessionId = SessionId.make("session-no-preflight");
    const toCheckpointRef = checkpointRefForSessionTurn(sessionId, 1);
    let hasCheckpointRefCallCount = 0;

    const sessionCheckpointContext = makeSessionCheckpointContext({
      projectId,
      sessionId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () =>
        Effect.sync(() => {
          hasCheckpointRefCallCount += 1;
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed("diff patch"),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.die("CheckpointDiffQuery should not request the command read model"),
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getArchivedShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
          getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
          getCounts: () => Effect.succeed({ projectCount: 0, sessionCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveSessionIdByProjectId: () => Effect.succeed(Option.none()),
          getSessionCheckpointContext: () => Effect.succeed(Option.some(sessionCheckpointContext)),
          getFullSessionDiffContext: () => Effect.die("unused"),
          getSessionShellById: () => Effect.succeed(Option.none()),
          getSessionDetailById: () => Effect.succeed(Option.none()),
          getResearchCardDetail: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          sessionId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(hasCheckpointRefCallCount).toBe(0);
  });

  it("fails when the session is missing from the snapshot", async () => {
    const sessionId = SessionId.make("session-missing");

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.die("CheckpointDiffQuery should not request the command read model"),
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
          getArchivedShellSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
          getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
          getCounts: () => Effect.succeed({ projectCount: 0, sessionCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveSessionIdByProjectId: () => Effect.succeed(Option.none()),
          getSessionCheckpointContext: () => Effect.succeed(Option.none()),
          getFullSessionDiffContext: () => Effect.succeed(Option.none()),
          getSessionShellById: () => Effect.succeed(Option.none()),
          getSessionDetailById: () => Effect.succeed(Option.none()),
          getResearchCardDetail: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            sessionId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Session 'session-missing' not found.");
  });
});
