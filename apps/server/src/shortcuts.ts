/**
 * Shortcuts - Shortcut configuration service definitions.
 *
 * Owns parsing, validation, merge, and persistence of user shortcut
 * configuration consumed by the server runtime.
 *
 * @module Shortcuts
 */
import {
  ShortcutRule,
  ShortcutsConfig,
  ShortcutsConfigError,
  KeyboardShortcut,
  ShortcutWhenNode,
  MAX_SHORTCUTS_COUNT,
  ResolvedShortcutRule,
  ResolvedShortcutsConfig,
  type ServerRemoveShortcutInput,
  type ServerUpsertShortcutInput,
  type ServerConfigIssue,
} from "@t3tools/contracts";
import * as Array from "effect/Array";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Ref from "effect/Ref";
import * as Context from "effect/Context";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "./config.ts";
import { writeFileStringAtomically } from "./atomicWrite.ts";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_RESOLVED_SHORTCUTS,
  compileResolvedShortcutRule,
  compileResolvedShortcutsConfig,
  parseKeyboardShortcut,
} from "@t3tools/shared/shortcuts";

export {
  DEFAULT_SHORTCUTS,
  compileResolvedShortcutRule,
  compileResolvedShortcutsConfig,
  parseKeyboardShortcut,
};

export const ResolvedShortcutFromConfig = ShortcutRule.pipe(
  Schema.decodeTo(
    Schema.toType(ResolvedShortcutRule),
    SchemaTransformation.transformOrFail({
      decode: (rule) =>
        Effect.succeed(compileResolvedShortcutRule(rule)).pipe(
          Effect.filterOrFail(
            Predicate.isNotNull,
            () =>
              new SchemaIssue.InvalidValue(Option.some(rule), {
                message: "Invalid shortcut rule",
              }),
          ),
          Effect.map((resolved) => resolved),
        ),

      encode: (resolved) =>
        Effect.gen(function* () {
          const key = encodeShortcut(resolved.shortcut);
          if (!key) {
            return yield* Effect.fail(
              new SchemaIssue.InvalidValue(Option.some(resolved), {
                message: "Resolved shortcut cannot be encoded to key string",
              }),
            );
          }

          const when = resolved.whenAst ? encodeWhenAst(resolved.whenAst) : undefined;
          return {
            key,
            command: resolved.command,
            when,
          };
        }),
    }),
  ),
);

export const ResolvedShortcutsFromConfig = Schema.Array(ResolvedShortcutFromConfig).check(
  Schema.isMaxLength(MAX_SHORTCUTS_COUNT),
);

function isSameShortcutRule(left: ShortcutRule, right: ShortcutRule): boolean {
  return (
    left.command === right.command &&
    left.key === right.key &&
    (left.when ?? undefined) === (right.when ?? undefined)
  );
}

function keyboardShortcutContext(rule: ShortcutRule): string | null {
  const parsed = parseKeyboardShortcut(rule.key);
  if (!parsed) return null;
  const encoded = encodeShortcut(parsed);
  if (!encoded) return null;
  return `${encoded}\u0000${rule.when ?? ""}`;
}

function hasSameShortcutContext(left: ShortcutRule, right: ShortcutRule): boolean {
  const leftContext = keyboardShortcutContext(left);
  const rightContext = keyboardShortcutContext(right);
  if (!leftContext || !rightContext) return false;
  return leftContext === rightContext;
}

function shortcutRuleFromUpsertInput(input: ServerUpsertShortcutInput): ShortcutRule {
  return input.when === undefined
    ? { key: input.key, command: input.command }
    : { key: input.key, command: input.command, when: input.when };
}

function replaceTargetFromUpsertInput(input: ServerUpsertShortcutInput): ShortcutRule | null {
  if (!input.replace) return null;
  return input.replace.when === undefined
    ? { key: input.replace.key, command: input.replace.command }
    : { key: input.replace.key, command: input.replace.command, when: input.replace.when };
}

function shortcutRuleFromRemoveInput(input: ServerRemoveShortcutInput): ShortcutRule {
  return input.when === undefined
    ? { key: input.key, command: input.command }
    : { key: input.key, command: input.command, when: input.when };
}

function encodeShortcut(shortcut: KeyboardShortcut): string | null {
  const modifiers: string[] = [];
  if (shortcut.modKey) modifiers.push("mod");
  if (shortcut.metaKey) modifiers.push("meta");
  if (shortcut.ctrlKey) modifiers.push("ctrl");
  if (shortcut.altKey) modifiers.push("alt");
  if (shortcut.shiftKey) modifiers.push("shift");
  if (!shortcut.key) return null;
  if (shortcut.key !== "+" && shortcut.key.includes("+")) return null;
  const key = shortcut.key === " " ? "space" : shortcut.key;
  return [...modifiers, key].join("+");
}

