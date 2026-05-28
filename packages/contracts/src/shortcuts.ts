import * as Schema from "effect/Schema";
import { TrimmedString } from "./baseSchemas.ts";

export const MAX_SHORTCUT_VALUE_LENGTH = 64;
export const MAX_SHORTCUT_WHEN_LENGTH = 256;
export const MAX_WHEN_EXPRESSION_DEPTH = 64;
export const MAX_SCRIPT_ID_LENGTH = 24;
export const MAX_SHORTCUTS_COUNT = 256;

export const THREAD_JUMP_SHORTCUT_COMMANDS = [
  "session.jump.1",
  "session.jump.2",
  "session.jump.3",
  "session.jump.4",
  "session.jump.5",
  "session.jump.6",
  "session.jump.7",
  "session.jump.8",
  "session.jump.9",
] as const;
export type SessionJumpShortcutCommand = (typeof THREAD_JUMP_SHORTCUT_COMMANDS)[number];

export const MODEL_PICKER_JUMP_SHORTCUT_COMMANDS = [
  "modelPicker.jump.1",
  "modelPicker.jump.2",
  "modelPicker.jump.3",
  "modelPicker.jump.4",
  "modelPicker.jump.5",
  "modelPicker.jump.6",
  "modelPicker.jump.7",
  "modelPicker.jump.8",
  "modelPicker.jump.9",
] as const;
export type ModelPickerJumpShortcutCommand = (typeof MODEL_PICKER_JUMP_SHORTCUT_COMMANDS)[number];

export const THREAD_SHORTCUT_COMMANDS = [
  "session.previous",
  "session.next",
  ...THREAD_JUMP_SHORTCUT_COMMANDS,
] as const;
export type SessionShortcutCommand = (typeof THREAD_SHORTCUT_COMMANDS)[number];

export const MODEL_PICKER_SHORTCUT_COMMANDS = [
  "modelPicker.toggle",
  ...MODEL_PICKER_JUMP_SHORTCUT_COMMANDS,
] as const;
export type ModelPickerShortcutCommand = (typeof MODEL_PICKER_SHORTCUT_COMMANDS)[number];

const STATIC_SHORTCUT_COMMANDS = [
  "terminal.toggle",
  "terminal.split",
  "terminal.new",
  "terminal.close",
  "diff.toggle",
  "sidebar.toggle",
  "commandPalette.toggle",
  "chat.new",
  "chat.newLocal",
  "editor.openFavorite",
  ...MODEL_PICKER_SHORTCUT_COMMANDS,
  ...THREAD_SHORTCUT_COMMANDS,
] as const;

export const SCRIPT_RUN_COMMAND_PATTERN = Schema.TemplateLiteral([
  Schema.Literal("script."),
  Schema.NonEmptyString.check(
    Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH),
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  ),
  Schema.Literal(".run"),
]);

export const ShortcutCommand = Schema.Union([
  Schema.Literals(STATIC_SHORTCUT_COMMANDS),
  SCRIPT_RUN_COMMAND_PATTERN,
]);
export type ShortcutCommand = typeof ShortcutCommand.Type;

export const ShortcutValue = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SHORTCUT_VALUE_LENGTH),
);

export const ShortcutWhen = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SHORTCUT_WHEN_LENGTH),
);
export const ShortcutRule = Schema.Struct({
  key: ShortcutValue,
  command: ShortcutCommand,
  when: Schema.optional(ShortcutWhen),
});
export type ShortcutRule = typeof ShortcutRule.Type;

export const ShortcutsConfig = Schema.Array(ShortcutRule).check(
  Schema.isMaxLength(MAX_SHORTCUTS_COUNT),
);
export type ShortcutsConfig = typeof ShortcutsConfig.Type;

export const KeyboardShortcut = Schema.Struct({
  key: ShortcutValue,
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
  altKey: Schema.Boolean,
  modKey: Schema.Boolean,
});
export type KeyboardShortcut = typeof KeyboardShortcut.Type;

const ShortcutWhenNodeRef = Schema.suspend((): Schema.Codec<ShortcutWhenNode> => ShortcutWhenNode);
export const ShortcutWhenNode = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("identifier"),
    name: Schema.NonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("not"),
    node: ShortcutWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("and"),
    left: ShortcutWhenNodeRef,
    right: ShortcutWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("or"),
    left: ShortcutWhenNodeRef,
    right: ShortcutWhenNodeRef,
  }),
]);
export type ShortcutWhenNode =
  | { type: "identifier"; name: string }
  | { type: "not"; node: ShortcutWhenNode }
  | { type: "and"; left: ShortcutWhenNode; right: ShortcutWhenNode }
  | { type: "or"; left: ShortcutWhenNode; right: ShortcutWhenNode };

export const ResolvedShortcutRule = Schema.Struct({
  command: ShortcutCommand,
  shortcut: KeyboardShortcut,
  whenAst: Schema.optional(ShortcutWhenNode),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
export type ResolvedShortcutRule = typeof ResolvedShortcutRule.Type;

export const ResolvedShortcutsConfig = Schema.Array(ResolvedShortcutRule).check(
  Schema.isMaxLength(MAX_SHORTCUTS_COUNT),
);
export type ResolvedShortcutsConfig = typeof ResolvedShortcutsConfig.Type;

export class ShortcutsConfigError extends Schema.TaggedErrorClass<ShortcutsConfigError>()(
  "ShortcutsConfigParseError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Unable to parse shortcuts config at ${this.configPath}: ${this.detail}`;
  }
}
