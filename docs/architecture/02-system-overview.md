# 02 · System Overview

> Scope: high-level components and end-to-end data flow. Last verified against `src/` at v0.2.4.

## 1. Three-process component map

```text
┌─────────────────────────── RENDERER (React 19) ──────────────────────────┐
│  index.html → main.tsx → App        pet.html → pet.tsx → PetApp           │
│                                                                            │
│  App shell: QueryClient · ThemeProvider · i18n · HashRouter · resizable UI │
│  Top-level routes:  / (Chat, keep-alive) · /settings                       │
│  features/  chat · git · mcp · providers · settings · skills · plugins ·   │
│             usage · browser · pet                                          │
│  State layers:  ChatSession (external store: live messages/stream) ·       │
│             react-query (data owned by main) · zustand (local UI state) ·  │
│             preferences (hydrated from main)                               │
│  platform/electron/*  the only layer that touches window.electron          │
│                              │                                             │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │  contextBridge: window.electron
┌──────────────────────────────┼────────────────────── PRELOAD ────────────┐
│  index.ts assembles tanzoApi = { ...system, preferences, mcp, provider,   │
│    chat, policy, hooks, goal, git, changeSet, activity, skills, plugins,  │
│    slashCommand, fileMention, pet, browser }                              │
│                       —— all built from two primitives: invoke() /         │
│                          subscribe()                                       │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │  ipcMain.handle / webContents.send
┌──────────────────────────────┼─────────────────────── MAIN (Node) ────────┐
│  index.ts bootstrap: single-instance lock → protocol registration →       │
│                       reserve loopback port → whenReady → module chain     │
│                                                                            │
│  agent/      createAgentModule  ← the system core                         │
│    service (mailbox/entry) · runtime/ (RunEngine, TurnLoop, streamText,   │
│      stream batching) · context/ (Section × Provider, compaction) ·        │
│    tools/ (builtin + MCP + provider merge) · policy + hooks (pre-tool      │
│      gate) · subagent/ · skills/ · plugins/ · goal/ · presence/ ·          │
│    telemetry/ · repositories/ · ipc/                                       │
│  provider/   createProviderModule  ProviderRuntime + 5 adapters + secrets  │
│  mcp/        createMcpModule        MCP client lifecycle + Elicitation      │
│  database/   createDatabaseModule   better-sqlite3 (WAL) + migrations       │
│  preferences · system · wallpaper · file-mention · slash-command · pet      │
│                                                                            │
│  SQLite (single source of truth): workspaces / conversations /            │
│    messages (append-log) + message_revisions + compaction_overlays /       │
│    runs / run_steps / provider_* / mcp_servers / policy_* / skill_states /  │
│    app_settings (incl. hooks state) / plugin_* / ...                       │
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. The module-factory convention

Every `main` subsystem follows the same three-part factory shape:

```ts
createXxxModule(deps) → { service?, registerIpc(ipcMain): void, close?(): void | Promise<void> }
```

- `registerIpc` is **idempotent**: internally it calls `unregister?.()` before registering, and the router
  (`registerIpcHandlers`, `src/main/ipc/router.ts:33`) also de-duplicates by removing each channel before
  handling, so repeated registration is safe.
- Dependencies are injected explicitly through `deps`: `createAgentModule` consumes `providerModule.service`,
  `mcpModule.service`, and `databaseModule.db`, expressing a clear dependency direction
  (`src/main/index.ts:235`).
- Teardown order is deliberately choreographed in `before-quit`: pet window → light modules → agent/mcp
  (awaited) → provider → database last (`src/main/index.ts:318`). See [03 Process Model](./03-process-model.md).

## 3. End-to-end data flow (one conversation turn)

Taking a user sending a message as the example, threading through every subsystem:

```text
[renderer] Composer.handleSubmit
   → chatClient.submit(chatId, TanzoUIMessage)            (platform/electron/chat-client.ts)
   → window.electron.chat.submit                          (preload, invoke 'chat:submit')
─────────────────────────────────────────────────────────── IPC ──────────
[main] ipc/chat.ts (zod validate) → service.submitMessage
   → mailbox.enqueue(chatId, …)                           (serial per conversation)
   → subagent conversation? background-driven : service.run(chatId, messages)
   → TurnLoop.run (≤10 passes): resolve def → save messages
        → changeSet.captureBeforeRun → compaction.prepareMessages (may compact history)
        → RunEngine.run / startChatRun:
             buildTools → buildAgentCall({ model, tools, toolApproval, stopWhen })
             → streamText({ ...agentCall, prepareStep → contextEngine.build })
             → onStepEnd / onEnd → persist messages
             → for await chunk: deps.send(chatId, chunk, { runId })
─────────────────────────────────────────────────────────── IPC ──────────
[main→renderer] run-session-registry batches delta chunks (24 ms window)
   → webContents.send(chat:event:<chatId>, ChatEvent)
[renderer] run-stream.ts frame gate enforces ordering
   → readUIMessageStream rebuilds TanzoUIMessage
   → ChatSession updates state → useSyncExternalStore → components re-render
   → AssistantMessage dispatches each part.type to the render registry
```

When approval is required, this loop stops naturally, the approval-request part streams back, the user's
response is written into the message, and `submit` fires again — `main` re-runs with the full history.
Approval, multi-step, and tool feedback are all self-contained inside this loop. See
[10 Agent Runtime](./10-agent-runtime.md) and [13 Policy & Approval](./13-policy-and-approval.md).

## 4. Tech-stack quick reference

| Concern | Choice | Location |
|---|---|---|
| Desktop shell | Electron 41 + electron-vite 6 | `electron.vite.config.ts` |
| Agent substrate | `ai@7` `streamText` / `tool()` / `UIMessage` | `src/main/agent/` |
| Model providers | `@ai-sdk/{anthropic,openai,openai-compatible,google,deepseek,mcp}` | `src/main/provider/`, `src/main/mcp/` |
| Persistence | `better-sqlite3` (WAL) | `src/main/database/` |
| Code search | `@vscode/ripgrep` | `src/main/agent/search/`, `src/main/file-mention/` |
| UI framework | React 19 + `react-router-dom@7` (HashRouter) | `src/renderer/src/` |
| Server state | `@tanstack/react-query` | each feature's `model/queries.ts` |
| Local UI state | `zustand` + a custom `ChatSession` external store | `features/*/model/` |
| Stream rebuild | `readUIMessageStream` (AI SDK) + a custom frame gate | `platform/electron/run-stream.ts` |
| Embedded settings pages | Skills / Plugins / Providers / MCP / Usage embedded as Settings sections | `features/settings/model/sections.tsx` |
| i18n | `i18next` + `react-i18next` (en / zh-CN) | `src/renderer/src/locales/` |
| Theming | CSS variables + presets, state stored in preferences | `src/renderer/src/common/theme/` |

The full tech stack, versions, and build chain are in [40 Build & Release](./40-build-and-release.md).

Next → [03 Process Model](./03-process-model.md)
