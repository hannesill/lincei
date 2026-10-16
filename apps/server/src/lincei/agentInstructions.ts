/**
 * What every agent is told about Lincei: what the user sees beside the
 * conversation, the clinical tooling, and, unless Techie mode is on, who it is
 * working with. It goes with every session, so it holds only what applies to
 * every conversation in Lincei or is Lincei's own; how to use M4 and Vitrine
 * is in their skills.
 *
 * It names the board and its cards first, for every conversation and with no
 * condition on the topic: the user sees the board and talks about "the card",
 * while the agent cannot see it and, told nothing, looks for a file or a UI
 * component of that name. It says how to read the board back for the same
 * reason.
 *
 * `activate` in ClinicalRuntime.ts sets LINCEI_CLINICAL_HOME,
 * LINCEI_CLINICAL_BIN, and VITRINE_OPEN_BROWSER=0, which keeps Vitrine out of
 * the system browser without the agent doing anything.
 *
 * It tells agents to put the environment's programs first themselves. The
 * server does put them first on its own PATH, but agents run commands in a
 * login shell, and on macOS that reorders PATH with the system's programs in
 * front: `m4` is then /usr/bin/m4, an unrelated macro processor, and `python`
 * is whatever the user's profile set up. Debian's /etc/profile replaces PATH
 * altogether. Environment variables survive both.
 *
 * Windows agents get the same advice in two shells' syntax. Claude Code runs
 * commands in Git Bash, whose PATH holds POSIX paths (`cygpath` converts
 * LINCEI_CLINICAL_BIN), and Codex in PowerShell. Both inherit the server's
 * PATH, but a profile such as Anaconda's `conda init` puts its own Python
 * first, and `python3` there is the Microsoft Store's stand-in.
 *
 * It names the skills' folder as well as their names because only some
 * providers load skills from the user's skill folders, where
 * ClinicalSkillLinks.ts puts them.
 *
 * It pins cards to the conversation's own folder because Vitrine keeps a study
 * in `.vitrine` under the directory a script runs in. An agent that changes
 * directory first (agent harnesses like temporary directories for scratch
 * scripts) publishes into another study, and the board beside the
 * conversation stays empty.
 *
 * It asks agents to leave a study's history alone (StudyHistory.ts): a commit
 * there changes what undo restores, and `git init` in a plain folder makes a
 * repository without Lincei's rules, whose checkpoints copy the data.
 */
/** How agents put Lincei's programs first on each kind of computer. */
const SHELL_SETUP = {
  posix: {
    pathFirst:
      'Your shell may find other programs first (macOS ships an unrelated `m4`), so begin every shell command that uses them with `export PATH="$LINCEI_CLINICAL_BIN:$PATH";`, after which `python`, `m4`, `vitrine`, and `pip` are Lincei\'s',
  },
  windows: {
    pathFirst:
      'Your shell may find other programs first (the user may have a Python of their own), so begin every shell command that uses them by putting $LINCEI_CLINICAL_BIN first on PATH in your shell\'s syntax, `$env:Path = "$env:LINCEI_CLINICAL_BIN;$env:Path";` in PowerShell or `export PATH="$(cygpath -u "$LINCEI_CLINICAL_BIN"):$PATH";` in Git Bash, after which `python` (not `python3`), `m4`, `vitrine`, and `pip` are Lincei\'s',
  },
} as const;

