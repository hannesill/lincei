# Lincei Studio

Lincei Studio is a minimal web GUI for coding agents (currently Codex, Claude, and OpenCode, more coming soon).

Lincei Studio is based on the MIT-licensed T3 Code project.

## Installation

> [!WARNING]
> Lincei Studio currently supports Codex, Claude, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/lincei-studio/lincei-studio/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install LinceiStudio.LinceiStudio
```

#### macOS (Homebrew)

```bash
brew install --cask lincei-studio
```

#### Arch Linux (AUR)

```bash
yay -S lincei-studio-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
