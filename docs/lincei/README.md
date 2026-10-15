# Lincei on top of T3 Code

Lincei is T3 Code plus a thin overlay. This page is for whoever maintains that overlay: what it
consists of, how to keep it thin, and how to pull upstream in.

## The rule

Upstream moves fast (over a thousand commits a month). Every line Lincei changes in an upstream
file is a line that can conflict, so Lincei code goes in **new files**, and upstream files get
one-line hooks at most. If a feature seems to need more than a few lines in an upstream file,
look for a different seam first: an MCP tool, the agent instructions, a build plugin, or a change
in M4 or Vitrine themselves. A feature the clients call adds a case to `lincei.request` rather
than a new RPC method, which would need entries in four upstream files.

Lincei shares git history with upstream. `git merge-base HEAD t3code/main` is the last upstream
commit merged in.

Before October 2026 Lincei was a copied tree with no shared history. That history (tag
`lincei-legacy-main`) is attached as the second parent of one merge commit and contributes no
content. `git log --first-parent` leaves it out.

## What the overlay consists of

| Part                                                             | Where                                                                                                                                                                                                                              | Hook in upstream files                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity (bundle id, URL scheme, data directory, release repo)   | [`scripts/lincei/identity.ts`](../../scripts/lincei/identity.ts)                                                                                                                                                                   | The files that script lists, rewritten by it, never by hand                                                                                                                                                                  |
| Display name in the UI                                           | [`apps/web/vite/linceiBrand.ts`](../../apps/web/vite/linceiBrand.ts)                                                                                                                                                               | One plugin entry in `apps/web/vite.config.ts`                                                                                                                                                                                |
| Mark and icons                                                   | [`scripts/lincei/icons.ts`](../../scripts/lincei/icons.ts) draws `assets/` and `apps/web/public/`; `apps/web/src/components/T3Wordmark.tsx`                                                                                        | Same file names as upstream, Lincei content                                                                                                                                                                                  |
| Clinical runtime (M4, Vitrine, skills, demo dataset)             | [`apps/server/src/lincei/ClinicalRuntime.ts`](../../apps/server/src/lincei/ClinicalRuntime.ts)                                                                                                                                     | Two lines in `apps/server/src/server.ts`                                                                                                                                                                                     |
| Agent tools `lincei_clinical_status` and `lincei_clinical_setup` | [`apps/server/src/lincei/mcp/`](../../apps/server/src/lincei/mcp)                                                                                                                                                                  | One registration in `apps/server/src/mcp/McpHttpServer.ts`                                                                                                                                                                   |
| What agents are told                                             | [`apps/server/src/lincei/agentInstructions.ts`](../../apps/server/src/lincei/agentInstructions.ts)                                                                                                                                 | `setRuntimeProductContext` in provider-core's `runtimeInstructions.ts`                                                                                                                                                       |
| Requests from the clients (`lincei.request`)                     | [`packages/contracts/src/lincei.ts`](../../packages/contracts/src/lincei.ts), [`apps/server/src/lincei/LinceiRequests.ts`](../../apps/server/src/lincei/LinceiRequests.ts)                                                         | One line each in `rpc.ts`, `ws.ts`, `RpcAuthorization.ts`, `RpcInstrumentation.ts`, and the export in `packages/contracts/src/index.ts`                                                                                      |
| Datasets and M4's skills for agents                              | [`ClinicalDatasets.ts`](../../apps/server/src/lincei/ClinicalDatasets.ts), [`ClinicalSkillLinks.ts`](../../apps/server/src/lincei/ClinicalSkillLinks.ts)                                                                           | None                                                                                                                                                                                                                         |
| Research board button, which also opens the board by itself      | [`apps/web/src/lincei/`](../../apps/web/src/lincei), [`apps/server/src/lincei/ResearchBoard.ts`](../../apps/server/src/lincei/ResearchBoard.ts)                                                                                    | `ChatView.tsx` renders `LinceiPanelLayoutControls` in place of `PanelLayoutControls`                                                                                                                                         |
| Settings, Clinical Data                                          | [`ClinicalDataSettings.tsx`](../../apps/web/src/lincei/ClinicalDataSettings.tsx), `apps/web/src/routes/settings.clinical.tsx`                                                                                                      | Five lines in `settingsSearch.ts`, two in `SettingsSidebarNav.tsx`, and the generated `routeTree.gen.ts`                                                                                                                     |
| Clinical step after the first-run wizard                         | [`LinceiWelcomeWizard.tsx`](../../apps/web/src/lincei/LinceiWelcomeWizard.tsx)                                                                                                                                                     | `routes/welcome.tsx` renders it in place of `WelcomeWizard`; the stage label is an identity rule                                                                                                                             |
| Researcher mode and Techie mode                                  | [`apps/web/vite/linceiResearcherMode.ts`](../../apps/web/vite/linceiResearcherMode.ts), [`apps/web/src/lincei/mode/`](../../apps/web/src/lincei/mode), [`LinceiPreferences.ts`](../../apps/server/src/lincei/LinceiPreferences.ts) | One changed line and an import each in `state/server.ts`, `localApi.ts`, `CommandPalette.tsx`, `SettingsSidebarNav.tsx`, `useAvailableSettingsSearchItems.ts`; two in `ChatView.tsx`; the switch row in `SettingsPanels.tsx` |
| A researcher's wording for upstream's developer copy             | [`apps/web/vite/linceiCopy.ts`](../../apps/web/vite/linceiCopy.ts)                                                                                                                                                                 | None: applied by the brand plugin as it builds                                                                                                                                                                               |
| Default look (colours, corners, borders, shadows)                | [`apps/web/src/lincei/theme.css`](../../apps/web/src/lincei/theme.css), [`apps/web/vite/linceiTheme.ts`](../../apps/web/vite/linceiTheme.ts)                                                                                       | None: compiled in by the brand plugin                                                                                                                                                                                        |
| Release                                                          | [`.github/workflows/lincei-release.yml`](../../.github/workflows/lincei-release.yml)                                                                                                                                               | None                                                                                                                                                                                                                         |

