# 30 · 渲染层架构

> 适用范围：App Shell、ChatSession、流传输、Part 渲染注册表、状态分层、特性模块、设计系统。最后核对：`src/renderer/src/*`。

> **重要纠正**：Tanzo 的对话流**不使用** ai-sdk 的 `useChat` hook。它实现了自研的 `ChatSession`（外部存储 + `useSyncExternalStore`），只借用 ai-sdk 的 `UIMessage` part 类型与 `readUIMessageStream` 流读取器。

## 1. App Shell

两个 HTML 入口（多窗口）：

- `index.html` → `src/main.tsx` → `App`（主窗口 `#root`）
- `pet.html` → `src/pet.tsx` → `PetApp`（桌宠覆盖层 `#pet-root`）

两者都有严格 CSP；主窗口额外允许 `img-src ... tanzo-asset:`（壁纸/资源自定义协议）。`main.tsx` 在挂载前据 `window.electron.platformInfo` 给 `<html>` 打 `electron`/`platform-*` 类与 `data-window-effect` 属性。

**Provider 组合**（`App.tsx`，外→内）：

```
QueryClientProvider
└─ ThemeProvider
   ├─ I18nLanguageSync（i18n.language ← preferences.language）
   ├─ WallpaperLayer（固定背景层 z-index -1）
   └─ HashRouter
      └─ shell wrapper
         ├─ AppShell（ResizablePanelGroup：左侧栏 + 内容区）
         │  └─ AppRoutes
         ├─ McpElicitationHost
         └─ Toaster
```

**启动门禁**：`App` 在三个异步条件满足前渲染 `null`——`useSystemPreferences()` 就绪、`usePreferencesReady()` 为真、i18n 初始化完成。保证 preferences + locale 先于任何 feature 挂载。

**路由**是静态注册表 `app/route-registry.tsx`：当前只有 `/`(Chat，`keepAlive: true`) 与 `/settings` 两个顶层路由。`AppShell` 根据 pathname 切换左侧栏：Chat 路由显示 `ConversationSidebar`，Settings 路由显示 `SettingsNav`。Skills/Providers/MCP/Usage 是 Settings sections 的嵌入页，不是独立顶层 route。

## 2. Chat 特性（深入）

目录 `features/chat/`，FSD 风格 `model/`（状态/逻辑）+ `ui/`（呈现）。

### 2.1 会话核心 ChatSession（非 useChat）

`model/conversation/chat-session.ts` 是核心：**按 chatId 引用计数的单例外部存储**（非 React、非 zustand），存在模块级 `Map<string, ChatSession>`，经 `getChatSession(chatId)` 取。

`ChatSessionState`（`chat-session.ts:29`）：`messages`、`isLoadingHistory`、`isStreaming`、`transientStatus`、`contextStatus`、`recentCompaction`、`compactionInProgress`、`activeRunKind`、`runNotice`、`queuedMessages`、`goal`、`subagentApprovals`、`tasks`。

`useChatSession(chatId)` 桥接 React：effect 内 `session.retain()`（引用计数），再 `useSyncExternalStore(session.subscribe, session.getState)`。最后一个订阅者释放后 `TEARDOWN_DELAY_MS = 1000` ms 自销。

生命周期 `open()`（`chat-session.ts:371`）：`onEvent` 监听 → `loadHistory()` → 并行 `loadSidecars()`（队列/审批/目标）→ `attachRun()` 连活跃流。

### 2.2 流传输（`platform/electron/run-stream.ts`）

这是真正的"ChatTransport"——没有 ai-sdk `ChatTransport` 类，而是手写流桥：

- `connectRun(api, chatId, handlers)` 经 `api.onEvent` 订阅，处理两类事件：`run-state`（running/finished/failed/aborted，驱动 attach/settle）与 `run-frame`（有序 chunk `{runId, seq, chunk}`）。
- `createFrameGate()` 强制**每 run 单调有序**：锁 `activeRunId`，拒绝其它 run 的帧或 `seq <= replayedSeq` 的帧。这是正确流重放的关键不变量。
- `attach()` 拉 `runSnapshot(chatId)`（base 消息 + 已发通知 + 帧），经门重放快照帧，再冲刷缓冲的 `liveFrames`（缓冲上限 2000）。
- `createMessageSink({ onMessage })` 包 `ReadableStream<UIMessageChunk>`，喂 ai-sdk 的 `readUIMessageStream<TanzoUIMessage>`，发出重建的完整消息——ai-sdk 流装配唯一被复用处。

