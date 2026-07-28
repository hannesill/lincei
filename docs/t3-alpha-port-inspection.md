# T3 Code → Lincei alpha inspection report

> Qualification skeleton. Replace every `PENDING-*` marker and every pending result before
> requesting approval. Do not merge this branch into `main`.

## Boundary and branch

- Integration branch: `codex/t3-alpha-port`
- Base branch: `main` at `PENDING-MAIN-BASE`
- Audited upstream cutoff: `887dd6e455bb969c1a0c9659a6bdf2baceac030d`
  (`#4705`)
- Upstream delta at audit: `0` commits; local `t3code/main` matched the cutoff.
- Integration state: `PENDING-FINAL-INTEGRATION-SHA`
- Main modification/merge status: `PENDING-FINAL-VERIFY-NO-MAIN-MUTATION`

## Commit order

Record the final linear, no-merge order after all independently reviewed cohorts are
rebased and fast-forwarded:

1. Integration policy and audit boundary: `PENDING-POLICY-COMMITS`
2. Runtime and transport: `PENDING-RUNTIME-COMMITS`
3. Desktop, terminal, SSH, and executable safety: `PENDING-PLATFORM-COMMITS`
4. Providers: `PENDING-PROVIDER-COMMITS`
5. Authenticated networking, Git, and security: `PENDING-SECURITY-COMMITS`
6. Sidebar lifecycle prerequisites/migrations: `PENDING-SIDEBAR-SERVER-COMMITS`
7. Sidebar v2 session UI: `PENDING-SIDEBAR-UI-COMMITS`
8. Cosmetic/chat refresh: `PENDING-COSMETIC-COMMITS`
9. Ledger and qualification evidence: `PENDING-DOCS-COMMITS`

Confirm:

- `PENDING-NO-MERGE-COMMITS`
- `PENDING-ATOMIC-IMPERATIVE-COMMIT-METADATA`
- `PENDING-NO-AI-ATTRIBUTION`

## Upstream ledger

- Ledger: [`docs/t3-alpha-port-ledger.md`](./t3-alpha-port-ledger.md)
- Reviewed SHA count: `81`
- Status counts:
  - `ported`: `68`
  - `equivalent`: `6`
  - `deferred`: `1`
  - `not applicable`: `6`
- Pending local-evidence markers: Sidebar server/UI and cosmetic cohort SHAs must replace
  all `PENDING-*` ledger markers before approval.

## Preserved scope

- Lincei product branding and session terminology.
- Vitrine/Research behavior and routes.
- M4, skills, workflows, model/reasoning selection, and custom instructions.
- Authenticated local/remote networking and saved environments.
- Desktop release/update behavior, terminal, SSH, and supported remote runtimes.
- Existing Bun/Turbo/Effect toolchain, settings, and route contracts.
- Distinct archived, settled, and snoozed semantics.
- Persisted Sidebar v1 rollback during alpha qualification; Sidebar v2 default.

## Excluded scope

- Mobile applications.
- T3 Connect, Clerk, relay, DPoP, hosted preview, and cloud infrastructure.
- `.repos` reference trees.
- Literal upstream product branding in runtime/UI output.
- Wholesale pnpm, Vite+, or Effect migration.
- Deferred branch-drift/PR-fetching overhaul from upstream `2d31cb022...` (`#2284`).

## Deliberate deviations

Fill after cohort integration:

- Effect WebSocket compression is adapted through Bun patched dependencies:
  `PENDING-VERIFY`.
- Sidebar migrations start after Lincei migration `033` and preserve archive data:
  `PENDING-VERIFY`.
- Sidebar v2 rollout is inverted to alpha-default with persisted v1 rollback:
  `PENDING-VERIFY`.
- Merged/closed PRs settle immediately; the superseded one-hour warm guard is omitted:
  `PENDING-VERIFY`.
- Mobile/Connect/cloud portions of mixed upstream commits are omitted:
  `PENDING-VERIFY`.
- Additional deviations: `PENDING-NONE-OR-LIST`.

## Independent review

