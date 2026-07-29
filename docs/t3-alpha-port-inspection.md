# T3 Code → Lincei alpha inspection report

> Qualification skeleton. Replace every `PENDING-*` marker and every pending result before
> requesting approval. Do not merge this branch into `main`.

## Boundary and branch

- Integration branch: `codex/t3-alpha-port`
- Base branch: `main` at `145c557a33fc316f15d2611c50ab93da86a5506f`
- Audited upstream cutoff: `887dd6e455bb969c1a0c9659a6bdf2baceac030d`
  (`#4705`)
- Upstream delta when implementation began: `0` commits; local `t3code/main` matched the
  cutoff.
- Live upstream recheck on 2026-07-29:
  `8650f05f95ac9f19254de679fdf4b380c37d7b94` is `11` commits ahead and `0` behind the
  cutoff. Those commits remain unreviewed and outside this pinned alpha.
- Audited integration history through:
  `a6361ecbac41482cec2fe2cb8db48778e28558e8`.
- Integration state: `PENDING-FINAL-INTEGRATION-SHA`
- Main modification/merge status: `PENDING-FINAL-VERIFY-NO-MAIN-MUTATION`

## Commit order

The current integration history is linear in these exact blocks:

1. Integration policy:
   `4c7aaadacebd504813c03a711d58f9a739240c94`.
2. Runtime, transport, and Codex provider work: 10 commits from
   `485873875296b7bebf9f1d52002be54dc5d3eb4d` through
   `a5a87605e37ced7497288bbbb6b1589716e2f4aa`.
3. Desktop, terminal, SSH, and executable safety: 12 commits from
   `156c5d53ad6750dbd8c70d9c8aa5a0db316b6061` through
   `789bf0944ac104e0a2c911212469f0dadc2fe19c`.
4. Claude provider work: 6 commits from
   `83763fe8755008d5f43b4c31ff09a2ab828edd44` through
   `6b1d0d7ad174f1f7b1d0992a109dab1038acdbac`.
5. Authenticated networking, Git, security, and their integration seam: 14 commits from
   `693fddb7220b85a89521f389c984f6f15ed354fb` through
   `9d6d4e686c0182bf4bdc9f68f496ed8cb9899b0c`.
6. OpenCode provider work: 6 commits from
   `1d7244d3d5839c86504e645f79620fc642f2aab0` through
   `a8d246150c4cc99d09e8397902d4084781a000c2`.
7. Initial ledger:
   `174045db6b8408587af603895be44bd8e8fe3da7`.
8. Sidebar lifecycle prerequisites and migrations: 6 commits from
   `8c946f9129ade8727beb8f731ecc5c0aef9b5858` through
   `3200ff550cd936937d0613944a817f77bb969787`.
9. Core independent-review corrections:
   `bd9d3d2a97ec1f3d9339904bff9a6f7448598d98`,
   `edcab93417617235b1014d5792d1775301c7477e`, and
   `a6361ecbac41482cec2fe2cb8db48778e28558e8`.
10. Sidebar v2 UI: `PENDING-SIDEBAR-UI-COMMITS`.
11. Cosmetic/chat refresh: `PENDING-COSMETIC-COMMITS`.
12. Final ledger and qualification evidence: `PENDING-FINAL-DOCS-COMMITS`.

Through `a6361ecbac41482cec2fe2cb8db48778e28558e8`, the branch contains 59 commits,
zero merge commits, imperative atomic subjects, upstream SHA/PR references with rationale
and adaptations, and no AI attribution. Recheck all four claims after the remaining
commits land: `PENDING-FINAL-HISTORY-METADATA-VERIFY`.

## Upstream ledger

- Ledger: [`docs/t3-alpha-port-ledger.md`](./t3-alpha-port-ledger.md)
- Reviewed SHA count: `81`
- Status counts:
  - `ported`: `68`
  - `equivalent`: `6`
  - `deferred`: `1`
  - `not applicable`: `6`
- Pending local-evidence markers: Sidebar UI and cosmetic cohort SHAs must replace all
  remaining `PENDING-*` ledger markers before approval.

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

- Effect WebSocket compression is adapted through Bun `patchedDependencies` for the pinned
  Effect 4 beta rather than a package-manager or Effect migration. A reused worktree must
  run `bun install --frozen-lockfile` before qualification so
  `patches/@effect__platform-bun@4.0.0-beta.73.patch` and
  `patches/@effect__platform-node@4.0.0-beta.73.patch` are materialized in
  `node_modules`.
