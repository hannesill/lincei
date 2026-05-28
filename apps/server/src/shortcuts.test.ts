import { ShortcutCommand, ShortcutRule, ShortcutsConfig } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "./config.ts";

import {
  DEFAULT_SHORTCUTS,
  Shortcuts,
  ShortcutsLive,
  ResolvedShortcutFromConfig,
  compileResolvedShortcutRule,
  compileResolvedShortcutsConfig,
  parseKeyboardShortcut,
} from "./shortcuts.ts";
import { ShortcutsConfigError } from "@t3tools/contracts";

const ShortcutsConfigJson = Schema.fromJsonString(ShortcutsConfig);
const encodeShortcutsConfigJson = Schema.encodeEffect(ShortcutsConfigJson);
const decodeShortcutsConfigJson = Schema.decodeUnknownEffect(ShortcutsConfigJson);
const encodeResolvedShortcutFromConfig = Schema.encodeEffect(ResolvedShortcutFromConfig);
const decodeResolvedShortcutFromConfigExit = Schema.decodeUnknownExit(ResolvedShortcutFromConfig);
const makeShortcutsLayer = () => {
  return ShortcutsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-shortcuts-test-",
        }),
      ),
    ),
  );
};

const toDetailResult = <A, R>(effect: Effect.Effect<A, ShortcutsConfigError, R>) =>
  effect.pipe(
    Effect.mapError((error) => error.detail),
    Effect.result,
  );

const writeShortcutsConfig = (configPath: string, rules: readonly ShortcutRule[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const encoded = yield* encodeShortcutsConfigJson(rules);
    yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fileSystem.writeFileString(configPath, encoded);
  });

const readShortcutsConfig = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rawConfig = yield* fileSystem.readFileString(configPath);
    return yield* decodeShortcutsConfigJson(rawConfig);
  });

