# Vitrine integration

Vitrine is Lincei's visual research surface. Lincei owns projects, sessions, chat, terminals,
diffs, and provider orchestration. Vitrine owns studies, research cards, artifacts, decisions,
provenance, review, and export.

This is a local-alpha integration. Research is available only for a project in Lincei's primary
environment when both configured transport endpoints are loopback and the backend reports a
desktop-managed-local or loopback-browser access policy. See [Deferred work](#deferred-work) before
relying on it remotely or migrating legacy native-card data.

## Runtime requirements

Lincei requires Vitrine `>=0.1.0 <0.2.0`. The backend resolves the `vitrine` executable from its
`PATH`, unless `LINCEI_VITRINE_EXECUTABLE` specifies an executable explicitly. Restart the Lincei
backend after changing that variable.

### The executable and Python environment are separate

There are currently two environment boundaries:

| Setting or environment      | What it controls                                          | What it does not control                                |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `LINCEI_VITRINE_EXECUTABLE` | The CLI Lincei invokes for `status`, `start`, and `stop`  | The Python interpreter used by an agent's analysis code |
| Project analysis Python     | Whether `from vitrine import show, confirm, ask` succeeds | Which lifecycle CLI the Lincei backend invokes          |

Pointing Lincei at `/path/to/.venv/bin/vitrine` therefore does not make Vitrine importable from a
different Python environment. The compatible package must also be installed in the environment
that runs the project's analysis code. The safest current setup is to use the same project virtual
environment for both and point `LINCEI_VITRINE_EXECUTABLE` at that environment's `vitrine` entry
point.

Lincei does not silently install or upgrade Vitrine.

## Project identity and worktrees

Every registered Lincei project has one Vitrine data directory:

```text
<canonical-project-root>/.vitrine
```

Lincei injects `VITRINE_DATA_DIR` into managed provider launches and project process paths,
including terminals, setup scripts, and project actions. A worktree session keeps its own `cwd`
but receives the registered project's canonical `VITRINE_DATA_DIR`. Threads and worktrees for the
same project therefore share one study store and one project-scoped Vitrine daemon.

Project-script environment overrides cannot redirect `VITRINE_DATA_DIR` away from the canonical
store.

## Lifecycle and presentation

- Opening Research discovers a compatible running daemon or starts one for the project.
- Vitrine owns the persistent daemon lifetime. Closing Research or quitting Lincei does not stop it.
- Closing the embedded desktop panel clears its automatic-restore intent; it does not stop Vitrine.
- The desktop app embeds the loopback page. In a standalone loopback browser environment, Lincei
  asks the backend host to open the validated page in its default browser; the web client never
  navigates to a backend loopback URL.
- Lincei validates the Vitrine version, data directory, process identity, and loopback URLs before
  attaching.
- Research is disabled for remote-reachable and unsafe primary-server policies, and for saved remote
  environments. A Vitrine daemon exposes a separate loopback HTTP/WebSocket service that the normal
  Lincei connection does not securely forward. A manually tunnelled loopback-browser connection can
  launch the page only on the backend host, not through the tunnel.

If lifecycle startup fails, invoke the executable configured by `LINCEI_VITRINE_EXECUTABLE` (or
`vitrine` when it is unset) with `status --json` from the project root and the same
`VITRINE_DATA_DIR`. This avoids accidentally inspecting a different Vitrine installation.

## Current limitations

- Executable resolution is backend-wide, not project-scoped.
- Agent-side Research is unsupported with a configured external OpenCode `serverUrl`. That process
  is not owned by Lincei, so Lincei cannot inject the project's `VITRINE_DATA_DIR`; use a
  Lincei-managed provider when an agent needs to write Vitrine studies.
- Raw process-launch APIs still need server-authoritative validation of the protected project
  environment; the normal managed UI paths use the canonical value.
- Legacy Lincei native-card records are preserved and quarantined, but are not automatically
  imported into Vitrine.

## Deferred work

The accepted follow-ups, migration safeguards, and manual acceptance matrix are tracked in the
[Vitrine research surface section of `TODO.md`](../TODO.md#vitrine-research-surface).
