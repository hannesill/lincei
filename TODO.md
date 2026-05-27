# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 sessions for a given study
- [ ] Session archiving
- [ ] New studies should go on top
- [ ] Studies should be sorted by latest session update

## Bigger things

- [ ] Queueing messages

## Telemetry

Telemetry plumbing exists in `apps/server/src/telemetry/` but is **disabled by default** (no PostHog key, `LINCEI_TELEMETRY_ENABLED=false`).

- [ ] Create a Lincei PostHog project (PostHog Cloud free tier is likely enough to start)
- [ ] Set `LINCEI_POSTHOG_KEY` in release/build env (do not commit the key)
- [ ] Enable telemetry for production builds via `LINCEI_TELEMETRY_ENABLED=true`
- [ ] Decide opt-in vs opt-out UX (marketing copy says “No telemetry unless you opt in”)
- [ ] Rename legacy telemetry fields (`t3CodeVersion`, `T3CODE_*` env aliases) when doing the Lincei rebrand

## OpenMed

- [ ] Copy from OpenMed: inspectable local operator runtime, explicit provider/service boundaries, plan-first workflows, deterministic domain tools, provenance on artifacts, restricted modes, and configurable service endpoints/secrets.
- [ ] Defer OpenMed-specific healthcare service planes, hosted HF infrastructure, audit export, compliance packaging, large workflow catalogs, and broad MCP marketplace work until the prototype proves the control-plane shape.
