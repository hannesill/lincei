# TODO

Last checked: 2026-07-22 across:

- `codex/vitrine-browser-pivot`
- `codex/lincei-lifecycle-json` in Vitrine
- `codex/card-handles-review-flow` as historical reference only
- `codex/lincei-skills-workflows` at `de05f02e`

## Recently completed on main

- [x] Submitting new messages scrolls to the bottom before optimistic message insert and keeps LegendList pinned.
- [x] Sidebar session preview limits exist and keep the active session visible when a project list is collapsed.
- [x] Session archiving exists across command dispatch, projections, sidebar actions, archived settings view, unarchive, and delete.
- [x] Projects can be sorted by latest session activity; session sorting uses latest user-message time when available.
- [x] Help & Feedback route is linked from the sidebar.

## Active product work

- [ ] Queueing messages. Current send paths use `sendInFlightRef` guards; there is no durable per-session outbound queue.
- [ ] Decide whether sidebar preview should default to exactly 10 sessions. Current setting is configurable from 1 to 15.
- [ ] Add focused browser coverage for "send while scrolled up" if scroll-to-bottom regresses in real use.

## Vitrine research surface

Vitrine is the sole owner of studies, research cards, artifacts, decisions, provenance, review, and export. Lincei owns projects, sessions, chat, terminals, diffs, provider integration, and the managed project-scoped Vitrine launch/preview path.

- [ ] Introduce a pinned/bundled Vitrine distribution so users do not need to install a compatible `vitrine` executable separately.
- [ ] Define secure loopback forwarding/tunneling before enabling embedded Vitrine for remote execution environments.
- [ ] Define and approve an explicit export/migration strategy before deleting dormant native-card tables, events, or on-disk records from developer databases.
- [ ] Complete the two-project manual acceptance flow, including M4 → `vitrine.show(...)`, blocking `confirm()`/`show(..., wait=True)`, and Lincei restart recovery.

## Worktree integration

### `codex/card-handles-review-flow` — obsolete; do not merge

This branch implements the retired Lincei-native card domain. Keep its branch/worktree only as a historical reference. Do not rebase, merge, or delete it as part of the Vitrine pivot.

### `codex/lincei-skills-workflows`

Branch summary: bundled Lincei skill/workflow catalog, Skills settings page, provider skill review, prompt enablement settings, managed skill sync metadata, workflow selection persistence, and responsive right-panel fixes.

- [ ] Rebase onto `main`; preserve scope-toggle polish and Help & Feedback, but do not restore native research-card actions or schemas.
- [ ] Resolve `033_ProjectionSessionWorkflowMetadata` against current `main`; the obsolete card branch no longer participates in migration-number decisions.
- [ ] Decide the explicit provider-native skill sync action API. Current behavior records deployment intent and avoids overwriting conflicts automatically.
- [ ] Verify workflow prompt enablement after provider session restart and projection reload.
- [ ] Run `bun fmt`, `bun lint`, `bun typecheck`, `bun run test src/linceiSkills.test.ts`, and relevant settings/provider tests.

## Telemetry

Telemetry plumbing exists in `apps/server/src/telemetry/` but is **disabled by default** (no PostHog key, `LINCEI_TELEMETRY_ENABLED=false`).

- [ ] Use PostHog Cloud for early privacy-preserving telemetry/diagnostics if event volume stays tiny. Pricing checked 2026-06-02: free tier includes 1M analytics events/month and 100K error exceptions/month.
- [ ] Keep telemetry anonymous/aggregate: no prompts, clinical data, file paths, raw errors, artifact contents, or provider transcript text.
- [ ] Create a Lincei PostHog project
- [ ] Set `LINCEI_POSTHOG_KEY` in release/build env (do not commit the key)
- [ ] Enable telemetry for production builds via `LINCEI_TELEMETRY_ENABLED=true`
- [ ] Decide opt-in vs opt-out UX (marketing copy says “No telemetry unless you opt in”)
- [ ] Rename legacy telemetry fields (`t3CodeVersion`, `T3CODE_*` env aliases) when doing the Lincei rebrand

## OpenMed

- [ ] Copy from OpenMed: inspectable local operator runtime, explicit provider/service boundaries, plan-first workflows, deterministic domain tools, provenance on artifacts, restricted modes, and configurable service endpoints/secrets.
- [ ] Defer OpenMed-specific healthcare service planes, hosted HF infrastructure, audit export, compliance packaging, large workflow catalogs, and broad MCP marketplace work until the prototype proves the control-plane shape.
