# 04 · 跨进程契约（IPC）

> 适用范围：IPC 路由、`@shared` 契约、错误编解码、通道命名约定。最后核对：`src/preload/`、`src/main/ipc/router.ts`、`src/main/agent/ipc/`、`src/shared/`（v0.2.4）。

## 1. preload 桥

`src/preload/index.ts` 组装单一对象 `tanzoApi`（`index.ts:16-35`），并以 `window.electron` 暴露——暴露名字面就是 `'electron'` 而非 `'tanzo'`——经 `contextBridge.exposeInMainWorld('electron', tanzoApi)`（`index.ts:39`），并有非隔离回退 `Object.assign(window, { electron: tanzoApi })`（`index.ts:44`）。类型导出为 `TanzoElectronAPI = typeof tanzoApi`（`index.ts:47`）；全局 `Window.electron` 增强在 `src/preload/index.d.ts`。

命名空间（键 → 模块 → 共享 API 类型）：

| 键 | 模块 | 共享类型 |
|---|---|---|
| `...`（展开） | `src/preload/system.ts` | system：`platformInfo`、`getPlatform`、`getSystemPreferences`、`pickDirectory`、`onSystemPreferencesChanged`、`windowControls` |
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
| `browser` | `src/preload/browser.ts` | `BrowserControlApi`（只收） |
| `process` | `src/preload/index.ts:34` | `{ versions }` |

`chat`、`policy`、`goal`、`git`、`changeSet`、`activity` 都出自单文件 `src/preload/agent.ts` 并由其再导出。

## 2. 两个原语：`invoke()` / `subscribe()`

每个命名空间都只由 `src/preload/invoke.ts` 的两个助手构成——preload 无业务逻辑：

- `invoke<F>(channel)`（`invoke.ts:3-5`）：返回类型化函数，调用 `ipcRenderer.invoke(channel, ...args)`（请求/响应）。
- `subscribe<T>(channel, callback)`（`invoke.ts:7-13`）：`ipcRenderer.on(channel, listener)`，返回调用 `ipcRenderer.off` 的取消订阅闭包。

## 3. ipcMain 注册与去重

`registerIpcHandlers(ipcMain, registrations, options)`（`src/main/ipc/router.ts:33-58`）使注册幂等：第一趟循环移除每个通道（`ipcMain.removeHandler(channel)`，`router.ts:38`），第二趟再 `ipcMain.handle`（`router.ts:40`）；返回一个再次移除所有通道的 disposer（`router.ts:55-57`）。

- `IpcRegistration` 是元组 `[channel, handler, options?]`，带可选 `passEvent`；设置时把 `IpcMainInvokeEvent` 转发给 handler（`router.ts:5-9,42`）。
- Agent handlers 聚合在 `src/main/agent/ipc/index.ts`：`allHandlers(deps)` 拼接 `chat / goal / policy / hooks / skill / plugin / activity / git / changeSet` 数组（`ipc/index.ts:15-27`）；`registerAgentIpc` 用 `'agent.ipc'` logger 包裹，在 `src/main/agent/module.ts:452`（先 `unregisterIpc?.()`）调用。
- 非 agent 域用同一路由自注册：`src/main/mcp/ipc.ts`、`src/main/provider/ipc.ts`、`src/main/slash-command/ipc.ts`、`src/main/file-mention/ipc.ts`。preferences / system / pet 在 main 别处注册。

## 4. 通道命名约定

通道用冒号命名空间 `domain:kebab-action`，每个常量在 `@shared` **定义一次**，两进程共引：

`chat:*`（`src/shared/chat.ts`）· `provider:*` · `mcp:*` · `policy:*` · `git:*` · `goal:*` · `activity:*` · `hooks:*` · `skills:*` · `plugins:*` · `change-set:*` · `pet:*` · `slash-command:*` · `file-mention:*` · `browser:*` · `preferences:*` · `system:*`。

