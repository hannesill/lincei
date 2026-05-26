# Lincei Desktop Development

This repository is a local fork of `pingdotgg/t3code` for Lincei.

## Runtime

The upstream project is Bun-first and currently declares `bun@1.3.11` in `package.json`.

If `bun` is not available in the current shell after installation, either reload the shell or use:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## Install

```bash
bun install
```

## Desktop Dev Loop

```bash
bun run dev:lincei
```

This runs the Electron desktop app with an isolated local profile:

- `LINCEI_HOME=.dev-home`
- `LINCEI_DEV_INSTANCE=lincei`

The renderer is served by Vite with hot reload. Electron main and preload files are rebuilt by `tsdown --watch`, and the Electron process restarts when those built files change.

## Verification Commands

```bash
bun run build:desktop
bun run test:desktop-smoke
```

On May 25, 2026, both commands passed locally. `bun run dev:lincei` also started successfully: Vite served the renderer, the backend listened on its assigned local port, and the Electron main window was created.
