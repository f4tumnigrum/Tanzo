<div align="center">

<img src="./docs/assets/logo.png" alt="Tanzo logo" width="120" height="120" />

# Tanzo

<p><b>An AI-native desktop workspace that runs an autonomous coding agent on your real files — locally, and under your control.</b></p>

<p>
  <a href="https://github.com/f4tumnigrum/Tanzo/actions/workflows/ci.yml"><img src="https://github.com/f4tumnigrum/Tanzo/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache 2.0" /></a>
  <a href="https://github.com/f4tumnigrum/Tanzo/releases"><img src="https://img.shields.io/github/v/tag/f4tumnigrum/Tanzo?label=release&sort=semver" alt="Latest release" /></a>
</p>
<p>
  <img src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white" alt="Electron 41" />
  <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/AI_SDK-v7-000000?logo=vercel&logoColor=white" alt="Vercel AI SDK v7" />
</p>

<p>
  <b>
    <a href="#highlights">Highlights</a> &nbsp;·&nbsp;
    <a href="#how-it-works">How it works</a> &nbsp;·&nbsp;
    <a href="#architecture">Architecture</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="./docs/README.md">Docs</a> &nbsp;·&nbsp;
    <a href="#contributing">Contributing</a>
  </b>
</p>

</div>

---

