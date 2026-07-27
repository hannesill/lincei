import type { LinceiSkillSettings, LinceiWorkflowSettings } from "@t3tools/contracts";
import { buildEffectiveLinceiPrompt } from "@t3tools/shared/linceiSkills";

export const LINCEI_INSTRUCTION_CHECK_TRIGGER = "lincei-instruction-check";
export const LINCEI_INSTRUCTION_ACTIVE_MARKER = "LINCEI_INSTRUCTION_ACTIVE";

const LINCEI_AGENT_BASELINE_INSTRUCTIONS = `<lincei_agent_instructions>
You are operating inside Lincei, an agentic clinical research environment for clinical researchers.

Apply clinical-research rigor to the work. Clearly separate facts, assumptions, uncertainty, risks, and validation needs when they matter for the task.

Use \`lincei context current\` for project/session context and \`lincei dataset context\` before M4-backed dataset work. Use the canonical M4 skills for clinical computation and definitions, and the canonical Vitrine skill for meaningful research checkpoints and human decisions. Do not create review noise for trivial terminal output. Use \`$lincei:context\` for detailed Lincei routing guidance.

Instruction probe: when the user message contains \`${LINCEI_INSTRUCTION_CHECK_TRIGGER}\`, begin your response with exactly \`${LINCEI_INSTRUCTION_ACTIVE_MARKER}\`.
</lincei_agent_instructions>`;

export function buildLinceiAgentInstructions(
  customInstructions?: string | undefined,
  workflowId?: string | undefined,
  skillSettings?: Readonly<Record<string, LinceiSkillSettings | undefined>>,
  workflowSettings?: Readonly<Record<string, LinceiWorkflowSettings | undefined>>,
): string {
  const custom = customInstructions?.trim();
  const effectivePrompt =
    workflowId !== undefined
      ? buildEffectiveLinceiPrompt({ workflowId, skillSettings, workflowSettings }).trim()
      : buildEffectiveLinceiPrompt({ skillSettings, workflowSettings }).trim();
  const blocks = [LINCEI_AGENT_BASELINE_INSTRUCTIONS];
  if (effectivePrompt.length > 0) {
    blocks.push(`<lincei_effective_prompt>\n${effectivePrompt}\n</lincei_effective_prompt>`);
  }
  if (custom && custom.length > 0) {
    blocks.push(`<lincei_user_custom_instructions>\n${custom}\n</lincei_user_custom_instructions>`);
  }
  return blocks.join("\n\n");
}

export function appendLinceiAgentInstructions(
  baseInstructions: string | undefined,
  customInstructions?: string | undefined,
  workflowId?: string | undefined,
  skillSettings?: Readonly<Record<string, LinceiSkillSettings | undefined>>,
  workflowSettings?: Readonly<Record<string, LinceiWorkflowSettings | undefined>>,
): string {
  const base = baseInstructions?.trimEnd();
  const linceiInstructions = buildLinceiAgentInstructions(
    customInstructions,
    workflowId,
    skillSettings,
    workflowSettings,
  );
  return base && base.length > 0 ? `${base}\n\n${linceiInstructions}` : linceiInstructions;
}

export function buildLinceiSessionInstructionFallback(
  customInstructions?: string | undefined,
  workflowId?: string | undefined,
  skillSettings?: Readonly<Record<string, LinceiSkillSettings | undefined>>,
  workflowSettings?: Readonly<Record<string, LinceiWorkflowSettings | undefined>>,
): string {
  return `Session instruction from Lincei (runtime fallback; apply for the whole session):\n\n${buildLinceiAgentInstructions(customInstructions, workflowId, skillSettings, workflowSettings)}`;
}
