import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor);

it.effect("accepts legacy descriptors with lifecycle capabilities absent", () =>
  Effect.gen(function* () {
    const descriptor = yield* decodeDescriptor({
      environmentId: "environment-legacy",
      label: "Legacy",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.0.1",
      capabilities: { repositoryIdentity: true },
    });

    assert.strictEqual(descriptor.capabilities.repositoryIdentity, true);
    assert.strictEqual(descriptor.capabilities.sessionSettlement ?? false, false);
    assert.strictEqual(descriptor.capabilities.sessionSnooze ?? false, false);
  }),
);

it.effect("preserves advertised lifecycle capabilities", () =>
  Effect.gen(function* () {
    const descriptor = yield* decodeDescriptor({
      environmentId: "environment-current",
      label: "Current",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.2",
      capabilities: {
        repositoryIdentity: true,
        sessionSettlement: true,
        sessionSnooze: true,
      },
    });

    assert.strictEqual(descriptor.capabilities.sessionSettlement, true);
    assert.strictEqual(descriptor.capabilities.sessionSnooze, true);
  }),
);
