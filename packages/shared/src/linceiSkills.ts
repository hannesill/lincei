import type {
  LinceiCanonicalSkill,
  LinceiSkillSyncSidecar,
  LinceiSkillSyncState,
  LinceiWorkflow,
  LinceiWorkflowSettings,
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
    description:
      "Use Lincei CLI commands for context, datasets, study records, artifacts, captured runs, research cards, decisions, and review gates.",
    category: "api" as const,
    body: `---
name: lincei-api
description: Use when working with Lincei CLI commands, datasets, study records, artifacts, captured runs, research cards, decisions, or review gates.
tier: bundled
category: api
---

# Lincei API Reference

Use Lincei as the control plane for clinical research work. The CLI gives agents structured access to current session context, datasets, study-local provenance, artifacts, captured runs, research cards, decisions, and review gates.

## When to Use This Skill

- The user asks for Lincei session, dataset, study, card, artifact, run, or decision work.
- You need current project/session/card context.
- You need to query a configured clinical dataset.
- You need to create auditable research cards or decision gates.
- You need to capture code, queries, outputs, or artifacts for provenance.
- You need to inspect existing study artifacts or card dependencies.

## Operating Rules

1. Start Lincei work with \`lincei context current\`.
2. Before dataset work, run \`lincei dataset context\`.
3. Before card work, run \`lincei card context\`.
4. Prefer ambient defaults from the Lincei runtime. Pass \`--session\`, \`--project\`, \`--dataset\`, or \`--backend\` only when inference is ambiguous or wrong.
5. Use read-only dataset queries. If a query mutates state or creates tables, write a script and capture the run instead.
6. For substantive analysis, use \`lincei run capture\` with declared dependencies and outputs.
7. Link important results to research cards with artifact IDs or artifact references.
8. Do not proceed past unresolved decision or review cards unless the user explicitly overrides the gate.
9. Separate facts, assumptions, uncertainty, methodological risk, validation needs, and interpretation.

## Quick Start

\`\`\`bash
lincei context current --pretty
lincei dataset context
lincei dataset status
lincei dataset schema --dataset mimic-iv-demo --backend duckdb
lincei dataset describe-table admissions --dataset mimic-iv-demo --backend duckdb
lincei dataset query --dataset mimic-iv-demo --backend duckdb --sql "select * from admissions limit 10"
lincei card context --pretty
\`\`\`

Capture a reproducible run and connect its output to a card:

\`\`\`bash
lincei study init --title "Sepsis Cohort Review"
lincei run capture --dep scripts/cohort.sql --out analysis/cohort.csv node scripts/build-cohort.mjs
lincei artifact list
lincei card propose --title "Cohort definition" --type table --preview-file analysis/cohort-preview.json --artifact artifact-cohort
lincei card request-review CARD_ID --note "Review cohort logic, exclusions, and denominator."
\`\`\`

## Context Commands

Use context commands to orient before acting.

| Command | Use |
| --- | --- |
| \`lincei context current --pretty\` | Infer current workspace, session, and active cards. |
| \`lincei context session --session SESSION_ID --pretty\` | Show compact context for one session. |
| \`lincei context project --project PROJECT_ID --pretty\` | Show compact context for one project. |
| \`lincei context summary --pretty\` | Show active project/session counts. |
| \`lincei card context --pretty\` | Show cards, pending decisions, and decisions made. |
| \`lincei card list --pretty\` | List active research cards. |

Useful flags:

- \`--session SESSION_ID\`: select a session when ambient inference is ambiguous.
- \`--all-cards\`: include inactive cards.
- \`--diagnostics\`: include cwd, ambient env, and resolution details.
- \`--pretty\`: pretty-print JSON output.

If inference fails, Lincei reports candidate sessions or projects. Pick one explicitly instead of guessing.

## Dataset Commands

Run \`lincei dataset context\` first. It emits prompt-ready dataset guidance by default and structured JSON with \`--structured\`.

| Command | Use |
| --- | --- |
| \`lincei dataset status\` | Show configured dataset runtimes. |
| \`lincei dataset capabilities\` | Show available backend capabilities. |
| \`lincei dataset schema --dataset DATASET --backend BACKEND\` | Show dataset schema. |
| \`lincei dataset describe-table TABLE --dataset DATASET --backend BACKEND\` | Inspect one table. |
| \`lincei dataset query --dataset DATASET --backend BACKEND --sql "select ..."\` | Run read-only SQL and return normalized JSON. |
| \`lincei dataset context --dataset DATASET --backend BACKEND\` | Emit dataset guidance for agents. |

\`lincei dataset query\` returns:

\`\`\`json
{
  "columns": ["subject_id", "hadm_id"],
  "rows": [{ "subject_id": 1, "hadm_id": 10 }],
  "rowCount": 1,
  "dataset": { "datasetId": "mimic-iv-demo", "backendId": "duckdb" },
  "provenance": {
    "source": "live",
    "command": ["m4", "..."],
    "workspacePath": "/path/to/workspace"
  }
}
\`\`\`

Dataset safety:

- Use \`limit\` during exploration.
- Do not present exploratory counts as final denominators until the cohort script is captured.
- Preserve the exact SQL used for results. Prefer saving SQL under \`analysis/\` or \`scripts/\` and capturing it as a dependency.
- If the live server is stale or unreachable, restart Lincei rather than relying on stale dataset state.

## Study Record Commands

Study records are portable, study-local provenance under \`.lincei\`.

| Command | Use |
| --- | --- |
| \`lincei study init --title "Study Title"\` | Create or read the study-local record. |
| \`lincei study status\` | Check card dependency and artifact consistency. |
| \`lincei run capture --dep INPUT --out OUTPUT COMMAND ...\` | Execute a command and record declared inputs/outputs. |
| \`lincei artifact list\` | List study-local artifact manifests. |
| \`lincei artifact show ARTIFACT_ID\` | Show an artifact manifest by stable ID. |
| \`lincei artifact preview ARTIFACT_ID\` | Preview artifact text. |
| \`lincei artifact preview ARTIFACT_ID --metadata\` | Emit structured preview metadata. |

\`lincei run capture\` records:

- command argv
- cwd
- started/finished timestamps
- exit code
- declared input dependencies
- declared output artifacts
- content hashes for declared files

Capture every substantive script-first analysis:

\`\`\`bash
lincei run capture \\
  --dep scripts/01_cohort.sql \\
  --dep scripts/02_analysis.py \\
  --out analysis/cohort.csv \\
  --out analysis/model-results.json \\
  python scripts/02_analysis.py
\`\`\`

Then inspect artifacts:

\`\`\`bash
lincei artifact list
lincei artifact preview ARTIFACT_ID --max-bytes 20000
\`\`\`

## Research Card Commands

Research cards are the durable visual record for milestones, findings, decisions, reviews, limitations, and final outputs.

| Command | Use |
| --- | --- |
| \`lincei card context --pretty\` | Read current card and decision state. |
| \`lincei card propose --title TITLE --type TYPE\` | Create a proposed card. |
| \`lincei card update CARD_ID\` | Update title, status, preview, or artifacts. |
| \`lincei card request-review CARD_ID --note NOTE\` | Request human review. |
| \`lincei card supersede OLD_CARD_ID --title TITLE\` | Replace a stale/incorrect card with a new proposal. |

Card types:

- \`markdown\`: narrative methods, findings, limitations, protocol text.
- \`table\`: tabular result or cohort preview.
- \`keyValue\`: compact metrics or configuration.
- \`chart\`: chart metadata or chart-like preview.
- \`image\`: visual artifact.
- \`decision\`: decision/review gate.

Lifecycle statuses:

- \`proposed\`
- \`review-requested\`
- \`accepted\`
- \`changes-requested\`
- \`rejected\`
- \`withdrawn\`
- \`superseded\`
- \`dismissed\`

Preview inputs:

- \`--preview "Markdown text"\`
- \`--preview-file path/to/preview.md\`
- \`--preview-file path/to/preview.json\`
- \`--preview-json '{"markdown":"..."}'\`

Use only one preview input per command.

Artifact inputs:

- \`--artifact ARTIFACT_ID\`: attach a study-local artifact by stable ID.
- \`--artifacts-file artifacts.json\`: attach explicit artifact references.
- \`--artifacts-json '[{"id":"artifact-1","kind":"csv","path":"analysis/table.csv"}]'\`

Artifact reference fields:

\`\`\`json
{
  "id": "artifact-cohort",
  "kind": "csv",
  "path": "analysis/cohort.csv",
  "lineStart": 1,
  "lineEnd": 20,
  "contentHash": "sha256:...",
  "role": "cohort output",
  "label": "Final cohort table",
  "mimeType": "text/csv"
}
\`\`\`

Valid artifact kinds: \`code\`, \`visual\`, \`table\`, \`sql\`, \`parquet\`, \`csv\`, \`markdown\`, \`other\`.

## Decision Commands

Use decision cards when human judgment is required before the research can safely proceed.

| Command | Use |
| --- | --- |
| \`lincei decision ask --title TITLE --preview-json JSON\` | Create a pending decision card. |
| \`lincei decision form --title TITLE --preview-json JSON\` | Alias for \`decision ask\`. |
| \`lincei decision record CARD_ID --action ACTION\` | Record a decision response. |
| \`lincei decision record CARD_ID --values-json JSON --note NOTE\` | Record structured values and rationale. |

Decision preview JSON:

\`\`\`json
{
  "fields": [
    {
      "name": "outcome",
      "question": "Primary outcome?",
      "options": [
        { "label": "In-hospital mortality", "description": "Outcome during index admission" },
        { "label": "30-day mortality", "description": "Outcome within 30 days" }
      ],
      "multiple": false,
      "allowOther": true,
      "header": "Outcome"
    }
  ]
}
\`\`\`

Record the decision:

\`\`\`bash
lincei decision record CARD_ID \\
  --action record \\
  --values-json '{"outcome":"In-hospital mortality"}' \\
  --note "Matches the protocol and available outcome labels."
\`\`\`

## Review Gates

Request review for:

- study protocol
- cohort definition
- inclusion/exclusion logic
- outcome/exposure/covariate definitions
- analysis plan
- final denominators
- result interpretation
- limitations and clinical claims

Do not continue past unresolved decision or review cards unless the user explicitly overrides the gate. If the user overrides, record that override as a decision card.

## Failure Handling

- If \`lincei context current\` cannot infer the session, pass \`--session\`.
- If project inference fails, pass \`--project\` or run from the workspace root.
- If the server runtime is stale or unreachable, restart the Lincei server before live write operations.
- If \`lincei run capture\` fails, report the exit code and captured context. Do not silently rerun with changed inputs.
- If an artifact is stale or missing, do not cite it as current evidence. Rebuild or record the stale state as a limitation.
- If a card update would overwrite a preview unintentionally, first inspect the card and use \`card supersede\` for material corrections.

## Output Discipline

When presenting a result to the user, include:

- dataset and backend
- SQL/script path or captured command
- dependencies
- artifact IDs
- card IDs
- denominator checks
- uncertainty and unresolved validation needs

Prefer concise user-facing summaries, but preserve the full provenance through Lincei commands and cards.`,
  },
  {
    id: "clinical-research-session",
    title: "Clinical Research Session",
    description: "Run clinical research sessions with explicit methodology and provenance.",
    category: "workflow" as const,
    body: `---
name: clinical-research-session
description: Use when running an end-to-end clinical research session in Lincei with explicit methodology, human review gates, captured runs, and provenance-backed outputs.
tier: bundled
category: workflow
---

# Clinical Research Session

Run clinical research as a controlled, reviewable workflow. The goal is not just to answer the prompt; it is to leave a research trail a clinical researcher can inspect, challenge, reproduce, and govern.

## When to Use This Skill

- The user is starting or continuing a clinical research project.
- The work includes cohort definition, outcomes, exposures, covariates, analysis, interpretation, or manuscript-like outputs.
- The task could produce a clinical claim or dataset-backed finding.
- The work needs human decision points, review gates, or provenance.

## Session Principles

1. Separate facts, assumptions, uncertainty, risks, and validation needs.
2. Prefer script-first analysis over ad hoc terminal-only analysis.
3. Treat every denominator as a claim that needs traceability.
4. Create decision cards for methodological choices.
5. Capture substantive runs with \`lincei run capture\`.
6. Link outputs to research cards through artifacts.
7. Request review before passing protocol, analysis-plan, and final-result checkpoints.
8. Keep clinical interpretation conservative unless evidence is strong and reviewed.

## Procedure

### Step 1: Orient

Run:

\`\`\`bash
lincei context current --pretty
lincei card context --pretty
lincei dataset context
\`\`\`

Identify:

- active project and session
- current workflow
- active cards
- pending decisions or review requests
- selected dataset/backend
- available dataset commands
- prior artifacts and captured runs

If there are pending decision or review cards, resolve them or ask the user whether to override before doing dependent work.

### Step 2: Define the Study

Create or update a study description card before analysis. It should include:

- research question
- target population
- exposure or intervention
- comparator, if applicable
- outcome
- time window
- dataset/backend
- planned analysis family
- known limitations
- review needs

Use a markdown card:

\`\`\`bash
lincei card propose \\
  --title "Study description" \\
  --type markdown \\
  --preview-file study-description.md
\`\`\`

### Step 3: Create Method Decision Cards

Create decision cards for choices that affect validity:

- cohort entry point
- inclusion criteria
- exclusion criteria
- outcome definition
- exposure definition
- covariates
- missingness handling
- follow-up window
- index date
- statistical model
- subgroup/sensitivity analyses

Use structured previews when useful:

\`\`\`bash
lincei decision ask \\
  --title "Primary outcome definition" \\
  --preview-json '{"fields":[{"name":"outcome","question":"Which primary outcome should be used?","options":[{"label":"In-hospital mortality"},{"label":"30-day mortality"}],"allowOther":true}]}'
\`\`\`

Do not proceed with dependent analysis until the decision is recorded or explicitly overridden.

### Step 4: Write Protocol Artifacts

Before running final analysis, write protocol artifacts in the workspace, for example:

- \`protocol.md\`
- \`analysis-plan.md\`
- \`scripts/01_cohort.sql\`
- \`scripts/02_variables.sql\`
- \`scripts/03_analysis.py\`

Then request review:

\`\`\`bash
lincei run capture --dep protocol.md --dep analysis-plan.md --out artifacts/protocol.md sh -c "mkdir -p artifacts && cp protocol.md artifacts/protocol.md"
lincei artifact list
lincei card propose --title "Protocol ready for review" --type markdown --preview-file protocol.md --artifact ARTIFACT_ID
lincei card request-review CARD_ID --note "Review research question, cohort, outcome, covariates, and planned analysis before execution."
\`\`\`

### Step 5: Explore Safely

Use dataset commands for orientation:

\`\`\`bash
lincei dataset schema --dataset DATASET --backend BACKEND
lincei dataset describe-table TABLE --dataset DATASET --backend BACKEND
lincei dataset query --dataset DATASET --backend BACKEND --sql "select count(*) as n from TABLE"
\`\`\`

Exploration rules:

- Use limits when inspecting rows.
- Avoid transforming exploratory query results into final claims.
- Save final SQL/scripts before capture.
- Record surprising data issues as cards.

### Step 6: Capture Analysis Runs

For final or near-final analysis, run scripts through \`lincei run capture\`:

\`\`\`bash
lincei run capture \\
  --dep scripts/01_cohort.sql \\
  --dep scripts/02_analysis.py \\
  --out analysis/cohort.csv \\
  --out analysis/results.json \\
  python scripts/02_analysis.py
\`\`\`

After capture:

\`\`\`bash
lincei artifact list
lincei artifact preview ARTIFACT_ID --metadata
\`\`\`

Check:

- command exited successfully
- declared outputs exist
- artifacts are current
- result files match the claims being made
- denominators are explicit

### Step 7: Present Results as Cards

Create result cards with:

- clear title
- concise preview
- artifact references
- dataset/backend
- script or SQL dependency
- denominator
- interpretation boundaries

Example:

\`\`\`bash
lincei card propose \\
  --title "Final cohort denominator" \\
  --type table \\
  --preview-file analysis/cohort-summary.json \\
  --artifact ARTIFACT_ID \\
  --dep scripts/01_cohort.sql \\
  --run-id RUN_ID
\`\`\`

For results that affect conclusions, request review:

\`\`\`bash
lincei card request-review CARD_ID --note "Review denominator, exclusion logic, and whether interpretation is supported."
\`\`\`

### Step 8: Interpret Conservatively

Before summarizing, create or update cards for:

- main findings
- sensitivity checks
- negative or null findings
- limitations
- unresolved risks
- clinical interpretation
- next validation steps

Do not make clinical practice recommendations unless explicitly requested and supported by reviewed evidence. Prefer phrasing such as "supports further investigation" over causal or practice-changing claims unless the design justifies stronger language.

### Step 9: Close the Session

Run:

\`\`\`bash
lincei study status
lincei card context --pretty
\`\`\`

Final answer should include:

- what was done
- current evidence
- artifacts/cards created
- decisions made
- unresolved decisions/reviews
- limitations
- recommended next step

## Review Checkpoints

Request human review before:

- protocol execution
- analysis plan execution
- first final denominator
- final outcome model
- final interpretation
- export or manuscript drafting

## Card Policy

Use cards for:

- milestone
- method decision
- finding
- result table
- plot/image
- limitation
- review request
- final conclusion

Do not create cards for trivial terminal chatter, temporary failed commands, or unvalidated exploratory fragments unless they reveal a material issue.

## Risk Handling

If you find a possible validity threat, stop and create a decision or review card before presenting the affected result as stable. Common examples:

- cohort leakage
- immortal time
- denominator mismatch
- outcome timing ambiguity
- missingness or coding drift
- post-treatment adjustment
- duplicate encounters
- unreviewed exclusions

## Output Contract

For every substantive result, the user should be able to answer:

- Which dataset/backend was used?
- Which SQL/script produced it?
- Which command ran?
- Which outputs were captured?
- Which card shows it?
- Which decisions shaped it?
- Which limitations remain?
- Is it reviewed, pending review, or exploratory?`,
  },
  {
    id: "clinical-research-pitfalls",
    title: "Clinical Research Pitfalls",
    description: "Check common clinical research failure modes before interpreting results.",
    category: "clinical-methods" as const,
    body: `---
name: clinical-research-pitfalls
description: Use when checking clinical research analyses for cohort leakage, immortal time, survivorship, missingness, coding drift, denominator mismatch, inappropriate adjustment, multiple testing, and unsupported claims.
tier: bundled
category: clinical-methods
---

# Clinical Research Pitfalls

Use this checklist before treating any clinical research result as stable. The right behavior is to surface risk early, ask for human judgment when needed, and preserve evidence through cards, artifacts, and captured runs.

## When to Use This Skill

- Before interpreting cohort counts, model outputs, tables, or plots.
- Before requesting review on protocol, analysis plan, or results.
- When a result seems surprising, clinically strong, or potentially practice-changing.
- When working with EHR, claims, registry, trial, or observational clinical data.
- When missingness, time alignment, coding, or confounding could change the conclusion.

## Procedure

1. Run \`lincei card context --pretty\` and check pending decisions.
2. Inspect the relevant SQL/scripts and captured artifacts.
3. Walk through each applicable pitfall below.
4. If a pitfall is plausible, create a decision or review card.
5. Do not present affected results as stable until the risk is resolved, accepted as a limitation, or explicitly overridden by the user.

## Pitfall Checklist

### Cohort Leakage

Problem: the cohort includes information that should not be available at cohort entry, or selection depends on post-index events.

Check:

- Is the index date explicit?
- Are inclusion/exclusion criteria measured before or at index?
- Are outcome-related events used to define eligibility?
- Are future measurements used to classify exposure or baseline risk?

Action:

\`\`\`bash
lincei decision ask --title "Cohort leakage check" --preview-json '{"fields":[{"name":"leakage_resolution","question":"Is cohort eligibility restricted to information available at index?","options":[{"label":"Yes"},{"label":"No, revise cohort"},{"label":"Accept as limitation"}],"allowOther":true}]}'
\`\`\`

### Immortal Time

Problem: exposed patients must survive or remain observable long enough to receive the exposure, creating bias.

Check:

- Is exposure assigned after follow-up starts?
- Is follow-up time before exposure counted as exposed time?
- Should exposure be modeled as time-varying?
- Is there a landmark time?

Resolution options:

- redefine index date
- use landmark analysis
- model exposure as time-varying
- restrict claims to association with explicit limitation

### Survivorship and Selection Bias

Problem: analysis includes only patients who survived, remained enrolled, had a lab, or reached a care location.

Check:

- Are only complete cases included?
- Are patients selected based on downstream care intensity?
- Are transfers, deaths before measurement, or early discharges excluded?
- Does missing measurement imply clinical state or care access?

Action: report excluded counts and compare included vs excluded patients when possible.

### Denominator Mismatch

Problem: tables, figures, and text use different denominators.

Check:

- Does every result state N?
- Do cohort, exposure, outcome, and model denominators match expectations?
- Are missing outcome/covariate denominators explicit?
- Are percentages calculated from the right denominator?

Required evidence:

- captured cohort artifact
- denominator table
- card preview with N
- review card for final denominator

### Outcome Timing Ambiguity

Problem: outcome timing is unclear or overlaps with exposure/covariate measurement.

Check:

- Is outcome measured after index?
- Is the follow-up window explicit?
- Are in-hospital, 30-day, ICU, and post-discharge outcomes distinguished?
- Is censoring handled?

Action: create a decision card if the outcome window is not already reviewed.

### Exposure Misclassification

Problem: exposure definition does not match the clinical question.

Check:

- Is exposure based on orders, administrations, diagnoses, procedures, labs, or notes?
- Are start/end times available?
- Are dose, duration, and adherence relevant?
- Is exposure measured before outcome?

Resolution: document operational definition and sensitivity analyses.

### Missingness

Problem: missing data changes the population or biases estimates.

Check:

- Which variables are missing?
- Is missingness structural, clinical, or random?
- Are missingness rates reported by exposure and outcome?
- Is complete-case analysis justified?
- Are imputation or missing indicators needed?

Minimum card: report missingness rates and how missingness was handled.

### Coding Drift and Ontology Risk

Problem: ICD, CPT, medication, lab, device, or local code meanings change over time or across sites.

Check:

- Are code lists versioned?
- Are time periods spanning coding transitions?
- Are local item IDs mapped to stable clinical concepts?
- Are units consistent?
- Are medication/lab names normalized?

Action: attach code list artifacts and request review when definitions affect eligibility or outcomes.

### Duplicate Encounters or Patients

Problem: unit of analysis is wrong.

Check:

- Is the unit patient, admission, ICU stay, encounter, prescription, or measurement?
- Are readmissions handled?
- Are repeated measures modeled or collapsed?
- Is clustering needed?

Decision examples:

- first admission only
- one ICU stay per admission
- all encounters with clustered SEs
- repeated-measures model

### Inappropriate Adjustment

Problem: the model adjusts for mediators, colliders, post-treatment variables, or variables unavailable at decision time.

Check:

- Are covariates baseline/pre-exposure?
- Could a covariate be affected by exposure?
- Is a variable a collider caused by exposure and outcome?
- Is adjustment aligned with the estimand?

Action: create a covariate decision card and preserve the DAG/rationale if available.

### Post-Treatment Covariates

Problem: variables measured after exposure are treated as baseline confounders.

Check:

- Are labs, vitals, severity scores, interventions, or complications measured after exposure?
- Are "baseline" windows explicit?
- Are time windows consistent across groups?

Resolution: restrict covariate window, use time-varying methods, or mark as limitation.

### Multiple Testing

Problem: many outcomes, subgroups, or model variants create false-positive risk.

Check:

- How many hypotheses were tested?
- Which outcome is primary?
- Were subgroup analyses pre-specified?
- Are p-values interpreted cautiously?
- Is correction or false discovery control needed?

Action: label exploratory analyses clearly and avoid strong confirmatory language.

### Unstable Small Cells

Problem: small counts make rates unstable and can create privacy or PHI risk.

Check:

- Are cell counts below institutional suppression thresholds?
- Are rare outcomes or subgroups overinterpreted?
- Are confidence intervals wide?

Action: suppress or aggregate small cells; record the suppression rule.

### Clinical Claim Overreach

Problem: language exceeds the study design.

Check:

- Is the design observational, retrospective, single-center, convenience sample, or underpowered?
- Are causal terms used without causal design?
- Are practice recommendations made from exploratory results?
- Are limitations visible near conclusions?

Safer language:

- "associated with"
- "consistent with"
- "hypothesis-generating"
- "requires validation"
- "supports further investigation"

Avoid unless justified:

- "causes"
- "prevents"
- "improves outcomes"
- "should be used clinically"
- "practice-changing"

## Required Stop Conditions

Stop and create a decision or review card when:

- final denominator is unclear
- index date is unclear
- outcome window is unclear
- exposure occurs after follow-up starts
- cohort criteria use post-outcome data
- missingness could change the conclusion
- covariates may be post-treatment
- multiple testing is not labeled
- artifact is stale or missing
- a clinical recommendation is being made

## Review Card Template

\`\`\`markdown
## Validity Check

**Finding affected:** <card/result>
**Risk:** <pitfall>
**Why it matters:** <short explanation>
**Evidence inspected:** <scripts, queries, artifacts>
**Current status:** unresolved | accepted limitation | resolved
**Decision needed:** <what the researcher must decide>
\`\`\`

Use:

\`\`\`bash
lincei card propose --title "Validity check: <risk>" --type markdown --preview-file validity-check.md
lincei card request-review CARD_ID --note "Review this validity risk before interpreting the affected result."
\`\`\`

## Output Contract

When reporting a pitfall assessment, include:

- checked risks
- risks ruled out and why
- unresolved risks
- artifacts/scripts inspected
- cards or decisions created
- whether the result remains exploratory, review-pending, or accepted`,
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
    skillIds: ["lincei-api", "clinical-research-session", "clinical-research-pitfalls"],
    body: structuredClinicalStudyBody,
  },
  {
    id: "replication-validation",
    title: "Replication / validation",
    version: "1.0.0",
    description: "Validate an existing finding, script, cohort, or protocol before extending it.",
    skillIds: ["lincei-api", "clinical-research-pitfalls"],
    body: `# Replication / Validation Workflow

Start by identifying the original claim, cohort, outcome, and analysis plan. Re-run or reconstruct the analysis script-first, record deviations as decision cards, and report agreement, disagreement, and unresolved threats to validity.`,
  },
  {
    id: "review-only",
    title: "Review only",
    version: "1.0.0",
    description:
      "Review existing artifacts/cards without creating new study claims unless requested.",
    skillIds: ["lincei-api", "clinical-research-pitfalls"],
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
