import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type EnvironmentApi,
  type LocalApi,
  ProjectId,
  ProviderInstanceId,
  type ServerConfig,
  type VitrineRuntimeStatus,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import {
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from "../../environments/primary";
import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { useStore } from "../../store";
import { forgetVitrineAutoOpenIntent, readVitrineAutoOpenIntent } from "../../vitrinePreview";
import { ResearchSettingsPanel } from "./ResearchSettings";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-research");
const NOW_ISO = "2026-07-28T10:00:00.000Z";

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createServerConfig(executablePath = ""): ServerConfig {
  return {
    environment: {
      environmentId: ENVIRONMENT_ID,
      label: "Local environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "desktop-managed-local",
      bootstrapMethods: ["desktop-bootstrap"],
      sessionMethods: ["bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    shortcutsConfigPath: "/repo/project/.t3code-shortcuts.json",
    shortcuts: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      vitrine: { executablePath },
    },
  };
}

function createRuntimeStatus(overrides: Partial<VitrineRuntimeStatus> = {}): VitrineRuntimeStatus {
  return {
    status: "ready",
    source: "settings",
    executable: "/repo/project/.venv/bin/vitrine",
    version: "0.1.1",
    lifecycleContractVersion: 1,
    pythonExecutable: "/repo/project/.venv/bin/python",
    supportedVersionRange: ">=0.1.1 <0.2.0",
    requiredLifecycleContractVersion: 1,
    message: null,
    checkedAt: NOW_ISO,
    ...overrides,
  };
}

function installResearchFixture(input: {
  runtimeStatus: VitrineRuntimeStatus;
  executablePath?: string;
}) {
  const config = createServerConfig(input.executablePath);
  const runtimeStatus = vi.fn().mockResolvedValue(input.runtimeStatus);
  const updateSettings = vi.fn().mockImplementation(async (patch) => ({
    ...config.settings,
    vitrine: {
      executablePath: patch.vitrine?.executablePath ?? config.settings.vitrine.executablePath,
    },
  }));

  writePrimaryEnvironmentDescriptor(config.environment);
  setServerConfigSnapshot(config);
  useStore.getState().syncServerShellSnapshot(
    {
      snapshotSequence: 1,
      projects: [
        {
          id: PROJECT_ID,
          title: "Cardiology review",
          workspaceRoot: "/repo/project",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5",
          },
          scripts: [],
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      ],
      sessions: [],
      updatedAt: NOW_ISO,
    },
    ENVIRONMENT_ID,
  );
  __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, {
    vitrine: { runtimeStatus },
  } as unknown as EnvironmentApi);
  window.nativeApi = {
    server: { updateSettings },
  } as unknown as LocalApi;
  window.desktopBridge = {
    preview: {},
  } as unknown as NonNullable<typeof window.desktopBridge>;

  return { runtimeStatus, updateSettings };
}

describe("ResearchSettingsPanel", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  beforeEach(async () => {
    await __resetLocalApiForTests();
    resetServerStateForTests();
    __resetEnvironmentApiOverridesForTests();
    resetPrimaryEnvironmentDescriptorForTests();
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    window.localStorage.clear();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    forgetVitrineAutoOpenIntent(ENVIRONMENT_ID, PROJECT_ID);
    Reflect.deleteProperty(window, "nativeApi");
    Reflect.deleteProperty(window, "desktopBridge");
    __resetEnvironmentApiOverridesForTests();
    resetPrimaryEnvironmentDescriptorForTests();
    resetServerStateForTests();
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    document.body.innerHTML = "";
    await __resetLocalApiForTests();
  });

  it("shows runtime provenance, version, contract, and analysis Python", async () => {
    installResearchFixture({ runtimeStatus: createRuntimeStatus() });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ResearchSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Ready", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Source: Research settings")).toBeInTheDocument();
    await expect
      .element(page.getByText("Vitrine 0.1.1 · supported >=0.1.1 <0.2.0"))
      .toBeInTheDocument();
    await expect.element(page.getByText("Lifecycle contract 1 · required 1")).toBeInTheDocument();
    await expect.element(page.getByText("/repo/project/.venv/bin/python")).toBeInTheDocument();
    await expect
      .element(page.getByText("The lifecycle executable and analysis Python are separate."))
      .toBeInTheDocument();
  });

  it("makes the executable setting read-only when the environment override is active", async () => {
    installResearchFixture({
      executablePath: "/settings/vitrine",
      runtimeStatus: createRuntimeStatus({
        source: "environment",
        executable: "/environment/vitrine",
      }),
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ResearchSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Source: LINCEI_VITRINE_EXECUTABLE")).toBeInTheDocument();
    await expect
      .element(page.getByText(/LINCEI_VITRINE_EXECUTABLE overrides this setting/))
      .toBeInTheDocument();
    await expect.element(page.getByLabelText("Vitrine executable path")).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a configured executable and refreshes runtime status", async () => {
    const { runtimeStatus, updateSettings } = installResearchFixture({
      runtimeStatus: createRuntimeStatus(),
    });
    const executablePath = "/repo/project/.venv/bin/vitrine";
    const updateDeferred = createDeferredPromise<ServerConfig["settings"]>();
    updateSettings.mockReturnValueOnce(updateDeferred.promise);

    mounted = await render(
      <AppAtomRegistryProvider>
        <ResearchSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await vi.waitFor(() => {
      expect(runtimeStatus).toHaveBeenCalledTimes(1);
    });
    await expect.element(page.getByText("Ready", { exact: true })).toBeInTheDocument();
    await page.getByLabelText("Vitrine executable path").fill(executablePath);
    await page.getByRole("button", { name: "Save" }).click();

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        vitrine: { executablePath },
      });
    });
    await expect.element(page.getByRole("button", { name: "Check again" })).toBeDisabled();
    expect(runtimeStatus).toHaveBeenCalledTimes(1);

    updateDeferred.resolve(createServerConfig(executablePath).settings);

    await vi.waitFor(() => {
      expect(runtimeStatus).toHaveBeenCalledTimes(2);
    });
    await expect.element(page.getByRole("button", { name: "Check again" })).not.toBeDisabled();
  });

  it("updates per-project automatic reopen intent", async () => {
    installResearchFixture({ runtimeStatus: createRuntimeStatus() });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ResearchSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const autoReopen = page.getByRole("switch", {
      name: "Automatically reopen Research for Cardiology review",
    });
    await expect.element(autoReopen).not.toBeChecked();
    await autoReopen.click();
    expect(readVitrineAutoOpenIntent(ENVIRONMENT_ID, PROJECT_ID)).toBe(true);
    await expect.element(autoReopen).toBeChecked();
  });
});
