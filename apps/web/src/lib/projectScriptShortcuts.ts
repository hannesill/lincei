import {
  ShortcutRule as ShortcutRuleSchema,
  type ShortcutCommand,
  type ShortcutRule,
  type ResolvedShortcutsConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const PROJECT_SCRIPT_SHORTCUT_INVALID_MESSAGE = "Invalid shortcut.";

const decodeShortcutRule = Schema.decodeUnknownOption(ShortcutRuleSchema);

function normalizeProjectScriptShortcutInput(shortcut: string | null | undefined): string | null {
  const trimmed = shortcut?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function decodeProjectScriptShortcutRule(input: {
  shortcut: string | null | undefined;
  command: ShortcutCommand;
}): ShortcutRule | null {
  const normalizedKey = normalizeProjectScriptShortcutInput(input.shortcut);
  if (!normalizedKey) return null;

  const decoded = decodeShortcutRule({
    key: normalizedKey,
    command: input.command,
  });
  if (decoded._tag === "None") {
    throw new Error(PROJECT_SCRIPT_SHORTCUT_INVALID_MESSAGE);
  }
  return decoded.value;
}

export function shortcutValueForCommand(
  shortcuts: ResolvedShortcutsConfig,
  command: ShortcutCommand,
): string | null {
  for (let index = shortcuts.length - 1; index >= 0; index -= 1) {
    const binding = shortcuts[index];
    if (!binding || binding.command !== command) continue;

    const parts: string[] = [];
    if (binding.shortcut.modKey) parts.push("mod");
    if (binding.shortcut.ctrlKey) parts.push("ctrl");
    if (binding.shortcut.metaKey) parts.push("meta");
    if (binding.shortcut.altKey) parts.push("alt");
    if (binding.shortcut.shiftKey) parts.push("shift");
    const keyToken =
      binding.shortcut.key === " "
        ? "space"
        : binding.shortcut.key === "escape"
          ? "esc"
          : binding.shortcut.key;
    parts.push(keyToken);
    return parts.join("+");
  }
  return null;
}
