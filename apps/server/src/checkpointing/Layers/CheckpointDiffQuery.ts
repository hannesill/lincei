import {
  type CheckpointRef,
  OrchestrationGetTurnDiffResult,
  type SessionId,
  type OrchestrationGetFullSessionDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForSessionTurn } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function buildTurnDiffResult(
  input: {
    readonly sessionId: SessionId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  },
  diff: string,
): OrchestrationGetTurnDiffResultType {
  return {
    sessionId: input.sessionId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    diff,
  };
}

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;
      yield* Effect.annotateCurrentSpan({
        "checkpoint.session_id": input.sessionId,
        "checkpoint.from_turn_count": input.fromTurnCount,
        "checkpoint.to_turn_count": input.toTurnCount,
        "checkpoint.ignore_whitespace": ignoreWhitespace,
      });

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          sessionId: input.sessionId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const sessionContext = yield* projectionSnapshotQuery
        .getSessionCheckpointContext(input.sessionId)
        .pipe(Effect.withSpan("checkpoint.turnDiff.lookupContext"));
      if (Option.isNone(sessionContext)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Session '${input.sessionId}' not found.`,
        });
      }

      const maxTurnCount = sessionContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          sessionId: input.sessionId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = sessionContext.value.worktreePath ?? sessionContext.value.workspaceRoot;
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for session '${input.sessionId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForSessionTurn(input.sessionId, 0)
          : sessionContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          sessionId: input.sessionId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = sessionContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          sessionId: input.sessionId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const diff = yield* checkpointStore
        .diffCheckpoints({
          cwd: workspaceCwd,
          fromCheckpointRef,
          toCheckpointRef,
          fallbackFromToHead: false,
          ignoreWhitespace,
        })
        .pipe(Effect.withSpan("checkpoint.turnDiff.diffCheckpoints"));

      const turnDiff = buildTurnDiffResult(input, diff);
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    },
  );

  const getFullSessionDiff: CheckpointDiffQueryShape["getFullSessionDiff"] = Effect.fn(
    "CheckpointDiffQuery.getFullSessionDiff",
  )(function* (input) {
    const operation = "CheckpointDiffQuery.getFullSessionDiff";
    const ignoreWhitespace = input.ignoreWhitespace ?? true;
    yield* Effect.annotateCurrentSpan({
      "checkpoint.session_id": input.sessionId,
      "checkpoint.from_turn_count": 0,
      "checkpoint.to_turn_count": input.toTurnCount,
      "checkpoint.ignore_whitespace": ignoreWhitespace,
      "checkpoint.diff_kind": "full-session",
    });

    if (input.toTurnCount === 0) {
      const emptyDiff = buildTurnDiffResult(
        {
          sessionId: input.sessionId,
          fromTurnCount: 0,
          toTurnCount: 0,
        },
        "",
      );
      if (!isTurnDiffResult(emptyDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed full session diff result does not satisfy contract schema.",
        });
      }
      return emptyDiff satisfies OrchestrationGetFullSessionDiffResult;
    }

    const sessionContext = yield* projectionSnapshotQuery
      .getFullSessionDiffContext(input.sessionId, input.toTurnCount)
      .pipe(Effect.withSpan("checkpoint.fullSession.lookupContext"));

    if (Option.isNone(sessionContext)) {
      return yield* new CheckpointInvariantError({
        operation,
        detail: `Session '${input.sessionId}' not found.`,
      });
    }

    if (input.toTurnCount > sessionContext.value.latestCheckpointTurnCount) {
      return yield* new CheckpointUnavailableError({
        sessionId: input.sessionId,
        turnCount: input.toTurnCount,
        detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${sessionContext.value.latestCheckpointTurnCount}.`,
      });
    }

    const workspaceCwd = sessionContext.value.worktreePath ?? sessionContext.value.workspaceRoot;
    if (!workspaceCwd) {
      return yield* new CheckpointInvariantError({
        operation,
        detail: `Workspace path missing for session '${input.sessionId}' when computing full session diff.`,
      });
    }

    if (!sessionContext.value.toCheckpointRef) {
      return yield* new CheckpointUnavailableError({
        sessionId: input.sessionId,
        turnCount: input.toTurnCount,
        detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
      });
    }

    const diff = yield* checkpointStore
      .diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef: checkpointRefForSessionTurn(input.sessionId, 0),
        toCheckpointRef: sessionContext.value.toCheckpointRef as CheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace,
      })
      .pipe(Effect.withSpan("checkpoint.fullSession.diffCheckpoints"));

    const turnDiff = buildTurnDiffResult(
      {
        sessionId: input.sessionId,
        fromTurnCount: 0,
        toTurnCount: input.toTurnCount,
      },
      diff,
    );
    if (!isTurnDiffResult(turnDiff)) {
      return yield* new CheckpointInvariantError({
        operation,
        detail: "Computed full session diff result does not satisfy contract schema.",
      });
    }

    return turnDiff satisfies OrchestrationGetFullSessionDiffResult;
  });

  return {
    getTurnDiff,
    getFullSessionDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