`attachRun` 中 `onChunk` 双职：`data-*` chunk 路由到 `handleDataPart`，所有 chunk 入 sink 重建消息。`onRunStart` 重置到 `snapshot.baseMessages`；`onSettled` 关 sink 并从 main `refresh()`。

### 2.3 数据 part 路由（`model/conversation/data-part-router.ts`）

`routeDataPart` 是对流式 `data-*` 的类型化 switch → 会话状态变更：`data-status`/`data-steering` → transientStatus；`data-context` → contextStatus；`data-compaction` → upsert 合成压缩消息；`data-task` → `setTasks`；`data-taskApproval` → 审批列表（`setTaskApprovals`）；`data-queued` → 队列；`data-goal` → 目标；`data-telemetry`(scope chat) → `reduceRunNotice`。

### 2.4 消息渲染管线（`ui/message/`）

`MessageItem` 按 role 分发：compaction → `CompactionMessage`；`user` → `UserMessage`；`assistant` → `AssistantMessage`。

`AssistantMessage` 是 **part 类型分发器**，遍历 `message.parts`，用 ai-sdk 类型守卫（`isTextUIPart`/`isReasoningUIPart`/`isToolUIPart`/`isDynamicToolUIPart`/`isDataUIPart`/`isFileUIPart` + source-*）分支：text → `Response`(markdown)；reasoning → `XmlTag`；`exitPlanMode` 工具 → `PlanReviewCard`；其它工具 → `ToolMessageBlock`；data part → `DataPartBlock`；审批态工具 part 二次渲染 `ApprovalGroup`（同一回合的多个并发审批合并为单张卡片）。

`VirtualizedMessages`（`react-virtuoso`）按 `threadId` 键，item key = `message.id`，跟随输出自动滚动。

### 2.5 工具渲染——Part 渲染注册表（`ui/tool/`）

这是核心的注册表模式：

- `registry.ts` `ToolRendererRegistry` 三张解析表：`byName`（精确名 + 短名）、`byComponent`（供应商组件提示）、`dynamicHandlers`（动态工具前缀）。`resolve(ctx)` 优先级：精确 `toolName` → `shortName` → `componentHint` → 动态前缀（`mcp__`）→ `null`。
- `renderer-types.ts`：`ToolRenderer = { Header?, Output?, Footer?, renderWhenPending?, fullBleed? }`（槽位组件，非单体）。
- `render-context.ts`：`buildToolRenderContext` 把 ai-sdk 工具 part 规整成 `ToolRenderContext`（toolName/shortName/规范化 state/input/output/`componentHint`(读自 `providerMetadata.tanzo.component`)/审批/错误）。
- `renderers/index.ts`：**注册站**。`registerMany`(shell/fileRead/fileEdit/multiEdit/fileWrite/glob/grep/skill/subagent/todo/updateGoal/askQuestion)、`registerComponents`(各卡片)、`registerDynamicPrefix('mcp', dynamicRenderer)`。`ui/tool/index.ts` 副作用 `import './renderers'`。
- `tool-card.tsx`（`ToolMessageBlock`）：宿主，构建 context、解析 renderer、缺省回落、`Collapsible` 包裹并持久化展开态，含工具特定自动开/合（shell 流式自动开、成功完成自动合）。

> **加一个工具 UI = 在 `renderers/index.ts` 注册一项。** 主干零改。

### 2.6 Compose 盒（`ui/compose/`）

`Composer` 编排：`useChatSession`（send/steer/enqueue/stop）+ `useChatUiStore` 草稿 + react-query（`usePolicyMode`/`useConversations`/`useAgents`）。`handleSubmit` 经 `parseSlashInput` 解析 slash：action 命令（compact/goal/agent）本地执行；prompt/skill 命令展开模板；否则按需切模型再 `session.sendMessage`。子组件：`ChatInput`/`ComposerPanel`/`ModelSelector`/`ContextUsageBadge`/`SlashCommandMenu`/`MentionMenu`/`useAttachments`/`RunNotice`/`SteeringControls`。

## 3. 状态分层

| 关注点 | 机制 | 位置 |
|---|---|---|
| 活跃对话消息 + run 态 | 自研 `ChatSession` 外部存储（按 chatId 引用计数）+ `useSyncExternalStore` | `model/conversation/chat-session.ts` |
| main 拥有的数据（会话/工作区/agent/策略/供应商/mcp/技能/用量） | TanStack Query（30s staleTime，`refetchOnWindowFocus:false`） | 各 feature `model/queries.ts` |
| 本地 UI 态（活跃 chatId/草稿/展开/搜索/选择/用量区间） | zustand + 一个 vanilla store | `features/*/model/store.ts` |
| App 偏好（主题/语言/壁纸/pet） | zustand 从 main 水合 + `onChanged` 订阅 | `common/preferences.ts` |

