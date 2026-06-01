export const LINCEI_INSTRUCTION_CHECK_TRIGGER = "lincei-instruction-check";
export const LINCEI_INSTRUCTION_ACTIVE_MARKER = "LINCEI_INSTRUCTION_ACTIVE";

const LINCEI_AGENT_BASELINE_INSTRUCTIONS = `<lincei_agent_instructions>
You are operating inside Lincei, an agentic clinical research environment for clinical researchers.

Apply clinical-research rigor to the work. Clearly separate facts, assumptions, uncertainty, risks, and validation needs when they matter for the task.

Use \`lincei\` CLI for Lincei work. Start Lincei work by running \`lincei context current\` once. Data: use \`lincei dataset context\` for prompt guidance, then read structured data with \`lincei dataset status|schema|describe-table|query\`; Python: \`import lincei\` if installed. Cards: \`lincei card context\`, then \`lincei card propose --title <title>\` or \`lincei card update|request-review|supersede\`; attach evidence with \`--dep\` / \`--artifact\`. Study artifacts/runs: use \`lincei study\`, \`lincei artifact\`, \`lincei run\`. Prefer ambient defaults. Ask user only when Lincei reports ambiguous targets. If unsure, run \`lincei <command> --help\`.

Instruction probe: when the user message contains \`${LINCEI_INSTRUCTION_CHECK_TRIGGER}\`, begin your response with exactly \`${LINCEI_INSTRUCTION_ACTIVE_MARKER}\`.
</lincei_agent_instructions>`;

export function buildLinceiAgentInstructions(customInstructions?: string | undefined): string {
  const custom = customInstructions?.trim();
  return custom && custom.length > 0
    ? `${LINCEI_AGENT_BASELINE_INSTRUCTIONS}\n\n<lincei_user_custom_instructions>\n${custom}\n</lincei_user_custom_instructions>`
    : LINCEI_AGENT_BASELINE_INSTRUCTIONS;
}

export function appendLinceiAgentInstructions(
  baseInstructions: string | undefined,
  customInstructions?: string | undefined,
): string {
  const base = baseInstructions?.trimEnd();
  const linceiInstructions = buildLinceiAgentInstructions(customInstructions);
  return base && base.length > 0 ? `${base}\n\n${linceiInstructions}` : linceiInstructions;
}

export function buildLinceiSessionInstructionFallback(
  customInstructions?: string | undefined,
): string {
  return `Session instruction from Lincei (runtime fallback; apply for the whole session):\n\n${buildLinceiAgentInstructions(customInstructions)}`;
}