To see every upstream file Lincei has touched:

```sh
git diff --stat "$(git merge-base HEAD t3code/main)" HEAD
```

Internal names stay upstream's on purpose: `@t3tools/*` packages, `T3CODE_*` environment
variables, the `t3-code` MCP server, `t3.json`. Renaming them buys nothing and conflicts
everywhere.

## Pulling in upstream

```sh
git fetch t3code main
git merge t3code/main
```

Then, for each conflict:

- **A file governed by `scripts/lincei/identity.ts`:** take upstream's side and reapply.

  ```sh
  git checkout --theirs <file>
  node scripts/lincei/identity.ts apply
  ```

  If the script reports a rule that no longer matches, upstream changed that line; update the
  rule to the new text.

- **`README.md`, `T3Wordmark.tsx`, `apps/desktop/resources/dmg/dmg-background-latest.svg`:** keep
  Lincei's side.
- **An icon under `assets/` or `apps/web/public/`:** take either side, then run
  `node scripts/lincei/icons.ts`.
- **A hook line** (`server.ts`, `ws.ts`, `McpHttpServer.ts`, `RpcAuthorization.ts`,
  `RpcInstrumentation.ts`, `rpc.ts`, `packages/contracts/src/index.ts`, `runtimeInstructions.ts`,
  `ChatView.tsx`, `SidebarChrome.tsx`,
  `routes/welcome.tsx`, `settingsSearch.ts`, `SettingsSidebarNav.tsx`,
  `useAvailableSettingsSearchItems.ts`, `SettingsPanels.tsx`, `CommandPalette.tsx`, `localApi.ts`,
  `state/server.ts`, `apps/web/vite.config.ts`): take upstream's side and re-add the hook.
  `git show HEAD -- <file>` shows what it was. Every hook is an import of something under
  `lincei/` and one line that uses it, so `git grep -n lincei -- <file>` on the old version lists
  them. `SettingsPanels.tsx` is also governed by `identity.ts`: reapply first, then re-add its hook.
