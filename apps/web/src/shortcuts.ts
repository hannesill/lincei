import {
  type ShortcutCommand,
  type KeyboardShortcut,
  type ShortcutWhenNode,
  MODEL_PICKER_JUMP_SHORTCUT_COMMANDS,
  type ResolvedShortcutsConfig,
  THREAD_JUMP_SHORTCUT_COMMANDS,
  type ModelPickerJumpShortcutCommand,
  type SessionJumpShortcutCommand,
} from "@t3tools/contracts";
import { isMacPlatform } from "./lib/utils";

export interface ShortcutEventLike {
  type?: string;
  code?: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutModifierStateLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  [key: string]: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

const TERMINAL_WORD_BACKWARD = "\u001bb";
const TERMINAL_WORD_FORWARD = "\u001bf";
const TERMINAL_LINE_START = "\u0001";
const TERMINAL_LINE_END = "\u0005";
const TERMINAL_DELETE_TO_LINE_START = "\u0015";
const EVENT_CODE_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BracketLeft: ["["],
  BracketRight: ["]"],
  Digit0: ["0"],
  Digit1: ["1"],
  Digit2: ["2"],
  Digit3: ["3"],
  Digit4: ["4"],
  Digit5: ["5"],
  Digit6: ["6"],
  Digit7: ["7"],
  Digit8: ["8"],
  Digit9: ["9"],
};

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "esc") return "escape";
  return normalized;
}

function resolveEventKeys(event: ShortcutEventLike): Set<string> {
  const keys = new Set([normalizeEventKey(event.key)]);
  const aliases = event.code ? EVENT_CODE_KEY_ALIASES[event.code] : undefined;
  if (!aliases) return keys;

  for (const alias of aliases) {
    keys.add(alias);
  }
  return keys;
}

function matchesShortcutModifiers(
  event: ShortcutModifierStateLike,
  shortcut: KeyboardShortcut,
  platform = navigator.platform,
): boolean {
  const useMetaForMod = isMacPlatform(platform);
  const expectedMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const expectedCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === shortcut.shiftKey &&
    event.altKey === shortcut.altKey
  );
}

function matchesShortcut(
  event: ShortcutEventLike,
  shortcut: KeyboardShortcut,
  platform = navigator.platform,
): boolean {
  if (!matchesShortcutModifiers(event, shortcut, platform)) return false;
  return resolveEventKeys(event).has(shortcut.key);
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    ...options?.context,
  };
}

function evaluateWhenNode(node: ShortcutWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhenNode(node.node, context);
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context);
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context);
  }
}

function matchesWhenClause(
  whenAst: ShortcutWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true;
  return evaluateWhenNode(whenAst, context);
}

function shortcutConflictKey(shortcut: KeyboardShortcut, platform = navigator.platform): string {
  const useMetaForMod = isMacPlatform(platform);
  const metaKey = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);

  return [
    shortcut.key,
    metaKey ? "meta" : "",
    ctrlKey ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

function findEffectiveShortcutForCommand(
  shortcuts: ResolvedShortcutsConfig,
  command: ShortcutCommand,
  options?: ShortcutMatchOptions,
): KeyboardShortcut | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const claimedShortcuts = new Set<string>();

  for (let index = shortcuts.length - 1; index >= 0; index -= 1) {
    const binding = shortcuts[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;

    const conflictKey = shortcutConflictKey(binding.shortcut, platform);
    if (claimedShortcuts.has(conflictKey)) {
      continue;
    }

    claimedShortcuts.add(conflictKey);
    if (binding.command === command) {
      return binding.shortcut;
    }
  }

  return null;
}

function matchesCommandShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  command: ShortcutCommand,
  options?: ShortcutMatchOptions,
): boolean {
  return resolveShortcutCommand(event, shortcuts, options) === command;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): ShortcutCommand | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);

  for (let index = shortcuts.length - 1; index >= 0; index -= 1) {
    const binding = shortcuts[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;
    if (!matchesShortcut(event, binding.shortcut, platform)) continue;
    return binding.command;
  }
  return null;
}

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(
  shortcut: KeyboardShortcut,
  platform = navigator.platform,
): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  const showAlt = shortcut.altKey;
  const showShift = shortcut.shiftKey;

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

