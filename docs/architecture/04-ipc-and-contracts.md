# 04 · Cross-Process Contracts (IPC)

> Scope: the IPC router, `@shared` contracts, error encoding/decoding, and channel-naming conventions. Last
> verified against `src/preload/`, `src/main/ipc/router.ts`, `src/main/agent/ipc/`, `src/shared/` at v0.2.4.

## 1. The preload bridge

`src/preload/index.ts` assembles a single object `tanzoApi` (`index.ts:16-35`) and exposes it as
`window.electron` — the exposed name is literally `'electron'`, not `'tanzo'` — via
`contextBridge.exposeInMainWorld('electron', tanzoApi)` (`index.ts:39`), with a non-isolated fallback
`Object.assign(window, { electron: tanzoApi })` (`index.ts:44`). The type is exported as
`TanzoElectronAPI = typeof tanzoApi` (`index.ts:47`); the global `Window.electron` augmentation is in
`src/preload/index.d.ts`.

Namespaces (key → module → shared API type):

| Key | Module | Shared type |
|---|---|---|
| `...` (spread) | `src/preload/system.ts` | system: `platformInfo`, `getPlatform`, `getSystemPreferences`, `pickDirectory`, `onSystemPreferencesChanged`, `windowControls` |
| `preferences` | `src/preload/preferences.ts` | `PreferencesApi` |
| `mcp` | `src/preload/mcp.ts` | `McpApi` |
| `provider` | `src/preload/provider.ts` | `ProviderApi` |
| `chat` | `src/preload/agent.ts` | `ChatApi` |
| `policy` | `src/preload/agent.ts` | `PolicyApi` |
| `hooks` | `src/preload/hooks.ts` | `HooksApi` |
| `goal` | `src/preload/agent.ts` | `GoalApi` |
| `git` | `src/preload/agent.ts` | `GitApi` |
| `changeSet` | `src/preload/agent.ts` | `ChangeSetApi` |
| `activity` | `src/preload/agent.ts` | `ActivityApi` |
| `skills` | `src/preload/skills.ts` | `SkillApi` |
| `plugins` | `src/preload/plugins.ts` | `PluginApi` |
| `slashCommand` | `src/preload/slash-command.ts` | `SlashCommandApi` |
| `fileMention` | `src/preload/file-mention.ts` | `FileMentionApi` |
| `pet` | `src/preload/pet.ts` | `PetApi` |
| `browser` | `src/preload/browser.ts` | `BrowserControlApi` (receive-only) |
| `process` | `src/preload/index.ts:34` | `{ versions }` |

`chat`, `policy`, `goal`, `git`, `changeSet`, and `activity` all originate in the single file
`src/preload/agent.ts` and are re-exported through it.

## 2. The two primitives: `invoke()` / `subscribe()`

Every namespace is built purely from two helpers in `src/preload/invoke.ts` — there is no business logic in
preload:

- `invoke<F>(channel)` (`invoke.ts:3-5`): returns a typed function that calls
  `ipcRenderer.invoke(channel, ...args)` (request/response).
- `subscribe<T>(channel, callback)` (`invoke.ts:7-13`): calls `ipcRenderer.on(channel, listener)` and returns
  an unsubscribe closure that calls `ipcRenderer.off`.

## 3. `ipcMain` registration and de-duplication

`registerIpcHandlers(ipcMain, registrations, options)` (`src/main/ipc/router.ts:33-58`) makes registration
idempotent: a first loop removes every channel (`ipcMain.removeHandler(channel)`, `router.ts:38`) before a
second loop calls `ipcMain.handle` (`router.ts:40`); it returns a disposer that removes all channels again
(`router.ts:55-57`).

- `IpcRegistration` is a tuple `[channel, handler, options?]` with an optional `passEvent`; when set, the
  `IpcMainInvokeEvent` is forwarded to the handler (`router.ts:5-9,42`).
- Agent handlers are aggregated in `src/main/agent/ipc/index.ts`: `allHandlers(deps)` concatenates the
  `chat / goal / policy / hooks / skill / plugin / activity / git / changeSet` handler arrays
  (`ipc/index.ts:15-27`); `registerAgentIpc` wraps them with the `'agent.ipc'` logger and is invoked (after
  `unregisterIpc?.()`) in `src/main/agent/module.ts:452`.
