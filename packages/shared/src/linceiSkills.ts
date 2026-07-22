import type {
  LinceiCanonicalSkill,
  LinceiSkillSyncSidecar,
  LinceiSkillSyncState,
  LinceiWorkflow,
  LinceiWorkflowSettings,
  ProviderDriverKind,
  ServerProvider,
  ServerProviderSkill,
  LinceiSkillSettings,
} from "@t3tools/contracts";

const BUNDLED_SKILL_VERSION = "2.0.0";
const STRUCTURED_CLINICAL_STUDY_VERSION = "2.0.0";

export const LINCEI_SKILL_SYNC_SIDECAR = ".lincei-skill-sync.json";

export function linceiContentHash(content: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= BigInt(content.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

const bundledSkillDefinitions = [
  {
    id: "lincei-api",
    title: "Lincei API",
    description:
      "Use Lincei for project/session context and M4 datasets, then publish meaningful research checkpoints to Vitrine.",
    category: "api" as const,
    body: `---
name: lincei-api
description: Use for Lincei context, M4 dataset work, and Vitrine research checkpoints or human decisions.
tier: bundled
category: api
---

# Lincei, M4, and Vitrine

Lincei owns projects, sessions, chat, terminals, and diffs. M4 owns clinical dataset access and computation. Vitrine owns studies, results, artifacts, decisions, provenance, and human review.

## Start Here

1. Orient with \`lincei context current\`.
2. Before clinical data work, run \`lincei dataset context\` and inspect the selected M4 dataset/backend.
3. Keep substantive analysis script-first and preserve the exact SQL, code, inputs, and outputs in the project.
4. Send meaningful intermediate or final results to Vitrine. Do not create a checkpoint for trivial terminal output.

Useful Lincei commands:

\`\`\`bash
lincei context current --pretty
lincei context session --session SESSION_ID --pretty
lincei context project --project PROJECT_ID --pretty
lincei dataset context
lincei dataset status
lincei dataset schema --dataset DATASET --backend BACKEND
lincei dataset describe-table TABLE --dataset DATASET --backend BACKEND
lincei dataset query --dataset DATASET --backend BACKEND --sql "select ... limit 20"
\`\`\`

Use read-only M4 queries for exploration. Save final SQL and analysis code under the project before treating a result as stable. Preserve dataset/backend, denominator, time window, assumptions, and uncertainty with every substantive result.

## Vitrine Python API

Use the Python API directly:

\`\`\`python
from vitrine import show, confirm, ask

show(result, title="Cohort after exclusions", study="sepsis")
approved = confirm("Use this cohort?", study="sepsis")
choice = ask(
    "Which severity score?",
    ["SOFA", "APACHE III", "Both"],
    study="sepsis",
)
\`\`\`

- \`show(...)\`: publish a meaningful result, table, visualization, method checkpoint, limitation, or final output.
- \`show(..., wait=True)\`: publish a result and block for review when work must not continue without a response.
- \`confirm(...)\`: block for a yes/no methodological or clinical decision.
- \`ask(...)\`: block for a choice among explicit options.

The return value from blocking Vitrine calls is the human response. Use it directly in the calling process; do not scrape rendered HTML or infer a response from UI state.

M4 results should flow naturally into Vitrine:

\`\`\`python
from vitrine import show

# result is the table, dataframe, chart, mapping, or other object produced from M4-backed work.
show(
    result,
    title="Eligible admissions by exclusion step",
    study="sepsis",
)
\`\`\`

## Checkpoint Discipline

Use Vitrine for nontrivial checkpoints such as:

- protocol, cohort, exposure, outcome, covariate, and analysis-plan choices;
- cohort attrition, final denominators, missingness, model diagnostics, and sensitivity analyses;
- tables, figures, clinically meaningful findings, limitations, and final outputs;
- human approval needed before dependent analysis continues.

Skip Vitrine for command echoes, package installation, routine file listings, transient debug output, and other low-value terminal noise.

At each substantive checkpoint, separate facts, assumptions, uncertainty, methodological risk, validation needs, and interpretation. Keep user-facing summaries concise while preserving reproducible code and provenance in the project and Vitrine.`,
  },
  {
    id: "clinical-research-pitfalls",
    title: "Clinical Research Pitfalls",
    description: "Check common clinical research failure modes before interpreting results.",
    category: "clinical-methods" as const,
    body: `---
name: clinical-research-pitfalls
description: Use when checking clinical research analyses for leakage, time bias, missingness, coding drift, denominator mismatch, inappropriate adjustment, multiple testing, and unsupported claims.
tier: bundled
category: clinical
---

# Clinical Research Pitfalls

Before treating a result as stable, check the risks that could materially change its denominator, estimate, or interpretation.

## Core Checks

- Cohort leakage: information after the index time influences eligibility or predictors.
- Time bias: immortal time, survivorship, inconsistent time zero, or unequal follow-up.
- Denominator drift: tables, models, and narrative claims use different populations.
- Missingness: complete-case analysis or imputation changes the target population or estimand.
- Coding drift: site, era, unit, vocabulary, and code-list changes alter definitions.
- Confounding and adjustment: mediators, colliders, post-treatment variables, or unsupported covariates enter the model.
- Multiplicity: outcomes, subgroups, and model variants are interpreted without accounting for selection.
- Validation: implausible ranges, duplicates, temporal ordering, calibration, and sensitivity checks are missing.
- Claims: causal or clinical conclusions exceed the design and evidence.

Inspect the exact M4-backed SQL/scripts and outputs. Recompute key counts when necessary. For a material risk, publish a concise Vitrine checkpoint with the affected result, evidence inspected, likely impact, and proposed resolution:

\`\`\`python
from vitrine import show, confirm, ask

show(validity_check, title="Validity check: denominator mismatch", study="sepsis")
proceed = confirm("Proceed with this denominator?", study="sepsis")
strategy = ask(
    "How should missing baseline values be handled?",
    ["Complete case", "Multiple imputation", "Sensitivity analysis"],
    study="sepsis",
)
\`\`\`

Block for review only when the unresolved choice changes dependent work. Do not create Vitrine noise for a routine check that found no material issue.`,
  },
] satisfies ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: LinceiCanonicalSkill["category"];
  readonly body: string;
}>;

export function bundledLinceiSkills(): ReadonlyArray<LinceiCanonicalSkill> {
  return bundledSkillDefinitions.map((skill) => ({
    id: skill.id,
    title: skill.title,
    description: skill.description,
    category: skill.category,
    tier: "bundled",
    version: BUNDLED_SKILL_VERSION,
    source: "bundled",
    enabled: true,
    body: skill.body,
    contentHash: linceiContentHash(skill.body),
    upstreamId: skill.id,
    upstreamVersion: BUNDLED_SKILL_VERSION,
    deploymentTargets: [],
  }));
}

export type LinceiSkillSettingsMap = Readonly<Record<string, LinceiSkillSettings | undefined>>;
export type LinceiWorkflowSettingsMap = Readonly<
  Record<string, LinceiWorkflowSettings | undefined>
>;

export function isLinceiWorkflowEnabled(
  workflowId: string,
  settings: LinceiWorkflowSettingsMap | undefined,
): boolean {
  return settings?.[workflowId]?.enabled ?? true;
}

export function applyLinceiSkillSettings(
  skills: ReadonlyArray<LinceiCanonicalSkill>,
  settings: LinceiSkillSettingsMap | undefined,
): ReadonlyArray<LinceiCanonicalSkill> {
  if (!settings) return skills;
  return skills.map((skill) => {
    const skillSettings = settings[skill.id];
    if (!skillSettings) return skill;
    return {
      ...skill,
      enabled: skillSettings.enabled,
    };
  });
}

export function configuredBundledLinceiSkills(
  settings?: LinceiSkillSettingsMap | undefined,
): ReadonlyArray<LinceiCanonicalSkill> {
  return applyLinceiSkillSettings(bundledLinceiSkills(), settings);
}

const structuredClinicalStudyBody = `# Structured Clinical Study Workflow

Run clinical research as a controlled, reviewable workflow. Lincei owns the session, M4 owns clinical computation, and Vitrine owns the study record, results, decisions, provenance, and review.

## Session Principles

1. Separate facts, assumptions, uncertainty, risks, and validation needs.
2. Prefer script-first analysis over ad hoc terminal-only analysis.
3. Treat every denominator as a claim that needs traceability.
4. Use Vitrine \`confirm()\` or \`ask()\` for methodological choices that block dependent work.
5. Keep substantive analysis script-first and preserve exact M4 inputs, SQL, code, and outputs.
6. Publish meaningful results and visualizations with \`vitrine.show(...)\`.
7. Request Vitrine review before protocol, analysis-plan, final-denominator, final-model, and final-interpretation checkpoints when human judgment is necessary.
8. Keep clinical interpretation conservative unless evidence is strong and reviewed.

## Procedure

1. Orient with \`lincei context current --pretty\` and \`lincei dataset context\`.
2. Establish the Vitrine study context for the research question; keep its hierarchy inside Vitrine.
3. Record the question, population, exposure/comparator, outcome, time window, dataset/backend, planned analysis, limitations, and review needs in project files and publish a meaningful Vitrine checkpoint.
4. Use \`confirm()\` or \`ask()\` for choices about cohort entry, eligibility, outcomes, exposures, covariates, missingness, follow-up, index date, model, and sensitivity/subgroup analyses when those choices block later work.
5. Produce protocol files before final analysis, for example \`protocol.md\`, \`analysis-plan.md\`, cohort SQL, variable SQL, and analysis scripts. Use \`show(..., wait=True)\` when protocol review must block execution.
6. Explore safely with dataset commands and limits. Do not turn exploratory counts into final claims.
7. Run final or near-final analysis from saved scripts with explicit inputs and outputs.
8. Present nontrivial results through Vitrine with dataset/backend, script or SQL dependency, denominator, and interpretation boundaries. Skip trivial terminal output.
9. Record final decisions, limitations, unresolved risks, and review status in Vitrine before summarizing conclusions.

For every substantive result, the user should be able to answer which dataset/backend was used, which SQL/script produced it, which outputs were preserved, which Vitrine result shows it, which decisions shaped it, which limitations remain, and whether it is reviewed, pending review, or exploratory.`;

export const LINCEI_WORKFLOWS: ReadonlyArray<LinceiWorkflow> = [
  {
    id: "ad-hoc",
    title: "Ad hoc",
    version: "2.0.0",
    description: "No additional workflow body beyond baseline Lincei instructions.",
    skillIds: ["lincei-api"],
    body: "",
  },
  {
    id: "structured-clinical-study",
    title: "Structured clinical study",
    version: STRUCTURED_CLINICAL_STUDY_VERSION,
    description: "Vitrine-mediated clinical study workflow with protocol review and M4 analysis.",
    skillIds: ["lincei-api", "clinical-research-pitfalls"],
    body: structuredClinicalStudyBody,
  },
  {
    id: "replication-validation",
    title: "Replication / validation",
    version: "2.0.0",
    description: "Validate an existing finding, script, cohort, or protocol before extending it.",
    skillIds: ["lincei-api", "clinical-research-pitfalls"],
    body: `# Replication / Validation Workflow

Start by identifying the original claim, cohort, outcome, and analysis plan. Re-run or reconstruct the M4-backed analysis script-first, record material deviations and decisions in Vitrine, and report agreement, disagreement, and unresolved threats to validity.`,
  },
  {
    id: "review-only",
    title: "Review only",
    version: "2.0.0",
    description:
      "Review existing project evidence and Vitrine results without creating new claims unless requested.",
    skillIds: ["lincei-api", "clinical-research-pitfalls"],
    body: `# Review Only Workflow

Inspect existing context, project files, Vitrine results, and scripts. Focus on correctness, reproducibility, methodological risk, and missing evidence. Publish only material review findings to Vitrine.`,
  },
];

export function workflowById(workflowId: string | undefined): LinceiWorkflow {
  return (
    LINCEI_WORKFLOWS.find((workflow) => workflow.id === workflowId) ??
    LINCEI_WORKFLOWS.find((workflow) => workflow.id === "ad-hoc")!
  );
}

export function projectSkillFromBody(input: {
  readonly id: string;
  readonly body: string;
  readonly version?: string;
  readonly enabled?: boolean;
}): LinceiCanonicalSkill {
  const title =
    input.body
      .split(/\r?\n/)
      .find((line) => line.startsWith("# "))
      ?.slice(2)
      .trim() || input.id;
  return {
    id: input.id,
    title,
    description: `Project skill ${input.id}`,
    category: "workflow",
    tier: "project",
    version: input.version ?? "0.0.0",
    source: "project",
    enabled: input.enabled ?? true,
    body: input.body,
    contentHash: linceiContentHash(input.body),
    deploymentTargets: [],
  };
}

export function mergeLinceiSkillCatalog(input: {
  readonly bundled?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly project?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly providerNative?: ReadonlyArray<ServerProviderSkill>;
  readonly provider?: ProviderDriverKind;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
}): ReadonlyArray<ServerProviderSkill> {
  const merged: ServerProviderSkill[] = [];
  const seen = new Set<string>();

  const addCanonical = (skill: LinceiCanonicalSkill, status: string) => {
    if (seen.has(skill.id)) return;
    seen.add(skill.id);
    merged.push({
      name: skill.id,
      displayName: skill.title,
      description: skill.description,
      shortDescription: skill.description,
      path: `lincei://${skill.source}/${skill.id}`,
      scope: skill.source === "project" ? "project" : "system",
      enabled: skill.enabled,
      linceiSkillId: skill.id,
      linceiSource: skill.source,
      linceiSyncStatus: status,
      linceiAvailability: status === "current" ? "provider-managed" : "prompt fallback",
    });
  };

  const bundled = applyLinceiSkillSettings(
    input.bundled ?? bundledLinceiSkills(),
    input.skillSettings,
  );
  const project = applyLinceiSkillSettings(input.project ?? [], input.skillSettings);

  for (const skill of bundled) {
    addCanonical(skill, "prompt-fallback");
  }
  for (const skill of project) {
    addCanonical(skill, "prompt-fallback");
  }
  for (const skill of input.providerNative ?? []) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    merged.push({
      ...skill,
      linceiSource: "provider-native",
      linceiSyncStatus: "unmanaged",
      linceiAvailability: "external provider skill",
    });
  }

  return merged;
}

