/**
 * What every agent is told about Lincei's clinical tooling. `activate` in
 * ClinicalRuntime.ts puts the managed environment on PATH and sets
 * LINCEI_CLINICAL_HOME; the skills this points at carry the detail, so it stays
 * short enough to send with every session.
 */
export const LINCEI_CLINICAL_INSTRUCTIONS = `<lincei_clinical_research>
Lincei is an environment for clinical research. Apply this when the work involves clinical or health data; ignore it otherwise.
- Tools: a managed Python environment is first on PATH. It provides M4 (the \`m4\` CLI and \`import m4\`) for clinical datasets such as MIMIC-IV, and Vitrine (\`from vitrine import show, confirm, ask\`) for research cards the user reviews. Add packages with \`pip install\`. If \`m4\` is not found, call lincei_clinical_status, and lincei_clinical_setup to install or repair the environment.
- Skills: before a matching task, read $LINCEI_CLINICAL_HOME/skills/system/<name>/SKILL.md (start with m4-api, vitrine-api, and clinical-research-session) and $LINCEI_CLINICAL_HOME/skills/clinical/<name>/SKILL.md for validated definitions such as sofa-score, sepsis-3-cohort, and kdigo-aki-staging. \`m4 skills catalog\` lists them all.
- Data: \`m4 status\` shows the active dataset; the open MIMIC-IV demo is installed by default. Query for aggregates rather than patient-level rows whenever aggregates answer the question, and never copy patient-level rows from credentialed datasets into your replies.
- Show your work: publish cohort tables, figures, and decisions as Vitrine cards instead of long chat tables. To put the study in front of the user, run \`vitrine start --no-open --json\` in the project directory, then call preview_open and preview_navigate with target {kind:"environment-port", port:<the port from that JSON>}.
- Rigor: state the cohort definition, exclusions, and denominators. Prefer the validated definitions in the skills over ad-hoc ones. Name the limitations, and never present exploratory findings as confirmed.
</lincei_clinical_research>`;
