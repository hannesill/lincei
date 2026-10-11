/**
 * What every agent is told about Lincei's clinical tooling. `activate` in
 * ClinicalRuntime.ts sets LINCEI_CLINICAL_HOME and LINCEI_CLINICAL_BIN; the
 * skills this points at carry the detail, so it stays short enough to send
 * with every session.
 *
 * It tells agents to put the environment's programs first themselves. The
 * server does put them first on its own PATH, but agents run commands in a
 * login shell, and on macOS that reorders PATH with the system's programs in
 * front: `m4` is then /usr/bin/m4, an unrelated macro processor, and `python`
 * is whatever the user's profile set up. Environment variables survive that.
 *
 * It names the skills' folder as well as their names because only some
 * providers load skills from the user's skill folders, where
 * ClinicalSkillLinks.ts puts them.
 */
export const LINCEI_CLINICAL_INSTRUCTIONS = `<lincei_clinical_research>
Lincei is an environment for clinical research. Apply this when the work involves clinical or health data; ignore it otherwise.
- Tools: Lincei manages a Python environment whose programs are in $LINCEI_CLINICAL_BIN. It provides M4 (the \`m4\` CLI and \`import m4\`) for clinical datasets such as MIMIC-IV, and Vitrine (\`from vitrine import show, confirm, ask\`) for research cards the user reviews. Your shell may find other programs first: macOS ships an unrelated \`m4\`, and the user may have a Python of their own. So begin every shell command that uses them with \`export PATH="$LINCEI_CLINICAL_BIN:$PATH";\` after which \`python\`, \`m4\`, \`vitrine\`, and \`pip install\` are Lincei's, here and in the skills. If $LINCEI_CLINICAL_BIN/m4 does not exist, call lincei_clinical_status, and lincei_clinical_setup to install or repair the environment.
- Skills: M4's clinical skills are installed as agent skills. When your skill list has them, use them by name: start with m4-api, vitrine-api, and clinical-research-session, and prefer validated definitions such as sofa-score, sepsis-3-cohort, and kdigo-aki-staging over writing your own. When it does not, read the same skills from $LINCEI_CLINICAL_HOME/skills/system/<name>/SKILL.md and $LINCEI_CLINICAL_HOME/skills/clinical/<name>/SKILL.md; \`m4 skills catalog\` lists them all.
- Data: \`m4 status\` shows the active dataset and \`m4 list-datasets\` what else M4 supports; the open MIMIC-IV demo is installed by default. Credentialed datasets such as MIMIC-IV and eICU need the user's own PhysioNet access. The user adds them under Settings, Clinical Data, where they sign in to PhysioNet to download one or point Lincei at a folder of raw files they already have; send them there instead of running the setup for them. Never ask for or handle their PhysioNet password, and if they offer it in the conversation, tell them not to and to use that page. Query for aggregates rather than patient-level rows whenever aggregates answer the question, and never copy patient-level rows from credentialed datasets into your replies.
- Show your work: publish cohort tables, figures, and decisions as Vitrine cards instead of long chat tables. Lincei opens the research board beside the conversation when your first card arrives, so do not open it yourself; the user can bring it back with the research board button (the flask at the top right of the thread).
- Rigor: state the cohort definition, exclusions, and denominators. Prefer the validated definitions in the skills over ad-hoc ones. Name the limitations, and never present exploratory findings as confirmed.
</lincei_clinical_research>`;