**命名例外**：窗口控制用 `window:*` 前缀（`window:minimize` / `toggle-maximize` / `close` / `is-maximized`），与 system 一起定义在 `src/shared/system.ts`。

每对话通道是**派生的、非静态**：`chatEventChannel(id) = \`chat:event:${id}\``、`taskEventChannel(id) = \`chat:task-event:${id}\``；全局汇聚通道 `chatAnyEventChannel() = 'chat:event'`（`src/shared/chat.ts`）。

## 5. `chat:*` 流式通道与载荷

基础常量 `event: 'chat:event'`；renderer 按对话经 `chatEventChannel(chatId)` 订阅，全局经 `chatAnyEventChannel()` 订阅。preload 接线（`onEvent` / `onAnyEvent` / `onTaskEvent`）在 `src/preload/agent.ts`。

载荷类型 `ChatEvent`（`src/shared/chat.ts`）是以下联合：

- `ChatRunFrame` —— `{ kind: 'run-frame', chatId, runId, seq, chunk: InferUIMessageChunk<TanzoUIMessage> }`。`chunk` 是 AI SDK 流式 chunk；`seq` 是 renderer 帧门用来排序去重的单调序号。
- `ChatRunStateEvent` —— `{ kind: 'run-state', …, status, error? }`。
- `ChatNotificationEvent` —— `{ kind: 'notification', chatId, chunk }`，其 chunk 为 `data-${string}` 的 UI-message chunk。

**发射侧（main → renderer）。** `createChatEventDeliverer`（`src/main/agent/module.ts:109-118`）把 `chatEventChannel(event.chatId)` 发给每个可用窗口，并把 `run-state` 事件镜像到 `chatAnyEventChannel()`。chunk 管线是 `createChunkSink`（`module.ts:121-137`），先入 `ChatRunSessionRegistry`（24ms delta 批处理）再投递 notification；上游 chunk 起自 `src/main/agent/runtime/stream-runner.ts:439` 的 `deps.send(chatId, chunk, { runId })`。详见 [10 Agent 运行时](./10-agent-runtime.md)。

**快照 / 重放。** `chat:run-snapshot` → `ChatApi.runSnapshot` 返回 `ChatRunSnapshot`（`baseMessages` + `notifications` + `frames`）供重连 renderer 重放；handler 是 `deps.streams.snapshot(chatId)`（`src/main/agent/ipc/chat.ts`）。

**任务流。** `chat:task-event` 承载 `TaskEvent` 联合（`{ type: 'tasks', … }` / `{ type: 'approvals', … }`），从 `src/main/agent/subagent/task-service.ts` 经 `deps.sendTo(taskEventChannel(rootChatId), …)` 发出——子代理进度即由此到 UI。详见 [12 工具系统](./12-tools.md)。

## 6. 跨 IPC 的错误编解码

跨切错误契约是 `src/shared/errors.ts`：

- **层级。** 基类 `TanzoError { code, recoverable, details }`，子类 `Invariant / Configuration / Validation / NotFound / Operation / Integration / Auth / Timeout`（`TanzoTimeoutError` 默认 `recoverable: true`）。中心化 `ERROR_CODES` 注册表命名各码。
- **编码（main）。** `serializeTanzoError` 产出 `{ code, message, recoverable, details? }`（非 Tanzo 错误强制为 `UNEXPECTED_ERROR`）；`encodeIpcError` 把 JSON 藏在标记前缀 `__TANZO_IPC_ERROR__:` 后放进普通 `Error.message`。路由对同步抛出与 promise 拒绝都编码（`src/main/ipc/router.ts:46,51`）。
- **Zod 规整。** `normalizeError`（`router.ts:24-31`）检测 `ZodError` 并转成 `TanzoValidationError('IPC_INPUT_INVALID', …)` 再编码。因所有 handler 入参经 Zod 解析，坏载荷统一表现为 `IPC_INPUT_INVALID`。
- **解码（renderer）。** `decodeIpcError` 把标记解析回 `TanzoError`（不存在则 `null`）。renderer 包装器 `withDecodedIpcError` / `withDecodedIpcErrors`（`src/renderer/src/platform/electron/ipc-errors.ts`）对每个客户端方法重抛 `decodeIpcError(error) ?? error`。此往返由 `tests/unit/main/ipc/router.test.ts` 覆盖。

