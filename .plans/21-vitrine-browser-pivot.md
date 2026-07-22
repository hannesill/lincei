Replace native Lincei cards with managed Vitrine

Implement the Lincei → Vitrine product pivot.

Work autonomously through implementation and verification. Do not stop after producing a plan. Ask for owner input only when a decision would materially change product scope, data compatibility, or release behavior.

## Repositories and upstream source

- Lincei: `/Users/hannesill/Developer/lincei`
- Vitrine: `/Users/hannesill/Developer/vitrine`
- Upstream browser donor: <https://github.com/pingdotgg/t3code/tree/v0.0.29-nightly.20260722.877>
- Relevant upstream browser commit: <https://github.com/pingdotgg/t3code/commit/52c77c1ec4>

## Target architecture

- Lincei/T3Code owns projects, agent sessions, chat, terminals, diffs, models, and provider integration.
- M4 owns clinical dataset access and computation.
- Vitrine owns studies, research cards, artifacts, decisions, human review, provenance, and export.
- Lincei starts one Vitrine server per project and opens that project's Vitrine UI in the embedded T3Code browser preview.
- Lincei must not retain a second native implementation of Vitrine's card/study/review domain.

Do not merge or cherry-pick the full upstream T3Code tag. Port only the browser/preview infrastructure needed by this task.

## Safety and branch setup

1. Inspect both repositories and their instructions before editing.

2. In Lincei, create an isolated worktree and branch from current `main`, for example:

   ```text
   codex/vitrine-browser-pivot
   ```

3. Do not modify, delete, stage, or commit the user-owned untracked `PRs.md`.

4. The existing `codex/card-handles-review-flow` worktree is obsolete for this direction. Do not merge it and do not destroy it. Leave it available as a historical/reference branch.

5. The Vitrine repository currently has existing user changes. At the start of this task, its observed state included:

   - `main` ahead of `origin/main`
   - modified `README.md`
   - modified `src/vitrine/client.py`
   - modified `src/vitrine/server.py`
   - modified `tests/test_api.py`
   - modified `tests/test_server.py`
   - untracked `ARCHITECTURE.md`
   - untracked `UX.md`
   - untracked `VISION.md`

   Treat all of those as user-owned. Preserve them and work around/with them. Never reset, overwrite, or discard them. Before changing Vitrine, re-check its actual current status and create a transparent safety snapshot or isolated worktree if needed.

6. Do not push, merge into `main`, delete branches/worktrees, or rewrite shared history. Deliver reviewable branches for owner approval.

## Part A: remove the native Lincei card system

Remove the Lincei-native research-card system semantically, not by blindly reverting interleaved commits.

Find and remove all code whose purpose is to implement Lincei-owned research cards, study records, card review, or card-specific presentation. This includes, where present:

- Research-card contracts and schemas.
- Research-card orchestration commands and domain events.
- Card projections, reactors, snapshot queries, and persistence services.
- Card-specific SQLite tables and migrations.
- Study-record services that only exist to support native Lincei cards/artifacts.
- Research-card drawers, panels, menus, mentions, and expansion state.
- Card handles/slugs and `@card` prompt expansion.
- `lincei card show`, `lincei card review`, and related CLI behavior.
- Agent instructions that tell agents to create Lincei-native cards.
- Card review actions and card-specific demo seeding.
- Decision-card UI that duplicates Vitrine's `show(..., wait=True)`, `confirm()`, or `ask()`.
- Tests and fixtures that only verify the removed subsystem.

Preserve:

- Projects, threads, and normal provider sessions.
- Dataset selection/readiness and M4 integration.
- MIMIC-IV demo data and non-card demo behavior.
- Generic artifact/file handling still used outside the removed card domain.
- Clinical skills and instructions that remain useful after rewriting them to use Vitrine.
- Lincei branding, paths, release behavior, and public APIs unrelated to cards.

Vitrine studies must remain inside Vitrine. Do not reproduce the Vitrine study hierarchy in the Lincei sidebar.

Because Lincei has not had a public release, prefer a clean product model over maintaining an unused public card API. Still protect developer databases:

- Inspect the migration framework before removing card migrations.
- If removing an already-numbered migration would break migration ordering or existing development databases, replace it with the smallest safe no-op/cleanup migration rather than corrupting the chain.
- Add coverage for both a fresh database and upgrade from a database containing the previous card schema.
- Do not delete user research data from disk without an explicit migration strategy and owner approval.

## Part B: port the upstream embedded browser

Port the browser/preview subsystem from upstream T3Code tag `v0.0.29-nightly.20260722.877`.

