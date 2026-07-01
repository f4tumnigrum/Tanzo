# Tanzo Architecture Documentation

> Tanzo is an AI-native desktop workspace (Electron + React 19) for planning, coding, and automation.
> This set of documents describes the architecture of the **current implementation**: the process model,
> cross-process contracts, the agent runtime, context engineering, tools and policy, providers and MCP,
> persistence, the renderer, and build/release.

These docs are written for engineers. The goal is that a new contributor can build an accurate mental model
of the system — and locate *where a given capability is implemented* — without reading all of the source.

**Languages:** English is the primary version at `docs/architecture/`. A Simplified-Chinese mirror lives at
[`docs/architecture/zh/`](./architecture/zh/) · 中文版见 [`docs/architecture/zh/`](./architecture/zh/)。

## Reading paths

- **First time with Tanzo** → read in order: [01 Introduction](./architecture/01-introduction.md) →
  [02 System Overview](./architecture/02-system-overview.md) → [03 Process Model](./architecture/03-process-model.md).
- **Changing conversation / agent behavior** → [10 Agent Runtime](./architecture/10-agent-runtime.md) →
  [11 Context Engineering](./architecture/11-context-engineering.md) → [12 Tools](./architecture/12-tools.md) →
  [13 Policy & Approval](./architecture/13-policy-and-approval.md) → [14 Hooks](./architecture/14-hooks.md).
- **Changing the frontend / renderer** → [04 IPC & Contracts](./architecture/04-ipc-and-contracts.md) →
  [30 Renderer](./architecture/30-renderer.md).
- **Changing model access / MCP** → [20 Providers](./architecture/20-providers.md) →
  [21 MCP](./architecture/21-mcp.md).
- **Understanding persistence / workspace integration** → [22 Persistence](./architecture/22-persistence.md) →
  [23 Workspace Integrations](./architecture/23-workspace-integrations.md).

## Document map

### Foundations

| # | Document | Contents |
|---|---|---|
| 01 | [Introduction](./architecture/01-introduction.md) | Product framing, design goals, architectural invariants, glossary |
| 02 | [System Overview](./architecture/02-system-overview.md) | High-level component diagram, end-to-end data flow, tech stack |
| 03 | [Process Model](./architecture/03-process-model.md) | Three-process split, startup/shutdown sequences, window model, security baseline |
| 04 | [IPC & Contracts](./architecture/04-ipc-and-contracts.md) | IPC router, `@shared` contracts, error encoding, channel naming |

### Agent Core

| # | Document | Contents |
|---|---|---|
| 10 | [Agent Runtime](./architecture/10-agent-runtime.md) | Module factory, `AgentService`/`RunEngine`/`TurnLoop` layering, the `streamText` inner loop, concurrency, persistence |
| 11 | [Context Engineering](./architecture/11-context-engineering.md) | Section × Provider model, cache frontier, budgeting, compaction and fork, tool-record normalization |
| 12 | [Tools](./architecture/12-tools.md) | Three-source merge, built-in tool catalog, fs/search/shell sandbox, skills, sub-agents |
| 13 | [Policy & Approval](./architecture/13-policy-and-approval.md) | `toolApproval` decision function, rule priority, permission modes, built-in guardrails, approval memory |
| 14 | [Hooks](./architecture/14-hooks.md) | Codex/Claude Code–compatible subprocess hooks: events, payload contract, trust model, settings |

### Platform Integration

| # | Document | Contents |
|---|---|---|
| 20 | [Providers](./architecture/20-providers.md) | `ProviderRuntime`, five adapters, model resolution, credential/secret security, provider options |
| 21 | [MCP](./architecture/21-mcp.md) | Server lifecycle, tool exposure, Elicitation round-trips, transports and reconnection |
| 22 | [Persistence](./architecture/22-persistence.md) | SQLite connection and migration framework, tables and ownership, message storage, recovery |
| 23 | [Workspace Integrations](./architecture/23-workspace-integrations.md) | Git, ChangeSet, Slash commands, file mentions, Usage/Activity, Pet boundaries |

### Frontend & Delivery

| # | Document | Contents |
|---|---|---|
| 30 | [Renderer](./architecture/30-renderer.md) | App shell, ChatSession, streaming, part-renderer registry, state layering, feature modules |
| 40 | [Build & Release](./architecture/40-build-and-release.md) | electron-vite entries, the typecheck gate, electron-builder, tests, CI |
| 50 | [Cross-Cutting](./architecture/50-cross-cutting.md) | Error model, logging, telemetry, security posture, i18n, theming |

## Documentation conventions

- Each document begins with its **scope** and a **last verified** note. Docs describe the current code, not
  historical designs or future plans.
- Claims carry **source coordinates** (`file:line` or a symbol name) wherever practical, to make them
  verifiable and resistant to drift.
- When you change the architecture, change the code first, then the docs. If a doc and the code disagree,
  **the code wins** — update the doc.