Tanzo is a cross-platform desktop application (Electron + React) that puts an autonomous AI agent to work **inside your local workspace**. The agent reads and edits your files, runs shell commands, searches code with ripgrep, drives a browser, calls [Model Context Protocol](https://modelcontextprotocol.io/) servers, and orchestrates sub-agents — every side-effecting action passing through an **approval system you control**.

It is not a chat window bolted onto an editor. The agent loop is built on the [Vercel AI SDK](https://ai-sdk.dev/) tool loop and wrapped in a layered runtime (`AgentService` → `RunEngine` → `TurnLoop`) with a single source of truth in local SQLite. Nothing about your conversations or credentials leaves your machine unless you send it to a model provider you configured.

> [!NOTE]
> Tanzo tracks the AI SDK v7 **beta** line (`ai@7.x-beta` and the `@ai-sdk/*` provider packages). Interfaces may shift between releases. See [Status](#status).

## Why Tanzo

| | |
|---|---|
| **Local-first, not cloud-tethered** | The agent operates on your actual files and processes. Messages live only in your local SQLite database — the renderer never writes to disk and rehydrates from `main` after every run. |
| **Any model, one workspace** | Anthropic, OpenAI, Google, DeepSeek, and any OpenAI-compatible endpoint through five provider adapters. API keys are stored in the OS secure store via Electron `safeStorage`, never sent in plaintext across IPC. |
| **Safe by default** | Filesystem access is confined to the workspace with symlink-escape (`realpath`) checks and credential-path blocking; shell runs with a stripped environment; destructive commands are intercepted by a policy engine. |
| **Grows by "adding a part"** | A new agent capability is one tool (`main`) + one message part type (`shared`) + one renderer component. The core loop stays untouched — the whole app is built around that invariant. |
| **Open ecosystem** | First-class MCP servers, subprocess hooks compatible with Codex / Claude Code, progressively-disclosed Skills, and a git-based plugin marketplace. |
| **Observable** | Every run, step, and tool call is written to telemetry so you can review token usage and cost in a built-in dashboard. |

## Highlights

- **Local-first agent runtime** — a layered `AgentService` / `RunEngine` / `TurnLoop` design over the AI SDK
  `streamText` tool loop. Tanzo doesn't hand-write the model/tool loop; it wraps it with an outer
  compaction-and-continuation loop and per-conversation serialization.
- **Multi-provider** — Anthropic, OpenAI, OpenAI-compatible, Google, and DeepSeek adapters, with credentials in
  the OS secure store.
- **Sandboxed tools** — `fileRead` / `fileEdit` / `multiEdit` / `fileWrite`, `glob`, `grep` (ripgrep), `shell`,
  and `browserOpen`. Read-only tools are auto-approved; everything else can be gated.
- **Approval + policy engine** — rule-priority decisions, permission modes, built-in guardrails, and approval
  memory. Approvals live *in the message history*, not in a server-side state machine.
- **MCP integration** — connect Model Context Protocol servers, expose their tools to the agent, and handle
  Elicitation round-trips.
- **Sub-agents** — spawn concurrent, isolated tasks. Four agents ship built-in: `tanzo` (main), plus `explore`,
  `verify`, and `review`.
- **Context engineering** — a Section × Provider context model with budgeting, compaction, and forking to keep
  long sessions within the model's window.
- **Hooks** — subprocess hooks compatible with Codex / Claude Code event triggers, with a per-command trust model.
- **Skills & plugins** — progressively-disclosed `SKILL.md` capability packs and a git-based plugin marketplace.
- **Embedded browser automation** — drive `<webview>` guests over CDP via
  [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) with explicit prompt-injection
  trust boundaries.
- **Desktop companion** — an optional Pet window that mirrors agent presence and surfaces quick approvals.
- **Bilingual UI** — English and Simplified Chinese via i18next.

## How it works

Every message in a conversation is a single kind of object — a `TanzoUIMessage` made of typed *parts*
(text, reasoning, tool calls, file diffs, plans, sub-agent progress, telemetry). All conversation data crosses
exactly one boundary: the `chat:*` IPC channel. There are **no local ports and no localhost SSE**.

```text
┌───────────────────────── RENDERER · React 19 ─────────────────────────┐
│  Composer.handleSubmit → chatClient.submit                            │
│  ChatSession (external store) · react-query · zustand                 │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │  window.electron  (contextBridge)
┌──────────────────────────────────┴──────────────── PRELOAD ───────────┐
│  tanzoApi = { chat, provider, mcp, policy, hooks, … }                 │
│  every call is invoke() / subscribe()                                 │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │  ipcMain.handle / webContents.send
┌──────────────────────────────────┴──────────────── MAIN · Node ───────┐
│  AgentService     mailbox — one conversation, serialized              │
│    └ RunEngine    epoch · cancellation · inflight                     │
│        └ TurnLoop ≤10 compaction / continuation passes                │
│            └ streamText (AI SDK)  ← the inner tool loop:              │
│                 model → run tools → feed results back → repeat        │
│                                                                       │
│  SQLite  single source of truth — messages, runs, telemetry, …        │
└───────────────────────────────────────────────────────────────────────┘
```

When the agent wants to touch something sensitive, the approval decision function returns a request part, the run
naturally stops, and the request streams back to you. Your response is written into the message history; the next
run replays the *complete* history and the SDK executes the now-approved call. Approval, multi-step tool use, and
tool feedback all resolve inside this one loop.

## Architecture

Tanzo is a single-package, three-process Electron app. `main` owns all truth and side effects, `renderer` only
renders and interacts, and `preload` is a thin, controlled bridge.

| Concern | Choice | Location |
|---|---|---|
| Desktop shell | Electron 41 + electron-vite | `electron.vite.config.ts` |
| Agent core | AI SDK v7 `streamText` / `tool()` / `UIMessage` | `src/main/agent/` |
| Model providers | `@ai-sdk/{anthropic,openai,openai-compatible,google,deepseek,mcp}` | `src/main/provider/`, `src/main/mcp/` |
| Persistence | better-sqlite3 (WAL) | `src/main/database/` |
| Code search | `@vscode/ripgrep` | `src/main/agent/search/` |
| UI | React 19 + React Router 7 (HashRouter) | `src/renderer/src/` |
| Server state | TanStack Query | `features/*/model/queries.ts` |
| Local UI state | Zustand + a custom `ChatSession` external store | `features/*/model/` |
| Streaming | `readUIMessageStream` + a custom frame gate | `platform/electron/run-stream.ts` |
| Styling | Tailwind CSS 4 + CSS-variable theming | `src/renderer/src/common/theme/` |
| i18n | i18next / react-i18next (en · zh-CN) | `src/renderer/src/locales/` |

Each `main` subsystem follows the same module-factory shape —
`createXxxModule(deps) → { service?, registerIpc, close? }` — with a deliberately ordered teardown on quit.

A full architecture reference lives under [`docs/architecture/`](./docs/architecture) (English, with a
Simplified-Chinese mirror at [`docs/architecture/zh/`](./docs/architecture/zh)), mapped in
[`docs/README.md`](./docs/README.md). Every non-trivial claim carries a `file:line` coordinate. Suggested
starting points:

- [01 · Introduction & invariants](./docs/architecture/01-introduction.md)
- [02 · System overview](./docs/architecture/02-system-overview.md)
- [03 · Process model](./docs/architecture/03-process-model.md)
- [10 · Agent runtime](./docs/architecture/10-agent-runtime.md)
- [13 · Policy & approval](./docs/architecture/13-policy-and-approval.md)

## Tech stack

- **Runtime** — Electron 41 (main / preload / renderer), TypeScript 6.
- **Frontend** — React 19, React Router 7, Zustand 5, TanStack Query 5 & Table 8, Tailwind CSS 4, Base UI,
  lucide-react, motion, recharts, react-markdown + KaTeX, i18next.
- **AI** — Vercel AI SDK v7 with provider adapters and `@ai-sdk/mcp`.
- **Persistence & workspace** — better-sqlite3, `@vscode/ripgrep`, chokidar, simple-git, zod.
- **Build & tooling** — electron-vite + electron-builder, a TypeScript type-check gate, Vitest, ESLint, Prettier.

## Quick start

### Prerequisites

- **Node.js** 24+
- **pnpm** 10+

### Install & run

```bash
git clone https://github.com/f4tumnigrum/Tanzo.git
cd Tanzo
pnpm install
pnpm dev
```

On first launch, open **Settings → Providers**, add a model provider and its API key (stored in your OS secure
store), and start a conversation. You can add MCP servers, skills, hooks, and permission rules from the same
Settings surface.

### Build a desktop package

```bash
pnpm build:mac     # DMG (macOS)
pnpm build:win     # NSIS installer (Windows)
pnpm build:linux   # AppImage + deb (Linux)
```

`pnpm build` runs the type-check gate and then `electron-vite build`; the `build:*` scripts add
`electron-builder` packaging on top.

## Development

### Quality gates

The same three checks run locally and in CI:

```bash
pnpm typecheck   # tsc for the node + web project configs
pnpm lint        # eslint
pnpm test        # vitest (unit tests under tests/)
```

Additional scripts: `pnpm test:watch`, `pnpm test:coverage`, `pnpm format`, and
`pnpm diagnose:prompt-cache`.

### Project layout

```text
src/
├── main/          # Node process — the single source of truth
│   ├── agent/     #   agent runtime: runtime, context, tools, policy,
│   │              #   hooks, subagent, skills, goal, telemetry, store
│   ├── provider/  #   provider runtime + 5 model adapters + secret storage
│   ├── mcp/       #   MCP client lifecycle + Elicitation
│   └── database/  #   better-sqlite3 + migrations
├── preload/       # contextBridge surface (window.electron = tanzoApi)
├── renderer/src/  # React 19 app
│   ├── features/  #   chat · git · mcp · providers · settings ·
│   │              #   skills · plugins · usage · browser · pet
│   └── platform/  #   the only layer that touches window.electron
└── shared/        # cross-process contracts (agent-message, tool-catalog, …)
docs/architecture/ # architecture reference (English + zh/ mirror)
tests/             # Vitest suites
```

### Recommended IDE setup

[VS Code](https://code.visualstudio.com/) with the
[ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and
[Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) extensions.

## Status

Tanzo is under active development and pre-1.0. It depends on the AI SDK v7 beta line, so provider interfaces and
behavior can change between releases. Expect breaking changes; pin a version if you need stability. Follow
[Releases](https://github.com/f4tumnigrum/Tanzo/releases) and the [Changelog](./CHANGELOG.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md) before opening a pull request. Every PR must pass the type-check, lint,
and test gates.

## Security

For the threat model and how to report a vulnerability, see [SECURITY.md](./SECURITY.md). Please do not open public
issues for security reports.

## License

Licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for attributions.

<div align="center">
<sub>Built with the <a href="https://ai-sdk.dev/">Vercel AI SDK</a> · Powered by <a href="https://www.electronjs.org/">Electron</a> and <a href="https://react.dev/">React</a></sub>
</div>
