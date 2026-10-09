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

| Part                                                             | Where                                                                                                                                                                      | Hook in upstream files                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Identity (bundle id, URL scheme, data directory, release repo)   | [`scripts/lincei/identity.ts`](../../scripts/lincei/identity.ts)                                                                                                           | The files that script lists, rewritten by it, never by hand                                               |
| Display name in the UI                                           | [`apps/web/vite/linceiBrand.ts`](../../apps/web/vite/linceiBrand.ts)                                                                                                       | One plugin entry in `apps/web/vite.config.ts`                                                             |
| Mark and icons                                                   | `apps/web/src/components/T3Wordmark.tsx`, `assets/`, `apps/web/public/`                                                                                                    | Same file names as upstream, Lincei content                                                               |
| Clinical runtime (M4, Vitrine, skills, demo dataset)             | [`apps/server/src/lincei/ClinicalRuntime.ts`](../../apps/server/src/lincei/ClinicalRuntime.ts)                                                                             | Two lines in `apps/server/src/server.ts`                                                                  |
| Agent tools `lincei_clinical_status` and `lincei_clinical_setup` | [`apps/server/src/lincei/mcp/`](../../apps/server/src/lincei/mcp)                                                                                                          | One registration in `apps/server/src/mcp/McpHttpServer.ts`                                                |
| What agents are told                                             | [`apps/server/src/lincei/agentInstructions.ts`](../../apps/server/src/lincei/agentInstructions.ts)                                                                         | `setRuntimeProductContext` in provider-core's `runtimeInstructions.ts`                                    |
| Requests from the clients (`lincei.request`)                     | [`packages/contracts/src/lincei.ts`](../../packages/contracts/src/lincei.ts), [`apps/server/src/lincei/LinceiRequests.ts`](../../apps/server/src/lincei/LinceiRequests.ts) | One line each in `rpc.ts`, `ws.ts`, `RpcAuthorization.ts`, `RpcInstrumentation.ts`                        |
| Datasets and M4's skills for agents                              | [`ClinicalDatasets.ts`](../../apps/server/src/lincei/ClinicalDatasets.ts), [`ClinicalSkillLinks.ts`](../../apps/server/src/lincei/ClinicalSkillLinks.ts)                   | None                                                                                                      |
| Research board button, which also opens the board by itself      | [`apps/web/src/lincei/`](../../apps/web/src/lincei), [`apps/server/src/lincei/ResearchBoard.ts`](../../apps/server/src/lincei/ResearchBoard.ts)                            | `ChatView.tsx` renders `LinceiPanelLayoutControls` in place of `PanelLayoutControls`                      |
| Settings, Clinical Data                                          | [`ClinicalDataSettings.tsx`](../../apps/web/src/lincei/ClinicalDataSettings.tsx), `apps/web/src/routes/settings.clinical.tsx`                                              | Three lines in `settingsSearch.ts`, two in `SettingsSidebarNav.tsx`, and the generated `routeTree.gen.ts` |
| Clinical step after the first-run wizard                         | [`LinceiWelcomeWizard.tsx`](../../apps/web/src/lincei/LinceiWelcomeWizard.tsx)                                                                                             | `routes/welcome.tsx` renders it in place of `WelcomeWizard`; the stage label is an identity rule          |
| Release                                                          | [`.github/workflows/lincei-release.yml`](../../.github/workflows/lincei-release.yml)                                                                                       | None                                                                                                      |

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

- **`README.md`, icons, `T3Wordmark.tsx`:** keep Lincei's side.
- **A hook line** (`server.ts`, `ws.ts`, `McpHttpServer.ts`, `RpcAuthorization.ts`,
  `RpcInstrumentation.ts`, `rpc.ts`, `runtimeInstructions.ts`, `ChatView.tsx`, `SidebarChrome.tsx`,
  `routes/welcome.tsx`, `settingsSearch.ts`, `SettingsSidebarNav.tsx`, `apps/web/vite.config.ts`):
  take upstream's side and re-add the hook. `git show HEAD -- <file>` shows what it was.
- **`apps/web/src/routeTree.gen.ts`:** take upstream's side and build the web app once
  (`vp run --filter @t3tools/web build`). The router plugin rewrites the file from the route
  files, which puts `/settings/clinical` back.

Finish with:

```sh
vp i
node scripts/lincei/identity.ts check
vp run --filter t3 --filter @t3tools/desktop --filter @t3tools/web typecheck
(cd apps/server && vp test run src/lincei)
(cd apps/desktop && vp test run)
```

A desktop or server test that now fails only because it asserts an upstream identity literal
(`com.t3tools.t3code`, `t3code://`, `~/.t3`) belongs in the identity script's list of tests.

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
has its own home. An environment whose requirements have not changed is left alone.

- **Adopting an M4 or Vitrine release:** change `DEFAULT_CLINICAL_REQUIREMENTS` in
  `ClinicalRuntime.ts`. The next setup reinstalls.
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

### Datasets

Settings, Clinical Data lists M4's datasets (`m4 list-datasets --json`) and adds one from a folder
of raw files (`m4 init <name> --src`) or by download (`m4 download`, then `m4 init`). M4 prints its
progress as NDJSON events, which `ClinicalDatasets.ts` folds into one job per dataset. Jobs live in
memory: a server restart drops the job but not the files it finished, and M4 resumes from them.
Agents do not go through this service. They have the `m4` CLI.

### Research cards

Research cards are shown by upstream's built-in browser, in the right panel. Vitrine keeps its
study store in `.vitrine` and runs one server per store. From 0.1.2 a git worktree shares the
store of its main checkout, so the threads of a project publish into one study wherever they run;
with an older Vitrine each worktree has its own.

The research board button asks the server to start Vitrine in the thread's directory
(`ResearchBoard.ts`) and opens the URL it reports. It also shows setup progress and retries a
failed setup. While an agent works in the thread on screen, the button asks the server every few
seconds when the study last changed, and opens the board the first time it does, once per thread.
The server answers from the modification times of `studies/<study>/index.json`, which Vitrine
documents as rewritten on every card, so asking costs a few `stat` calls and no Python process.

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