- **`apps/web/src/routeTree.gen.ts`:** take upstream's side and build the web app once
  (`vp run --filter @t3tools/web build`). The router plugin rewrites the file from the route
  files, which puts `/settings/clinical` back.

Finish with:

```sh
vp i
node scripts/lincei/identity.ts check
vp run --filter t3 --filter @t3tools/desktop --filter @t3tools/web typecheck
(cd apps/server && vp test run src/lincei)
(cd apps/web && vp test run src/lincei)
(cd apps/desktop && vp test run)
```

`identity.ts check` reads four things. A governed file that is stale: run `apply`. A string in
`apps/web/vite/linceiCopy.ts` or a colour in `apps/web/vite/linceiTheme.ts` that upstream reworded
or moved: decide whether Lincei still wants its own text for the new one and update `from`. A
source text that a researcher-mode selector in `apps/web/vite/linceiResearcherMode.ts` depends on:
upstream renamed an aria-label or a data attribute, so that control is visible again in researcher
mode until the selector and its anchor are updated. A source text that a selector of the default
look depends on (`THEME_SELECTORS` in `linceiTheme.ts`): that component has upstream's look again
until `theme.css` and its entry are updated. The last three never conflict in git, because Lincei
does not edit those files; the check is the only thing that notices.

The typecheck and the tests show what is left, because none of it conflicts in git:

- **Lincei's own files use upstream's modules.** When the typecheck fails inside `lincei/`,
  upstream renamed or moved something they import. `git log -S'<old name>' t3code/main` finds the
  commit, which also shows how upstream changed its own callers; change Lincei's the same way.
- **New upstream code can carry an identity literal the script has no rule for yet.** A governed
  test then fails, because its expectation is rewritten and the new line it tests is not (or the
  other way round, where the test writes the literal differently, such as with escaped dots in a
  regular expression). Add an exact rule for that line and run `apply`. A desktop or server test
  that fails only because it asserts an upstream identity literal (`com.t3tools.t3code`,
  `t3code://`, `~/.t3`) belongs in the identity script's list of tests.
- **An upstream test that builds a layer Lincei hooks into must pass without Lincei's services.**
  Hook code therefore reads Lincei's services as optional (`Effect.serviceOption`, as in
  [`mcp/handlers.ts`](../../apps/server/src/lincei/mcp/handlers.ts)). If such a test stops
  compiling after a merge, a Lincei requirement has leaked into an upstream layer.

Merge often. A weekly merge is a handful of mechanical conflicts; a quarterly one is a project.

## The clinical runtime

Lincei owns one Python environment at `<home>/clinical/venv`, where `<home>` is `~/.lincei`. At
startup the server puts its `bin` first on `PATH` and sets `LINCEI_CLINICAL_HOME`,
`LINCEI_CLINICAL_BIN`, and `M4_DATA_DIR` for everything it spawns. A user who exports their own
`M4_DATA_DIR` keeps it.

Being first on the server's `PATH` is not enough for agents. They run commands in a login shell,
and macOS rebuilds `PATH` there with the system's directories in front, where `/usr/bin/m4` is an
unrelated macro processor and `python` is whatever the user's profile set up. Environment
variables survive, so the agent instructions tell agents to begin clinical commands with
`export PATH="$LINCEI_CLINICAL_BIN:$PATH";`. Anything else that needs the environment from a
login shell has to do the same.

Setup runs `uv`: create the environment, install the pinned requirements, materialize M4's
skills into `<home>/clinical/skills`, and download the MIMIC-IV demo. A machine without `uv` gets
Lincei's own copy in `<home>/clinical/bin`, downloaded from the release pinned (with its digest)
in `UvInstallation.ts`. The desktop app runs it
on launch; a dev server waits until an agent calls `lincei_clinical_setup`, because each worktree
has its own home. An environment whose requirements have not changed is left alone, unless the
request says `force`, which installs everything again to repair tools that are installed but
broken. When an update of the requirements fails (offline, say) and the installed tools still
run, they stay usable and the status says the update is pending.