Use upstream structure and behavior wherever possible so later T3Code ports remain straightforward. Do not invent a separate iframe-only browser.

Required behavior:

- Desktop-only embedded browser/preview surface.
- Browser panel integrated with the existing right-panel/diff/plan layout.
- URL navigation, back, forward, refresh, and loading/error state.
- Localhost server discovery.
- Open-in-system-browser action.
- Open terminal loopback links in preview where upstream supports it.
- Per-thread browser presentation state and reconnect recovery.
- A project script or equivalent mechanism supporting `previewUrl` and `autoOpenPreview`.
- Resizable panel with persisted width if this remains compatible with Lincei's layout.
- Secure desktop IPC and webview registration following upstream's implementation.
- Web builds must still compile and provide a reasonable external-browser fallback when the embedded desktop surface is unavailable.

Prefer a structurally faithful port of upstream contracts, server manager, port scanner, desktop IPC, preview state store, panel components, and tests. Adapt only:

- Lincei branding and public terminology.
- Existing Lincei route/layout differences.
- Lincei runtime paths and desktop identity.
- Features removed with the native card system.

Do not import:

- Expo/mobile.
- T3 Connect relay.
- Clerk/cloud authentication.
- T3 branding or assets.
- T3 release/marketing infrastructure.
- Unrelated provider or mobile architecture.

Follow Electron security guidance:

- No Node integration for previewed content.
- Keep context isolation and renderer sandboxing.
- Validate IPC senders and webview ownership.
- Deny unexpected popups/window creation.
- Do not disable `webSecurity`.
- Restrict the dedicated Vitrine launch path to the expected loopback URL.
- Do not expose raw Electron IPC to Vitrine.
- Prefer upstream's tested security boundary rather than creating a new preload bridge.

## Part C: manage Vitrine per project

Add a small Lincei runtime service responsible for Vitrine lifecycle and discovery.

Required semantics:

1. One Vitrine server per Lincei project, not per thread.

2. Start it with the project root as cwd and explicitly set:

   ```text
   VITRINE_DATA_DIR=<project-root>/.vitrine
   ```

3. Start without opening the system browser.

4. Starting must be idempotent:

   - Reuse an existing healthy Vitrine server for the same project.
   - Never attach to another project's Vitrine process merely because a port matches.
   - Never kill an unknown process occupying a port.
   - Recover from stale PID/status data.
   - Handle multiple projects concurrently.

5. Discover the actual browser URL after startup rather than assuming port 7741.

6. Expose clear states to the web UI:

   - unavailable
   - starting
   - ready
   - failed
   - stopped

7. Surface actionable errors when:

   - the Vitrine executable/module is unavailable;
   - startup times out;
   - the process exits;
   - the status payload is invalid;
   - the browser URL is not loopback;
   - the Vitrine version is incompatible.

8. Add a project-level "Research" or "Vitrine" action that:

   - starts or discovers the project Vitrine;
   - opens its URL in the embedded preview;
   - reopens the same project URL after Lincei reconnect/restart;
   - does not create a second Vitrine server for another thread in the same project.

9. Do not silently download/install Python packages at runtime.

10. Inspect the existing M4/Python distribution before choosing how to launch Vitrine:

    - Prefer an already-managed Python/runtime environment if Lincei has one suitable for Vitrine.
    - Otherwise, for this first version, detect a configured `vitrine` executable and show an actionable installation/readiness error.
    - Keep the launcher behind a small interface so a pinned bundled Vitrine can be introduced later without rewriting the UI.

11. Use argument arrays/process APIs. Do not construct shell command strings from project paths.

12. Decide and document whether Vitrine persists after Lincei closes. Prefer Vitrine's existing persistent server model unless it causes unsafe orphan management. Explicit stop/restart controls should only affect the Vitrine process identified for that project.

## Part D: minimal Vitrine changes

Keep modifications to `/Users/hannesill/Developer/vitrine` minimal and backward compatible.

Add only the machine-readable lifecycle surface Lincei needs.

Required additions:

1. Add JSON output to the smallest useful CLI commands, preferably:

   - `vitrine start --no-open --json`
   - `vitrine status --json`
   - `vitrine stop --json`
   - optionally `vitrine restart --no-open --json` if it removes duplicated Lincei logic

2. Human-readable output without `--json` must remain unchanged.

3. JSON must be emitted as one stable object on stdout. Human diagnostics should not corrupt stdout in JSON mode.

4. Include at least:

   ```json
   {
     "status": "running",
     "url": "http://vitrine.localhost:7741",
     "api_url": "http://127.0.0.1:7741",
     "pid": 1234,
     "port": 7741,
     "session_id": "...",
     "data_dir": "/project/.vitrine",
     "version": "0.1.0"
   }
   ```

