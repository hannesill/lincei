import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DatasetClearCredentialsInput,
  DatasetCredentialPresence,
  DatasetInitializeInput,
  DatasetSaveBigQueryCredentialsInput,
  DatasetSavePhysioNetCredentialsInput,
  DatasetSettings,
  DatasetStatusSnapshot,
  DatasetStatusResult,
} from "./datasets.ts";

const decodeCredentials = Schema.decodeUnknownSync(DatasetCredentialPresence);
const decodePhysioNetCredentialsInput = Schema.decodeUnknownSync(
  DatasetSavePhysioNetCredentialsInput,
);
const decodeBigQueryCredentialsInput = Schema.decodeUnknownSync(
  DatasetSaveBigQueryCredentialsInput,
);
const decodeSettings = Schema.decodeUnknownSync(DatasetSettings);
const decodeSnapshot = Schema.decodeUnknownSync(DatasetStatusSnapshot);
const decodeStatus = Schema.decodeUnknownSync(DatasetStatusResult);
const decodeInitializeInput = Schema.decodeUnknownSync(DatasetInitializeInput);
const decodeClearCredentialsInput = Schema.decodeUnknownSync(DatasetClearCredentialsInput);

describe("dataset credential contracts", () => {
  it("accepts secret-bearing save inputs without exposing secrets in presence snapshots", () => {
    const physioNetInput = decodePhysioNetCredentialsInput({
      username: "  researcher  ",
      password: "  token-value  ",
    });
    const bigQueryInput = decodeBigQueryCredentialsInput({
      projectId: "  clinical-project  ",
      serviceAccountJson: '  {"client_email":"service@example.com"}  ',
    });

    expect(physioNetInput).toEqual({
      username: "researcher",
      password: "token-value",
    });
    expect(bigQueryInput).toEqual({
      projectId: "clinical-project",
      serviceAccountJson: '{"client_email":"service@example.com"}',
      useApplicationDefaultCredentials: false,
    });

    const presence = decodeCredentials({
      physioNet: { stored: true, username: "researcher" },
      bigQuery: {
        stored: true,
        projectId: "clinical-project",
        serviceAccountJsonStored: true,
      },
    });

    expect(JSON.stringify(presence)).not.toContain("token-value");
    expect(JSON.stringify(presence)).not.toContain("client_email");
  });

  it("defaults BigQuery credential capability flags when decoding old snapshots", () => {
    const presence = decodeCredentials({
      physioNet: { stored: false },
      bigQuery: { stored: false },
    });

    expect(presence.bigQuery.serviceAccountJsonStored).toBe(false);
    expect(presence.bigQuery.applicationDefaultCredentials).toBe(false);
  });
});

describe("dataset settings contracts", () => {
  it("defaults to non-secret M4 preferences only", () => {
    expect(decodeSettings({})).toEqual({
      workspacePath: "",
      preferredBackendId: "duckdb",
      m4Command: "",
    });
  });
});

describe("dataset status contracts", () => {
  it("decodes readiness snapshots with default table arrays", () => {
    const status = decodeStatus({
      runtime: {
        available: true,
        command: "uvx --from m4-infra m4",
        checkedAt: "2026-05-27T10:00:00.000Z",
      },
      credentials: {
        physioNet: { stored: true, username: "researcher" },
        bigQuery: { stored: false },
      },
      datasets: [
        {
          datasetId: "mimic-iv-demo",
          backendId: "duckdb",
          readiness: "ready",
          initialized: true,
          selected: true,
          lastCheckedAt: "2026-05-27T10:00:00.000Z",
        },
      ],
      appReadiness: {
        selectedDatasetId: "mimic-iv-demo",
        selectedBackendId: "duckdb",
        clinicalDataReady: true,
        readiness: "ready",
        lastCheckedAt: "2026-05-27T10:00:00.000Z",
      },
    });

    expect(status.datasets[0]?.tables).toEqual([]);
  });

  it("decodes optional derived table readiness when present", () => {
    const snapshot = decodeSnapshot({
      datasetId: "mimic-iv",
      backendId: "duckdb",
      readiness: "ready",
      initialized: true,
      selected: true,
      lastCheckedAt: "2026-05-27T10:00:00.000Z",
      derivedTables: {
        supported: true,
        ready: false,
        total: 20,
        materialized: 12,
        backendAvailable: false,
      },
    });

    expect(snapshot.derivedTables).toEqual({
      supported: true,
      ready: false,
      total: 20,
      materialized: 12,
      backendAvailable: false,
    });
    expect(snapshot.tables).toEqual([]);
  });

  it("preserves backwards compatibility when derived table readiness is absent", () => {
    const snapshot = decodeSnapshot({
      datasetId: "mimic-iv-demo",
      backendId: "duckdb",
      readiness: "ready",
      initialized: true,
      selected: true,
      lastCheckedAt: "2026-05-27T10:00:00.000Z",
    });

    expect(snapshot.derivedTables).toBeUndefined();
    expect(snapshot.tables).toEqual([]);
  });

  it("rejects unsupported dataset and credential ids", () => {
    expect(() => decodeInitializeInput({ datasetId: "mimic-iii" })).toThrow();

    expect(() =>
      decodeClearCredentialsInput({
        credentialKind: "physionet-password",
      }),
    ).toThrow();
  });
});