export function enrichServerProviderWithLinceiSkills(input: {
  readonly provider: ServerProvider;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
}): ServerProvider {
  const providerNative = input.provider.skills.filter(isExternalProviderSkill);
  if (!input.provider.enabled || input.provider.availability === "unavailable") {
    return {
      ...input.provider,
      skills: providerNative,
    };
  }

  return {
    ...input.provider,
    skills: mergeLinceiSkillCatalog({
      provider: input.provider.driver,
      providerNative,
      skillSettings: input.skillSettings,
    }),
  };
}

export function isLinceiOwnedProviderSkill(
  skill: Pick<ServerProviderSkill, "linceiSkillId" | "linceiSource" | "path">,
): boolean {
  return (
    skill.linceiSkillId !== undefined ||
    skill.linceiSource === "bundled" ||
    skill.linceiSource === "project" ||
    skill.path.startsWith("lincei://")
  );
}

export function isExternalProviderSkill(
  skill: Pick<ServerProviderSkill, "linceiSkillId" | "linceiSource" | "path">,
): boolean {
  return skill.linceiSource === "provider-native" || !isLinceiOwnedProviderSkill(skill);
}

export function linceiSkillTokenPrefixForProvider(provider: ProviderDriverKind): "$" | "/" {
  return provider === "codex" ? "$" : "/";
}

