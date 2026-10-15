# Lincei

Lincei is an agentic clinical research environment. You direct coding agents (Claude Code,
Codex, Cursor, OpenCode, and others) at clinical datasets, stay in the loop while they work, and
review what they produce as visual research cards instead of walls of chat.

Lincei is built on [T3 Code](https://github.com/pingdotgg/t3code) and tracks it closely: threads,
terminals, diffs, the built-in browser, remote access, and provider support all come from upstream.
Lincei adds the clinical layer:

- **A managed clinical Python environment.** [M4](https://github.com/hannesill/m4) for clinical
  datasets such as MIMIC-IV, [Vitrine](https://github.com/hannesill/vitrine) for research cards,
  and the usual analysis stack (pandas, DuckDB, scikit-learn, lifelines, statsmodels). Every agent
  is told where it is, so nothing has to be set up per project.
- **Clinical skills.** Validated definitions the agents read before the matching task: SOFA,
  Sepsis-3, KDIGO AKI staging, comorbidity scores, cohort pitfalls, and more. They are in the
  composer's skill picker next to your own skills.
- **A dataset ready on first run.** The open-access MIMIC-IV demo is downloaded during setup.
- **Your own datasets.** **Settings → Clinical Data** lists the datasets M4 supports. It
  downloads one with your PhysioNet account, or prepares it from a folder of files you already
  downloaded, with progress and no terminal. Your PhysioNet password is used for that download
  and never stored, and agents never see it.
- **Private by default.** No telemetry. No hosted relay. Data stays on your machine unless you
  send it to a model provider yourself.

> [!WARNING]
> Lincei is an early alpha. Agents send the text they read, including query results, to the
> model provider you chose. Use the open MIMIC-IV demo, or make sure your data use agreement
> covers that provider before pointing Lincei at credentialed data.

## Install

1. Install and sign in to at least one provider, for example
   [Claude Code](https://claude.com/product/claude-code) (`claude auth login`) or
   [Codex CLI](https://developers.openai.com/codex/cli) (`codex login`).
2. Download Lincei from [Releases](https://github.com/hannesill/lincei/releases/latest):
   - **Mac:** [`Lincei-mac-arm64.dmg`](https://github.com/hannesill/lincei/releases/latest/download/Lincei-mac-arm64.dmg)
     for Apple Silicon (M1 and later) or
     [`Lincei-mac-x64.dmg`](https://github.com/hannesill/lincei/releases/latest/download/Lincei-mac-x64.dmg)
     for Intel. Open it and drag Lincei into Applications.
   - **Linux:** [`Lincei-linux-x64.AppImage`](https://github.com/hannesill/lincei/releases/latest/download/Lincei-linux-x64.AppImage),
     or [`Lincei-linux-arm64.AppImage`](https://github.com/hannesill/lincei/releases/latest/download/Lincei-linux-arm64.AppImage)
     on ARM. Make it executable and run it: `chmod +x Lincei-linux-x64.AppImage`, then
     `./Lincei-linux-x64.AppImage`.

There is no Windows build yet.

On a Mac, Lincei is not signed with an Apple Developer ID yet, so macOS blocks the first launch and
says it cannot verify the app. Open Lincei once and choose **Done**, then go to **System Settings →
Privacy & Security**, scroll down to the message about Lincei, and choose **Open Anyway**. The
button shows for about an hour after macOS blocked the app; if it is missing, open Lincei once
more. On macOS 14 or earlier, right-click the app and choose **Open** instead. You do this once per
download, and the installer window shows the same steps.

Lincei does not update itself yet. To update, quit Lincei, download the new build from
[Releases](https://github.com/hannesill/lincei/releases), and replace the app in Applications, or
the AppImage on Linux; your conversations and datasets stay. On a Mac, allow it in Privacy &
Security again, as above. On its first launch macOS asks whether Lincei may use "lincei Safe
Storage" in your keychain, where Lincei keeps its sign-ins encrypted: enter your Mac password and
choose **Always Allow**.

On first launch Lincei sets up the clinical environment in the background: Python, M4, Vitrine,
the clinical skills, and the demo dataset. It takes a few minutes and needs a network connection,
but no terminal. The last step of the first-run wizard and **Settings → Clinical Data** show how
far it is and let you retry a step that failed. You can also ask the agent "is the clinical
runtime ready?"; it can check and repair the setup itself.

The clinical skills are linked into `~/.claude/skills` and `~/.agents/skills`, where Claude Code
and Codex look for skills, so they are available to those tools outside Lincei too. A skill of
your own with the same name is never replaced.

## Try it

Open a folder as a project, start a thread, and ask:

> Using the MIMIC-IV demo, build a Sepsis-3 cohort, describe it, and show me the result as cards.

The agent reads the relevant skills, queries the data through M4, and publishes tables and figures
to Vitrine. When the first card arrives, Lincei opens the study beside the conversation for you to
review. The flask button at the top right of a thread opens that study at any time; while Lincei
is still setting up, it shows what it is working on.

## Develop

See [docs/lincei/README.md](./docs/lincei/README.md) for how the fork is organized, how to pull in
upstream changes, and how to cut a release. Everything else in [docs/](./docs/README.md) is
upstream's documentation and applies unchanged, with "T3 Code" read as "Lincei".

Lincei is MIT licensed, as is T3 Code.