function encodeWhenAst(node: ShortcutWhenNode): string {
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!(${encodeWhenAst(node.node)})`;
    case "and":
      return `(${encodeWhenAst(node.left)} && ${encodeWhenAst(node.right)})`;
    case "or":
      return `(${encodeWhenAst(node.left)} || ${encodeWhenAst(node.right)})`;
  }
}

const RawShortcutsEntries = fromLenientJson(Schema.Array(Schema.Unknown));
const ShortcutsConfigPrettyJson = fromJsonStringPretty(ShortcutsConfig);
const decodeShortcutRuleExit = Schema.decodeUnknownExit(ShortcutRule);
const decodeResolvedShortcutFromConfigExit = Schema.decodeExit(ResolvedShortcutFromConfig);
const decodeRawShortcutsEntriesExit = Schema.decodeUnknownExit(RawShortcutsEntries);
const encodeShortcutsConfigPrettyJson = Schema.encodeEffect(ShortcutsConfigPrettyJson);

export interface ShortcutsConfigState {
  readonly shortcuts: ResolvedShortcutsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

export interface ShortcutsChangeEvent {
  readonly shortcuts: ResolvedShortcutsConfig;
  readonly issues: readonly ServerConfigIssue[];
}

function trimIssueMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : "Invalid shortcuts configuration.";
}

function malformedConfigIssue(detail: string): ServerConfigIssue {
  return {
    kind: "shortcuts.malformed-config",
    message: trimIssueMessage(detail),
  };
}

function invalidEntryIssue(index: number, detail: string): ServerConfigIssue {
  return {
    kind: "shortcuts.invalid-entry",
    index,
    message: trimIssueMessage(detail),
  };
}

function mergeWithDefaultShortcuts(custom: ResolvedShortcutsConfig): ResolvedShortcutsConfig {
  if (custom.length === 0) {
    return [...DEFAULT_RESOLVED_SHORTCUTS];
  }

  const overriddenCommands = new Set(custom.map((binding) => binding.command));
  const retainedDefaults = DEFAULT_RESOLVED_SHORTCUTS.filter(
    (binding) => !overriddenCommands.has(binding.command),
  );
  const merged = [...retainedDefaults, ...custom];

  if (merged.length <= MAX_SHORTCUTS_COUNT) {
    return merged;
  }

  // Keep the latest rules when the config exceeds max size; later rules have higher precedence.
  return merged.slice(-MAX_SHORTCUTS_COUNT);
}

/**
 * ShortcutsShape - Service API for shortcut configuration operations.
 */
export interface ShortcutsShape {
  /**
   * Start the shortcuts runtime and attach file watching.
   *
   * Safe to call multiple times. The first successful call establishes the
   * runtime; later calls await the same startup.
   */
  readonly start: Effect.Effect<void, ShortcutsConfigError>;

  /**
   * Await shortcuts runtime readiness.
   *
   * Readiness means the config directory exists, the watcher is attached, the
   * startup sync has completed, and the current snapshot has been loaded.
   */
  readonly ready: Effect.Effect<void, ShortcutsConfigError>;

  /**
   * Ensure the on-disk shortcuts file exists and includes all default
   * commands so newly-added defaults are backfilled on startup.
   */
  readonly syncDefaultShortcutsOnStartup: Effect.Effect<void, ShortcutsConfigError>;

  /**
   * Load runtime shortcuts state along with non-fatal configuration issues.
   */
  readonly loadConfigState: Effect.Effect<ShortcutsConfigState, ShortcutsConfigError>;

  /**
   * Read the latest shortcuts snapshot from cache/disk.
   */
  readonly getSnapshot: Effect.Effect<ShortcutsConfigState, ShortcutsConfigError>;

  /**
   * Stream of shortcuts config change events.
   */
  readonly streamChanges: Stream.Stream<ShortcutsChangeEvent>;

  /**
   * Upsert a shortcut rule and persist the resulting configuration.
   *
   * Writes config atomically and enforces the max rule count by truncating
   * oldest entries when needed.
   */
  readonly upsertShortcutRule: (
    input: ServerUpsertShortcutInput,
  ) => Effect.Effect<ResolvedShortcutsConfig, ShortcutsConfigError>;

  /**
   * Remove a single persisted shortcut rule by exact key/command/when match.
   */
  readonly removeShortcutRule: (
    input: ServerRemoveShortcutInput,
  ) => Effect.Effect<ResolvedShortcutsConfig, ShortcutsConfigError>;
}

/**
 * Shortcuts - Service tag for shortcut configuration operations.
 */
export class Shortcuts extends Context.Service<Shortcuts, ShortcutsShape>()("t3/shortcuts") {}

const makeShortcuts = Effect.gen(function* () {
  const { legacyShortcutsConfigPath, shortcutsConfigPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const upsertSemaphore = yield* Semaphore.make(1);
  const resolvedConfigCacheKey = "resolved" as const;
  const changesPubSub = yield* PubSub.unbounded<ShortcutsChangeEvent>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ShortcutsConfigError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
  const emitChange = (configState: ShortcutsConfigState) =>
    PubSub.publish(changesPubSub, configState).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(shortcutsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new ShortcutsConfigError({
          configPath: shortcutsConfigPath,
          detail: "failed to access shortcuts config",
          cause,
        }),
    ),
  );

  const readLegacyConfigExists = fs.exists(legacyShortcutsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new ShortcutsConfigError({
          configPath: legacyShortcutsConfigPath,
          detail: "failed to access legacy shortcuts config",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(shortcutsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new ShortcutsConfigError({
          configPath: shortcutsConfigPath,
          detail: "failed to read shortcuts config",
          cause,
        }),
    ),
  );

  const readRawLegacyConfig = fs.readFileString(legacyShortcutsConfigPath).pipe(
    Effect.mapError(
      (cause) =>
        new ShortcutsConfigError({
          configPath: legacyShortcutsConfigPath,
          detail: "failed to read legacy shortcuts config",
          cause,
        }),
    ),
  );

  const migrateLegacyShortcutsConfig = Effect.gen(function* () {
    const [configExists, legacyConfigExists] = yield* Effect.all([
      readConfigExists,
      readLegacyConfigExists,
    ]);
    if (configExists || !legacyConfigExists) {
      return;
    }

    const contents = yield* readRawLegacyConfig;
    yield* writeFileStringAtomically({
      filePath: shortcutsConfigPath,
      contents,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ShortcutsConfigError({
            configPath: shortcutsConfigPath,
            detail: "failed to migrate legacy shortcuts config",
            cause,
          }),
      ),
    );
    yield* Effect.logInfo("migrated legacy shortcuts config", {
      from: legacyShortcutsConfigPath,
      to: shortcutsConfigPath,
    });
  });

  const loadWritableCustomShortcutsConfig = Effect.fn(function* (): Effect.fn.Return<
    readonly ShortcutRule[],
    ShortcutsConfigError
  > {
    yield* migrateLegacyShortcutsConfig;
    if (!(yield* readConfigExists)) {
      return [];
    }

    const rawConfig = yield* readRawConfig.pipe(
      Effect.flatMap(Schema.decodeEffect(RawShortcutsEntries)),
      Effect.mapError(
        (cause) =>
          new ShortcutsConfigError({
            configPath: shortcutsConfigPath,
            detail: "expected JSON array",
            cause,
          }),
      ),
    );

    return yield* Effect.forEach(rawConfig, (entry) =>
      Effect.gen(function* () {
        const decodedRule = decodeShortcutRuleExit(entry);
        if (decodedRule._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid shortcut entry", {
            path: shortcutsConfigPath,
            entry,
            error: Cause.pretty(decodedRule.cause),
          });
          return null;
        }
        const resolved = decodeResolvedShortcutFromConfigExit(decodedRule.value);
        if (resolved._tag === "Failure") {
          yield* Effect.logWarning("ignoring invalid shortcut entry", {
            path: shortcutsConfigPath,
            entry,
            error: Cause.pretty(resolved.cause),
          });
          return null;
        }
        return decodedRule.value;
      }),
    ).pipe(Effect.map(Array.filter(Predicate.isNotNull)));
  });

  const loadRuntimeCustomShortcutsConfig = Effect.fn(function* (): Effect.fn.Return<
    {
      readonly shortcuts: readonly ShortcutRule[];
      readonly issues: readonly ServerConfigIssue[];
    },
    ShortcutsConfigError
  > {
    yield* migrateLegacyShortcutsConfig;
    if (!(yield* readConfigExists)) {
      return { shortcuts: [], issues: [] };
    }

    const rawConfig = yield* readRawConfig;
    const decodedEntries = decodeRawShortcutsEntriesExit(rawConfig);
    if (decodedEntries._tag === "Failure") {
      const detail = `expected JSON array (${Cause.pretty(decodedEntries.cause)})`;
      return {
        shortcuts: [],
        issues: [malformedConfigIssue(detail)],
      };
    }

    const shortcuts: ShortcutRule[] = [];
    const issues: ServerConfigIssue[] = [];
    for (const [index, entry] of decodedEntries.value.entries()) {
      const decodedRule = decodeShortcutRuleExit(entry);
      if (decodedRule._tag === "Failure") {
        const detail = Cause.pretty(decodedRule.cause);
        issues.push(invalidEntryIssue(index, detail));
        yield* Effect.logWarning("ignoring invalid shortcut entry", {
          path: shortcutsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }

      const resolvedRule = decodeResolvedShortcutFromConfigExit(decodedRule.value);
      if (resolvedRule._tag === "Failure") {
        const detail = Cause.pretty(resolvedRule.cause);
        issues.push(invalidEntryIssue(index, detail));
        yield* Effect.logWarning("ignoring invalid shortcut entry", {
          path: shortcutsConfigPath,
          index,
          entry,
          error: detail,
        });
        continue;
      }
      shortcuts.push(decodedRule.value);
    }

    return { shortcuts, issues };
  });

  const writeConfigAtomically = (rules: readonly ShortcutRule[]) => {
    return encodeShortcutsConfigPrettyJson(rules).pipe(
      Effect.map((encoded) => `${encoded}\n`),
      Effect.flatMap((encoded) =>
        writeFileStringAtomically({
          filePath: shortcutsConfigPath,
          contents: encoded,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.mapError(
        (cause) =>
          new ShortcutsConfigError({
            configPath: shortcutsConfigPath,
            detail: "failed to write shortcuts config",
            cause,
          }),
      ),
    );
  };

  const loadConfigStateFromDisk = loadRuntimeCustomShortcutsConfig().pipe(
    Effect.map(({ shortcuts, issues }) => ({
      shortcuts: mergeWithDefaultShortcuts(compileResolvedShortcutsConfig(shortcuts)),
      issues,
    })),
  );

  const resolvedConfigCache = yield* Cache.make<
    typeof resolvedConfigCacheKey,
    ShortcutsConfigState,
    ShortcutsConfigError
  >({
    capacity: 1,
    lookup: () => loadConfigStateFromDisk,
  });

  const loadConfigStateFromCacheOrDisk = Cache.get(resolvedConfigCache, resolvedConfigCacheKey);

  const revalidateAndEmit = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      const configState = yield* loadConfigStateFromCacheOrDisk;
      yield* emitChange(configState);
    }),
  );

  const syncDefaultShortcutsOnStartup = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const configExists = yield* readConfigExists;
      if (!configExists) {
        yield* writeConfigAtomically(DEFAULT_SHORTCUTS);
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const runtimeConfig = yield* loadRuntimeCustomShortcutsConfig();
      if (runtimeConfig.issues.length > 0) {
        yield* Effect.logWarning(
          "skipping startup shortcuts default sync because config has issues",
          {
            path: shortcutsConfigPath,
            issues: runtimeConfig.issues,
          },
        );
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }
      const customConfig = runtimeConfig.shortcuts;
      const existingCommands = new Set(customConfig.map((entry) => entry.command));
      const missingDefaults: ShortcutRule[] = [];
      const shortcutConflictWarnings: Array<{
        defaultCommand: ShortcutRule["command"];
        conflictingCommand: ShortcutRule["command"];
        key: string;
        when: string | null;
      }> = [];
      for (const defaultRule of DEFAULT_SHORTCUTS) {
        if (existingCommands.has(defaultRule.command)) {
          continue;
        }
        const conflictingEntry = customConfig.find((entry) =>
          hasSameShortcutContext(entry, defaultRule),
        );
        if (conflictingEntry) {
          shortcutConflictWarnings.push({
            defaultCommand: defaultRule.command,
            conflictingCommand: conflictingEntry.command,
            key: defaultRule.key,
            when: defaultRule.when ?? null,
          });
          continue;
        }
        missingDefaults.push(defaultRule);
      }
      for (const conflict of shortcutConflictWarnings) {
        yield* Effect.logWarning("skipping default shortcut due to shortcut conflict", {
          path: shortcutsConfigPath,
          defaultCommand: conflict.defaultCommand,
          conflictingCommand: conflict.conflictingCommand,
          key: conflict.key,
          when: conflict.when,
          reason: "shortcut context already used by existing rule",
        });
      }
      if (missingDefaults.length === 0) {
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const matchingDefaults = DEFAULT_SHORTCUTS.filter((defaultRule) =>
        customConfig.some((entry) => isSameShortcutRule(entry, defaultRule)),
      ).map((rule) => rule.command);
      if (matchingDefaults.length > 0) {
        yield* Effect.logWarning("default shortcut rule already defined in user config", {
          path: shortcutsConfigPath,
          commands: matchingDefaults,
        });
      }

      const nextConfig = [...customConfig, ...missingDefaults];
      const cappedConfig =
        nextConfig.length > MAX_SHORTCUTS_COUNT
          ? nextConfig.slice(-MAX_SHORTCUTS_COUNT)
          : nextConfig;
      if (nextConfig.length > MAX_SHORTCUTS_COUNT) {
        yield* Effect.logWarning("truncating shortcuts config to max entries", {
          path: shortcutsConfigPath,
          maxEntries: MAX_SHORTCUTS_COUNT,
        });
      }

      yield* writeConfigAtomically(cappedConfig);
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const shortcutsConfigDir = path.dirname(shortcutsConfigPath);
    const shortcutsConfigFile = path.basename(shortcutsConfigPath);
    const shortcutsConfigPathResolved = path.resolve(shortcutsConfigPath);

    yield* fs.makeDirectory(shortcutsConfigDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ShortcutsConfigError({
            configPath: shortcutsConfigPath,
            detail: "failed to prepare shortcuts config directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));
    yield* migrateLegacyShortcutsConfig;

    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    const debouncedShortcutsEvents = fs.watch(shortcutsConfigDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === shortcutsConfigFile ||
          event.path === shortcutsConfigPath ||
          path.resolve(shortcutsConfigDir, event.path) === shortcutsConfigPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedShortcutsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(startedRef);
    if (alreadyStarted) {
      return yield* Deferred.await(startedDeferred);
    }

    yield* Ref.set(startedRef, true);
    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* syncDefaultShortcutsOnStartup;
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      yield* loadConfigStateFromCacheOrDisk;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    syncDefaultShortcutsOnStartup,
    loadConfigState: loadConfigStateFromCacheOrDisk,
    getSnapshot: loadConfigStateFromCacheOrDisk,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
    upsertShortcutRule: (input) =>
      upsertSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const customConfig = yield* loadWritableCustomShortcutsConfig();
          const rule = shortcutRuleFromUpsertInput(input);
          const replaceTarget = replaceTargetFromUpsertInput(input);
          const nextConfig = [
            ...customConfig.filter((entry) => {
              if (replaceTarget) {
                return !isSameShortcutRule(entry, replaceTarget);
              }
              return !isSameShortcutRule(entry, rule);
            }),
            rule,
          ];
          const cappedConfig =
            nextConfig.length > MAX_SHORTCUTS_COUNT
              ? nextConfig.slice(-MAX_SHORTCUTS_COUNT)
              : nextConfig;
          if (nextConfig.length > MAX_SHORTCUTS_COUNT) {
            yield* Effect.logWarning("truncating shortcuts config to max entries", {
              path: shortcutsConfigPath,
              maxEntries: MAX_SHORTCUTS_COUNT,
            });
          }
          yield* writeConfigAtomically(cappedConfig);
          const nextResolved = mergeWithDefaultShortcuts(
            compileResolvedShortcutsConfig(cappedConfig),
          );
          yield* Cache.set(resolvedConfigCache, resolvedConfigCacheKey, {
            shortcuts: nextResolved,
            issues: [],
          });
          yield* emitChange({
            shortcuts: nextResolved,
            issues: [],
          });
          return nextResolved;
        }),
      ),
    removeShortcutRule: (input) =>
      upsertSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const customConfig = yield* loadWritableCustomShortcutsConfig();
          const target = shortcutRuleFromRemoveInput(input);
          const nextConfig = customConfig.filter((entry) => !isSameShortcutRule(entry, target));
          yield* writeConfigAtomically(nextConfig);
          const nextResolved = mergeWithDefaultShortcuts(
            compileResolvedShortcutsConfig(nextConfig),
          );
          yield* Cache.set(resolvedConfigCache, resolvedConfigCacheKey, {
            shortcuts: nextResolved,
            issues: [],
          });
          yield* emitChange({
            shortcuts: nextResolved,
            issues: [],
          });
          return nextResolved;
        }),
      ),
  } satisfies ShortcutsShape;
});

export const ShortcutsLive = Layer.effect(Shortcuts, makeShortcuts);
