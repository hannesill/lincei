# Upstream Merge Policy

This repository is a fork of `pingdotgg/t3code`, but Lincei owns product identity,
release infrastructure, runtime data paths, and public-facing documentation.

Use this policy whenever merging upstream `t3code` changes into this repository.

## Fork Baseline

Commit `a8cc0b9298de62781cf18c454f22cec7820905b2` is the Lincei fork baseline.

At this commit, the repository had completed the initial refactor from the upstream
`t3code` codebase into the Lincei codebase. After this point, new commits may include
Lincei-specific product work.

When merging upstream `t3code`, treat this baseline as the point where Lincei ownership
begins. Do not assume upstream should overwrite local changes made after this commit.

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

## Merge Workflow

Do upstream merges in a separate worktree and branch so the main checkout remains usable
while conflicts are resolved.

Recommended shape:

```sh
git fetch upstream
git worktree add ../lincei-upstream-merge -b merge/upstream-t3code HEAD
cd ../lincei-upstream-merge
git merge upstream/main
```

Resolve conflicts using this policy. Leave uncertain conflicts open and report them for
owner review. Do not create the final merge commit and do not fast-forward or merge the
finished branch back into the main checkout until the owner has inspected the result and
explicitly approved landing it.

If a different branch layout is more appropriate for the local checkout, keep the same
principle: isolate the upstream merge in a purpose-named `merge/upstream-*` branch and
avoid resolving large upstream conflicts directly in the primary working tree.

## Compatibility Rules

Legacy `T3CODE_*` and `.t3code` support may remain when it is explicitly present for
migration or backward compatibility. Treat those compatibility paths as intentional
unless nearby code or docs say otherwise.

Do not introduce new T3 Code public branding. New user-facing behavior should use
Lincei naming, even if internal packages still use `@t3tools/*`.

## Agent Prompt

Use this prompt when assigning an upstream merge task to an AI agent:

```md
Merge the latest upstream `pingdotgg/t3code` changes into this Lincei fork.

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
7. Do the merge in a separate worktree and purpose-named branch such as
   `merge/upstream-t3code`. Do not resolve large upstream conflicts directly in the
   primary working tree.
8. If a conflict is not clearly mechanical or directly covered by this policy, leave it
   open and report it back instead of guessing. Include the file path, the conflicting
   choices, likely impact, and any recommendation.
9. Do not create the final merge commit, fast-forward, or merge the worktree branch back
   into the main checkout. Stop after preparing the merge branch so the owner can inspect
   and approve it.
10. After resolving the conflicts you are confident about, run `bun fmt`, `bun lint`, and `bun typecheck`.
    Do not run `bun test`; use `bun run test` only if tests are needed.
11. Summarize:

- upstream range merged
- conflicts resolved and chosen resolution
- conflicts left open for owner review
- Lincei-specific changes preserved
- verification commands and results
```
