# T3 Code → Lincei alpha inspection report

> Qualification report prepared for the final command run. Do not merge this branch into
> `main` without explicit owner approval.

## Boundary and branch

- Integration branch: `codex/t3-alpha-port`
- Base branch: `main` at `145c557a33fc316f15d2611c50ab93da86a5506f`
- Audited upstream cutoff: `887dd6e455bb969c1a0c9659a6bdf2baceac030d`
  (`#4705`)
- Upstream delta when implementation began: `0` commits; local `t3code/main` matched the
  cutoff.
- Live upstream recheck on 2026-07-29:
  `694f8d1c6eaaabafbf5c2861ae524174919ef625` is `14` commits ahead and `0` behind the
  cutoff. Those commits remain unreviewed and outside this pinned alpha.
- Audited and qualified product history through:
  `94ef0d9705eccdcb187637b81c8a749aad48ea1b`.
- Report skeleton commit:
  `3dbd7ad69c5b5cc70fd9bf21dfd07e5cda2b1745`.
- Final post-documentation state: recorded in the approval gate after the final docs commit.
- Main modification/merge status: `main` remains at
  `145c557a33fc316f15d2611c50ab93da86a5506f`; no integration commit or merge was applied.
  The pre-existing user-owned `TODO.md` modification remains untouched.

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
10. Remote-only default-ref correction:
    `4c9ab511f55583c1435d635b005f9de996b8a38b`.
11. Sidebar v2 UI: 17 commits from
    `d8ab6cd2169b27e1db31acfc069c4fe774a2fcae` through
    `d62d4ea02e92a5891350233bebfe357f35126133`.
12. Shell snapshot handoff correction:
    `6c84c96a97575d2c42c20b2be406823aa1a88b98`.
13. Cosmetic/chat refresh: 9 commits from
    `f5b4db5c02f2e04515db4dae10952f11fb08ba19` through
    `24384623c29da9af2eb54f9bdb10ae779fd251fc`.
14. Saved-environment persistence correction:
    `5c0f6efc6a62b2bb40b6128d99848c7c3577ddd6`.
15. Skills settings browser qualification:
    `4ed17a7f5fc88f1753c29c9f5b0e65a262ec1a75`.
16. Audited report skeleton:
    `3dbd7ad69c5b5cc70fd9bf21dfd07e5cda2b1745`.
17. Turn-start failure ownership correction:
    `f50ebc804bd61e6d7ae2d4c2a6c5f5273e43820c`.
18. Browser qualification corrections:
    `56b700bf49be1522007736cc9198da8b633c43e5` and
    `94ef0d9705eccdcb187637b81c8a749aad48ea1b`.
19. Final ledger and qualification evidence: the documentation commit produced after the
    final command run.

Through `94ef0d9705eccdcb187637b81c8a749aad48ea1b`, the branch contains 93 commits,
zero merge commits, imperative atomic subjects, port commits with upstream SHA/PR references,
rationale and adaptations, explicit `Upstream: none` labels for Lincei-only qualification
corrections, and no AI attribution. The post-documentation commit count is recorded in the
approval gate after the final docs commit.

## Upstream ledger

- Ledger: [`docs/t3-alpha-port-ledger.md`](./t3-alpha-port-ledger.md)
- Reviewed SHA count: `84`
- Status counts:
  - `ported`: `71`
  - `equivalent`: `6`
  - `deferred`: `1`
- `not applicable`: `6`
- Local evidence: every `ported` row has exact evidence resolving to an ancestor of
  `94ef0d9705eccdcb187637b81c8a749aad48ea1b`; no ledger evidence placeholder remains.

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
  explicit Sidebar v1 rollback setting. `25c09a884`, `0ae9678b9`, and `87acab830`
  verify the v2 default, persisted v1 selection, hydration gate, and qualification path.
- Merged or closed pull requests settle immediately. The superseded one-hour warm guard is
  intentionally omitted.
- Saved-environment metadata and credentials are serialized through one renderer FIFO and
  one desktop semaphore. Removal persists metadata before deleting credentials and restores
  the record on either failure; this preserves authenticated networking without importing
  upstream Connect ownership.
- A delayed provider start failure is recorded but may clear pending-turn/runtime ownership
  only when its durable message identity still owns that start.
- The cosmetic port uses Lincei semantic tokens and one bounded Appearance opacity setting.
  It selectively adapts the relevant portions of the upstream 33-fix change without
  importing its global cool-neutral palette or unrelated layout, mobile, Connect, or cloud
  changes.