it.layer(NodeServices.layer)("shortcuts", (it) => {
  it.effect("parses shortcuts including plus key", () =>
    Effect.sync(() => {
      assert.deepEqual(parseKeyboardShortcut("mod+j"), {
        key: "j",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
      assert.deepEqual(parseKeyboardShortcut("mod++"), {
        key: "+",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
    }),
  );

  it.effect("compiles valid rule with parsed when AST", () =>
    Effect.sync(() => {
      const compiled = compileResolvedShortcutRule({
        key: "mod+d",
        command: "terminal.split",
        when: "terminalOpen && !terminalFocus",
      });

      assert.deepEqual(compiled, {
        command: "terminal.split",
        shortcut: {
          key: "d",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
        whenAst: {
          type: "and",
          left: { type: "identifier", name: "terminalOpen" },
          right: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      });
    }),
  );

  it.effect("encodes resolved plus-key shortcuts", () =>
    Effect.gen(function* () {
      const encoded = yield* encodeResolvedShortcutFromConfig({
        command: "terminal.toggle",
        shortcut: {
          key: "+",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      });

      assert.equal(encoded.key, "mod++");
      assert.equal(encoded.command, "terminal.toggle");
    }),
  );

  it.effect("rejects invalid rules", () =>
    Effect.sync(() => {
      assert.isNull(
        compileResolvedShortcutRule({
          key: "mod+shift+d+o",
          command: "terminal.new",
        }),
      );

      assert.isNull(
        compileResolvedShortcutRule({
          key: "mod+d",
          command: "terminal.split",
          when: "terminalFocus && (",
        }),
      );

      assert.isNull(
        compileResolvedShortcutRule({
          key: "mod+d",
          command: "terminal.split",
          when: `${"!".repeat(300)}terminalFocus`,
        }),
      );
    }),
  );

  it.effect("formats invalid resolved shortcut rules with the custom message", () =>
    Effect.sync(() => {
      const result = decodeResolvedShortcutFromConfigExit({
        key: "mod+shift+d+o",
        command: "terminal.new",
      });

      if (result._tag !== "Failure") {
        assert.fail("Expected invalid shortcut decode to fail");
      }

      const detail = Cause.pretty(result.cause);
      assert.isTrue(detail.includes("Invalid shortcut rule"));
      assert.isFalse(detail.includes("Invalid data"));
    }),
  );

  it.effect("bootstraps default shortcuts when config file is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      assert.isFalse(yield* fs.exists(shortcutsConfigPath));

      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        yield* shortcuts.syncDefaultShortcutsOnStartup;
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      assert.deepEqual(persisted, DEFAULT_SHORTCUTS);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("migrates existing legacy shortcut config before bootstrapping defaults", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { legacyShortcutsConfigPath, shortcutsConfigPath } = yield* ServerConfig;
      const legacyRules: readonly ShortcutRule[] = [
        { key: "mod+shift+t", command: "terminal.toggle" },
      ];
      yield* writeShortcutsConfig(legacyShortcutsConfigPath, legacyRules);
      assert.isFalse(yield* fs.exists(shortcutsConfigPath));

      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        yield* shortcuts.syncDefaultShortcutsOnStartup;
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      assert.isTrue(persisted.some((entry) => entry.key === "mod+shift+t"));
      assert.isTrue(persisted.some((entry) => entry.command === "terminal.split"));
      assert.deepEqual(yield* readShortcutsConfig(legacyShortcutsConfigPath), legacyRules);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("ships configurable session navigation defaults", () =>
    Effect.sync(() => {
      const defaultsByCommand = new Map(
        DEFAULT_SHORTCUTS.map((binding) => [binding.command, binding.key] as const),
      );

      assert.equal(defaultsByCommand.get("session.previous"), "mod+shift+[");
      assert.equal(defaultsByCommand.get("session.next"), "mod+shift+]");
      assert.equal(defaultsByCommand.get("session.jump.1"), "mod+1");
      assert.equal(defaultsByCommand.get("session.jump.9"), "mod+9");
      assert.equal(defaultsByCommand.get("sidebar.toggle"), "mod+b");
      assert.equal(defaultsByCommand.get("modelPicker.toggle"), "mod+shift+m");
      assert.equal(defaultsByCommand.get("modelPicker.jump.1"), "mod+1");
      assert.equal(defaultsByCommand.get("modelPicker.jump.9"), "mod+9");
    }),
  );

  it.effect("uses defaults in runtime when config is malformed without overriding file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* fs.writeFileString(shortcutsConfigPath, "{ not-json");

      const configState = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.loadConfigState;
      });

      assert.deepEqual(configState.shortcuts, compileResolvedShortcutsConfig(DEFAULT_SHORTCUTS));
      assert.deepEqual(configState.issues, [
        {
          kind: "shortcuts.malformed-config",
          message: configState.issues[0]?.message ?? "",
        },
      ]);
      assert.equal(yield* fs.readFileString(shortcutsConfigPath), "{ not-json");
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("ignores invalid entries in runtime and reports them as issues", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* fs.writeFileString(
        shortcutsConfigPath,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify([
          { key: "mod+j", command: "terminal.toggle" },
          { key: "mod+shift+d+o", command: "terminal.new" },
          { key: "mod+x", command: "invalid.command" },
        ]),
      );

      const configState = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.loadConfigState;
      });

      assert.isTrue(configState.shortcuts.some((entry) => entry.command === "terminal.toggle"));
      assert.isFalse(
        configState.shortcuts.some((entry) => String(entry.command) === "invalid.command"),
      );
      assert.deepEqual(configState.issues, [
        {
          kind: "shortcuts.invalid-entry",
          index: 1,
          message: configState.issues[0]?.message ?? "",
        },
        {
          kind: "shortcuts.invalid-entry",
          index: 2,
          message: configState.issues[1]?.message ?? "",
        },
      ]);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect(
    "upserts missing default shortcuts on startup without overriding existing command rules",
    () =>
      Effect.gen(function* () {
        const { shortcutsConfigPath } = yield* ServerConfig;
        yield* writeShortcutsConfig(shortcutsConfigPath, [
          { key: "mod+shift+t", command: "terminal.toggle" },
          { key: "mod+shift+r", command: "script.run-tests.run" },
        ]);

        yield* Effect.gen(function* () {
          const shortcuts = yield* Shortcuts;
          yield* shortcuts.syncDefaultShortcutsOnStartup;
        });

        const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
        const byCommand = new Map(persisted.map((entry) => [entry.command, entry]));

        const persistedToggle = byCommand.get("terminal.toggle");
        assert.isNotNull(persistedToggle);
        assert.equal(persistedToggle?.key, "mod+shift+t");
        assert.isFalse(
          persisted.some((entry) => entry.command === "terminal.toggle" && entry.key === "mod+j"),
        );

        for (const defaultRule of DEFAULT_SHORTCUTS) {
          assert.isTrue(byCommand.has(defaultRule.command), `expected ${defaultRule.command}`);
        }
        assert.isTrue(byCommand.has("script.run-tests.run"));
      }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("skips conflicting default shortcuts on startup and logs a detailed warning", () => {
    const messages: string[] = [];
    const logger = Logger.make(({ message }) => {
      messages.push(String(message));
    });

    return Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+j", command: "script.custom-action.run" },
      ]);

      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        yield* shortcuts.syncDefaultShortcutsOnStartup;
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      assert.isFalse(persisted.some((entry) => entry.command === "terminal.toggle"));
      assert.isTrue(persisted.some((entry) => entry.command === "script.custom-action.run"));

      assert.isTrue(
        messages.some((message) =>
          message.includes("skipping default shortcut due to shortcut conflict"),
        ),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(makeShortcutsLayer(), Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("upserts custom shortcuts to configured path", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);

      const resolved = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));

      assert.deepEqual(persistedView, [
        { key: "mod+j", command: "terminal.toggle" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      assert.isTrue(resolved.some((entry) => entry.command === "script.run-tests.run"));
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("appends additional custom shortcuts for the same command", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("replaces only the targeted custom shortcut", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "mod+r", command: "script.run-tests.run" },
        });
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "mod+alt+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("removes only the targeted custom shortcut", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.removeShortcutRule({
          key: "mod+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+shift+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("refuses to overwrite malformed shortcuts config", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* fs.writeFileString(shortcutsConfigPath, "{ not-json");

      const result = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(result, "expected JSON array");

      const persistedRaw = yield* fs.readFileString(shortcutsConfigPath);
      assert.equal(persistedRaw, "{ not-json");
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("reports non-array config parse errors without duplicate prefix", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* fs.writeFileString(shortcutsConfigPath, '{"key":"mod+j","command":"terminal.toggle"}');

      const firstResult = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(firstResult, "expected JSON array");

      const secondResult = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(secondResult, "expected JSON array");
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("fails when config directory is not writable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shortcutsConfigPath } = yield* ServerConfig;
      const { dirname } = yield* Path.Path;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);
      yield* fs.chmod(dirname(shortcutsConfigPath), 0o500);

      const result = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        return yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(result, "failed to write shortcuts config");

      yield* fs.chmod(dirname(shortcutsConfigPath), 0o700);

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+j", command: "terminal.toggle" }]);
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("caches loaded resolved config across repeated reads", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);

      const [first, second] = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        const firstLoad = (yield* shortcuts.loadConfigState).shortcuts;
        const secondLoad = (yield* shortcuts.loadConfigState).shortcuts;
        return [firstLoad, secondLoad] as const;
      });

      assert.deepEqual(first, second);
      assert.isTrue(second.some((entry) => entry.command === "terminal.toggle"));
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("updates cached resolved config after upsert", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);

      const loadedAfterUpsert = yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        yield* shortcuts.loadConfigState;
        yield* shortcuts.upsertShortcutRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
        return (yield* shortcuts.loadConfigState).shortcuts;
      });

      assert.isTrue(loadedAfterUpsert.some((entry) => entry.command === "script.run-tests.run"));
      assert.isTrue(loadedAfterUpsert.some((entry) => entry.command === "terminal.toggle"));
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );

  it.effect("serializes concurrent upserts to avoid lost updates", () =>
    Effect.gen(function* () {
      const { shortcutsConfigPath } = yield* ServerConfig;
      yield* writeShortcutsConfig(shortcutsConfigPath, []);

      const commands = Array.from(
        { length: 20 },
        (_, index): ShortcutCommand => `script.concurrent-${index}.run`,
      );
      yield* Effect.gen(function* () {
        const shortcuts = yield* Shortcuts;
        yield* Effect.all(
          commands.map((command, index) =>
            shortcuts.upsertShortcutRule({
              key: `mod+${String.fromCharCode(97 + index)}`,
              command,
            }),
          ),
          { concurrency: "unbounded", discard: true },
        );
      });

      const persisted = yield* readShortcutsConfig(shortcutsConfigPath);
      const persistedCommands = new Set(persisted.map((entry) => entry.command));
      for (const command of commands) {
        assert.isTrue(persistedCommands.has(command), `expected persisted command ${command}`);
      }
    }).pipe(Effect.provide(makeShortcutsLayer())),
  );
});
