import { MAX_SHORTCUT_VALUE_LENGTH, type ShortcutCommand } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { commandForProjectScript } from "../projectScripts";
import {
  decodeProjectScriptShortcutRule,
  shortcutValueForCommand,
  PROJECT_SCRIPT_SHORTCUT_INVALID_MESSAGE,
} from "./projectScriptShortcuts";

describe("projectScriptShortcuts", () => {
  it("decodes and trims valid shortcut rules", () => {
    const rule = decodeProjectScriptShortcutRule({
      shortcut: "  mod+k  ",
      command: commandForProjectScript("lint"),
    });

    expect(rule).toEqual({
      key: "mod+k",
      command: "script.lint.run",
    });
  });

  it("returns null when shortcut is empty", () => {
    expect(
      decodeProjectScriptShortcutRule({
        shortcut: "   ",
        command: commandForProjectScript("lint"),
      }),
    ).toBeNull();
  });

  it("rejects invalid shortcut values", () => {
    expect(() =>
      decodeProjectScriptShortcutRule({
        shortcut: "k".repeat(MAX_SHORTCUT_VALUE_LENGTH + 1),
        command: commandForProjectScript("lint"),
      }),
    ).toThrowError(PROJECT_SCRIPT_SHORTCUT_INVALID_MESSAGE);
  });

  it("rejects invalid commands", () => {
    expect(() =>
      decodeProjectScriptShortcutRule({
        shortcut: "mod+k",
        command: "script.BAD.run" as ShortcutCommand,
      }),
    ).toThrowError(PROJECT_SCRIPT_SHORTCUT_INVALID_MESSAGE);
  });

  it("reads latest matching shortcut value for a command", () => {
    const command = commandForProjectScript("test");
    const value = shortcutValueForCommand(
      [
        {
          command,
          shortcut: {
            key: "escape",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
        },
        {
          command,
          shortcut: {
            key: "k",
            metaKey: false,
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
            modKey: true,
          },
        },
      ],
      command,
    );

    expect(value).toBe("mod+shift+k");
  });
});
