import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const firstSome = <A>(values: ReadonlyArray<Option.Option<A>>): Option.Option<A> =>
  values.reduce((resolved, value) => Option.orElse(resolved, () => value), Option.none<A>());

const aliasedTrimmedString = (primaryName: string, ...fallbackNames: ReadonlyArray<string>) =>
  Config.all([primaryName, ...fallbackNames].map(trimmedString)).pipe(Config.map(firstSome));

const optionalBoolean = (name: string) => Config.boolean(name).pipe(Config.option);

const aliasedOptionalBoolean = (primaryName: string, ...fallbackNames: ReadonlyArray<string>) =>
  Config.all([primaryName, ...fallbackNames].map(optionalBoolean)).pipe(
    Config.map((values) => Option.getOrElse(firstSome(values), () => false)),
  );

const aliasedPort = (primaryName: string, ...fallbackNames: ReadonlyArray<string>) =>
  Config.all(
    [primaryName, ...fallbackNames].map((name) => Config.port(name).pipe(Config.option)),
  ).pipe(Config.map(firstSome));

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

const aliasedCommaSeparatedStrings = (
  primaryName: string,
  ...fallbackNames: ReadonlyArray<string>
) =>
  Config.all([primaryName, ...fallbackNames].map(commaSeparatedStrings)).pipe(
    Config.map((values) => values.find((value) => value.length > 0) ?? []),
  );

const aliasedPortWithDefault = (
  primaryName: string,
  fallbackNames: ReadonlyArray<string>,
  defaultValue: number,
) =>
  aliasedPort(primaryName, ...fallbackNames).pipe(Config.map(Option.getOrElse(() => defaultValue)));

const aliasedIntWithDefault = (
  primaryName: string,
  fallbackNames: ReadonlyArray<string>,
  defaultValue: number,
) =>
  Config.all(
    [primaryName, ...fallbackNames].map((name) => Config.int(name).pipe(Config.option)),
  ).pipe(Config.map((values) => Option.getOrElse(firstSome(values), () => defaultValue)));

const linceiEnvNames = (name: string) => [`LINCEI_${name}`, `T3CODE_${name}`] as const;

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  baseDir: aliasedTrimmedString(...linceiEnvNames("HOME")),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  devRemoteT3ServerEntryPath: aliasedTrimmedString(
    "LINCEI_DEV_REMOTE_SERVER_ENTRY_PATH",
    "T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH",
  ),
  configuredBackendPort: aliasedPort(...linceiEnvNames("PORT")),
  commitHashOverride: aliasedTrimmedString(...linceiEnvNames("COMMIT_HASH")),
  desktopLanHostOverride: aliasedTrimmedString(...linceiEnvNames("DESKTOP_LAN_HOST")),
  desktopHttpsEndpointUrls: aliasedCommaSeparatedStrings(
    ...linceiEnvNames("DESKTOP_HTTPS_ENDPOINTS"),
  ),
  otlpTracesUrl: aliasedTrimmedString(...linceiEnvNames("OTLP_TRACES_URL")),
  otlpExportIntervalMs: aliasedIntWithDefault(
    "LINCEI_OTLP_EXPORT_INTERVAL_MS",
    ["T3CODE_OTLP_EXPORT_INTERVAL_MS"],
    10_000,
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: aliasedOptionalBoolean(...linceiEnvNames("DISABLE_AUTO_UPDATE")),
  mockUpdates: aliasedOptionalBoolean(...linceiEnvNames("DESKTOP_MOCK_UPDATES")),
  mockUpdateServerPort: aliasedPortWithDefault(
    "LINCEI_DESKTOP_MOCK_UPDATE_SERVER_PORT",
    ["T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT"],
    3000,
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