export function shortcutLabelForCommand(
  shortcuts: ResolvedShortcutsConfig,
  command: ShortcutCommand,
  options?: string | ResolvedShortcutLabelOptions,
): string | null {
  const resolvedOptions =
    typeof options === "string"
      ? ({ platform: options } satisfies ResolvedShortcutLabelOptions)
      : options;
  const platform = resolvePlatform(resolvedOptions);
  const shortcut = findEffectiveShortcutForCommand(shortcuts, command, resolvedOptions);
  return shortcut ? formatShortcutLabel(shortcut, platform) : null;
}

export function sessionJumpCommandForIndex(index: number): SessionJumpShortcutCommand | null {
  return THREAD_JUMP_SHORTCUT_COMMANDS[index] ?? null;
}

export function sessionJumpIndexFromCommand(command: string): number | null {
  const index = THREAD_JUMP_SHORTCUT_COMMANDS.indexOf(command as SessionJumpShortcutCommand);
  return index === -1 ? null : index;
}

export function sessionTraversalDirectionFromCommand(
  command: string | null,
): "previous" | "next" | null {
  if (command === "session.previous") return "previous";
  if (command === "session.next") return "next";
  return null;
}

export function shouldShowSessionJumpHints(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowSessionJumpHintsForModifiers(event, shortcuts, options);
}

export function shouldShowSessionJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_SHORTCUT_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(shortcuts, command, options);
    if (!shortcut) continue;
    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpShortcutCommand | null {
  return MODEL_PICKER_JUMP_SHORTCUT_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = MODEL_PICKER_JUMP_SHORTCUT_COMMANDS.indexOf(
    command as ModelPickerJumpShortcutCommand,
  );
  return index === -1 ? null : index;
}

export function shouldShowModelPickerJumpHints(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowModelPickerJumpHintsForModifiers(event, shortcuts, options);
}

export function shouldShowModelPickerJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of MODEL_PICKER_JUMP_SHORTCUT_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(shortcuts, command, options);
    if (!shortcut) continue;
    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function isTerminalToggleShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "terminal.toggle", options);
}

export function isTerminalSplitShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "terminal.split", options);
}

export function isTerminalNewShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "terminal.new", options);
}

export function isTerminalCloseShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "terminal.close", options);
}

export function isDiffToggleShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "diff.toggle", options);
}

export function isChatNewShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "chat.new", options);
}

export function isChatNewLocalShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "chat.newLocal", options);
}

export function isOpenFavoriteEditorShortcut(
  event: ShortcutEventLike,
  shortcuts: ResolvedShortcutsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, shortcuts, "editor.openFavorite", options);
}

export function isTerminalClearShortcut(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();

  if (key === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return true;
  }

  return (
    isMacPlatform(platform) &&
    key === "k" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function terminalDeleteShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (!isMacPlatform(platform)) {
    return null;
  }

  const key = normalizeEventKey(event.key);
  if (key !== "backspace") {
    return null;
  }

  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    ? TERMINAL_DELETE_TO_LINE_START
    : null;
}

export function terminalNavigationShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (event.shiftKey) return null;

  const key = normalizeEventKey(event.key);
  if (key !== "arrowleft" && key !== "arrowright") {
    return null;
  }

  const moveWord = key === "arrowleft" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
  const moveLine = key === "arrowleft" ? TERMINAL_LINE_START : TERMINAL_LINE_END;

  if (isMacPlatform(platform)) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      return moveWord;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      return moveLine;
    }
    return null;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    return moveWord;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    return moveWord;
  }

  return null;
}
