# 02 · 系统总览

> 适用范围：高层组件与端到端数据流。最后核对：对照 `src/` 当前实现。

## 1. 三进程组件图

```
┌─────────────────────────── RENDERER (React 19) ──────────────────────────┐
│  index.html → main.tsx → App        pet.html → pet.tsx → PetApp           │
│                                                                            │
│  App Shell: QueryClient · ThemeProvider · i18n · HashRouter · Resizable UI │
│  顶层路由:  / (Chat，keep-alive) · /settings                               │
│  features/  chat · git · mcp · providers · settings · skills · usage · pet │
│  状态分层:  ChatSession(外部存储, 活跃消息/流) · react-query(main 拥有的数据) │
│             zustand(本地 UI 态) · preferences(从 main 水合)                 │
│  platform/electron/*  唯一接触 window.electron 的层（带错误解码的客户端）   │
│                              │                                             │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │  contextBridge: window.electron
┌──────────────────────────────┼────────────────────── PRELOAD ────────────┐
│  index.ts 组装 tanzoApi = { ...system, preferences, mcp, provider, chat,   │
│    policy, hooks, goal, git, changeSet, activity, skills, slashCommand,   │
│    fileMention, pet }     —— 全部由 invoke() / subscribe() 两个原语构成    │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │  ipcMain.handle / webContents.send
┌──────────────────────────────┼─────────────────────── MAIN (Node) ────────┐
│  index.ts 引导: 单实例锁 → 协议注册 → whenReady → 模块工厂链               │
│                                                                            │
│  agent/      createAgentModule  ← 系统核心                                 │
│    service(邮箱/入口) · runtime/(RunEngine, TurnLoop, streamText, 流)      │
│    context/(Section×Provider, 压缩) · tools/(内置+MCP+provider 合并)        │
│    policy+hooks/(审批前附加门) · subagent/ · skills/ · goal/ · presence/   │
│    telemetry/ · store(repositories) · ipc/                                 │
│  provider/   createProviderModule  ProviderRuntime + 5 适配器 + 密钥安全   │
│  mcp/        createMcpModule        MCP 客户端生命周期 + Elicitation        │
│  database/   createDatabaseModule   better-sqlite3 + 迁移框架               │
│  preferences · system · wallpaper · file-mention · slash-command · pet     │
│                                                                            │
│  SQLite (唯一真源): conversations / messages(JSON) / runs / provider_* /    │
│                     mcp_servers / policy_* / skill_states / app_settings    │
│                     （含 hooks trust/enabled）/ ...                          │
└────────────────────────────────────────────────────────────────────────────┘
```

## 2. 模块工厂约定

main 端的子系统统一遵循工厂三件套：

```ts
createXxxModule(deps) → { service?, registerIpc(ipcMain): void, close?(): void | Promise<void> }
```

- `registerIpc` 是**幂等**的：内部先 `unregister?.()` 再注册，重复调用安全（`src/main/ipc/router.ts:29` 的 `registerIpcHandlers` 在路由层也做同样的去重）。
- 依赖通过 `deps` 显式注入：`createAgentModule` 消费 `providerModule.service`、`mcpModule.service` 与 `databaseModule.db`，体现明确的依赖方向。
- 关闭顺序在 `before-quit` 里**刻意编排**：窗口 → 轻量模块 → agent/mcp（await）→ provider → database 最后关。详见 [03 进程模型](./03-process-model.md)。

## 3. 端到端数据流（一次对话回合）

以用户发送一条消息为例，串起所有子系统：

```
[renderer] Composer.handleSubmit
   → chatClient.submit(chatId, TanzoUIMessage)            (platform/electron/chat-client.ts)
   → window.electron.chat.submit                          (preload, invoke 'chat:submit')
─────────────────────────────────────────────────────────── IPC ──────────
[main] ipc/chat.ts 校验 → service.submitMessage
   → mailbox.enqueue(chatId, …)                           (每条对话串行)
   → 有 parentConversationId? → 子代理后台驱动 : run(chatId, messages)
   → service.run → mailbox.enqueue → TurnLoop.run (≤10 次续航): 解析 def → 保存消息
        → changeSet.captureBeforeRun → compaction.prepareMessages(可能压缩历史)
        → RunEngine.run / startChatRun:
             buildTools → buildAgentCall({ model, tools, toolApproval, stopWhen })
             → createUIMessageStream({ execute: w.merge(toUIMessageStream({ stream:
                 streamText({ ...agentCall, prepareStep → contextEngine.build }).stream })),
                                       onStepFinish/onFinish → 持久化 })
             → for await chunk: send(chatId, chunk)
─────────────────────────────────────────────────────────── IPC ──────────
[main→renderer] run-session-registry 批量合并 delta(24ms)
   → webContents.send(chat:event:<chatId>, ChatEvent)
[renderer] run-stream.ts 帧门(frame gate)保证顺序
   → readUIMessageStream 重建 TanzoUIMessage
   → ChatSession 更新状态 → useSyncExternalStore → 组件重渲染
   → AssistantMessage 按 part.type 分发到渲染注册表
```

需要审批时这条回路自然停止、把审批请求 part 流回，用户响应写回消息后再次 `submit`，main 用完整历史重跑——审批、多步、工具回灌全在这条回路内自洽。详见 [10 Agent 运行时](./10-agent-runtime.md) 与 [13 策略与审批](./13-policy-and-approval.md)。

## 4. 技术栈速查

| 关注点 | 选型 | 位置 |
|---|---|---|
| 桌面壳 | Electron 41 + electron-vite 5 | `electron.vite.config.ts` |
| Agent 基底 | `ai@7` `streamText` / `tool()` / `UIMessage` | `src/main/agent/` |
| 模型供应商 | `@ai-sdk/{anthropic,openai,openai-compatible,google,deepseek,mcp}` | `src/main/provider/`、`src/main/mcp/` |
| 持久化 | `better-sqlite3`（WAL） | `src/main/database/` |
| 代码检索 | `@vscode/ripgrep` | `src/main/agent/search/`、`src/main/file-mention/` |
| UI 框架 | React 19 + react-router-dom@7（HashRouter） | `src/renderer/src/` |
| 服务端态 | `@tanstack/react-query` | 各 feature 的 `model/queries.ts` |
| 本地 UI 态 | `zustand` + 自研 `ChatSession` 外部存储 | `features/*/model/` |
| 流式重建 | `readUIMessageStream`（ai-sdk）+ 自研帧门 | `platform/electron/run-stream.ts` |
| 设置内嵌页 | Skills / Providers / MCP / Usage 作为 Settings sections 嵌入 | `features/settings/model/sections.tsx` |
| i18n | `i18next` + `react-i18next`（en / zh-CN） | `src/renderer/src/locales/` |
| 主题 | CSS 变量 + 预设，状态落 preferences | `src/renderer/src/common/theme/` |

完整技术栈、版本与构建链见 [40 构建与发布](./40-build-and-release.md)。

下一篇 → [03 进程模型](./03-process-model.md)
