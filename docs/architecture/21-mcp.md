# 21 · MCP 集成

> 适用范围：MCP 服务器配置、生命周期、工具暴露、Elicitation 往返、传输与重连。最后核对：`src/main/mcp/*`、`src/shared/mcp.ts`。

## 1. 概览

基于 `@ai-sdk/mcp`（`createMCPClient`、`Experimental_StdioMCPTransport`）。模块装配 `module.ts`。MCP 让 agent 接入外部工具服务器（stdio 或 http/sse 传输），把它们的工具暴露成 agent 可调的 `ToolSet`。

## 2. 配置与存储

- `McpStore`（`store.ts:10`）把服务器存在 `mcp_servers` 表。契约 `McpServerConfig`（`shared/mcp.ts:30`）；`name` UNIQUE（重复 → `MCP_SERVER_NAME_DUPLICATE`）。JSON 列（`args_json`/`headers_json`/`env_json`）读时 zod 校验；`sanitizeServerForTransport` 丢弃与传输类型无关字段。
- 校验不变量（`store.ts:123`）：name 必填；stdio 需 `command`；http/sse 需 `url`。

## 3. 生命周期与连接管理（`client.ts`）

`McpClient` 是按服务器 **name** 键的有状态管理器：

- `syncServers(servers)`（`client.ts:197`）协调配置：移除消失的、断开禁用的、（重）连配置变化（经 `normalizeConnectionConfig` 比较）或未连接的。所有变更经 `#withServerOperation`（每 name 一个 promise 队列）串行——重要并发不变量。
- `#connect`（`client.ts:496`）：建传输 → `createMCPClient`（`capabilities: { elicitation: {} }` + `onUncaughtError` 丢连接并排程重连）。包 `withTimeout`（连接默认 120s）；迟到解析的 client 被关闭防泄漏。
- **重连不变量**：指数退避（`1s → 30s`），最多 5 次，**仅远程传输**（`isRemoteTransport`）。stdio 不自动重连。
- 连接状态经监听器广播（`onConnectionStatesChanged`）；`McpConnectionState` 带 `status`/`toolCount`/`serverInfo`/`instructions`/`error`。
- 分页安全：tools/resources/prompts 列举上限 100 页 / 10000 项，检测重复游标 → `MCP_PAGINATION_*`。

## 4. 传输（`transport.ts`）

- **stdio**：`Experimental_StdioMCPTransport`，`stderr: 'inherit'`。命令解析经 `resolveStdioLaunchCommand`（处理 Windows PATHEXT/.bat 引号）；环境经 `safeChildEnv` 净化。
- **http/sse**：校验仅 `http:`/`https:`，`redirect` 默认 `'error'`。
- **环境变量展开**：`${VAR}` 与 `${VAR:-default}` 语法在启动前对 command/args/cwd/url/headers/env 展开（`env.ts`）。

## 5. 工具暴露给 Agent

`toolsForServer(serverName)`（`client.ts:325`）列出工具定义后返回 `client.toolsFromDefinitions(...)`——一个 ai-sdk `ToolSet`。这是 MCP 与 agent 工具循环的桥。agent 侧 `tools/mcp.ts` 把它们命名为 `mcp__<server>__<tool>` 并映射注解到 `kind`（[12 工具系统](./12-tools.md) §2.1）。

UI 用的原始内省：`listTools`/`listResources`/`listPrompts`/`getPrompt`/`readResource`/`listResourceTemplates`，返回共享 `Mcp*Result` 形状。

## 6. Elicitation 往返（服务器 → 用户 → 服务器）

MCP 服务器向用户索要结构化输入的往返：

```
1. 连接时注册 client.onElicitationRequest(...)（client.ts:540）→ handleElicitationRequest
2. module.ts:85 handleElicitationRequest 生成 randomUUID requestId，存 resolver 进
   pendingElicitations，推 mcp:elicitation-requested 给主窗口
   { requestId, serverName, message, requestedSchema }；无窗口则 resolve {action:'cancel'}
3. 超时（默认 5 分钟）自动取消
4. renderer 经 mcp:resolve-elicitation 响应（requestId 须 UUID）→ resolveElicitation 解析
5. McpElicitResult { action: 'accept'|'decline'|'cancel'; content? } 返回给服务器
6. close() 时所有待处理 elicitation resolve 为 cancel
```

renderer 侧由全局 `McpElicitationHost`（挂在 App）队列驱动模态消费（[30 渲染层](./30-renderer.md)）。

## 7. 通道

`MCP_CHANNELS`（`shared/mcp.ts:1`，前缀 `mcp:`）。**推送**：`mcp:connection-states-changed`、`mcp:elicitation-requested`（main→renderer，`webContents.send`）；其余为 invoke。

## 8. MCP 不变量

- [ ] 每服务器操作经 promise 队列串行；远程才自动重连（退避上限 5 次），stdio 不重连。
- [ ] Elicitation 是 5 分钟限时的请求/解析往返，targeting 主窗口；超时/无窗口/关停时取消。
- [ ] http/sse 仅允许 `http:`/`https:`，默认禁止重定向。
- [ ] MCP 工具命名空间 `mcp__<server>__<tool>`，注解映射到 read/edit。

下一篇 → [22 持久化](./22-persistence.md)