What setup and the dataset jobs report is read by someone who may never have opened a terminal.
Every `message` says what happened and what to do next, in plain words; command output goes in
`detail`, which the clients keep behind a disclosure.

- **Adopting an M4 or Vitrine release:** change `DEFAULT_CLINICAL_REQUIREMENTS` in
  `ClinicalRuntime.ts`. The next launch installs the new versions.
- **Developing against a local checkout:** set `LINCEI_CLINICAL_REQUIREMENTS`, for example
  `LINCEI_CLINICAL_REQUIREMENTS="m4-infra[research] /path/to/vitrine"`.

### Skills

T3 Code's skill picker lists the skills each provider finds on disk. So that M4's skills appear
there, and so that an agent loads one when its description fits the task, setup links every skill
of the bundle into the folders Claude and Codex read user skills from: `~/.claude/skills` (or
`$CLAUDE_CONFIG_DIR/skills`) and `~/.agents/skills`. These folders belong to the user. A skill of
theirs with the same name is left alone and wins, and Lincei's links are the ones that point into
`<home>/clinical/skills`, which is how setup removes stale ones and how to remove them by hand.
`LINCEI_CLINICAL_SKILL_DIRS` (paths separated like `PATH`) replaces the folders, and setting it
empty keeps Lincei out of them. Providers that do not read those folders still get the skills
through the agent instructions, which name `<home>/clinical/skills`.

Settings, Clinical Data, What agents get shows the same thing read-only: the instructions for the
current mode, and each skill with its description and whether a skill of the user's takes its
place. Upstream shows neither anywhere, and a researcher should be able to check what an agent was
told. A skill's text is asked for only when its row is opened (`ClinicalSkillText`), so the page
does not carry the whole bundle over the connection.

### Datasets

Settings, Clinical Data lists M4's datasets (`m4 list-datasets --json`) and adds one from a folder
of raw files (`m4 init <name> --src`) or by download (`m4 download`, then `m4 init`). M4 prints its
progress as NDJSON events, which `ClinicalDatasets.ts` folds into one job per dataset. Setup's
demo download is such a job too, so every M4 run that writes a dataset has one owner. Agents do
not go through this service. They have the `m4` CLI.

Jobs live in memory; what a job left unfinished does not. M4 (0.5.5) calls a dataset ready as soon
as some converted files and a database exist, and converts nothing once any converted file exists,
so a preparation that was cancelled or killed came back as a ready dataset with tables missing.
Before M4 prepares a dataset, Lincei writes a mark at `<home>/clinical/preparing/<name>` and
removes it only when M4 reports completion. A marked dataset is never ready, and the next Add or
Download first removes the converted files and the database M4 reports for it, so everything is
converted again; downloaded raw files are kept, so downloads still resume. Lincei removes those
files only in its own store under `<home>`. With a store the user chose (`M4_DATA_DIR`) the job
stops and says so. M4 0.5.6 fixes the cause and is now the minimum, so the mark can go once no
environment set up with 0.5.5 is left (setup replaces M4 when the minimum changes).

Credentialed datasets are downloaded with the user's own PhysioNet login, which Lincei never
stores:

- It is typed into a password field on that page, never into a conversation, where an agent and
  its model provider would read it. The agent instructions say so too.
- The dialog only sends it to this machine or over HTTPS (`connectionProtectsSecrets`).
- In the contract the password is `Schema.RedactedFromValue`, so a request that is logged, traced,
  or printed shows `<redacted>`. Upstream's RPC instrumentation records the method, not the
  payload.
- The server holds it for that one download and gives it to M4 on standard input: not on a
  command line, in the environment, or in a file. The next download asks again; only the username
  is remembered, in the client's local storage.
