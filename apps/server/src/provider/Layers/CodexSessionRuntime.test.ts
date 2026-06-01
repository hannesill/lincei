import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, it } from "vitest";
import { SessionId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  appendLinceiAgentInstructions,
  buildLinceiAgentInstructions,
} from "../LinceiAgentInstructions.ts";
import {
  buildTurnStartParams,
  isRecoverableSessionResumeError,
  openCodexSession,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

function makeSessionOpenResponse(
  sessionId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: sessionId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        sessionId: "provider-session-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-session-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendLinceiAgentInstructions(
            CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
          ),
        },
      },
    });
  });

  it("includes custom Lincei instructions in collaboration mode developer instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        sessionId: "provider-session-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        interactionMode: "plan",
        linceiAgentCustomInstructions: "Prefer concise status updates.",
      }),
    );

    assert.equal(
      params.collaborationMode?.settings.developer_instructions,
      appendLinceiAgentInstructions(
        CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
        "Prefer concise status updates.",
      ),
    );
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        sessionId: "provider-session-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-session-1",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendLinceiAgentInstructions(
            CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
          ),
        },
      },
    });
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        sessionId: "provider-session-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-session-1",
      approvalPolicy: "untrusted",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("isRecoverableSessionResumeError", () => {
  it("matches missing session errors", () => {
    assert.equal(
      isRecoverableSessionResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Session does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableSessionResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention sessions", () => {
    assert.equal(
      isRecoverableSessionResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableSessionResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexSession", () => {
  it("falls back to session/start when resume fails recoverably", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const started = makeSessionOpenResponse("fresh-session");
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "session not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    const developerInstructions = buildLinceiAgentInstructions();
    const opened = await Effect.runPromise(
      openCodexSession({
        client,
        sessionId: SessionId.make("session-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        developerInstructions,
        resumeSessionId: "stale-session",
      }),
    );

    assert.equal(opened.thread.id, "fresh-session");
    assert.deepStrictEqual(
      calls.map((call) => call.method),
      ["thread/resume", "thread/start"],
    );
    assert.deepStrictEqual(calls[0]?.payload, {
      threadId: "stale-session",
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: "gpt-5.3-codex",
      developerInstructions,
    });
    assert.deepStrictEqual(calls[1]?.payload, {
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: "gpt-5.3-codex",
      developerInstructions,
    });
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeSessionOpenResponse("fresh-session") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    const developerInstructions = buildLinceiAgentInstructions();
    await assert.rejects(
      Effect.runPromise(
        openCodexSession({
          client,
          sessionId: SessionId.make("session-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          developerInstructions,
          resumeSessionId: "stale-session",
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });
});
