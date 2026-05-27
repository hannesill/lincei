import { EnvironmentId, ProjectId, SessionId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { createKnownEnvironment, getKnownEnvironmentHttpBaseUrl } from "./knownEnvironment.ts";
import {
  parseScopedProjectKey,
  parseScopedSessionKey,
  scopedProjectKey,
  scopedRefKey,
  scopedSessionKey,
  scopeProjectRef,
  scopeSessionRef,
} from "./scoped.ts";

describe("known environment bootstrap helpers", () => {
  it("creates known environments from explicit server base urls", () => {
    expect(
      createKnownEnvironment({
        label: "Remote environment",
        target: {
          httpBaseUrl: "https://remote.example.com",
          wsBaseUrl: "wss://remote.example.com",
        },
      }),
    ).toEqual({
      id: "ws:Remote environment",
      label: "Remote environment",
      source: "manual",
      target: {
        httpBaseUrl: "https://remote.example.com",
        wsBaseUrl: "wss://remote.example.com",
      },
    });
  });

  it("returns the explicit fetchable http origin", () => {
    expect(
      getKnownEnvironmentHttpBaseUrl(
        createKnownEnvironment({
          label: "Local environment",
          target: {
            httpBaseUrl: "http://localhost:3773",
            wsBaseUrl: "ws://localhost:3773",
          },
        }),
      ),
    ).toBe("http://localhost:3773");

    expect(
      getKnownEnvironmentHttpBaseUrl(
        createKnownEnvironment({
          label: "Remote environment",
          target: {
            httpBaseUrl: "https://remote.example.com/api",
            wsBaseUrl: "wss://remote.example.com/api",
          },
        }),
      ),
    ).toBe("https://remote.example.com/api");
  });
});

describe("scoped refs", () => {
  const environmentId = EnvironmentId.make("environment-test");
  const projectRef = scopeProjectRef(environmentId, ProjectId.make("project-1"));
  const sessionRef = scopeSessionRef(environmentId, SessionId.make("session-1"));

  it("builds stable scoped project and session keys", () => {
    expect(scopedRefKey(projectRef)).toBe("environment-test:project-1");
    expect(scopedRefKey(sessionRef)).toBe("environment-test:session-1");
    expect(scopedProjectKey(projectRef)).toBe("environment-test:project-1");
    expect(scopedSessionKey(sessionRef)).toBe("environment-test:session-1");
  });

  it("returns typed scoped refs", () => {
    expect(projectRef).toEqual({
      environmentId,
      projectId: ProjectId.make("project-1"),
    });
    expect(sessionRef).toEqual({
      environmentId,
      sessionId: SessionId.make("session-1"),
    });
  });

  it("parses scoped project and session keys back into refs", () => {
    expect(parseScopedProjectKey("environment-test:project-1")).toEqual(projectRef);
    expect(parseScopedSessionKey("environment-test:session-1")).toEqual(sessionRef);
    expect(parseScopedProjectKey("bad-key")).toBeNull();
    expect(parseScopedSessionKey("bad-key")).toBeNull();
  });
});
