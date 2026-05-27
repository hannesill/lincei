import { scopedSessionKey, scopeSessionRef } from "@t3tools/client-runtime";
import { SessionId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { collectActiveTerminalSessionIds } from "./terminalStateCleanup";

const sessionId = (id: string): SessionId => SessionId.make(id);
const sessionKey = (environmentId: string, id: string): string =>
  scopedSessionKey(scopeSessionRef(environmentId as never, sessionId(id)));

describe("collectActiveTerminalSessionIds", () => {
  it("retains non-deleted server sessions", () => {
    const activeSessionIds = collectActiveTerminalSessionIds({
      snapshotSessions: [
        { key: sessionKey("env-a", "server-1"), deletedAt: null, archivedAt: null },
        { key: sessionKey("env-b", "server-2"), deletedAt: null, archivedAt: null },
      ],
      draftSessionKeys: [],
    });

    expect(activeSessionIds).toEqual(
      new Set([sessionKey("env-a", "server-1"), sessionKey("env-b", "server-2")]),
    );
  });

  it("ignores deleted and archived server sessions and keeps local draft sessions", () => {
    const activeSessionIds = collectActiveTerminalSessionIds({
      snapshotSessions: [
        { key: sessionKey("env-a", "server-active"), deletedAt: null, archivedAt: null },
        {
          key: sessionKey("env-a", "server-deleted"),
          deletedAt: "2026-03-05T08:00:00.000Z",
          archivedAt: null,
        },
        {
          key: sessionKey("env-a", "server-archived"),
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftSessionKeys: [sessionKey("env-a", "local-draft")],
    });

    expect(activeSessionIds).toEqual(
      new Set([sessionKey("env-a", "server-active"), sessionKey("env-a", "local-draft")]),
    );
  });

  it("does not keep draft-linked terminal state for archived server sessions", () => {
    const archivedSessionId = sessionKey("env-a", "server-archived");

    const activeSessionIds = collectActiveTerminalSessionIds({
      snapshotSessions: [
        {
          key: archivedSessionId,
          deletedAt: null,
          archivedAt: "2026-03-05T09:00:00.000Z",
        },
      ],
      draftSessionKeys: [archivedSessionId, sessionKey("env-a", "local-draft")],
    });

    expect(activeSessionIds).toEqual(new Set([sessionKey("env-a", "local-draft")]));
  });
});