| Cohort                               | Correctness | Migration/data | Security  | Lincei regression | Findings fixed |
| ------------------------------------ | ----------- | -------------- | --------- | ----------------- | -------------- |
| Runtime/transport/providers/platform | `PENDING`   | `PENDING`      | `PENDING` | `PENDING`         | `PENDING`      |
| Sidebar server lifecycle             | `PENDING`   | `PENDING`      | `PENDING` | `PENDING`         | `PENDING`      |
| Sidebar v2 UI                        | `PENDING`   | `PENDING`      | `PENDING` | `PENDING`         | `PENDING`      |
| Cosmetic/chat refresh                | `PENDING`   | `PENDING`      | `PENDING` | `PENDING`         | `PENDING`      |
| Final integrated branch              | `PENDING`   | `PENDING`      | `PENDING` | `PENDING`         | `PENDING`      |

## Test evidence

Do not mark the alpha ready until every exact final command passes on
`codex/t3-alpha-port`.

| Command                               | Result  | Evidence  |
| ------------------------------------- | ------- | --------- |
| `bun fmt`                             | pending | `PENDING` |
| `bun lint`                            | pending | `PENDING` |
| `bun typecheck`                       | pending | `PENDING` |
| `bun run test`                        | pending | `PENDING` |
| `bun run --cwd apps/web test:browser` | pending | `PENDING` |
| `bun run build:desktop`               | pending | `PENDING` |
| `bun run test:desktop-smoke`          | pending | `PENDING` |

Focused cohort evidence:

- Runtime/transport/providers: `PENDING`
- Desktop/terminal/SSH/security: `PENDING`
- Sidebar lifecycle/migrations: `PENDING`
- Sidebar v2 UI/browser behavior: `PENDING`
- Cosmetic/chat behavior: `PENDING`

## Unresolved risks

- `PENDING-RUNTIME-RECONNECT-SNAPSHOT-SOAK`
- `PENDING-REAL-PROVIDER-RESUME-AND-CAPABILITY-SMOKE`
- `PENDING-APPIMAGE-WINDOWS-FNM-SSH-UPDATER-SMOKE`
- `PENDING-MIGRATION-REPLAY-SCALE-AND-CRASH-SAFETY`
- `PENDING-MIXED-VERSION-CAPABILITY-NEGOTIATION`
- `PENDING-VISUAL-BROWSER-COVERAGE`
- `PENDING-OTHER-OR-NONE`

## Manual acceptance

Perform against a packaged or release-equivalent desktop build:

1. Verify Sidebar v2 is the alpha default; enable Sidebar v1 rollback, restart, and verify
   the choice persists without changing session data.
2. Create active, settled, snoozed, and archived sessions. Confirm each partitions
   independently and settle/snooze never triggers archive/delete/provider-stop/terminal/
   worktree/route cleanup.
3. Verify snooze countdown and wake behavior, raised-hand pending input/approval behavior,
   deep links to parked sessions, and immediate settlement after merged/closed PR state.
4. Use grouped project/session creation. Verify a new session does not inherit the viewed
   checkout/branch but preserves intended project, model, reasoning, workflow, skills, and
   M4 settings.
5. Toggle Sidebar v1/v2 and Appearance values in light/dark modes. Inspect composer,
   dialogs, command/model pickers, tooltips, toasts, question contrast, hover/focus, and
   glass fallbacks.
6. Exercise Vitrine/Research routes and milestone/card actions; verify no route, settings,
   or research behavior regressed.
7. Connect a legacy/mixed-version remote. Verify settle/snooze controls are hidden or
   disabled according to that environment's negotiated capabilities.
8. Resume Codex, Claude, and OpenCode sessions; exercise an active-turn steer and an inline
   repository file link.
9. Exercise local terminal, SSH terminal, remote Node/fnm bootstrap, authenticated SSH 401
   recovery, updater relaunch, and packaged desktop startup without crash dialogs.
10. Inspect runtime/UI output for Lincei branding and confirm excluded Connect/Clerk/relay/
    cloud/mobile surfaces are absent.

## Approval gate

- Final integration SHA: `PENDING`
- Owner inspection: `PENDING`
- Approved for merge into `main`: `NO — explicit owner approval required`
