import type {
  LinceiCanonicalSkill,
  LinceiSkillSyncSidecar,
  LinceiSkillSyncState,
  LinceiWorkflow,
  ProviderDriverKind,
  ServerProviderSkill,
  LinceiSkillSettings,
} from "@t3tools/contracts";

const BUNDLED_SKILL_VERSION = "1.0.0";
const STRUCTURED_CLINICAL_STUDY_VERSION = "1.0.0";

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
    description: "Use Lincei CLI commands for context, datasets, artifacts, runs, and cards.",
    category: "api" as const,
    body: `# Lincei API

Start Lincei work with \`lincei context current\`. Prefer ambient defaults from the Lincei environment.

Use \`lincei dataset context\` before dataset work, then use structured commands such as \`lincei dataset status\`, \`lincei dataset schema\`, \`lincei dataset describe-table\`, and \`lincei dataset query\`.

Use \`lincei card context\` before creating or updating research cards. Capture important outputs with \`lincei artifact\` and \`lincei run capture\`.`,
  },
  {
    id: "lincei-cards-api",
    title: "Lincei Cards API",
    description: "Create auditable research cards, review gates, and artifact-linked outputs.",
    category: "cards" as const,
    body: `# Lincei Cards API

Use research cards for important milestones, findings, decisions, reviews, and limitations.

Before card work, run \`lincei card context\`. Propose or update cards with explicit titles, previews, dependencies, and artifacts. Request review for protocol, analysis-plan, decision, and final-result checkpoints.

Do not proceed past unresolved decision or review cards unless the user explicitly overrides the gate.`,
  },
  {
    id: "clinical-research-session",
    title: "Clinical Research Session",
    description: "Run clinical research sessions with explicit methodology and provenance.",
    category: "workflow" as const,
    body: `# Clinical Research Session

Separate facts, assumptions, uncertainty, risks, and validation needs. Record core methodological choices as decision cards.

For every substantive analysis, preserve the dataset context, script or query, run command, outputs, and interpretation. Prefer script-first analysis through \`lincei run capture\` so results are reproducible.`,
  },
  {
    id: "clinical-research-pitfalls",
    title: "Clinical Research Pitfalls",
    description: "Check common clinical research failure modes before interpreting results.",
    category: "clinical-methods" as const,
    body: `# Clinical Research Pitfalls

Actively check cohort leakage, immortal time, survivorship, missingness, coding drift, denominator mismatch, duplicated encounters, inappropriate adjustment, post-treatment covariates, multiple testing, and unclear outcome timing.

When a pitfall is plausible, stop and create a decision or review card before presenting results as stable.`,
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

1. Create a study description card first.
2. Create decision cards for research question, outcome, population, exposure, exclusions, covariates, dataset, and analysis plan.
3. Produce a protocol artifact and a protocol review card before analysis.
4. Run script-first analysis with \`lincei run capture\`; record declared deps and outputs.
5. Present results as cards with artifact references, code/query provenance, and denominator checks.
6. Record final decisions, limitations, and unresolved risks before summarizing conclusions.`;

export const LINCEI_WORKFLOWS: ReadonlyArray<LinceiWorkflow> = [
  {
    id: "ad-hoc",
    title: "Ad hoc",
    version: "1.0.0",
    description: "No additional workflow body beyond baseline Lincei instructions.",
    skillIds: ["lincei-api"],
    body: "",
  },
  {
    id: "structured-clinical-study",
    title: "Structured clinical study",
    version: STRUCTURED_CLINICAL_STUDY_VERSION,
    description: "Decision-gated clinical study workflow with protocol review and captured runs.",
    skillIds: [
      "lincei-api",
      "lincei-cards-api",
      "clinical-research-session",
      "clinical-research-pitfalls",
    ],
    body: structuredClinicalStudyBody,
  },
  {
    id: "replication-validation",
    title: "Replication / validation",
    version: "1.0.0",
    description: "Validate an existing finding, script, cohort, or protocol before extending it.",
    skillIds: ["lincei-api", "lincei-cards-api", "clinical-research-pitfalls"],
    body: `# Replication / Validation Workflow

Start by identifying the original claim, cohort, outcome, and analysis plan. Re-run or reconstruct the analysis script-first, record deviations as decision cards, and report agreement, disagreement, and unresolved threats to validity.`,
  },
  {
    id: "review-only",
    title: "Review only",
    version: "1.0.0",
    description:
      "Review existing artifacts/cards without creating new study claims unless requested.",
    skillIds: ["lincei-api", "lincei-cards-api", "clinical-research-pitfalls"],
    body: `# Review Only Workflow

Inspect existing context, cards, artifacts, and scripts. Focus on correctness, reproducibility, methodological risk, and missing evidence. Prefer review cards and concise findings over new analysis.`,
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
      linceiAvailability: status === "current" ? "native current" : "prompt fallback",
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
      linceiAvailability: "native current",
    });
  }

  return merged;
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
}): string {
  const workflow = workflowById(input.workflowId);
  const skillsById = new Map(
    applyLinceiSkillSettings(input.skills ?? bundledLinceiSkills(), input.skillSettings).map(
      (skill) => [skill.id, skill],
    ),
  );
  const selectedSkillIds =
    input.selectedSkillIds && input.selectedSkillIds.length > 0
      ? input.selectedSkillIds
      : workflow.skillIds;
  const selectedBodies = selectedSkillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is LinceiCanonicalSkill => skill !== undefined && skill.enabled)
    .map(
      (skill) =>
        `<lincei_skill id="${skill.id}" version="${skill.version}">\n${skill.body}\n</lincei_skill>`,
    );

  const workflowBlock = workflow.body.trim()
    ? [
        `<lincei_workflow id="${workflow.id}" version="${workflow.version}">`,
        workflow.body,
        "</lincei_workflow>",
      ]
    : [];

  return [...workflowBlock, ...selectedBodies].join("\n\n");
}