- Mobile, Connect, Clerk, relay, cloud, and wholesale pnpm/Vite+/Effect portions of mixed
  upstream commits are omitted. Independent cosmetic and Lincei-regression review confirmed
  that the final diff stays inside this boundary.
- Upstream is now 14 commits beyond the cutoff. The alpha target remains the owner-pinned
  cutoff rather than silently expanding during qualification.

## Independent review

| Cohort                               | Correctness                 | Migration/data              | Security                    | Lincei regression           | Findings fixed                                                                                                                                                                                  |
| ------------------------------------ | --------------------------- | --------------------------- | --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/transport/providers/platform | covered by cohort approval  | covered by cohort approval  | covered by cohort approval  | covered by cohort approval  | `bd9d3d2a9` saved-environment mock; `edcab9341` Git refresh mocks; `a6361ecba` provider-confirmed request resolution                                                                            |
| Sidebar server lifecycle             | covered by cohort approvals | covered by cohort approvals | covered by cohort approvals | covered by cohort approvals | `7745ee958` durable/capability hardening; `7e96e7543` replay, timestamps, and RPC hardening; `3200ff550` purged-projection cleanup                                                              |
| Sidebar v2 UI                        | independently approved      | independently approved      | independently approved      | independently approved      | Route-safe project deletion, bounded transition observers, repository-default drafts, action/navigation separation, rollout hydration, worktree-base readiness, and routed wake acknowledgement |
| Cosmetic/chat refresh                | independently approved      | independently approved      | independently approved      | independently approved      | Exact 9-commit integrated range approved; tree-equivalent to the pre-rebase review; 29 cutoff SHAs; no prohibited scope or direct `SidebarV2` edits                                             |
| Final integrated branch              | independently approved      | independently approved      | independently approved      | independently approved      | Shell cursor fencing; saved-environment FIFO/semaphore and failure restoration; schema-complete Skills fixture; durable turn-start failure ownership                                            |
| Browser qualification corrections    | independently approved      | independently approved      | independently approved      | independently approved      | Semantically stable Sidebar visible-session registration and canonical Lincei catalog expectations                                                                                              |

The runtime row records one independent approval at `a6361ecb`. The Sidebar server row
records exactly two independent approvals covering the cohort; it does not imply two
separate reviewers for every table column.

The final core review blocked the first shell correction until raw events were cursor-fenced
before effectful projection and its ordering seam was strengthened. The amended correction
was independently approved and integrated as `6c84c96a9`.

The cosmetic reviewer approved the exact integrated range
`6c84c96a97575d2c42c20b2be406823aa1a88b98..24384623c29da9af2eb54f9bdb10ae779fd251fc`.
Its 9 linear commits are tree-equivalent to the approved pre-rebase cohort and cover 29
cutoff SHAs. The review found no prohibited scope and no direct `SidebarV2` edits. Findings
fixed before integration included tooltip pointer targeting, settings-write serialization,
real command-list viewport sizing, provider identity validation, forced-colors visibility,
settings scroll clearance, M4 disclosure geometry, and picker/sidebar contrast.

Final correctness/security review blocked saved-environment persistence and provider-start
ownership races until `5c0f6efc6` and `f50ebc804` closed them. The exact
`f50ebc804bd61e6d7ae2d4c2a6c5f5273e43820c` commit was approved against parent
`3dbd7ad69c5b5cc70fd9bf21dfd07e5cda2b1745`; its range-diff was identical to the reviewed
correction, the parent delta did not overlap the reactor seam, the tree was clean, and commit
metadata was compliant. The saved-environment FIFO/semaphore and shell handoff were clean;
bounded SSH stdout redaction remained non-blocking.

Final migration/Lincei regression review approved migrations `034`–`036` as ordered and
guarded; migration `036` rebuilds only derived rows. Archived, settled, and snoozed state
remain distinct. Sidebar v2 becomes the default after settings hydration while the persisted
v1 rollback remains authoritative. Research/Vitrine, M4, skills/workflows, routes,
authenticated networking, and release behavior are preserved. The remaining platform and
scale risks are manual-acceptance items below, not untracked code-review findings.

Final browser qualification exposed a real React update loop in
`SidebarV2ProjectGroup`: referentially new but semantically unchanged visible-session arrays
repeatedly updated parent registration state. The source correction range
`f50ebc804bd61e6d7ae2d4c2a6c5f5273e43820c..ac9c379ae01d03e7339dc9bd6ddce2f453abe165`
was independently approved, then integrated linearly as
`56b700bf49be1522007736cc9198da8b633c43e5` and
`94ef0d9705eccdcb187637b81c8a749aad48ea1b`. Review covered project add/remove/reorder,
remount registration, the sole production callback, stale-registration paths, metadata,
scope, and the clean tree. The formerly hanging case passed 1/1, five neighboring cases
passed 5/5, `ChatView` passed 89/89, the shared catalog passed 9/9, and the full browser
suite passed 180/180.

