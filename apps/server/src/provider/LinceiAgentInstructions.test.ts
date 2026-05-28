import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  appendLinceiAgentInstructions,
  buildLinceiSessionInstructionFallback,
  LINCEI_AGENT_INSTRUCTIONS,
  LINCEI_INSTRUCTION_ACTIVE_MARKER,
  LINCEI_INSTRUCTION_CHECK_TRIGGER,
} from "./LinceiAgentInstructions.ts";

describe("LinceiAgentInstructions", () => {
  it("contains the exact instruction probe trigger and marker", () => {
    assert.match(
      LINCEI_AGENT_INSTRUCTIONS,
      new RegExp(`\\b${LINCEI_INSTRUCTION_CHECK_TRIGGER}\\b`),
    );
    assert.match(
      LINCEI_AGENT_INSTRUCTIONS,
      new RegExp(`\\b${LINCEI_INSTRUCTION_ACTIVE_MARKER}\\b`),
    );
    assert.match(
      LINCEI_AGENT_INSTRUCTIONS,
      new RegExp(`begin your response with exactly \`${LINCEI_INSTRUCTION_ACTIVE_MARKER}\``),
    );
  });

  it("composes with existing provider instructions", () => {
    assert.equal(
      appendLinceiAgentInstructions("Existing instructions."),
      `Existing instructions.\n\n${LINCEI_AGENT_INSTRUCTIONS}`,
    );
    assert.equal(
      buildLinceiSessionInstructionFallback(),
      `Session instruction from Lincei (runtime fallback; apply for the whole session):\n\n${LINCEI_AGENT_INSTRUCTIONS}`,
    );
  });
});
