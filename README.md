# Tanzo

> AI-native desktop workspace for planning, coding, and automation.

[![CI](https://github.com/f4tumnigrum/Tanzo/actions/workflows/ci.yml/badge.svg)](https://github.com/f4tumnigrum/Tanzo/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/tag/f4tumnigrum/Tanzo?label=release&sort=semver)](https://github.com/f4tumnigrum/Tanzo/releases)

Tanzo is an Electron + React desktop application that combines local project context, multi-provider
AI configuration, chat-driven workflows, sandboxed tool execution, and desktop-focused controls in a
single packaged app. It runs an autonomous agent loop locally against your real workspace: reading and
editing files, running shell commands, searching code, and orchestrating sub-agents — all behind an
approval system you control.

## Highlights

- **Local-first agent runtime** — the agent works on your actual files and processes, with a layered
  `AgentService` / `RunEngine` / `TurnLoop` design built on the AI SDK tool-loop.
- **Multi-provider** — Anthropic, OpenAI, Google, DeepSeek, and any OpenAI-compatible endpoint, with
  credentials stored via the OS secure store (Electron `safeStorage`).
- **MCP integration** — connect Model Context Protocol servers and expose their tools to the agent.
- **Sandboxed tools** — filesystem access is confined to the workspace with symlink-escape protection
  and credential-path blocking; shell execution runs with a stripped environment.
- **Approval system** — a policy engine gates sensitive tool calls with configurable rules and
  permission modes.
- **Context engineering** — section/provider context model with budgeting, compaction, and forking.
- **Hooks** — subprocess hooks compatible with Codex/Claude Code event triggers.

## Tech Stack

- **Runtime**: Electron 41 (three-process model: main / preload / renderer)
- **Frontend**: React 19, React Router 7, Zustand, TanStack Query/Table, Tailwind CSS 4, i18next (en / zh-CN)
- **AI**: Vercel AI SDK (v7) with provider adapters and `@ai-sdk/mcp`
- **Persistence**: better-sqlite3
- **Build**: electron-vite + electron-builder, TypeScript type-check gate, Vitest

> Note: core AI SDK packages currently track beta releases. Interfaces may change between versions.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Prerequisites

- Node.js 24+
- pnpm 10+

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Build

```bash
# For Windows
pnpm build:win

# For macOS
pnpm build:mac

# For Linux
pnpm build:linux
```

## Quality Gates

The project enforces three checks, run the same set locally and in CI:

```bash
pnpm typecheck   # tsc for node + web project configs
pnpm lint        # eslint
pnpm test        # vitest (unit tests under tests/)
```

## Architecture

A full architecture reference lives under [`docs/architecture/`](./docs/architecture). Suggested
reading paths are in [`docs/README.md`](./docs/README.md). Start with:

- [01 Introduction](./docs/architecture/01-introduction.md)
- [02 System Overview](./docs/architecture/02-system-overview.md)
- [03 Process Model](./docs/architecture/03-process-model.md)

> The architecture docs are currently written in Chinese.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and our
[Code of Conduct](./CODE_OF_CONDUCT.md) before opening a pull request.

## Security

For the threat model and how to report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

Licensed under the [Apache License 2.0](./LICENSE).
