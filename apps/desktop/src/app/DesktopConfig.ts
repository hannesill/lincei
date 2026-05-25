import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const aliasedTrimmedString = (primaryName: string, legacyName: string) =>
  Config.all({
    primary: trimmedString(primaryName),
    legacy: trimmedString(legacyName),
  }).pipe(Config.map(({ primary, legacy }) => Option.orElse(primary, () => legacy)));

const optionalBoolean = (name: string) => Config.boolean(name).pipe(Config.option);

const aliasedOptionalBoolean = (primaryName: string, legacyName: string) =>
  Config.all({
    primary: optionalBoolean(primaryName),
    legacy: optionalBoolean(legacyName),
  }).pipe(
    Config.map(({ primary, legacy }) =>
      Option.getOrElse(
        Option.orElse(primary, () => legacy),
        () => false,
      ),
    ),
  );

const aliasedPort = (primaryName: string, legacyName: string) =>
  Config.all({
    primary: Config.port(primaryName).pipe(Config.option),
    legacy: Config.port(legacyName).pipe(Config.option),
  }).pipe(Config.map(({ primary, legacy }) => Option.orElse(primary, () => legacy)));

const commaSeparatedStrings = (name: string) =>
  trimmedString(name).pipe(
    Config.map(
      Option.match({
        onNone: () => [],
        onSome: (value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
      }),
    ),
  );

const aliasedCommaSeparatedStrings = (primaryName: string, legacyName: string) =>
  Config.all({
    primary: commaSeparatedStrings(primaryName),
    legacy: commaSeparatedStrings(legacyName),
  }).pipe(Config.map(({ primary, legacy }) => (primary.length > 0 ? primary : legacy)));

const aliasedPortWithDefault = (primaryName: string, legacyName: string, defaultValue: number) =>
  aliasedPort(primaryName, legacyName).pipe(Config.map(Option.getOrElse(() => defaultValue)));

const aliasedIntWithDefault = (primaryName: string, legacyName: string, defaultValue: number) =>
  Config.all({
    primary: Config.int(primaryName).pipe(Config.option),
    legacy: Config.int(legacyName).pipe(Config.option),
  }).pipe(
    Config.map(({ primary, legacy }) =>
      Option.getOrElse(
        Option.orElse(primary, () => legacy),
        () => defaultValue,
      ),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  baseDir: aliasedTrimmedString("LINCEI_STUDIO_HOME", "T3CODE_HOME"),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  devRemoteT3ServerEntryPath: aliasedTrimmedString(
    "LINCEI_STUDIO_DEV_REMOTE_SERVER_ENTRY_PATH",
    "T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH",
  ),
  configuredBackendPort: aliasedPort("LINCEI_STUDIO_PORT", "T3CODE_PORT"),
  commitHashOverride: aliasedTrimmedString("LINCEI_STUDIO_COMMIT_HASH", "T3CODE_COMMIT_HASH"),
  desktopLanHostOverride: aliasedTrimmedString(
    "LINCEI_STUDIO_DESKTOP_LAN_HOST",
    "T3CODE_DESKTOP_LAN_HOST",
  ),
  desktopHttpsEndpointUrls: aliasedCommaSeparatedStrings(
    "LINCEI_STUDIO_DESKTOP_HTTPS_ENDPOINTS",
    "T3CODE_DESKTOP_HTTPS_ENDPOINTS",
  ),
  otlpTracesUrl: aliasedTrimmedString("LINCEI_STUDIO_OTLP_TRACES_URL", "T3CODE_OTLP_TRACES_URL"),
  otlpExportIntervalMs: aliasedIntWithDefault(
    "LINCEI_STUDIO_OTLP_EXPORT_INTERVAL_MS",
    "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    10_000,
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: aliasedOptionalBoolean(
    "LINCEI_STUDIO_DISABLE_AUTO_UPDATE",
    "T3CODE_DISABLE_AUTO_UPDATE",
  ),
  mockUpdates: aliasedOptionalBoolean(
    "LINCEI_STUDIO_DESKTOP_MOCK_UPDATES",
    "T3CODE_DESKTOP_MOCK_UPDATES",
  ),
  mockUpdateServerPort: aliasedPortWithDefault(
    "LINCEI_STUDIO_DESKTOP_MOCK_UPDATE_SERVER_PORT",
    "T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT",
    3000,
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