- Migrations `034`, `035`, and `036` follow Lincei migration `033`. Settled, snoozed, and
  archived data remain separate.
- Migration `036` was introduced in `7745ee958`, then amended in `7e96e7543` and
  `3200ff550` before integration without changing its migration number. No released build
  used an intermediate form. Any qualification database opened at an intermediate cohort
  tip must be recreated because its migration table may already record `036`; a database
  upgrading directly from released migration `033` receives the final migrations normally.
- The upstream Sidebar v2 opt-in is inverted into an alpha-default target with a persisted
  explicit Sidebar v1 rollback setting. Server persistence is integrated; final UI
  selection remains `PENDING-SIDEBAR-UI-DEFAULT-VERIFY`.
- Merged or closed pull requests settle immediately. The superseded one-hour warm guard is
  intentionally omitted.
- Mobile, Connect, Clerk, relay, cloud, and wholesale pnpm/Vite+/Effect portions of mixed
  upstream commits are omitted. Final UI/cosmetic exclusion review remains
  `PENDING-UI-COSMETIC-BOUNDARY-VERIFY`.
- Upstream is now 11 commits beyond the cutoff. The alpha target remains the owner-pinned
  cutoff rather than silently expanding during qualification.

## Independent review

| Cohort                               | Correctness                 | Migration/data              | Security                    | Lincei regression           | Findings fixed                                                                                                                     |
| ------------------------------------ | --------------------------- | --------------------------- | --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/transport/providers/platform | covered by cohort approval  | covered by cohort approval  | covered by cohort approval  | covered by cohort approval  | `bd9d3d2a9` saved-environment mock; `edcab9341` Git refresh mocks; `a6361ecba` provider-confirmed request resolution               |
| Sidebar server lifecycle             | covered by cohort approvals | covered by cohort approvals | covered by cohort approvals | covered by cohort approvals | `7745ee958` durable/capability hardening; `7e96e7543` replay, timestamps, and RPC hardening; `3200ff550` purged-projection cleanup |
| Sidebar v2 UI                        | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                                                                                                                          |
| Cosmetic/chat refresh                | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                                                                                                                          |
| Final integrated branch              | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                   | `PENDING`                                                                                                                          |

The runtime row records one independent approval at `a6361ecb`. The Sidebar server row
records exactly two independent approvals covering the cohort; it does not imply two
separate reviewers for every table column.

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

- Independent core review approved
  `a6361ecbac41482cec2fe2cb8db48778e28558e8`.
- Core `bun run test`: 13/13 tasks; server 148 passed/2 skipped files and 1,281
  passed/6 skipped tests; total 2m16.858s.
- Core static verification: `bun run fmt:check` passed; `bun lint` completed with 0 errors
  and 9 pre-existing warnings; `bun typecheck` passed 13/13 tasks.
- Core focused verification: web 125/125; server transport 209 passed/1 skipped; exact
  provider-approval regressions 2/2 in 464ms; orchestration integration 11 passed/1
  skipped.
- Sidebar lifecycle/migrations: 146 focused tests passed and two independent reviews
  approved the final cohort.
- Sidebar v2 UI/browser behavior: `PENDING`
- Cosmetic/chat behavior: `PENDING`

## Unresolved risks

- Snapshot handoff, event buffering, and compression have deterministic regressions but no
  long-duration reconnect soak under sustained production-scale streams.
- Real Codex, Claude, and OpenCode resume/capability behavior still requires packaged
  provider smoke testing.
- AppImage cleanup, Windows direct executable spawning, real remote fnm activation, SSH
  bearer-401 recovery, and updater relaunch require platform-specific manual acceptance.
- Migrations `034`–`036` have replay, idempotency, and purge coverage but no
  production-scale crash-injection qualification. Intermediate qualification databases
  must be recreated as described above.
- Mixed-version lifecycle capability negotiation has deterministic tests but still
  requires a real legacy remote.
- Sidebar and glass behavior still needs visual browser and packaged Electron acceptance
  across light/dark modes, opacity 40/80/100, forced colors, and no-backdrop-filter
  fallbacks.
- Upstream has 11 unreviewed post-cutoff commits. They are intentionally excluded from this
  alpha and may contain relevant follow-up fixes.
- Branch-drift/PR-fetching hardening from `2d31cb022...` remains explicitly deferred.

## Manual acceptance

Before acceptance:

- Run `bun install --frozen-lockfile` in the final integration worktree so the pinned Effect
  compression patches are applied.
- Use a fresh qualification profile/database if any intermediate Sidebar lifecycle commit
  was previously launched against the profile.

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