- Non-agent domains self-register via the same router: `src/main/mcp/ipc.ts`, `src/main/provider/ipc.ts`,
  `src/main/slash-command/ipc.ts`, `src/main/file-mention/ipc.ts`. Preferences / system / pet register
  elsewhere in `main`.

## 4. Channel-naming conventions

Channels are colon-namespaced `domain:kebab-action`, and each constant is defined **once** in `@shared` and
imported by both processes:

`chat:*` (`src/shared/chat.ts`) · `provider:*` · `mcp:*` · `policy:*` · `git:*` · `goal:*` · `activity:*` ·
`hooks:*` · `skills:*` · `plugins:*` · `change-set:*` · `pet:*` · `slash-command:*` · `file-mention:*` ·
`browser:*` · `preferences:*` · `system:*`.

**Naming exception:** window controls use the `window:*` prefix (`window:minimize` / `toggle-maximize` /
`close` / `is-maximized`), defined alongside system in `src/shared/system.ts`.

Per-conversation channels are **derived, not static**: `chatEventChannel(id) = \`chat:event:${id}\`` and
`taskEventChannel(id) = \`chat:task-event:${id}\``; the global fan-in channel is
`chatAnyEventChannel() = 'chat:event'` (`src/shared/chat.ts`).

## 5. The `chat:*` streaming channel and payload

The base constant is `event: 'chat:event'`; the renderer subscribes per-chat via `chatEventChannel(chatId)`
and globally via `chatAnyEventChannel()`. The preload wiring (`onEvent` / `onAnyEvent` / `onTaskEvent`) is in
`src/preload/agent.ts`.

The payload type `ChatEvent` (`src/shared/chat.ts`) is a union of:

- `ChatRunFrame` — `{ kind: 'run-frame', chatId, runId, seq, chunk: InferUIMessageChunk<TanzoUIMessage> }`.
  The `chunk` is the AI SDK streaming chunk; `seq` is the monotonic sequence the renderer's frame gate uses to
  order and de-duplicate.
- `ChatRunStateEvent` — `{ kind: 'run-state', …, status, error? }`.
- `ChatNotificationEvent` — `{ kind: 'notification', chatId, chunk }` where the chunk is a
  `data-${string}` UI-message chunk.

**Emit side (main → renderer).** `createChatEventDeliverer` (`src/main/agent/module.ts:109-118`) sends
`chatEventChannel(event.chatId)` to each usable window and mirrors `run-state` events to
`chatAnyEventChannel()`. The chunk pipeline is `createChunkSink` (`module.ts:121-137`), which publishes into
the `ChatRunSessionRegistry` (24 ms delta batching) and delivers `notification` events; upstream chunks
originate at `src/main/agent/runtime/stream-runner.ts:439` via `deps.send(chatId, chunk, { runId })`. See
[10 Agent Runtime](./10-agent-runtime.md).

**Snapshot / replay.** `chat:run-snapshot` → `ChatApi.runSnapshot` returns a `ChatRunSnapshot`
(`baseMessages` + `notifications` + `frames`) so a reconnecting renderer can replay; the handler is
`deps.streams.snapshot(chatId)` (`src/main/agent/ipc/chat.ts`).

**Task stream.** `chat:task-event` carries a `TaskEvent` union (`{ type: 'tasks', … }` / `{ type: 'approvals',
… }`) emitted via `deps.sendTo(taskEventChannel(rootChatId), …)` from
`src/main/agent/subagent/task-service.ts`. This is how sub-agent progress reaches the UI. See
[12 Tools](./12-tools.md).

## 6. Error encoding/decoding across IPC

The cross-cutting error contract is `src/shared/errors.ts`:

- **Hierarchy.** Base `TanzoError { code, recoverable, details }` with subclasses `Invariant / Configuration /
  Validation / NotFound / Operation / Integration / Auth / Timeout` (`TanzoTimeoutError` defaults
  `recoverable: true`). A central `ERROR_CODES` registry names the codes.
- **Encode (main).** `serializeTanzoError` produces `{ code, message, recoverable, details? }` (non-Tanzo
  errors coerced to `UNEXPECTED_ERROR`); `encodeIpcError` wraps the JSON behind the marker prefix
  `__TANZO_IPC_ERROR__:` inside a plain `Error.message`. The router encodes both sync throws and rejected
  promises (`src/main/ipc/router.ts:46,51`).
