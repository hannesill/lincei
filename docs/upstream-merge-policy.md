# Upstream Merge Policy

This repository is a fork of `pingdotgg/t3code`, but Lincei owns product identity,
release infrastructure, runtime data paths, and public-facing documentation.

Use this policy whenever merging upstream `t3code` changes into this repository.

## Fork Baseline

Commit `a8cc0b9298de62781cf18c454f22cec7820905b2` is the Lincei fork baseline.

At this commit, the repository had completed the initial refactor from the upstream
`t3code` codebase into the Lincei codebase. After this point, new commits may include
Lincei-specific product work.

When reviewing upstream `t3code`, treat this baseline as the point where Lincei ownership
begins. Current Lincei and upstream histories are not suitable for a direct Git merge, so
the baseline is an ownership reference rather than a merge base. Do not assume upstream
should overwrite local changes made after this commit.

Use the baseline to distinguish three categories:

1. Upstream-derived code that can usually accept upstream fixes.
2. Lincei fork adaptations that must be preserved.
3. New Lincei product features added after the baseline.

When a conflict touches category 2 or 3, preserve the Lincei behavior and port only the
upstream fix or improvement.

## Preserve Lincei Decisions

When resolving conflicts, the Lincei side wins for:

- Product names: `Lincei`, `lincei`, package, app, domain, or filesystem identifier.
- Public URLs and domains: `app.lincei.studio`, `latest.app.lincei.studio`,
  `nightly.app.lincei.studio`, and related hosted app routing.
- Release artifact names, desktop build metadata, update channels, manifests, and
  signing/notarization configuration.
- Desktop app identity, app IDs, user data paths, icons, and branding assets.
- Lincei environment variables as the primary names.
- Lincei README, docs, marketing copy, package registry instructions, and release docs.
- Intentional compatibility aliases for legacy `T3CODE_*` environment variables or
  `.t3code` paths.
- Local package namespace choices such as `@t3tools/*` when retained to reduce upstream
  merge friction.

Do not revert these decisions back to upstream T3 Code values unless explicitly asked.

## Prefer Upstream Fixes

Prefer upstream changes for generic implementation work that does not conflict with
Lincei ownership:

- Bug fixes.
- Provider protocol handling.
- Performance improvements.
- Reliability, failure recovery, and reconnection improvements.
- Security fixes.
- Dependency-compatible runtime improvements.
- Test improvements.
- Shared architecture improvements.

When upstream changes conflict with Lincei-specific files, port the behavioral fix
without reverting Lincei branding, release behavior, runtime data paths, or public docs.

## Conflict Escalation

Do not guess through conflicts whose correct resolution is unclear.

If a conflict involves product direction, release ownership, data migration, runtime
storage paths, public behavior, security, or non-obvious architecture tradeoffs, leave
the conflict open and report it back for owner review. Include the file path, the
conflicting choices, the likely impact of each choice, and any recommended resolution
if one is apparent.

Resolve only conflicts that are clearly mechanical or directly covered by this policy.

## Selective Port Workflow

Do upstream reviews and ports in separate worktrees and branches so the main checkout
remains usable while adaptations are implemented and verified.

Before changing the target:

```sh
git ls-remote t3code refs/heads/main
git show --no-patch <audited-upstream-sha>
```

If upstream advanced beyond the audited SHA, report the exact delta before changing the
cutoff. Create the integration branch from Lincei, not from upstream, then behavior-port
selected upstream commits through the pinned cutoff. Do not merge `t3code/main`, copy its
tree wholesale, or introduce an upstream merge commit.

Use separate cohort worktrees when ports can be partitioned without overlapping files.
Serialize shared seam files, independently review each cohort, fix findings on the cohort
branch, then rebase or cherry-pick only clean atomic commits onto the integration branch.
Do not fast-forward or merge the integration branch into `main` until the owner has
inspected it and explicitly approved landing it.

## Upstream Ledger

Every reviewed upstream SHA must appear in the integration ledger with exactly one status:

- `ported`: Lincei contains the upstream behavior, normally with an adapted implementation
  and focused regression coverage.
- `equivalent`: existing Lincei behavior already provides the relevant guarantee; cite the
  concrete implementation or test.
- `deferred`: the change is potentially applicable but intentionally outside the pinned
  port scope; state the remaining risk or dependency.
- `not applicable`: the change targets an excluded platform, product, provider, or
  architecture; state why it does not apply.

Port commits must be atomic and use imperative subjects. Their bodies must cite the
upstream SHA and PR when known, explain why the behavior matters, and record material
Lincei or toolchain adaptations. Do not describe an existing Lincei capability as ported
when the ledger evidence shows it was already equivalent.

## Compatibility Rules

Legacy `T3CODE_*` and `.t3code` support may remain when it is explicitly present for
migration or backward compatibility. Treat those compatibility paths as intentional
unless nearby code or docs say otherwise.

Do not introduce new T3 Code public branding. New user-facing behavior should use
Lincei naming, even if internal packages still use `@t3tools/*`.

## Agent Prompt

Use this prompt when assigning a selective upstream port:

```md
Review and selectively port upstream `pingdotgg/t3code` changes through the pinned cutoff
into this Lincei fork.

Important constraints:

1. Treat this repository as the product owner for Lincei-specific behavior.
2. Preserve Lincei branding, app identity, release scripts, artifact names, domains,
   icons, desktop metadata, Lincei env vars, and Lincei docs/marketing.
3. Keep compatibility aliases such as `T3CODE_*` and `.t3code` only where they are
   intentionally present for migration/backward compatibility.
4. Do not rename local packages away from `@t3tools/*` unless explicitly necessary;
   that namespace is intentionally retained to reduce upstream merge friction.
5. When conflicts occur, prefer upstream for generic code fixes and prefer Lincei for
   product identity, release, config, and public documentation decisions.
6. Use `lincei-fork-baseline` or the baseline commit in this document to understand
   where Lincei ownership begins. Do not assume upstream should overwrite local changes
   made after that baseline.
7. Work in separate cohort worktrees and purpose-named branches. Do not edit the primary
   checkout or merge the upstream branch.
8. If a conflict is not clearly mechanical or directly covered by this policy, leave it
   open and report it back instead of guessing. Include the file path, the conflicting
   choices, likely impact, and any recommendation.
9. Record every reviewed SHA as `ported`, `equivalent`, `deferred`, or `not applicable`.
   Cite the concrete Lincei implementation, test, remaining dependency, or exclusion.
10. Keep port commits atomic. Use imperative subjects and include the upstream SHA/PR,
    rationale, and material Lincei adaptations in the commit message.
11. Obtain independent cohort review and fix findings before rebasing or cherry-picking
    clean commits onto the integration branch. Do not merge the integration branch into
    `main`; stop for owner inspection and approval.
12. Run focused tests for the cohort plus `bun fmt`, `bun lint`, and `bun typecheck`.
    Do not run `bun test`; use `bun run test`.
13. Summarize:

- upstream cutoff and reviewed SHAs
- ledger classifications and deliberate deviations
- review findings and fixes
- Lincei-specific changes preserved
- verification commands and results
```
