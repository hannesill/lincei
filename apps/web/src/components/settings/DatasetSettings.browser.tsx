import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type DatasetStatusResult,
  type LocalApi,
  type ServerConfig,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { DatasetSettingsPanel } from "./DatasetSettings";

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    shortcutsConfigPath: "/repo/project/.t3code-shortcuts.json",
    shortcuts: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createDatasetStatus(overrides: Partial<DatasetStatusResult> = {}): DatasetStatusResult {
  const base: DatasetStatusResult = {
    runtime: {
      available: true,
      command: "uvx --from m4-infra m4",
      workspacePath: "/repo/project",
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
    datasets: [
      {
        datasetId: "mimic-iv-demo",
        backendId: "duckdb",
        readiness: "ready",
        initialized: true,
        active: true,
        tables: [{ name: "primary", ready: true, rowCount: 100 }],
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
      },
      {
        datasetId: "mimic-iv",
        backendId: "duckdb",
        readiness: "missing_credentials",
        initialized: false,
        active: false,
        tables: [],
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
      },
      {
        datasetId: "mimic-iv-note",
        backendId: "duckdb",
        readiness: "not_initialized",
        initialized: false,
        active: false,
        tables: [],
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
      },
      {
        datasetId: "eicu",
        backendId: "duckdb",
        readiness: "ready",
        initialized: true,
        active: false,
        tables: [],
        lastCheckedAt: "2026-05-28T10:00:00.000Z",
      },
    ],
    appReadiness: {
      activeDatasetId: "mimic-iv-demo",
      activeBackendId: "duckdb",
      clinicalDataReady: true,
      readiness: "ready",
      lastCheckedAt: "2026-05-28T10:00:00.000Z",
    },
  };
  return { ...base, ...overrides };
}

function installDatasetApi(overrides: Partial<LocalApi["datasets"]> = {}) {
  const datasets: LocalApi["datasets"] = {
    getStatus: vi.fn().mockResolvedValue(createDatasetStatus()),
    savePhysioNetCredentials: vi.fn().mockResolvedValue({
      credentials: createDatasetStatus().credentials,
    }),
    saveBigQueryCredentials: vi.fn().mockResolvedValue({
      credentials: createDatasetStatus().credentials,
    }),
    initialize: vi.fn().mockResolvedValue(createDatasetStatus()),
    setActiveDataset: vi.fn().mockResolvedValue(createDatasetStatus()),
    clearCredentials: vi.fn().mockResolvedValue({
      credentials: createDatasetStatus().credentials,
    }),
    ...overrides,
  };
  window.nativeApi = {
    persistence: {
      getClientSettings: vi.fn().mockResolvedValue(null),
      setClientSettings: vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      pickFolder: vi.fn(),
      confirm: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      openInEditor: vi.fn(),
    },
    contextMenu: {
      show: vi.fn(),
    },
    server: {
      updateSettings: vi.fn().mockResolvedValue(DEFAULT_SERVER_SETTINGS),
    },
    datasets,
  } as unknown as LocalApi;
  return datasets;
}

describe("DatasetSettingsPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
    setServerConfigSnapshot(createBaseServerConfig());
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  it("renders readiness and dataset status", async () => {
    installDatasetApi();

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "Clinical Data Setup", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "MIMIC-IV Demo", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByText("Ready").first()).toBeInTheDocument();
    await expect.element(page.getByText("100 rows")).toBeInTheDocument();
  });

  it("renders derived table readiness only for supported datasets", async () => {
    const status = createDatasetStatus();
    installDatasetApi({
      getStatus: vi.fn().mockResolvedValue({
        ...status,
        datasets: status.datasets.map((dataset) =>
          dataset.datasetId === "mimic-iv"
            ? Object.assign({}, dataset, {
                readiness: "ready" as const,
                initialized: true,
                derivedTables: {
                  supported: true,
                  ready: false,
                  total: 20,
                  materialized: 12,
                  backendAvailable: false,
                },
              })
            : dataset,
        ),
      }),
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Derived tables: 12/20 materialized")).toBeInTheDocument();
    await expect.element(page.getByText("Derived tables ready")).not.toBeInTheDocument();
  });

  it("renders failed dataset readiness and error detail", async () => {
    const status = createDatasetStatus();
    installDatasetApi({
      getStatus: vi.fn().mockResolvedValue({
        ...status,
        datasets: status.datasets.map((dataset) =>
          dataset.datasetId === "mimic-iv"
            ? Object.assign({}, dataset, {
                readiness: "failed" as const,
                error: {
                  code: "dataset_initialization_failed" as const,
                  detail:
                    "M4 reported setup_state=download_failed for mimic-iv. Warnings: PhysioNet credentials were rejected.",
                  actionableMessage:
                    "Review the M4 dataset setup failure, fix the underlying issue, then initialize the dataset again.",
                },
              })
            : dataset,
        ),
      }),
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Failed").first()).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Review the M4 dataset setup failure, fix the underlying issue, then initialize the dataset again.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText(/setup_state=download_failed/)).toBeInTheDocument();
  });

  it("clears secret fields after credential save", async () => {
    const storedStatus = createDatasetStatus({
      credentials: {
        physioNet: {
          stored: true,
          username: "researcher",
          updatedAt: "2026-05-28T10:01:00.000Z",
        },
        bigQuery: {
          stored: true,
          projectId: "clinical-project",
          serviceAccountJsonStored: true,
          applicationDefaultCredentials: false,
          updatedAt: "2026-05-28T10:01:00.000Z",
        },
      },
    });
    const getStatus = vi
      .fn<LocalApi["datasets"]["getStatus"]>()
      .mockResolvedValueOnce(createDatasetStatus())
      .mockResolvedValue(storedStatus);
    const savePhysioNetCredentials = vi
      .fn<LocalApi["datasets"]["savePhysioNetCredentials"]>()
      .mockResolvedValue({ credentials: storedStatus.credentials });
    const saveBigQueryCredentials = vi
      .fn<LocalApi["datasets"]["saveBigQueryCredentials"]>()
      .mockResolvedValue({ credentials: storedStatus.credentials });
    installDatasetApi({ getStatus, savePhysioNetCredentials, saveBigQueryCredentials });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("PhysioNet username").fill("researcher");
    const passwordInput = page.getByLabelText("PhysioNet password");
    await passwordInput.fill("secret-password");
    await page.getByRole("button", { name: "Save PhysioNet credentials" }).click();
    await vi.waitFor(() => {
      expect(savePhysioNetCredentials).toHaveBeenCalledWith({
        username: "researcher",
        password: "secret-password",
      });
    });
    await expect.element(passwordInput).toHaveValue("");

    await page.getByLabelText("BigQuery project ID").fill("clinical-project");
    const jsonInput = page.getByLabelText("BigQuery service account JSON");
    await jsonInput.fill('{"private_key":"secret"}');
    await page.getByRole("button", { name: "Save BigQuery credentials" }).click();
    await vi.waitFor(() => {
      expect(saveBigQueryCredentials).toHaveBeenCalledWith({
        projectId: "clinical-project",
        serviceAccountJson: '{"private_key":"secret"}',
        useApplicationDefaultCredentials: false,
      });
    });
    await expect.element(jsonInput).toHaveValue("");
  });

  it("initializes a dataset and refreshes status", async () => {
    const getStatus = vi
      .fn<LocalApi["datasets"]["getStatus"]>()
      .mockResolvedValue(createDatasetStatus());
    const initialize = vi
      .fn<LocalApi["datasets"]["initialize"]>()
      .mockResolvedValue(createDatasetStatus());
    installDatasetApi({ getStatus, initialize });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("MIMIC-IV Note")).toBeInTheDocument();
    await page.getByRole("button", { name: "Initialize" }).nth(2).click();

    await vi.waitFor(() => {
      expect(initialize).toHaveBeenCalledWith({
        datasetId: "mimic-iv-note",
        backendId: "duckdb",
      });
      expect(getStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("sets the active dataset through the dataset RPC", async () => {
    const setActiveDataset = vi
      .fn<LocalApi["datasets"]["setActiveDataset"]>()
      .mockResolvedValue(createDatasetStatus());
    installDatasetApi({ setActiveDataset });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "eICU", exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Set active" }).nth(3).click();

    await vi.waitFor(() => {
      expect(setActiveDataset).toHaveBeenCalledWith({
        datasetId: "eicu",
        backendId: "duckdb",
      });
    });
  });

  it("renders actionable M4 errors", async () => {
    installDatasetApi({
      getStatus: vi.fn().mockRejectedValue({
        code: "m4_unavailable",
        detail: "M4 command could not be started: uvx.",
        actionableMessage: "Install or update m4-infra.",
        command: "uvx --from m4-infra m4 status --all --json",
      }),
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <DatasetSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Install or update m4-infra.")).toBeInTheDocument();
    await expect
      .element(page.getByText("M4 command could not be started: uvx."))
      .toBeInTheDocument();
  });
});