export function linceiSkillTokenPrefixForProviderSkill(input: {
  readonly provider: ProviderDriverKind;
  readonly skill: Pick<ServerProviderSkill, "linceiSkillId" | "linceiSource" | "path">;
}): "$" | "/" {
  return isLinceiOwnedProviderSkill(input.skill)
    ? linceiSkillTokenPrefixForProvider(input.provider)
    : "$";
}

export function parseSelectedLinceiSkillIds(input: {
  readonly text: string | undefined;
  readonly skills?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
}): ReadonlyArray<string> {
  if (!input.text) return [];

  const skillsById = new Map(
    applyLinceiSkillSettings(input.skills ?? bundledLinceiSkills(), input.skillSettings).map(
      (skill) => [skill.id, skill],
    ),
  );
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const tokenRegex = /(^|\s)[$/]([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

  for (const match of input.text.matchAll(tokenRegex)) {
    const id = match[2] ?? "";
    const skill = skillsById.get(id);
    if (!skill?.enabled || selectedSet.has(id)) {
      continue;
    }
    selectedSet.add(id);
    selected.push(id);
  }

  return selected;
}

function escapeLinceiSkillXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeLinceiSkillXmlAttribute(value: string): string {
  return escapeLinceiSkillXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function buildSelectedLinceiSkillsPrompt(input: {
  readonly skillIds: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
}): string {
  const skillsById = new Map(
    applyLinceiSkillSettings(input.skills ?? bundledLinceiSkills(), input.skillSettings).map(
      (skill) => [skill.id, skill],
    ),
  );
  const selectedBodies = input.skillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is LinceiCanonicalSkill => skill !== undefined && skill.enabled)
    .map(
      (skill) =>
        `<lincei_skill id="${escapeLinceiSkillXmlAttribute(skill.id)}" version="${escapeLinceiSkillXmlAttribute(skill.version)}">\n${escapeLinceiSkillXmlText(skill.body)}\n</lincei_skill>`,
    );

  if (selectedBodies.length === 0) {
    return "";
  }
  return `<lincei_selected_skills>\n${selectedBodies.join("\n")}\n</lincei_selected_skills>`;
}

export function appendSelectedLinceiSkillPrompts(input: {
  readonly text: string | undefined;
  readonly skills?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
}): string | undefined {
  const selectedSkillIds = parseSelectedLinceiSkillIds(input);
  const prompt = buildSelectedLinceiSkillsPrompt({
    skillIds: selectedSkillIds,
    ...(input.skills !== undefined ? { skills: input.skills } : {}),
    ...(input.skillSettings !== undefined ? { skillSettings: input.skillSettings } : {}),
  });
  if (!input.text || !prompt) {
    return input.text;
  }
  return `${input.text.trimEnd()}\n\n${prompt}`;
}

export function evaluateManagedSkillSyncState(input: {
  readonly canonicalHash: string;
  readonly targetExists: boolean;
  readonly targetHash?: string;
  readonly sidecar?: LinceiSkillSyncSidecar;
}): LinceiSkillSyncState {
  if (!input.targetExists) return "missing";
  if (!input.sidecar) return "unmanaged";
  if (input.targetHash === undefined) return "missing";

  const canonicalChanged = input.sidecar.contentHash !== input.canonicalHash;
  const targetChanged = input.sidecar.lastSeenTargetHash !== input.targetHash;
  if (!canonicalChanged && !targetChanged && input.targetHash === input.canonicalHash) {
    return "current";
  }
  if (canonicalChanged && !targetChanged) {
    return "outdated";
  }
  if (!canonicalChanged && targetChanged) {
    return "target-modified";
  }
  return "conflict";
}

export function shouldAutoSyncSkill(input: {
  readonly skill: Pick<LinceiCanonicalSkill, "source">;
  readonly state: LinceiSkillSyncState;
}): boolean {
  if (input.skill.source !== "bundled") return false;
  return input.state === "missing" || input.state === "outdated" || input.state === "current";
}

export function buildEffectiveLinceiPrompt(input: {
  readonly workflowId?: string;
  readonly skills?: ReadonlyArray<LinceiCanonicalSkill>;
  readonly selectedSkillIds?: ReadonlyArray<string>;
  readonly skillSettings?: LinceiSkillSettingsMap | undefined;
  readonly workflowSettings?: LinceiWorkflowSettingsMap | undefined;
}): string {
  const workflow = workflowById(input.workflowId);
  const workflowEnabled = isLinceiWorkflowEnabled(workflow.id, input.workflowSettings);
  const skillsById = new Map(
    applyLinceiSkillSettings(input.skills ?? bundledLinceiSkills(), input.skillSettings).map(
      (skill) => [skill.id, skill],
    ),
  );
  const selectedSkillIds = !workflowEnabled
    ? []
    : input.selectedSkillIds && input.selectedSkillIds.length > 0
      ? input.selectedSkillIds
      : workflow.skillIds;
  const selectedBodies = selectedSkillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is LinceiCanonicalSkill => skill !== undefined && skill.enabled)
    .map(
      (skill) =>
        `<lincei_skill id="${skill.id}" version="${skill.version}">\n${skill.body}\n</lincei_skill>`,
    );

  const workflowBlock =
    workflowEnabled && workflow.body.trim()
      ? [
          `<lincei_workflow id="${workflow.id}" version="${workflow.version}">`,
          workflow.body,
          "</lincei_workflow>",
        ]
      : [];

  return [...workflowBlock, ...selectedBodies].join("\n\n");
}