- **Zod normalization.** `normalizeError` (`router.ts:24-31`) detects a `ZodError` and converts it to
  `TanzoValidationError('IPC_INPUT_INVALID', …)` before encoding. Because handler inputs are Zod-parsed, bad
  payloads surface uniformly as `IPC_INPUT_INVALID`.
- **Decode (renderer).** `decodeIpcError` parses the marker back into a `TanzoError` (or `null` if absent).
  The renderer wrappers `withDecodedIpcError` / `withDecodedIpcErrors`
  (`src/renderer/src/platform/electron/ipc-errors.ts`) re-throw `decodeIpcError(error) ?? error` for each
  client method. This round-trip is covered by `tests/unit/main/ipc/router.test.ts`.

## 7. Inventory of `@shared` contracts

Each file in `src/shared/` owns one contract, imported by both processes:

| File | Purpose |
|---|---|
| `chat.ts` | Chat/conversation contract: `CHAT_CHANNELS`, `ChatApi`, streaming `ChatEvent` / `ChatRunFrame` / `ChatRunSnapshot`, `TaskEvent`, channel helpers |
| `agent-message.ts` | `TanzoUIMessage` (extends AI SDK `UIMessage`), data-part types (`TanzoDataParts`), `AskQuestion*`, `QueuedMessage` — the type threaded through the whole seam |
| `subagent-task.ts` | Sub-agent task model: `SubagentTask`, statuses, approval views/responses/scopes |
| `policy.ts` | Permission policy: `POLICY_CHANNELS`, `PolicyApi`, `PolicyRule` / `PolicyMatch`, `PermissionMode`, user decisions |
| `provider.ts` | Model-provider control plane: `PROVIDER_CHANNELS`, `ProviderApi`, `PROVIDER_IDS`, model families/setups/keys |
| `mcp.ts` | MCP servers: `MCP_CHANNELS`, `McpApi`, connection states, elicitation request/result types |
| `git.ts` | Git domain: `GIT_CHANNELS`, `GitApi`, `gitEventChannel`, `GitChangedEvent`, status/diff/branch/remote types (wraps results in `GitResult<T>` rather than throwing) |
| `change-set.ts` | Change-set diff/apply: `CHANGE_SET_CHANNELS`, `ChangeSetApi`, `ChangePreviewData` |
| `goal.ts` | Thread goal: `GOAL_CHANNELS`, `GoalApi`, `ThreadGoalStatus`, budget fields |
| `activity.ts` | Activity/analytics: `ACTIVITY_CHANNELS`, `ActivityApi`, summary/trend/reliability/run types |
| `hooks.ts` | Lifecycle hooks: `HOOK_EVENTS`, `HOOKS_CHANNELS`, `HooksApi` |
| `skills.ts` | Skills registry: `SKILL_CHANNELS`, `SkillApi` |
| `plugins.ts` | Plugins + marketplaces: `PLUGIN_CHANNELS`, `PluginApi` |
| `slash-command.ts` | Slash commands: `SLASH_COMMAND_CHANNELS`, `SlashCommandApi`, `SlashCommandDef` |
| `file-mention.ts` | `@`-mention search: `FILE_MENTION_CHANNELS`, `FileMentionApi`, `FileMentionEntry` |
| `pet.ts` | Desktop-pet window: `PET_CHANNELS`, `PetApi`, presence payload, hit-rect/drag/position |
| `browser-control.ts` | Built-in browser panel: `BROWSER_CHANNELS`, `BrowserOpenRequest` (main asks the renderer to open a URL; MCP/CDP drives the page) |
| `system.ts` | OS/window integration: `SYSTEM_CHANNELS` (+ `window:*` controls), platform/system-preference types |
| `preferences.ts` | User preferences/theming: `PREFERENCES_CHANNELS`, `UserPreferences` / `PreferencesPatch`, theme/radius/density/font presets |
| `approval-responses.ts` | Pure helpers to apply `ChatApprovalResponse` onto tool UI parts (no channels) |
| `tool-catalog.ts` | Catalog of user-toggleable built-in tools grouped by category (pure data, no channels) |
| `errors.ts` | The error contract: `TanzoError` hierarchy, `ERROR_CODES`, `encodeIpcError` / `decodeIpcError` |

Next → [10 Agent Runtime](./10-agent-runtime.md)
