import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  NodeId,
  RunId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { v2Now, v2Projection, v2ThreadId } from "../state/orchestrationV2TestFixtures.ts";
import { findRevertCheckpoint } from "./revertCheckpoint.ts";

const scopeId = CheckpointScopeId.make("scope-root");

const run = (ordinal: number, status: OrchestrationV2Run["status"]): OrchestrationV2Run => ({
  id: RunId.make(`run-${ordinal}`),
  threadId: v2ThreadId,
  ordinal,
  providerInstanceId: v2Projection.thread.providerInstanceId,
  modelSelection: v2Projection.thread.modelSelection,
  providerThreadId: null,
  userMessageId: MessageId.make(`message-${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: v2Now,
  startedAt: v2Now,
  completedAt: v2Now,
  checkpointId: CheckpointId.make(`checkpoint-${ordinal}`),
  contextHandoffId: null,
});

const checkpoint = (
  ordinal: number,
  status: OrchestrationV2Checkpoint["status"],
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${ordinal}`),
  threadId: v2ThreadId,
  scopeId,
  runId: ordinal === 0 ? null : RunId.make(`run-${ordinal}`),
  nodeId: NodeId.make(`node-${ordinal}`),
  parentCheckpointId: null,
  ordinalWithinScope: ordinal,
  appRunOrdinal: ordinal === 0 ? null : ordinal,
  ref: CheckpointRef.make(`refs/t3/checkpoints/${ordinal}`),
  status,
  files: [],
  capturedAt: v2Now,
});

// The web client asks for the run ordinal just below the edited message's run
// (deriveRevertTurnCountByUserMessageId), so these cases pass that ordinal.
describe("findRevertCheckpoint", () => {
  it("rewinds a resent first message to the thread start", () => {
    // Send, rewind to the start, send again: run 1 is rolled back and run 2
    // replaces it, so editing the first message again asks for ordinal 1.
    const projection = {
      runs: [run(1, "rolled_back"), run(2, "completed")],
      checkpoints: [checkpoint(0, "ready"), checkpoint(1, "stale"), checkpoint(2, "ready")],
    };

    expect(findRevertCheckpoint(projection, 1)?.id).toBe("checkpoint-0");
  });

  it("skips rolled-back runs between live ones", () => {
    // Messages 1-3, rewind to message 2, resend it (run 4), then send run 5.
    const projection = {
      runs: [
        run(1, "completed"),
        run(2, "rolled_back"),
        run(3, "rolled_back"),
        run(4, "completed"),
        run(5, "completed"),
      ],
      checkpoints: [
        checkpoint(0, "ready"),
        checkpoint(1, "ready"),
        checkpoint(2, "stale"),
        checkpoint(3, "stale"),
        checkpoint(4, "ready"),
        checkpoint(5, "ready"),
      ],
    };

    expect(findRevertCheckpoint(projection, 3)?.id).toBe("checkpoint-1");
    expect(findRevertCheckpoint(projection, 4)?.id).toBe("checkpoint-4");
  });
});
