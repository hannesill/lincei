import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ClientSettings.sidebarAutoSettleAfterDays", () => {
  it("defaults legacy settings to three days and permits disabling", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarAutoSettleAfterDays).toBe(3);
    expect(decodeClientSettings({}).sidebarAutoSettleAfterDays).toBe(3);
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it("accepts bounded whole-day thresholds", () => {
    expect(decodeClientSettings({ sidebarAutoSettleAfterDays: 1 }).sidebarAutoSettleAfterDays).toBe(
      1,
    );
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: 90 }).sidebarAutoSettleAfterDays,
    ).toBe(90);
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: 0 })).toThrow();
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: 3.5 })).toThrow();
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: 91 })).toThrow();
  });
});

describe("ClientSettings.sidebarV1RollbackEnabled", () => {
  it("defaults legacy settings to Sidebar v2", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarV1RollbackEnabled).toBe(false);
    expect(decodeClientSettings({}).sidebarV1RollbackEnabled).toBe(false);
  });

  it("round-trips an explicit Sidebar v1 rollback choice", () => {
    const settings = decodeClientSettings({ sidebarV1RollbackEnabled: true });
    expect(settings.sidebarV1RollbackEnabled).toBe(true);
    expect(encodeClientSettings(settings).sidebarV1RollbackEnabled).toBe(true);
    expect(decodeClientSettingsPatch({ sidebarV1RollbackEnabled: true })).toEqual({
      sidebarV1RollbackEnabled: true,
    });
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
    expect(DEFAULT_SERVER_SETTINGS.linceiSkills).toEqual({});
    expect(DEFAULT_SERVER_SETTINGS.linceiWorkflows).toEqual({});
    expect(DEFAULT_SERVER_SETTINGS.datasets).toEqual({
      workspacePath: "",
      preferredBackendId: "duckdb",
      m4Command: "",
    });
    expect(DEFAULT_SERVER_SETTINGS.vitrine).toEqual({
      executablePath: "",
    });
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    expect(decoded.linceiAgentCustomInstructions).toBe("");
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings.linceiSkills", () => {
  it("decodes legacy deployNative skill preferences without preserving native deployment", () => {
    const decoded = decodeServerSettings({
      linceiSkills: {
        "clinical-research-pitfalls": {
          enabled: false,
          deployNative: true,
        },
      },
    });

    expect(decoded.linceiSkills["m4:clinical-research-pitfalls"]).toEqual({
      enabled: false,
    });

    const encoded = encodeServerSettings(decoded);
    expect(encoded.linceiSkills?.["m4:clinical-research-pitfalls"]).toEqual({
      enabled: false,
    });
    expect(
      (
        encoded.linceiSkills?.["m4:clinical-research-pitfalls"] as
          | { deployNative?: unknown }
          | undefined
      )?.deployNative,
    ).toBeUndefined();
  });

  it("accepts lincei skill preference patches without deployNative", () => {
    const patch = decodeServerSettingsPatch({
      linceiSkills: {
        "lincei-api": {
          enabled: true,
          deployNative: false,
        },
      },
    });

    expect(patch.linceiSkills?.["lincei:context"]).toEqual({
      enabled: true,
    });
  });

  it("preserves unknown keys and lets an existing qualified preference win migration", () => {
    const decoded = decodeServerSettings({
      linceiSkills: {
        "lincei-api": { enabled: false },
        "lincei:context": { enabled: true },
        "future:unknown-skill": { enabled: false },
      },
    });

    expect(decoded.linceiSkills).toEqual({
      "lincei:context": { enabled: true },
      "future:unknown-skill": { enabled: false },
    });
    expect(encodeServerSettings(decoded).linceiSkills).toEqual(decoded.linceiSkills);
  });
});

describe("ServerSettings.linceiWorkflows", () => {
  it("decodes and patches workflow enablement preferences", () => {
    const decoded = decodeServerSettings({
      linceiWorkflows: {
        "structured-clinical-study": {
          enabled: false,
        },
      },
    });

    expect(decoded.linceiWorkflows["structured-clinical-study"]).toEqual({
      enabled: false,
    });

    const patch = decodeServerSettingsPatch({
      linceiWorkflows: {
        "structured-clinical-study": {
          enabled: true,
        },
      },
    });

    expect(patch.linceiWorkflows?.["structured-clinical-study"]).toEqual({
      enabled: true,
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch.datasets", () => {
  it("keeps dataset preferences non-secret and patchable", () => {
    const patch = decodeServerSettingsPatch({
      datasets: {
        workspacePath: "  ~/.lincei/m4  ",
        preferredBackendId: "bigquery",
        m4Command: "  uvx --from 'm4-infra>=0.5.4,<0.6' m4  ",
      },
    });

    expect(patch.datasets).toEqual({
      workspacePath: "~/.lincei/m4",
      preferredBackendId: "bigquery",
      m4Command: "uvx --from 'm4-infra>=0.5.4,<0.6' m4",
    });
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      vitrine: {
        executablePath: "  ~/.venvs/research/bin/vitrine  ",
      },
      linceiAgentCustomInstructions: "  Prefer concise status updates.  ",
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.linceiAgentCustomInstructions).toBe("Prefer concise status updates.");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.vitrine?.executablePath).toBe("~/.venvs/research/bin/vitrine");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      linceiAgentCustomInstructions: "  Prefer concise status updates.  ",
      vitrine: {
        executablePath: "  /opt/vitrine/bin/vitrine  ",
      },
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.linceiAgentCustomInstructions).toBe("Prefer concise status updates.");
    expect(encoded.vitrine?.executablePath).toBe("/opt/vitrine/bin/vitrine");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
  });
});

describe("ServerSettings.vitrine", () => {
  it("decodes and patches a trimmed executable path", () => {
    expect(
      decodeServerSettings({
        vitrine: { executablePath: "  /project/.venv/bin/vitrine  " },
      }).vitrine,
    ).toEqual({ executablePath: "/project/.venv/bin/vitrine" });

    expect(
      decodeServerSettingsPatch({
        vitrine: { executablePath: "   " },
      }).vitrine,
    ).toEqual({ executablePath: "" });
  });
});
