import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  appendLinceiAgentInstructions,
  buildLinceiAgentInstructions,
  buildLinceiSessionInstructionFallback,
  LINCEI_INSTRUCTION_ACTIVE_MARKER,
  LINCEI_INSTRUCTION_CHECK_TRIGGER,
} from "./LinceiAgentInstructions.ts";

describe("LinceiAgentInstructions", () => {
  it("contains the exact instruction probe trigger and marker", () => {
    const instructions = buildLinceiAgentInstructions();
    assert.match(instructions, new RegExp(`\\b${LINCEI_INSTRUCTION_CHECK_TRIGGER}\\b`));
    assert.match(instructions, new RegExp(`\\b${LINCEI_INSTRUCTION_ACTIVE_MARKER}\\b`));
    assert.match(
      instructions,
      new RegExp(`begin your response with exactly \`${LINCEI_INSTRUCTION_ACTIVE_MARKER}\``),
    );
  });

  it("describes the Lincei card CLI workflow", () => {
    const instructions = buildLinceiAgentInstructions();
    assert.match(instructions, /lincei context current --json/);
    assert.match(instructions, /lincei card propose --title <title>/);
    assert.match(instructions, /lincei <command> --help/);
    assert.match(instructions, /ambiguous targets/);
  });

  it("appends trimmed custom instructions after the hidden baseline", () => {
    const baseline = buildLinceiAgentInstructions();
    const custom = buildLinceiAgentInstructions("  Prefer concise answers.  ");
    assert.match(custom, /lincei context current --json/);
    assert.match(
      custom,
      /<lincei_user_custom_instructions>\nPrefer concise answers\.\n<\/lincei_user_custom_instructions>/,
    );
    assert.equal(buildLinceiAgentInstructions("   "), baseline);
  });

  it("composes with existing provider instructions", () => {
    const instructions = buildLinceiAgentInstructions();
    assert.equal(
      appendLinceiAgentInstructions("Existing instructions."),
      `Existing instructions.\n\n${instructions}`,
    );
    assert.equal(
      buildLinceiSessionInstructionFallback(),
      `Session instruction from Lincei (runtime fallback; apply for the whole session):\n\n${instructions}`,
    );
  });
});