**唯一真源 = main（已确认）**：`chatClient` 是纯 IPC 透传无存储；`ChatSession` 只在内存持有消息、~1s 后自销；每次 run settle 后 `refresh()` 从 `listMessages`+`getConversation` 重读对齐；`runSnapshot` 提供可重放帧让新挂载的 renderer 完全从 main 重建；乐观更新（本地追加 user 消息、审批响应）出错回滚后被 `refresh()` 覆盖。无 localStorage/IndexedDB 消息存储。

## 4. platform/electron 层（传输边界）

`platform/electron/` 是**唯一**接触 `window.electron` 的层。模式：每个 `*-client.ts` 先 `requireXApi()`（桥缺失抛 `TanzoIntegrationError`），再用 `withDecodedIpcError(s)`（`ipc-errors.ts`）把 main 抛错经 `decodeIpcError` 还原成 `TanzoError`。

客户端：`chat-client`、`run-stream`、`mcp-client`、`providers-client`、`policy-client`、`hooks-client`、`git-client`、`goal-client`、`skills-client`、`slash-command-client`、`activity-client`、`system-client`、`file-mention-client`、`change-set-client`。

**传输边界不变量**：UI/feature 代码不直接调 `window.electron`，仅少数 window/system 级处例外（chat page git watch、pet 窗口、theme 的 `onSystemPreferencesChanged`、navigation 的 `pet.setActiveChatId`）。

## 5. 非 Chat 特性

| 特性 | 要点 |
|---|---|
| git | Chat header 的 `WorkspaceGitPill` 打开 `GitReviewDialog`；`useGitReviewController` 管 overview/status/history/branches/remotes/diffs 与写操作，`git:event` 触发去抖刷新 |
| mcp | Settings section 嵌入 `McpPage`；`model/queries.ts` 管服务器/工具/资源；连接状态监听器推进 react-query 缓存；`McpElicitationHost` 全局队列模态 |
| providers | Settings section 嵌入 `ProvidersPage`；catalog/setups/keys/option schemas；list/detail zustand store；管理 API key 与每 family 模型配置 |
| settings | section 视图：theme/skills/providers/mcp/usage/permissions/hooks/pet；embedded feature page 自带 header/scroll |
| skills | Settings section 嵌入 `SkillsPage`；snapshot + 详情 + setEnabled/install/uninstall/reload（失效 `skillKeys.all`） |
| usage | Settings section 嵌入 `UsagePage`；`activityClient` summary/trend/conversations/runDetail；recharts 图表 |
| hooks | Settings Hooks 标签通过 `hooksClient` list/reload/setEnabled/setTrusted/preview 管理钩子信任与启停 |
| pet | 独立窗口/根（`pet.tsx`），直接调 `window.electron.pet` 与 `.chat`，绕过标准客户端/query 层（轻量独立窗口） |

## 6. 设计系统

- **components/ui/**：shadcn/Radix 风格原语库（button/dialog/sheet/popover/select/command/tabs/table/chart/sidebar/resizable/...）。**components/layout/**：page-layout/header/scaffold/pill-tabs。
- **主题**（`components/theme/theme-provider.tsx` + `common/theme/`）：`ThemeProvider` 据 `themeMode` 对系统方案解析，切 `.dark` 与 `color-scheme`；`ThemeInitializer` 把设计令牌作为 CSS 变量应用到 `:root`（色板/圆角/密度/字号预设）。所有主题态落 preferences，故持久在 main。`WallpaperLayer` 在有壁纸时注入表面透明度令牌覆盖。
- **i18n**（`i18n.ts` + `locales/en.ts`、`zh-CN.ts`）：两套资源，启动据系统偏好解析语言，`I18nLanguageSync` 保持同步。

## 7. 渲染层不变量

- [ ] 唯一真源 = main；renderer 不落盘，run settle 后 `refresh()` 对齐。
- [ ] 所有持久交互经 `platform/electron/*` 客户端（带 `withDecodedIpcError`）。
- [ ] `createFrameGate` 保证每 run `seq` 单调，外/迟到帧丢弃。
- [ ] 工具 UI 经 4 层注册表解析；新工具在 `renderers/index.ts` 注册。
- [ ] 不用 `useChat`；流式为自研 + ai-sdk `readUIMessageStream`。
- [ ] 启动门禁：系统偏好 + 用户偏好 + i18n 就绪前不渲染 feature。

下一篇 → [40 构建与发布](./40-build-and-release.md)
