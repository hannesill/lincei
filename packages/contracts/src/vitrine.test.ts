import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  ProjectId,
  VitrineLifecycleError,
  VitrineProjectState,
  VitrineRuntimeStatus,
} from "./index.ts";

const decode = Schema.decodeUnknownSync(VitrineProjectState);
const decodeLifecycleError = Schema.decodeUnknownSync(VitrineLifecycleError);
const decodeRuntimeStatus = Schema.decodeUnknownSync(VitrineRuntimeStatus);

describe("VitrineRuntimeStatus", () => {
  it("decodes a compatible configured runtime", () => {
    const status = decodeRuntimeStatus({
      status: "ready",
      source: "settings",
      executable: "/project/.venv/bin/vitrine",
      version: "0.1.1",
      lifecycleContractVersion: 1,
      pythonExecutable: "/project/.venv/bin/python",
      supportedVersionRange: ">=0.1.1 <0.2.0",
      requiredLifecycleContractVersion: 1,
      message: null,
      checkedAt: "2026-07-28T12:00:00.000Z",
    });

    expect(status.status).toBe("ready");
    expect(status.source).toBe("settings");
  });
});

describe("VitrineProjectState", () => {
  it("decodes a ready project server", () => {
    const state = decode({
      projectId: ProjectId.make("project-1"),
      status: "ready",
      dataDir: "/project/.vitrine",
      url: "http://vitrine.localhost:7741",
      apiUrl: "http://127.0.0.1:7741",
      pid: 1234,
      port: 7741,
      sessionId: "session-1",
      version: "0.1.0",
      issueCode: null,
      message: null,
      updatedAt: "2026-07-22T12:00:00.000Z",
    });

    expect(state.status).toBe("ready");
    expect(state.port).toBe(7741);
  });

  it("decodes an unavailable project server", () => {
    const state = decode({
      projectId: ProjectId.make("project-1"),
      status: "unavailable",
      dataDir: "/project/.vitrine",
      url: null,
      apiUrl: null,
      pid: null,
      port: null,
      sessionId: null,
      version: null,
      issueCode: "executable_unavailable",
      message: "Install Vitrine and ensure the vitrine executable is on PATH.",
      updatedAt: "2026-07-22T12:00:00.000Z",
    });

    expect(state.status).toBe("unavailable");
  });
});

describe("VitrineLifecycleError", () => {
  it.each(["browser_policy_unsupported", "browser_url_invalid", "browser_launch_failed"] as const)(
    "decodes the %s browser error",
    (code) => {
      const error = decodeLifecycleError({
        _tag: "VitrineLifecycleError",
        projectId: ProjectId.make("project-1"),
        code,
        message: "Vitrine could not be opened in the system browser.",
      });

      expect(error.code).toBe(code);
    },
  );
});