- It is sent only when M4 says the dataset downloads from `https://physionet.org/`. A dataset
  definition in M4's data folder can replace a built-in one, address included, and agents can
  write that folder.
- M4 runs with plain tracebacks (`_TYPER_STANDARD_TRACEBACK`), because its default ones print
  local variables, and the password is redacted from M4's output before that output is cut down.

Where the installed M4 has `--physionet-credentials-stdin` (0.5.6 and later), Lincei uses it on
every platform. An environment still on M4 0.5.5 gets the login through
`--physionet-credentials-file /dev/stdin`, which works on macOS only: on Linux a child process's
standard input is a socket that cannot be opened by path, and Windows has no such path. There the
server reports credentialed datasets as not downloadable, so the clients offer "Add from folder"
and never ask for a password.

PhysioNet reads a login only from clients whose user agent starts with `Wget/` or `libwfdb/`
(`HTTP_AUTH_USER_AGENT` in physionet-build's `project/utility.py`) and answers everyone else 403, as
if the account had no access. M4 0.5.5 sent a browser user agent, so no credentialed download could
work; 0.5.6 sends a Wget-compatible one with a login. Only since then does M4 tell a wrong
password (`physionet_auth_failed`) from an account without access (`physionet_access_forbidden`).

PhysioNet requires that an AI service used with credentialed data keeps none of it, does not train
on it, and has no human review, and makes the researcher responsible for checking that. Agents
send what they read to the model provider, so the clients say this wherever a credentialed dataset
comes in: both dataset dialogs, the first-run step, and Settings, Clinical Data. The two dialogs go
ahead only once the researcher ticks that they checked their account, every time, because the
account an agent uses can change. `physioNet.tsx` links the pages a researcher needs on the way:
credentialing, training, each dataset's page with its data use agreement, and PhysioNet's rules
for AI services.

### Research cards

Research cards are shown by upstream's built-in browser, in the right panel. Vitrine keeps its
study store in `.vitrine` under the directory a script runs in, and runs one server per store.
A git worktree shares the store of its main checkout, so the threads of a project publish into
one study wherever they run. Vitrine 0.1.3, the minimum, locks a study's index, so two agents
publishing at once keep each other's cards.

Three things follow from "the directory a script runs in", and each has bitten:

- An agent that changes directory before publishing writes to another study, and the board
  beside the conversation stays empty. The agent instructions say to publish from the folder the
  conversation started in, or to set `VITRINE_DATA_DIR`.
- The store sits in the project folder, holds the rows behind every card, and upstream snapshots
  the folder with `git add -A` after every turn. Vitrine writes a `.gitignore` into its store;
  before 0.1.2 the store showed up in the turn's changed files and went into the hidden
  checkpoint commits.
- Vitrine's servers never stop by themselves and it has ten ports. The server stops the boards of
  the folders it opened or watched when it shuts down (`ResearchBoard.ts`).

Vitrine opens the system browser when a script's first card starts its server. Lincei sets
`VITRINE_OPEN_BROWSER=0`, which Vitrine honours from 0.1.2; the agent instructions also say to run
`vitrine start --no-open` first, for an environment set up before that.

The research board button asks the server to start Vitrine in the thread's directory
(`ResearchBoard.ts`) and opens the URL it reports. It also shows setup progress and retries a
failed setup. While an agent works in the thread on screen, the button asks the server every few
seconds when the study last changed, and opens the board the first time it does, once per thread.
The server answers from the modification times of `studies/<study>/index.json`, which Vitrine
documents as rewritten on every card, so asking costs a few `stat` calls and no Python process.

## Researcher mode and Techie mode

Lincei's user is a clinical researcher. Upstream's is a developer, and its interface says so on
every screen: terminals, diffs, branches, worktrees, pull requests, runtime modes. Lincei keeps all
of that function and hides the surfaces unless **Techie mode** is on. The switch is the first row
of Settings, General and the last row of the first-run wizard; it is off by default, takes effect
at once, and closes nothing, so a terminal that was open is still there when the mode is turned
back on. Settings search and the command palette find it under the names of what it hides
(terminal, git, keyboard shortcuts), which in researcher mode would otherwise find nothing.

Four layers, cheapest first:

1. **What agents are told** ([`agentInstructions.ts`](../../apps/server/src/lincei/agentInstructions.ts)).
   The conversation is most of what a researcher reads. With Techie mode off agents get a second
   block: plain language, results on cards, code and SQL on request, files and git handled
   quietly. The server builds this text, so the mode is stored on the server:
   [`LinceiPreferences.ts`](../../apps/server/src/lincei/LinceiPreferences.ts) keeps it in
   `lincei.json` beside upstream's `settings.json` and calls `setRuntimeProductContext` again on
   every change. Most providers pick that up on their next turn; Claude when its process next
   starts. Clients read and write it through `lincei.request`.
2. **Copy** ([`linceiCopy.ts`](../../apps/web/vite/linceiCopy.ts)). Exact upstream strings and a
   researcher's wording, replaced as the bundle is built. It is the same in both modes.
3. **Controls on screen** ([`linceiResearcherMode.ts`](../../apps/web/vite/linceiResearcherMode.ts)).
   One table of selectors. The build turns it into a stylesheet scoped to
   `html:not([data-lincei-techie="true"])` and a boot script that sets that attribute from the
   cached mode before first paint. Upstream has few test ids, so most selectors use an aria-label
   or a data attribute; each entry names the source text it depends on, and `identity.ts check`
   fails when that text is gone. A selector that stops matching hides nothing: a broken rule means
   the control reappears, never that something else disappears.
4. **Surfaces that act from data** ([`mode/`](../../apps/web/src/lincei/mode)). A hidden palette
   row still runs on Enter, and a shortcut needs no row at all. So the command palette, keyboard
   shortcuts, context menus, settings search, and the settings nav are filtered where upstream
   builds them, each through one hook line, and the right panel's terminal, diff, pull-request and
   device surfaces are marked unavailable, which also stops the letter keys its launcher listens
   to. The thread view treats every folder as plain (`mode/git.ts`): no branch strip, no worktree
   choice.

To hide another control: add an entry to the table with its selector and anchors, run
`node scripts/lincei/identity.ts check`, and, if the control can also be reached from the palette,
a shortcut, a context menu, or settings search, add it to
[`researcherFilters.ts`](../../apps/web/src/lincei/mode/researcherFilters.ts), whose test fails
when upstream renames a settings id or a shortcut command.

**Starting settings** ([`researcherDefaults.ts`](../../apps/web/src/lincei/researcherDefaults.ts)).
Four settings start differently from upstream's default: archiving a conversation asks first,
in-app notifications are on, surfaces are solid instead of frosted glass (which shows grey smudges
on the plain white look), and new conversations run in upstream's "Auto" permission mode
instead of "Full access" (Claude runs in Claude Code's auto mode; Codex runs sandboxed to the
project with its automatic reviewer deciding the rest). Researcher mode hides the permission
picker, so this is the mode a researcher works in. The wizard writes them once per device when it
reaches Lincei's step, through upstream's settings writer, which sends the permission default to
the server, so they cost no upstream line and are the user's to change afterwards. The reset arrows in Settings still lead to upstream's defaults, and a
test fails when upstream's default catches up with one of them, which is when to drop it.

Git stays underneath and out of sight. A project that is a git repository still gets upstream's
checkpoint after every turn, so rewinding a conversation works there. A plain folder gets none:
Lincei does not turn a folder the researcher chose into a repository, because a checkpoint copies
every file that is not ignored into `.git`, and a research folder holds data.

## The default look

Lincei's look is a quiet version of the neobrutalism of its research cards: ink on white paper
(Vitrine's dark palette in dark), square corners, an ink line around what holds input or floats,
and a small hard shadow under menus, dialogs, tooltips, and toasts. Dividers and list separators
stay quiet grey, and the only hues are error, warning, and success, so the research board is the
most colourful thing on screen. It replaces upstream's stock look only. A theme the user picks,
the contrast and glass sliders, and custom fonts are upstream's and keep winning.

- [`theme.css`](../../apps/web/src/lincei/theme.css) sets upstream's tokens with upstream's own
  selectors, and puts everything no theme maps under `html:not([data-theme-id])`. The brand plugin
  appends it to `index.css` as an `@import`, so Tailwind compiles it with upstream's stylesheet and
  its rules come last at the same specificity. A `<style>` tag in `index.html` would not work: the
  app's stylesheet is added to the page at run time, after everything in `<head>`, and would win
  every tie. The file's header lists the four rules that keep it from fighting upstream or the
  user.
- Tokens cannot do all of it: Tailwind writes each shadow into its `shadow-*` utility, and
  `rounded-full` and arbitrary radii are literals. One universal rule squares every corner except
  a radio's, and a few component rules select on `data-slot` and similar attributes.
  `THEME_SELECTORS` in [`linceiTheme.ts`](../../apps/web/vite/linceiTheme.ts) lists every selector
  of theme.css with the upstream text it depends on.
- `--input` is ink in light, which puts the ink line on fields, outline buttons, and checkboxes
  without a selector. Upstream also fills an unchecked switch, a pressed toggle, and a segmented
  track with it; those get rules of their own, and they are the selectors whose breaking is worse
  than upstream's look coming back.
- Upstream repeats its stock colours outside CSS, in the stock palette as theme roles
  (`packages/shared/src/themePalettes.ts`) and in the Appearance previews. linceiTheme.ts replaces
  those literals with exact-once rules, the same mechanism as the copy, checked the same way. The
  canvas is upstream's own white and near-black, so the boot script in `index.html` and the colour
  Electron paints before the page exists stay upstream's.
- The mark is the same card in black and white: an ink outline and a hard shadow twice as thick,
  as on Vitrine's buttons, around a serif L. `T3Wordmark.tsx` draws it in the text colour.

Type is still upstream's system stack.

The app icons and favicons are drawn by [`scripts/lincei/icons.ts`](../../scripts/lincei/icons.ts)
and written to upstream's icon files, so the build scripts read them unchanged. After changing the
drawing, run `node scripts/lincei/icons.ts`. Development builds get the mark inverted, to tell them
apart from an installed Lincei. Never run `vp run icons:export`: it renders upstream's Icon
Composer projects and would put T3 Code's icons back. The iOS and Android icons stay upstream's,
because Lincei ships no mobile app.

## Releasing

Run the **Lincei release** workflow with a version. It builds an Apple Silicon DMG and attaches
it to a draft GitHub release. Building locally needs Rust (`rustup target add
aarch64-apple-darwin`) and runs:

```sh
vp run dist:desktop:dmg:arm64
```

Builds are unsigned until a Developer ID certificate and notarization credentials are added to
the workflow, so macOS blocks them until the user allows the app in System Settings. An unsigned
build also cannot install updates, which is why the workflow builds without an update feed
(`T3CODE_DESKTOP_UPDATE_REPOSITORY: none`). Drop that line when signing is added.

Upstream's own workflows (`release.yml`, `ci.yml`, the mobile and relay ones) assume T3 Code's
runners and accounts, and `release.yml` runs on a 30-minute schedule. The files stay in place so
merges stay clean, and every workflow except **Lincei release** is disabled on GitHub. A workflow
file that a merge adds starts out enabled, so after pushing a merge:

```sh
gh workflow list --all
gh workflow disable <new-file>.yml
```

## Not carried over from upstream

- **T3 Connect, the hosted relay, and the mobile apps** stay off: they need upstream's accounts,
  and Lincei sets none of the build-time keys that enable them.
- **Remote hosts over SSH** download a server binary from Lincei's GitHub releases, which do not
  publish one yet.
- **Telemetry** is off, with no analytics key.
