# 21 · MCP 集成

> 适用范围：Model Context Protocol 服务器生命周期、传输与重连、工具暴露、Elicitation 往返、存储。最后核对：`src/main/mcp/*` 与 `src/shared/mcp.ts`（v0.2.4）。

## 1. 模块与生命周期

`createMcpModule({ db, getWindows, remoteDebuggingPort })` 在 `McpClient` 之上构建 `McpService`。`McpModule.initialize()`（`mcp/module.ts:176-180`）跑 `service.syncFromStore()` → `client.syncServers(mergedServers())`，然后订阅连接状态变化并经 `MCP_CHANNELS.connectionStatesChanged` 广播给所有窗口。它在 UI 起来后异步触发（见 [03 进程模型](./03-process-model.md)）。

`syncServers`（`mcp/client.ts:197-246`）把期望服务器列表对齐到活动连接：已移除的断开；已禁用的断开但保 `disconnected` 状态；未变的已连保持不动；新增或变更的连接。所有按服务器操作经 `#withServerOperation`（按名链式 promise 队列）串行化。

**连接**（`client.ts:496-593`）：状态 → `connecting`；构建传输；在 120 秒超时内调 `createMCPClient({ transport, clientName, version, capabilities: { elicitation: {} }, onUncaughtError })`；注册 elicitation handler；成功则存连接并置状态 → `connected`（并刷新工具计数）；失败则置状态 → `error` 并按需调度重连。

**断开**（`client.ts:617-643`）：`connection.client.close()`，随后移除状态或保为 `disconnected`（保留 `serverInfo` / `instructions`）。

## 2. 传输（`mcp/transport.ts`）

`createMcpTransport(config)` 支持：

- **stdio**：展开环境变量（`mcp/env.ts`），经 `safeChildEnv` 剥离敏感键，Windows 上把 `.bat` / `.cmd` 解析为 `cmd.exe /d /c <script>` 并拦截含 CMD 元字符的参数。从 `@ai-sdk/mcp/mcp-stdio` 创建 `Experimental_StdioMCPTransport`，`stderr: 'inherit'` 及解析后的 cwd。
- **http / sse**：展开环境，校验 URL 协议为 `http(s)`，返回 `{ type, url, headers, redirect }`（默认 `redirect: 'error'`）传给 `createMCPClient`。对外网字段（url、headers）只展开非敏感环境变量。

## 3. 重连（`mcp/client.ts:645-693`）

- **仅远程传输**（`http` / `sse`）自动重连；stdio **不**自动重连。
- 指数退避 `delay = min(1000 × 2^(attempt-1), 30000)`，上限 `MAX_RECONNECT_ATTEMPTS = 5`；耗尽后状态变 `error`（"Reconnect attempts exhausted"）。
- 手动 `reconnectServer(name)` 重置计数并以 `throwOnFailure: true` 重连。

## 4. 工具暴露

`toolsForServer(serverName)`（`client.ts:325-331`）：按需确保服务器已连，用游标分页循环（有防失控分页守护）列出其全部工具，并经 `connection.client.toolsFromDefinitions(...)` 把定义包装成 Vercel AI SDK 的 `ToolSet`。MCP 层不跨服务器合并——由 agent 工具注册表完成，键名以 `mcp__<server>__<tool>` 命名空间，并从各工具的 `readOnlyHint` / `destructiveHint` 注解推导审批 `kind`。详见 [12 工具系统](./12-tools.md)。

## 5. Elicitation 往返

当服务器需要用户输入时，它发一个 elicitation 请求。流程（`mcp/module.ts:131-164`）：

1. SDK 客户端的 `onElicitationRequest` handler 以 `{ serverName, message, requestedSchema }` 触发。
2. 模块生成 UUID `requestId`，把 promise resolver 存入 `pendingElicitations`，并向主窗口发 `MCP_CHANNELS.elicitationRequested`。无窗口时立即以 `{ action: 'cancel' }` 解决。
3. 超时（`DEFAULT_ELICITATION_TIMEOUT_MS = 5 × 60_000`）到期以 `{ action: 'cancel' }` 解决。
4. renderer 经 `MCP_CHANNELS.resolveElicitation` 用 `(requestId, result)` 回复；IPC handler 校验 id 与 `result` 并调 `resolveElicitation`，清定时器并解决 promise。MCP SDK 收到 `{ action: 'accept' | 'decline' | 'cancel', content? }`。

renderer 宿主是 `McpElicitationHost`（见 [30 渲染层](./30-renderer.md)）。

## 6. 存储与服务器合并

MCP 服务器存在 `mcp_servers` SQLite 表（`mcp/store.ts`），列含 `id`、`name`（UNIQUE）、`transport`（`stdio | sse | http`）、`command`、`args_json`、`cwd`、`url`、`headers_json`、`redirect`、`env_json`、`enabled`。数组/对象字段为 JSON blob，经 `z.safeParse` 复解析。`sanitizeServerForTransport` 剥去与传输无关的列（如 http/sse 无 `command`）。校验要求 name、stdio 要 `command`、http/sse 要 `url`（重名抛 `MCP_SERVER_NAME_DUPLICATE`）。详见 [22 持久化](./22-persistence.md)。

服务器合并优先级（`mcp/service.ts`）：用户定义的 DB 服务器赢所有重名冲突，其次插件服务器（`setPluginServers`），再次内置服务器（`setBuiltinServers`）。

**内置浏览器服务器**（`mcp/module.ts`）：当 `remoteDebuggingPort > 0`，注册一个 `chrome-devtools` stdio 服务器，运行 `npx chrome-devtools-mcp@latest --browser-url http://127.0.0.1:<port> --experimentalIncludeAllPages --blockedUrlPattern file://**`。其中 `--blockedUrlPattern file://**` 阻止 agent 导航进或注入 Electron 应用自身的 `file://` renderer——一道提示注入边界。详见 [03 进程模型](./03-process-model.md) 与 [50 横切关注点](./50-cross-cutting.md)。

下一篇 → [22 持久化](./22-persistence.md)