## 7. `@shared` 契约清单

`src/shared/` 下每个文件承载一份契约，两进程共引：

| 文件 | 用途 |
|---|---|
| `chat.ts` | 对话契约：`CHAT_CHANNELS`、`ChatApi`、流式 `ChatEvent` / `ChatRunFrame` / `ChatRunSnapshot`、`TaskEvent`、通道助手 |
| `agent-message.ts` | `TanzoUIMessage`（扩展 AI SDK `UIMessage`）、数据 part 类型（`TanzoDataParts`）、`AskQuestion*`、`QueuedMessage`——贯穿整条缝的类型 |
| `subagent-task.ts` | 子代理任务模型：`SubagentTask`、状态、审批视图/响应/作用域 |
| `policy.ts` | 权限策略：`POLICY_CHANNELS`、`PolicyApi`、`PolicyRule` / `PolicyMatch`、`PermissionMode`、用户决策 |
| `provider.ts` | 模型供应商控制面：`PROVIDER_CHANNELS`、`ProviderApi`、`PROVIDER_IDS`、模型族/配置/密钥 |
| `mcp.ts` | MCP 服务器：`MCP_CHANNELS`、`McpApi`、连接状态、elicitation 请求/结果类型 |
| `git.ts` | Git 域：`GIT_CHANNELS`、`GitApi`、`gitEventChannel`、`GitChangedEvent`、状态/diff/分支/远端类型（用 `GitResult<T>` 包裹而非抛出） |
| `change-set.ts` | 变更集 diff/应用：`CHANGE_SET_CHANNELS`、`ChangeSetApi`、`ChangePreviewData` |
| `goal.ts` | 线程目标：`GOAL_CHANNELS`、`GoalApi`、`ThreadGoalStatus`、预算字段 |
| `activity.ts` | 活动/分析：`ACTIVITY_CHANNELS`、`ActivityApi`、汇总/趋势/可靠性/运行类型 |
| `hooks.ts` | 生命周期钩子：`HOOK_EVENTS`、`HOOKS_CHANNELS`、`HooksApi` |
| `skills.ts` | 技能注册：`SKILL_CHANNELS`、`SkillApi` |
| `plugins.ts` | 插件 + 市场：`PLUGIN_CHANNELS`、`PluginApi` |
| `slash-command.ts` | 斜杠命令：`SLASH_COMMAND_CHANNELS`、`SlashCommandApi`、`SlashCommandDef` |
| `file-mention.ts` | `@` 提及检索：`FILE_MENTION_CHANNELS`、`FileMentionApi`、`FileMentionEntry` |
| `pet.ts` | 桌宠窗口：`PET_CHANNELS`、`PetApi`、presence 载荷、命中矩形/拖拽/位置 |
| `browser-control.ts` | 内置浏览器面板：`BROWSER_CHANNELS`、`BrowserOpenRequest`（main 请 renderer 开 URL；MCP/CDP 驱动页面） |
| `system.ts` | OS/窗口集成：`SYSTEM_CHANNELS`（+ `window:*` 控制）、平台/系统偏好类型 |
| `preferences.ts` | 用户偏好/主题：`PREFERENCES_CHANNELS`、`UserPreferences` / `PreferencesPatch`、主题/圆角/密度/字体预设 |
| `approval-responses.ts` | 把 `ChatApprovalResponse` 应用到工具 UI part 的纯助手（无通道） |
| `tool-catalog.ts` | 按类目分组的可切换内置工具目录（纯数据，无通道） |
| `errors.ts` | 错误契约：`TanzoError` 层级、`ERROR_CODES`、`encodeIpcError` / `decodeIpcError` |

下一篇 → [10 Agent 运行时](./10-agent-runtime.md)