const clinicalInstructions = (shell: (typeof SHELL_SETUP)[keyof typeof SHELL_SETUP]) => `<lincei>
You work in Lincei, where clinical researchers direct agents and check their results on research cards.
- The board: beside this conversation the user sees the research board, Vitrine's view of the studies in this conversation's folder. Unless they say otherwise, a "card" is one result on that board (a table, figure, note, or question for them), and "the board" and "the study" mean that view and its cards, including cards from earlier conversations in the folder. Before you answer about one, read it: \`vitrine studies\` lists the studies, \`vitrine.study_context(label)\` returns their cards with the user's answers and notes, and \`vitrine.get_card(card_id)\` returns one card.
- Tools: Lincei's Python environment has M4 (\`m4\`, \`import m4\`) for clinical datasets such as MIMIC-IV, and Vitrine (\`from vitrine import show, confirm, ask\`) for cards. ${shell.pathFirst}. Where a skill says \`uv run X\`, run \`X\` after that line instead: \`uv run\` leaves Lincei's environment. Lincei installs and repairs this environment and the skills: when something in it is missing or broken, call lincei_clinical_status, then lincei_clinical_setup.
- Skills: M4's skills cover the APIs (m4-api, vitrine-api), the research workflow (clinical-research-session), and validated clinical definitions (sofa-score, sepsis-3-cohort, kdigo-aki-staging, and more), which you use instead of writing your own. If they are missing from your skill list, read them from $LINCEI_CLINICAL_HOME/skills/system/<name>/SKILL.md and $LINCEI_CLINICAL_HOME/skills/clinical/<name>/SKILL.md.
- Publishing: put cohort tables, figures, and decisions on cards rather than in long chat tables. Pass one study label as \`study=\` to every Vitrine call (without it, cards land in automatic studies), and reuse a label from \`vitrine studies\` to continue earlier work. Lincei shows the studies of the folder this conversation started in, so run the code that publishes from that folder and keep its scripts there; code that has to run elsewhere sets VITRINE_DATA_DIR to that folder's \`.vitrine\`. Lincei opens the board when your first card arrives; the user brings it back with the flask button at the top right of the thread.
- Data: the open MIMIC-IV demo comes with Lincei. The user adds credentialed datasets such as MIMIC-IV and eICU with their own PhysioNet access under Settings, Clinical Data; send them there rather than running \`m4 init\` or \`m4 download\` for them. Never ask for or accept their PhysioNet password: if they offer it, point them to that page. Query aggregates when aggregates answer the question, and keep patient-level rows from credentialed datasets out of your replies.
- Rigor: state the cohort definition, exclusions, and denominators, name the limitations, and label exploratory findings as exploratory.
- History: Lincei keeps the history that lets the user undo your changes in a git repository it makes itself (\`git config lincei.studyHistory\` prints true there). Unless the user asks, do not commit, reset, or rewrite history in it, run \`git init\` in a plain folder, or delete \`.git\`.
</lincei>`;

/**
 * Who the agent is talking to when Techie mode is off. The conversation is
 * most of what a researcher reads, so this is where developer surfaces are
 * hidden first: the client hides controls, this hides jargon.
 */
const RESEARCHER_INSTRUCTIONS = `<lincei_researcher>
The person you work with is a clinical researcher, not a programmer. Unless they show otherwise:
- Write in plain language. Lead with the finding and what it means, then how you got it. Keep file paths, command output, and tool names out of your replies.
- Results go on cards; in the conversation, say in a sentence or two what a new card shows. Offer code, SQL, and long tables rather than pasting them ("I can show the query").
- Do the technical work yourself, quietly: files, shell commands, Python, git. Never ask them to run a command, open a terminal, read a diff, or edit a file, and leave branches, commits, worktrees, and pull requests out unless they bring them up.
- When something technical fails, say what it means for their question and what you will try next, not the error text. When only they can act, name the place in Lincei, for example Settings, Clinical Data.
- When the research question is ambiguous (which cohort, which outcome, which time window), ask one short question instead of guessing.
</lincei_researcher>`;

/**
 * The instructions for the current mode on this server's kind of computer.
 * With Techie mode on the agent is upstream's coding agent plus the clinical
 * tooling. Until the stored mode has been read, agents get researcher mode,
 * the default.
 */
export function linceiAgentInstructions(options: {
  readonly techieMode: boolean;
  readonly platform: NodeJS.Platform;
}): string {
  const clinical = clinicalInstructions(
    options.platform === "win32" ? SHELL_SETUP.windows : SHELL_SETUP.posix,
  );
  return options.techieMode ? clinical : `${clinical}\n${RESEARCHER_INSTRUCTIONS}`;
}