5. Define stable exit codes for ready/already-running, unavailable/start failure, and stopped/not-running states.

6. Preserve the existing `VITRINE_DATA_DIR` resolution and PID-file format unless a change is strictly necessary.

7. Add WebSocket Origin validation. Accept the exact Vitrine page origins needed for:

   - `vitrine.localhost`
   - `127.0.0.1`
   - the actual bound Vitrine port
   - the Electron embedded browser when its Origin is equivalent to the served Vitrine page

   Reject unrelated external origins before accepting the WebSocket.

8. Keep the server bound to loopback by default.

9. Do not redesign Vitrine's card UI, study model, artifact format, persistence, or Python API.

10. Add focused Vitrine tests for JSON mode, existing human CLI output, per-project data directories, stale server state, and WebSocket Origin validation.

## Part E: agent workflow

Rewrite Lincei's bundled clinical skills/instructions so agents use Vitrine directly.

The intended interface is:

```python
from vitrine import show, confirm, ask

show(result, title="Cohort after exclusions", study="sepsis")
approved = confirm("Use this cohort?", study="sepsis")
choice = ask("Which severity score?", ["SOFA", "APACHE III", "Both"], study="sepsis")
```

Requirements:

- Agents should use Vitrine for meaningful intermediate results, visualizations, decisions, and review.
- M4 outputs should flow naturally into `vitrine.show(...)`.
- Blocking Vitrine review must return its response to the calling agent process.
- Do not parse Vitrine's rendered HTML to recover research state; use its Python/CLI/API interfaces.
- Remove instructions referring to native Lincei research cards.
- Keep prompts concise and avoid forcing a card for trivial terminal output.

## Tests and acceptance scenarios

Add regression coverage before or alongside implementation.

Lincei must cover:

- Vitrine executable unavailable.
- Start success and machine-readable status parsing.
- Existing healthy project server reuse.
- Stale PID/status recovery.
- Startup timeout and early exit.
- Two projects using separate `.vitrine` directories and servers.
- Multiple threads in one project reuse one server.
- Reject non-loopback/malformed preview URLs.
- Lincei reconnect/restart restores the project Vitrine URL.
- Embedded browser opens the correct Vitrine page.
- Web/non-desktop build remains functional.
- No remaining native card feature is reachable through UI, RPC, or CLI.
- Fresh and previous-development-schema database startup.

Vitrine must cover:

- `start/status/stop --json`.
- Human output remains backward compatible.
- JSON stdout is not mixed with Rich/log output.
- Per-project `VITRINE_DATA_DIR`.
- Existing server reuse.
- Stale PID cleanup.
- WebSocket same-origin acceptance and foreign-origin rejection.
- Existing Python API and full Vitrine test suite remain green.

Manual acceptance flow:

1. Open two Lincei projects.
2. Open Research in each.
3. Confirm each embeds its own Vitrine and `.vitrine` store.
4. Start an agent in project A.
5. Have it run an M4-backed analysis and call `vitrine.show`.
6. Verify the result appears live in the embedded Vitrine.
7. Have it call `confirm()` or `show(..., wait=True)`.
8. Respond in Vitrine and verify the agent resumes with the correct response.
9. Restart Lincei.
10. Verify both projects reconnect to their existing Vitrine servers and studies.
11. Verify normal chat, terminal, diff, and dataset flows remain intact.

## Required verification

In Lincei, run:

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Never run `bun test`.

Also run the relevant browser/desktop tests and a production desktop/web build.

In Vitrine, run:

```sh
uv run ruff check .
uv run pytest
```

Run any additional packaging/build verification required by either repository.

## Definition of done

The task is complete only when:

- Native Lincei research cards and their duplicate persistence/UI/API are removed.
- Vitrine is the sole research-card/study/review surface.
- Current upstream T3Code browser preview is ported in an upstream-compatible form.
- One project-scoped Vitrine server is reliably managed and embedded.
- Agents can send M4/Python results to Vitrine and block for human decisions.
- Vitrine changes are minimal, tested, and backward compatible.
- Existing user changes in both repositories are preserved.
- All required checks pass.
- The branches/worktrees are clean except for explicitly documented user-owned files.
- No merge to `main` or push has occurred.
- The final report includes:
  - commits created;
  - native card files/features removed;
  - upstream browser files/behavior ported;
  - Lincei files added/changed;
  - Vitrine files changed and why each was necessary;
  - persistence/migration decision;
  - process lifecycle and security model;
  - tests and commands run;
  - remaining risks or owner decisions;
  - exact review/merge instructions.
