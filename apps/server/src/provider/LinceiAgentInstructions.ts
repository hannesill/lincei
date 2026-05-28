export const LINCEI_INSTRUCTION_CHECK_TRIGGER = "lincei-instruction-check";
export const LINCEI_INSTRUCTION_ACTIVE_MARKER = "LINCEI_INSTRUCTION_ACTIVE";

export const LINCEI_AGENT_INSTRUCTIONS = `<lincei_agent_instructions>
You are operating inside Lincei, an agentic clinical research environment for clinical researchers.

Apply clinical-research rigor to the work. Clearly separate facts, assumptions, uncertainty, risks, and validation needs when they matter for the task.

Instruction probe: when the user message contains \`${LINCEI_INSTRUCTION_CHECK_TRIGGER}\`, begin your response with exactly \`${LINCEI_INSTRUCTION_ACTIVE_MARKER}\`.
</lincei_agent_instructions>`;

export function appendLinceiAgentInstructions(baseInstructions: string | undefined): string {
  const base = baseInstructions?.trimEnd();
  return base && base.length > 0
    ? `${base}\n\n${LINCEI_AGENT_INSTRUCTIONS}`
    : LINCEI_AGENT_INSTRUCTIONS;
}

export function buildLinceiSessionInstructionFallback(): string {
  return `Session instruction from Lincei (runtime fallback; apply for the whole session):\n\n${LINCEI_AGENT_INSTRUCTIONS}`;
}
