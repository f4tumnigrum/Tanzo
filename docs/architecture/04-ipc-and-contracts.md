# 04 · 跨进程契约

> 适用范围：IPC 路由、`@shared` 契约、错误编解码、通道命名。最后核对：`src/main/ipc/router.ts`、`src/shared/*`、`src/preload/*`。

## 1. 通道命名约定

所有 IPC 通道名都是 `"<domain>:<kebab-action>"` 字符串常量，**只在 `src/shared/<domain>.ts` 定义一次**（`as const` 对象），main 与 renderer 共引，绝不内联硬编码。

```ts
// src/shared/chat.ts:93
export const CHAT_CHANNELS = {
  submit: 'chat:submit',
  editMessage: 'chat:edit-message',
  respondApprovals: 'chat:respond-approvals',
  cancel: 'chat:cancel',
  steer: 'chat:steer',
  enqueue: 'chat:enqueue',
  // ...共 34 个
  event: 'chat:event',
} as const
```

特例：
- 窗口控制用 `window:` 前缀（`SYSTEM_CHANNELS`）。
- 每对话事件通道带 id 后缀：`chatEventChannel(id)` → `chat:event:<id>`（`chat.ts:133`）；`chatAnyEventChannel()` → `chat:event`（`chat.ts:132`）。
- **推送通道**（main→renderer，经 `webContents.send`）：`chat:event[:id]`、`mcp:connection-states-changed`、`mcp:elicitation-requested`、`system:preferences-changed`、`preferences:changed`、`pet:presence-changed`、`git:event`。renderer 侧一律用 `subscribe()` 消费；`hooks:*` 当前均为 invoke。

## 2. IPC 路由：`registerIpcHandlers`

新模块统一经 `src/main/ipc/router.ts:29` 的 `registerIpcHandlers(ipcMain, registrations, options)` 注册：

```ts
type IpcHandler = (...args: unknown[]) => unknown
type IpcRegistration = readonly [channel: string, handler: IpcHandler]
registerIpcHandlers(ipcMain, registrations, opts): () => void  // 返回 unregister
```

要点：

1. **幂等**：注册前先移除该通道已有 handler，重复注册安全。
2. **错误归一化**：每个 handler 被包裹，同步抛出与 Promise reject 都经 `normalizeError → encodeIpcError`。Zod 错误（`name === 'ZodError'`）被转成 `TanzoValidationError('IPC_INPUT_INVALID', ...)`，renderer 收到结构化、可序列化的错误而非裸栈。
3. **校验在调用点**：handler 自己用 Zod `parse` 入参再委派给 service；路由只负责捕获与归一化，不做校验。
4. 返回的 `unregister` 闭包被模块存住，在 `close()` 或重注册前调用。

旧的独立模块（system、preferences、wallpaper、pet-window、pet-assets）直接调 `ipcMain.handle`。

## 3. 错误编解码（`src/shared/errors.ts`）

跨进程错误系统是一条横切契约：

- `TanzoError` 基类（`errors.ts:7`）带 `code`、`recoverable`、`details`，子类含 `Invariant`/`Configuration`/`Validation`/`NotFound`/`Operation`/`Integration`/`Auth`/`Timeout`（`Timeout` 默认 `recoverable: true`）。
- `ERROR_CODES` 是集中注册表（`errors.ts:69`）。
- 编解码：`encodeIpcError` / `decodeIpcError`（`errors.ts:140-157`），标记前缀 `__TANZO_IPC_ERROR__:` + JSON。renderer 侧 `platform/electron/ipc-errors.ts` 的 `withDecodedIpcError(s)` 包裹每个客户端方法，把 main 抛出的错误还原成 `TanzoError`。

## 4. Preload 桥接

### 4.1 两个原语（`src/preload/invoke.ts`）

```ts
invoke<F>(channel): F                          // 包 ipcRenderer.invoke
subscribe<T>(channel, cb): () => void          // 包 ipcRenderer.on，返回 disposer
```

每个 domain API 都只由这两者构成。`invoke` 请求/响应；`subscribe` 消费推送通道并返回反订阅函数。

### 4.2 桥对象（`src/preload/index.ts`）

```ts
const tanzoApi = {
  ...systemApi,            // platformInfo, getPlatform, windowControls, pickDirectory…
  preferences, mcp, provider, chat, policy, hooks, goal, git, changeSet,
  activity, skills, slashCommand, fileMention, pet,
  process: { versions: process.versions }
}
contextBridge.exposeInMainWorld('electron', tanzoApi)   // 上下文隔离时
export type TanzoElectronAPI = typeof tanzoApi
```

`index.d.ts` 把 `Window.electron: TanzoElectronAPI` 注入类型——renderer 的强类型句柄。每个 domain 的 preload 模块导入对应 `*_CHANNELS` 与 `*Api` 类型，构造出受该 `Api` 约束的对象，保证桥不会偏离契约。

## 5. `@shared` 核心契约

`src/shared/` 共 19 个文件，定义跨进程边界。模式：每个 domain 一个 `*_CHANNELS` 常量 + 数据接口 + 在 preload 实现、在 main 服务的 `*Api` 接口。`hooks.ts` 是其中一个完整 domain（list/reload/setEnabled/setTrusted/preview）。

### 5.1 消息物质（`agent-message.ts`）—— 系统骨架

```ts
export type TanzoUIMessage = UIMessage<TanzoMetadata, TanzoDataParts, TanzoToolUI>   // :419
```

