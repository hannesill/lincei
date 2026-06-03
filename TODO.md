# TODO

Last checked: 2026-06-02 across:

- `main` at `9e2b80fc`
- `codex/card-handles-review-flow` at `9088f675`
- `codex/lincei-skills-workflows` at `de05f02e`

## Recently completed on main

- [x] Submitting new messages scrolls to the bottom before optimistic message insert and keeps LegendList pinned.
- [x] Sidebar session preview limits exist and keep the active session visible when a project list is collapsed.
- [x] Session archiving exists across command dispatch, projections, sidebar actions, archived settings view, unarchive, and delete.
- [x] Studies/projects can be sorted by latest session activity; session sorting uses latest user-message time when available.
- [x] Help & Feedback route is linked from the sidebar.

## Active product work

- [ ] Queueing messages. Current send paths use `sendInFlightRef` guards; there is no durable per-session outbound queue.
- [ ] Decide whether sidebar preview should default to exactly 10 sessions. Current setting is configurable from 1 to 15.
- [ ] Add focused browser coverage for "send while scrolled up" if scroll-to-bottom regresses in real use.

## Study card review system

Strategic read: the current card drawer is useful as a quick session review surface, but not enough as the main clinical study review experience. Keep the drawer. Add a focused full-screen study review view and harden the card model around provenance, review history, supersession, VCS/checkpoint binding, and downstream invalidation.

### First-release essentials

- [ ] Add a full-screen Study Review route for serious card/artifact review. Keep the side drawer for quick "what just happened?" review.
- [ ] Show cards as a study-level review workspace, not only a sorted drawer list: card list/timeline, selected card, artifacts, dependencies, provenance, and review notes in one view.
- [ ] Add review history/audit trail. Current projected card review keeps only latest `review.response`; clinical review should preserve prior accept/change/reject events.
- [ ] Add downstream impact display. If a dependency/artifact is stale, missing, rejected, or superseded, show affected downstream cards.
- [ ] Add a correction flow for bad earlier cards: mark issue, create correction branch/session, supersede old card, and require downstream revalidation.
- [ ] Make captured artifact vs current artifact comparison explicit for stale files.
- [ ] Bind each persisted card to VCS/checkpoint context: branch/worktree, commit/checkpoint ref, and captured dependency/blob identity where available.
- [ ] Add anchored comments with a small scope: card-level, artifact-level, and optional file path + line range.

### Data model hardening

- [ ] Add explicit graph fields: parent/dependency card ids and `supersedesCardId` or equivalent.
- [ ] Add immutable card version identity if mutable card ids remain user-facing.
- [ ] Store review responses as append-only events or a review log, while still projecting latest response for UI speed.
- [ ] Store branch/worktree/checkpoint/commit context on card manifests, not only scattered artifact/dependency fields.
- [ ] Distinguish "stale input", "stale output", "missing", and "needs revalidation" in card consistency.
- [ ] Ensure study scope does not hide branch structure by deduping solely by card id and latest timestamp.

### UX details

- [ ] Keep drawer actions compact: Preview, Open in editor, Accept, Request changes, Reject.
- [ ] In full-screen review, show filters for needs review, changes requested, stale, missing, accepted, and superseded.
- [ ] Show dependencies and artifacts as first-class inspectable rows with status, captured hash, current hash, and path.
- [ ] Add "Open captured version" or "Compare with captured version" where VCS/checkpoint data exists.
- [ ] Show branch/session origin for study-scope cards so researchers can understand parallel work.
- [ ] Add clear empty/error states for missing previews, binary files, stale files, and unavailable card details.

### Defer for now

- [ ] Defer large decorative graph visualizations until card graph semantics are solid.
- [ ] Defer realtime Google-Docs-style collaboration; anchored comments are enough for v1.
- [ ] Defer many new card types. Current practical types are enough unless a concrete study workflow needs more.
- [ ] Defer complex branch management UI until correction/supersede/downstream invalidation works.
- [ ] Avoid generic dashboards that do not answer whether the study output can be trusted.

## Worktree integration

### `codex/card-handles-review-flow`

Branch summary: stable research-card slugs/handles, `@card:<handle>` composer mentions, bounded card context injection, `lincei card show`, `lincei card review`, and CLI review request flow.

- [ ] Rebase onto `main` and keep the `help-feedback` route/route tree from `9e2b80fc`.
- [ ] Resolve migration numbering before merge. This branch uses `033_ProjectionSessionResearchCardSlugs`; `codex/lincei-skills-workflows` also uses migration `033`.
- [ ] After merge, verify card handles still use UUIDs as canonical IDs and slugs only as stable human-facing handles.
- [ ] Run `bun fmt`, `bun lint`, `bun typecheck`, and targeted card/composer tests.

### `codex/lincei-skills-workflows`

Branch summary: bundled Lincei skill/workflow catalog, Skills settings page, provider skill review, prompt enablement settings, managed skill sync metadata, workflow selection persistence, and responsive right-panel fixes.

- [ ] Rebase onto `main`; preserve the research-card review actions from `48d228c4`, scope-toggle polish from `e3ef91a7`, and Help & Feedback route from `9e2b80fc`.
- [ ] Resolve migration numbering before merge. This branch uses `033_ProjectionSessionWorkflowMetadata`; `codex/card-handles-review-flow` also uses migration `033`.
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
