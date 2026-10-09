# Lincei

Lincei is an agentic clinical research environment. You direct coding agents (Claude Code,
Codex, Cursor, OpenCode, and others) at clinical datasets, stay in the loop while they work, and
review what they produce as visual research cards instead of walls of chat.

Lincei is built on [T3 Code](https://github.com/pingdotgg/t3code) and tracks it closely: threads,
terminals, diffs, the built-in browser, remote access, and provider support all come from upstream.
Lincei adds the clinical layer:

- **A managed clinical Python environment.** [M4](https://github.com/hannesill/m4) for clinical
  datasets such as MIMIC-IV, [Vitrine](https://github.com/hannesill/vitrine) for research cards,
  and the usual analysis stack (pandas, DuckDB, scikit-learn, lifelines, statsmodels). It is first
  on `PATH` for every agent and terminal, so nothing has to be set up per project.
- **Clinical skills.** Validated definitions the agents read before the matching task: SOFA,
  Sepsis-3, KDIGO AKI staging, comorbidity scores, cohort pitfalls, and more.
- **A dataset ready on first run.** The open-access MIMIC-IV demo is downloaded during setup.
- **Private by default.** No telemetry. No hosted relay. Data stays on your machine unless you
  send it to a model provider yourself.

> [!WARNING]
> Lincei is an early alpha. Agents send the text they read, including query results, to the
> model provider you chose. Use the open MIMIC-IV demo, or make sure your data use agreement
> covers that provider before pointing Lincei at credentialed data.

## Install

1. Install [uv](https://docs.astral.sh/uv/), which Lincei uses to build its Python environment:

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. Install and sign in to at least one provider, for example
   [Claude Code](https://claude.com/product/claude-code) (`claude auth login`) or
   [Codex CLI](https://developers.openai.com/codex/cli) (`codex login`).
3. Download the latest Lincei build for Apple Silicon Macs from
   [Releases](https://github.com/hannesill/lincei/releases) and drag it into Applications.

Alpha builds are not signed with an Apple Developer ID yet, so macOS blocks the first launch.
Open Lincei once and dismiss the warning, then go to **System Settings → Privacy & Security**,
scroll down to the message about Lincei, and choose **Open Anyway**. On macOS 14 or earlier,
right-click the app and choose **Open** instead.

On first launch Lincei sets up the clinical environment in the background (a few minutes,
network required). Ask the agent "is the clinical runtime ready?" at any time; it can check and
repair the setup itself.

## Try it

Open a folder as a project, start a thread, and ask:

> Using the MIMIC-IV demo, build a Sepsis-3 cohort, describe it, and show me the result as cards.

The agent reads the relevant skills, queries the data through M4, publishes tables and figures to
Vitrine, and opens the study in the built-in browser for you to review.

## Develop

See [docs/lincei/README.md](./docs/lincei/README.md) for how the fork is organized, how to pull in
upstream changes, and how to cut a release. Everything else in [docs/](./docs/README.md) is
upstream's documentation and applies unchanged, with "T3 Code" read as "Lincei".

Lincei is MIT licensed, as is T3 Code.