## Test evidence

Every exact final command passed on `codex/t3-alpha-port` at qualified product SHA
`94ef0d9705eccdcb187637b81c8a749aad48ea1b`.

| Command                               | Final result and evidence                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun fmt`                             | PASS — 1,252 files processed in 538ms                                                               |
| `bun lint`                            | PASS — 0 errors and 8 existing warnings in 763ms                                                    |
| `bun typecheck`                       | PASS — 13/13 tasks, 0 cached, in 11.691s                                                            |
| `bun run test`                        | PASS — 13/13 tasks in 2m23.549s; server 148 passed/2 skipped files and 1,286 passed/6 skipped tests |
| `bun run --cwd apps/web test:browser` | PASS — 14/14 files and 180/180 tests in 47.19s                                                      |
| `bun run build:desktop`               | PASS — 3/3 tasks, 2 cached, in 1.1s; desktop and bundled web/CLI artifacts built                    |
| `bun run test:desktop-smoke`          | PASS — 4/4 tasks, 3 cached, in 506ms; packaged Electron smoke reported `Desktop smoke test passed.` |

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
- Sidebar v2 UI/browser behavior: independent review approved the final
  `d62d4ea02` tree. The main qualification pass covered 188 focused unit tests and four
  exact browser cases; the routed-wake correction separately passed 22 lifecycle-logic and
  31 UI-state tests. Web typecheck and formatting passed; lint completed with 0 errors and
  9 pre-existing warnings.
- Shell snapshot handoff: four adjacent WebSocket tests passed, including deterministic
  subscription-before-snapshot, buffered-gap delivery, raw cursor fencing, and snapshot-load
  failure cleanup. Server typecheck and formatting passed; lint completed with 0 errors and
  9 pre-existing warnings.
- Cosmetic/chat behavior: web typecheck, formatting, lint, and production build passed
  throughout the reviewed cohort. The final Chromium contrast/model-picker qualification
  passed 28/28 AppSidebarContrast and ProviderModelPicker cases. Earlier cohort evidence
  includes 26/26 ProviderModelPicker cases, 43 application-surface browser tests, and 7
  provider-wizard unit tests. Calculated sidebar foreground, muted, and active contrast
  ranges from 6.43:1 to 16.61:1.
- Saved-environment persistence: 13/13 catalog cases, including blocked hydration,
  competing rename, and same-ID operations; 76/76 focused web tests; 12/12 desktop
  persistence tests; web and desktop typechecks, formatting, and lint passed.
- Skills settings qualification: `4ed17a7f5fc88f1753c29c9f5b0e65a262ec1a75`
  replaces the stale browser fixture with schema-complete bundled Lincei Context and M4
  clinical/methodology descriptors. Its focused browser run passed 1 case with 24 skipped;
  production settings behavior is unchanged.
- Final migration/Lincei regression review: server 35/35, client-runtime 19/19, and web logic
  178/178 passed.
- Final correctness/security review: the broader pre-fix qualification passed 326 tests with
  1 skipped and identified the provider-start ownership P1. After the fix,
  ProviderCommandReactor passed 36/36 focused tests and the exact `f50ebc804` correction was
  independently approved.
- Final browser-loop correction: formerly hanging case 1/1, neighboring behavior 5/5,
  `ChatView` 89/89, shared catalog 9/9, and full Chromium suite 180/180; the exact source
  correction range was independently approved before integration.

Manual in-app demo qualification covered light and dark surfaces, Sidebar v2 as the default,
persisted Sidebar v1 rollback across reload and restoration to v2, glass dialogs,
Research/Vitrine, Skills/M4/workflows, and a clean browser console with no warnings or errors.

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
- Sidebar and glass behavior passed an in-app light/dark visual demo, including persisted
  Sidebar v1 rollback and restoration. Packaged Electron, real composer/session content,
  opacity 40/100 extremes, forced colors, and no-backdrop-filter fallbacks still require
  manual acceptance.
- Upstream has 14 unreviewed post-cutoff commits. They are intentionally excluded from this
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

- Qualified product-tree SHA: `94ef0d9705eccdcb187637b81c8a749aad48ea1b`
- Final integration SHA: the documentation commit at branch tip, reported verbatim in the
  owner handoff because a commit cannot embed its own content-derived SHA
- Final commit count above `main`: `94`
- Owner inspection: awaiting explicit owner inspection and approval
- Approved for merge into `main`: `NO — explicit owner approval required`
