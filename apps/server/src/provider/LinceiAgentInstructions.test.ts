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
    assert.match(instructions, /lincei context current/);
    assert.doesNotMatch(instructions, /lincei context current --json/);
    assert.match(instructions, /lincei dataset context/);
    assert.doesNotMatch(instructions, /dataset context --format/);
    assert.match(instructions, /lincei card context/);
    assert.doesNotMatch(instructions, /lincei card context --json/);
    assert.match(instructions, /decision cards/);
    assert.match(instructions, /\$lincei-api/);
    assert.match(instructions, /<lincei_effective_prompt>/);
  });

  it("injects the selected workflow and bundled skill prompt separately", () => {
    const instructions = buildLinceiAgentInstructions(undefined, "structured-clinical-study");
    assert.match(instructions, /<lincei_workflow id="structured-clinical-study"/);
    assert.match(instructions, /study description card first/);
    assert.match(instructions, /<lincei_skill id="clinical-research-session"/);
  });

  it("appends trimmed custom instructions after the hidden baseline", () => {
    const baseline = buildLinceiAgentInstructions();
    const custom = buildLinceiAgentInstructions("  Prefer concise answers.  ");
    assert.match(custom, /lincei context current/);
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
