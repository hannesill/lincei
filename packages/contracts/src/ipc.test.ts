import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { EnvironmentId } from "./baseSchemas.ts";
import {
  LegacyPersistedSavedEnvironmentRecordSchema,
  PersistedSavedEnvironmentRecordSchema,
} from "./ipc.ts";

const decodePersistedSavedEnvironmentRecord = Schema.decodeUnknownSync(
  PersistedSavedEnvironmentRecordSchema,
);
const decodeLegacyPersistedSavedEnvironmentRecord = Schema.decodeUnknownSync(
  LegacyPersistedSavedEnvironmentRecordSchema,
);

const makeRecord = (overrides?: {
  readonly httpBaseUrl?: string;
  readonly wsBaseUrl?: string;
}) => ({
  environmentId: EnvironmentId.make("environment-remote"),
  label: "Remote environment",
  httpBaseUrl: overrides?.httpBaseUrl ?? "https://remote.example.test:44342/",
  wsBaseUrl: overrides?.wsBaseUrl ?? "wss://remote.example.test:44342/",
  createdAt: "2026-07-28T00:00:00.000Z",
  lastConnectedAt: null,
});

describe("PersistedSavedEnvironmentRecordSchema", () => {
  it("keeps unsupported legacy targets decodable at read-only migration boundaries", () => {
    const legacyRecord = makeRecord({
      httpBaseUrl: "ftp://remote.example.test/",
      wsBaseUrl: "file:///tmp/lincei.sock",
    });

    expect(decodeLegacyPersistedSavedEnvironmentRecord(legacyRecord)).toEqual(legacyRecord);
    expect(() => decodePersistedSavedEnvironmentRecord(legacyRecord)).toThrow();
  });

  it("accepts aligned HTTP and WebSocket remote endpoints", () => {
    expect(decodePersistedSavedEnvironmentRecord(makeRecord()).environmentId).toBe(
      "environment-remote",
    );
    expect(
      decodePersistedSavedEnvironmentRecord(
        makeRecord({
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
        }),
      ).httpBaseUrl,
    ).toBe("http://127.0.0.1:3773/");
  });

  it.each([
    {
      httpBaseUrl: "ftp://remote.example.test/",
      wsBaseUrl: "wss://remote.example.test/",
    },
    {
      httpBaseUrl: "https://remote.example.test/",
      wsBaseUrl: "file:///tmp/lincei.sock",
    },
    {
      httpBaseUrl: "https://remote-a.example.test/",
      wsBaseUrl: "wss://remote-b.example.test/",
    },
  ])("rejects unsupported or mismatched persisted targets: %o", (record) => {
    expect(() => decodePersistedSavedEnvironmentRecord(makeRecord(record))).toThrow();
  });
});
