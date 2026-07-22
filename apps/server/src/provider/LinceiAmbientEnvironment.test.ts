import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SessionId,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { VITRINE_DATA_DIR_ENV } from "@t3tools/shared/vitrine";
import { afterEach, describe, expect, it } from "vitest";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import {
  configureLinceiCliAmbientEnvironment,
  LINCEI_CLI_PATH_ENV,
  LINCEI_PROJECT_DIR_ENV,
  LINCEI_PROJECT_ID_ENV,
  LINCEI_PROVIDER_INSTANCE_ID_ENV,
  LINCEI_SESSION_ID_ENV,
  makeLinceiSessionEnvironment,
  prependPathEntry,
  resetLinceiCliAmbientEnvironmentForTest,
} from "./LinceiAmbientEnvironment.ts";

const PATH_DELIMITER = process.platform === "win32" ? ";" : ":";

const makeSessionInput = (): ProviderSessionStartInput => ({
  provider: ProviderDriverKind.make("codex"),
  sessionId: SessionId.make("session-1"),
  projectId: ProjectId.make("project-1"),
  workspaceRoot: "/workspace",
  providerInstanceId: ProviderInstanceId.make("codex-main"),
  runtimeMode: "full-access",
});

describe("makeLinceiSessionEnvironment", () => {
  afterEach(() => {
    resetLinceiCliAmbientEnvironmentForTest();
  });

  it("prepends the Lincei shim bin directory and preserves existing PATH entries", () => {
    configureLinceiCliAmbientEnvironment({
      binDir: "/state/bin",
      cliPath: "/state/bin/lincei",
    });

    const env = makeLinceiSessionEnvironment(makeSessionInput(), {
      PATH: ["/usr/local/bin", "/usr/bin"].join(PATH_DELIMITER),
    });

    expect(env.PATH).toBe(["/state/bin", "/usr/local/bin", "/usr/bin"].join(PATH_DELIMITER));
    expect(env[LINCEI_CLI_PATH_ENV]).toBe("/state/bin/lincei");
  });

  it("keeps existing Lincei session environment variables present", () => {
    const env = makeLinceiSessionEnvironment(makeSessionInput(), {});

    expect(env).toMatchObject({
      [LINCEI_SESSION_ID_ENV]: "session-1",
      [LINCEI_PROJECT_ID_ENV]: "project-1",
      [LINCEI_PROJECT_DIR_ENV]: "/workspace",
      [VITRINE_DATA_DIR_ENV]: "/workspace/.vitrine",
      [LINCEI_PROVIDER_INSTANCE_ID_ENV]: "codex-main",
    });
  });

  it("merges provider-specific overrides before adding ambient Lincei values", () => {
    configureLinceiCliAmbientEnvironment({
      binDir: "/state/bin",
      cliPath: "/state/bin/lincei",
    });
    const providerEnv = mergeProviderInstanceEnvironment(
      [
        { name: "ANTHROPIC_API_KEY", value: "sk-ant-test", sensitive: true },
        {
          name: "PATH",
          value: ["/provider/bin", "/usr/bin"].join(PATH_DELIMITER),
          sensitive: false,
        },
        {
          name: VITRINE_DATA_DIR_ENV,
          value: "/wrong/worktree/.vitrine",
          sensitive: false,
        },
      ],
      { PATH: "/base/bin", OPENAI_API_KEY: "sk-openai-test" },
    );

    const env = {
      ...providerEnv,
      ...makeLinceiSessionEnvironment(makeSessionInput(), providerEnv),
    };

    expect(env.PATH).toBe(["/state/bin", "/provider/bin", "/usr/bin"].join(PATH_DELIMITER));
    expect(env.OPENAI_API_KEY).toBe("sk-openai-test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env[LINCEI_SESSION_ID_ENV]).toBe("session-1");
    expect(env[VITRINE_DATA_DIR_ENV]).toBe("/workspace/.vitrine");
  });
});

describe("prependPathEntry", () => {
  it("does not duplicate the shim entry when it is already present", () => {
    expect(
      prependPathEntry(
        ["/state/bin", "/usr/bin", "/state/bin", "/bin"].join(PATH_DELIMITER),
        "/state/bin",
      ),
    ).toBe(["/state/bin", "/usr/bin", "/bin"].join(PATH_DELIMITER));
  });
});
