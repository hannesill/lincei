import { describe, expect, it } from "vitest";
import { scopeSessionRef } from "@t3tools/client-runtime";
import { SessionId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";

import {
  buildDraftSessionRouteParams,
  buildSessionRouteParams,
  resolveSessionRouteRef,
  resolveSessionRouteTarget,
} from "./sessionRoutes";

describe("sessionRoutes", () => {
  it("builds canonical session route params from a scoped ref", () => {
    const ref = scopeSessionRef("env-1" as never, SessionId.make("session-1"));

    expect(buildSessionRouteParams(ref)).toEqual({
      environmentId: "env-1",
      sessionId: "session-1",
    });
  });

  it("resolves a scoped ref only when both params are present", () => {
    expect(
      resolveSessionRouteRef({
        environmentId: "env-1",
        sessionId: "session-1",
      }),
    ).toEqual({
      environmentId: "env-1",
      sessionId: "session-1",
    });

    expect(resolveSessionRouteRef({ environmentId: "env-1" })).toBeNull();
    expect(resolveSessionRouteRef({ sessionId: "session-1" })).toBeNull();
  });

  it("builds canonical draft route params from a draft id", () => {
    expect(buildDraftSessionRouteParams(DraftId.make("draft-1"))).toEqual({
      draftId: "draft-1",
    });
  });

  it("resolves draft and server route targets", () => {
    expect(
      resolveSessionRouteTarget({
        environmentId: "env-1",
        sessionId: "session-1",
      }),
    ).toEqual({
      kind: "server",
      sessionRef: {
        environmentId: "env-1",
        sessionId: "session-1",
      },
    });

    expect(
      resolveSessionRouteTarget({
        draftId: "draft-1",
      }),
    ).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });
});
