import type {
  DatasetStatusResult,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusStreamEvent,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import { createWsRpcClient } from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

describe("wsRpcClient", () => {
  it("exposes dataset RPC methods under a typed namespace", async () => {
    const datasetStatus: DatasetStatusResult = {
      runtime: {
        available: true,
        command: "uvx --from m4-infra m4",
        checkedAt: "2026-05-28T10:00:00.000Z",
      },
      credentials: {
        physioNet: { stored: false },
        bigQuery: {
          stored: false,
          serviceAccountJsonStored: false,
          applicationDefaultCredentials: false,
        },
      },
      datasets: [],
      appReadiness: {
        clinicalDataReady: false,
        readiness: "not_initialized",
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
      },
    };
    const rpcMethods = {
      "datasets.getStatus": vi.fn(async () => datasetStatus),
      "datasets.initialize": vi.fn(async () => datasetStatus),
    };
    const request = vi.fn((connect: (client: unknown) => Promise<unknown>) => connect(rpcMethods));
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request,
      requestStream: vi.fn(),
      subscribe: vi.fn(),
    };

    const client = createWsRpcClient(transport as unknown as WsTransport);

    await expect(client.datasets.getStatus()).resolves.toEqual(datasetStatus);
    await expect(
      client.datasets.initialize({ datasetId: "mimic-iv-demo", backendId: "duckdb" }),
    ).resolves.toEqual(datasetStatus);
    expect(rpcMethods["datasets.getStatus"]).toHaveBeenCalledWith({});
    expect(rpcMethods["datasets.initialize"]).toHaveBeenCalledWith({
      datasetId: "mimic-iv-demo",
      backendId: "duckdb",
    });
  });

  it("exposes artifact study RPC methods under a typed namespace", async () => {
    const artifactRecord = {
      artifact: {
        schemaVersion: 1,
        id: "artifact-1",
        kind: "csv",
        relativePath: "outputs/cohort.csv",
        mimeType: "text/csv",
        size: 8,
        contentHash: "sha256:abc",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
      },
      relativePath: "outputs/cohort.csv",
      status: "current",
      currentSize: 8,
      currentMimeType: "text/csv",
      currentContentHash: "sha256:abc",
    };
    const preview = {
      artifact: artifactRecord,
      preview: {
        relativePath: "outputs/cohort.csv",
        mimeType: "text/csv",
        size: 8,
        contentHash: "sha256:abc",
        previewable: true,
        truncated: false,
        text: "a,b\n",
        reason: null,
      },
    };
    const rpcMethods = {
      "study.listArtifacts": vi.fn(async () => ({ artifacts: [artifactRecord] })),
      "study.getArtifact": vi.fn(async () => artifactRecord),
      "study.previewArtifact": vi.fn(async () => preview),
    };
    const request = vi.fn((connect: (client: unknown) => Promise<unknown>) => connect(rpcMethods));
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request,
      requestStream: vi.fn(),
      subscribe: vi.fn(),
    };
    const client = createWsRpcClient(transport as unknown as WsTransport);

    await expect(client.study.listArtifacts({ studyRoot: "/study" })).resolves.toEqual({
      artifacts: [artifactRecord],
    });
    await expect(
      client.study.getArtifact({ studyRoot: "/study", artifactId: "artifact-1" as never }),
    ).resolves.toEqual(artifactRecord);
    await expect(
      client.study.previewArtifact({ studyRoot: "/study", artifactId: "artifact-1" as never }),
    ).resolves.toEqual(preview);

    expect(rpcMethods["study.listArtifacts"]).toHaveBeenCalledWith({ studyRoot: "/study" });
    expect(rpcMethods["study.getArtifact"]).toHaveBeenCalledWith({
      studyRoot: "/study",
      artifactId: "artifact-1",
    });
    expect(rpcMethods["study.previewArtifact"]).toHaveBeenCalledWith({
      studyRoot: "/study",
      artifactId: "artifact-1",
    });
  });

  it("reduces vcs status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies VcsStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.vcs.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          aheadOfDefaultCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });
});