- **`TanzoTools`（`:58`）—— 工具词汇**：每个工具的 `{ input, output }` 类型。含 `fileRead/fileEdit/multiEdit/fileWrite/glob/grep/shell/shellStart/shellPoll/shellWrite/shellStop/shellList/spawn/await/tasks/steer/cancel/report/skill/web_search/updateGoal/askQuestion/todo/exitPlanMode`。`ToolError = { error: true; message: string }` 是统一失败变体。`TanzoToolUI = TanzoTools`。
- **`TanzoDataParts`（`:264`）—— 数据 part 词汇**（流式 `data-*`）：`plan/fileDiff/changePreview/status/task/taskApproval/compaction/context/steering/queued/goal/telemetry`。`telemetry` part 是富事件信封（operation/step/model/tool/retry/error 生命周期）。
- **`TanzoMetadata`（`:413`）**：`createdAt`、`usage`、逐步 `steps`。

**类型贯穿**：`TanzoUIMessage` 同时参数化了 renderer 状态、`chat:event` 帧载荷（`ChatRunFrame.chunk` 即 `InferUIMessageChunk<TanzoUIMessage>`）、main 流与持久化校验。定义一次，整链路被锁死。

### 5.2 对话生命周期（`chat.ts`）

- 流事件：`ChatEvent = ChatRunFrame | ChatRunStateEvent | ChatNotificationEvent`（`:179`）。`ChatRunSnapshot`（`:181`）让 renderer 在 run 中途重同步（baseMessages + notifications + frames）。
- 会话：`ConversationSummary`、`NewConversationInput`、`ForkConversationInput/Result`、`AgentSummary`/`AgentKind`。
- 审批/问答：`ChatApprovalResponse`（`:193`）、`SubagentApprovalScope = 'once'|'session'|'forever'`（`:191`，即 `subagent-task.ts` 的 `SubagentTaskApprovalScope` 别名）、`PendingQuestion`（`:200`）。
- `ChatApi`（`:210`）是完整调用面。

### 5.3 其它 domain 契约

| 文件 | 关键类型 / 作用 |
|---|---|
| `provider.ts` | `PROVIDER_CHANNELS`、`ProviderId`(5)、`ModelFamily`、`ProviderConfig`、`ProviderKeySummary`(只带 `maskedKey`)、`ProviderOptionSchema`、`ProviderCapabilities` |
| `mcp.ts` | `MCP_CHANNELS`、`McpServerConfig`、`McpConnectionState`、`McpTool`、`McpElicitationRequest`/`McpElicitResult` |
| `policy.ts` | `POLICY_CHANNELS`、`PolicyRule`(action `allow/deny/ask`)、`PolicyMatch`、`PermissionMode = default/plan/yolo/dangerous`、re-export ai-sdk `ToolApprovalStatus` |
| `hooks.ts` | `HOOKS_CHANNELS`、Codex/Claude 事件集合、`HookEntrySummary`、`HookPreviewResult`、`HooksApi` |
| `goal.ts` | `GOAL_CHANNELS`、`ThreadGoal`、`deriveStatus(goal)` 共享派生逻辑 |
| `git.ts` | `GIT_CHANNELS`(27 op，含 `watch`/`unwatch`)、`GitResult<T> = {ok:true;data}|{ok:false;code;message}`（不跨 IPC 抛异常）、`GitOverview`、`GitDiffInput` |
| `change-set.ts` | `CHANGE_SET_CHANNELS`、`ChangePreviewData`(检查点/树 OID/恢复风险分级) |
| `activity.ts` | `ACTIVITY_CHANNELS`、`ActivitySummary`/`ActivityKpis`/`ActivityRunDetail`（只读分析） |
| `skills.ts` | `SKILL_CHANNELS`、`SkillSummary`/`SkillDetail`、`SkillScope`(user/workspace/builtin) |
| `preferences.ts` | `PREFERENCES_CHANNELS`(含 `changed` 推送)、`UserPreferences`、`PreferencesPatch`、默认值与边界常量 |
| `system.ts` | `SYSTEM_CHANNELS`(含 `window:*`)、`ElectronPlatformInfo`、`detectNativeWindowEffect` |
| `approval-responses.ts` | 纯共享逻辑 `applyApprovalResponses(messages, responses)`：把 `approval-requested` 工具 part 迁移到 `approval-responded` |
| `file-mention.ts` / `slash-command.ts` | 各一通道 + 共享解析逻辑（`parseSlashInput`、`expandTemplate`） |
| `pet.ts` | `PET_CHANNELS`、`PetPresenceState`、spritesheet 元数据 |
| `subagent-task.ts` | `SubagentTask`、`SubagentTaskApproval*`、`SubagentTaskApprovalScope`（`chat.ts` 与审批链路依赖） |
| `errors.ts` | 见 §3 |

## 6. 契约不变量

- [ ] 通道名只在 `@shared` 定义一次，两进程共引。
- [ ] 所有跨 IPC 错误经 `encodeIpcError`/`decodeIpcError`，保留 `code`/`recoverable`/`details`；Zod 失败 → `IPC_INPUT_INVALID`。
- [ ] 凭证/密钥不以明文跨 IPC（见 [20 供应商](./20-providers.md)）。
- [ ] `TanzoUIMessage` 是 renderer 状态、流帧、持久化校验的同一类型。
- [ ] preload 仅由 `invoke`/`subscribe` 构成，无业务逻辑。

下一篇 → [10 Agent 运行时](./10-agent-runtime.md)
