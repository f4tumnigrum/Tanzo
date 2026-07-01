# 30 · 渲染层架构

> 适用范围：App Shell、`ChatSession`、流传输、Part 渲染注册表、状态分层、特性模块。最后核对：`src/renderer/src/*`（v0.2.4）。

## 1. App Shell

`src/renderer/src/App.tsx` 按此顺序嵌套 provider（`App.tsx:38-54`）：`QueryClientProvider` → `ThemeProvider` →（`I18nLanguageSync` + `WallpaperLayer` 兄弟）→ `HashRouter` → 侧栏包装 → `AppShell` 包 `AppRoutes` → `McpElicitationHost` + `Toaster`。

- i18n **不是** React provider——它命令式初始化（`initializeI18n(systemPreferences)`）并由 `I18nLanguageSync` 保持同步。应用在 `systemPreferences && preferencesReady && i18nReady` 前渲染 `null`（`App.tsx:36`）。
- `QueryClient` 是单例（`common/query-client.ts`：`staleTime: 30_000`、`refetchOnWindowFocus: false`）。
- `ThemeProvider`（`components/theme/theme-provider.tsx`）是自研（非 `next-themes`，后者是残留依赖）：读 `usePreferences().themeMode`，经 `onSystemPreferencesChanged` 跟踪系统方案，切换 `.dark` 类与 `colorScheme`。

**两个顶层路由**（`app/route-registry.tsx:11-21`）：`'/'` → `ChatPage`，`keepAlive: true`；`'/settings'` → `SettingsPage`。keep-alive 在 `AppRoutes` 实现（`App.tsx:57-89`）：keep-alive 路由恒挂载，用 `matchPath` 经 CSS（`hidden` + `aria-hidden`）切换，故导航到 Settings 时 **ChatPage 从不卸载**；非 keep-alive 路由仅当无 keep-alive 路由活动时才在 `<Routes>` 内渲染。

## 2. `ChatSession` —— 外部存储

活跃对话状态（消息、流式、run 状态）活在每对话外部存储，不在 react-query 或 zustand。

- **Hook**（`features/chat/model/conversation/use-chat-session.ts`）：`getChatSession(chatId)` → `useEffect(() => session.retain(), [session])` → `useSyncExternalStore(session.subscribe, session.getState)`。
- **存储**（`.../chat-session.ts`）：普通闭包存储。`subscribe` 增删监听 `Set`；`getState` 返回闭包 `state`；`setState` 浅合并并通知。模块级 `Map<string, ChatSession>` 按 `chatId` 记忆化一个 session，经 `retain()` 引用计数并带去抖 `dispose`（`TEARDOWN_DELAY_MS = 1000`）。
- **带回滚的乐观变更**：`sendMessage`、`editMessage`、`respondApprovals` 各自快照前序消息并在出错时恢复。
- 存在时从 react-query 缓存（`chatKeys.messages`）播种初始状态。

## 3. 流传输 —— 帧门

`platform/electron/run-stream.ts` 把 IPC `chat:event` 流变成重建的 `TanzoUIMessage`：

- **帧门**（`createFrameGate`）：跟踪 `activeRunId` + `replayedSeq`；`accept(frame)` 除非其 `runId` 匹配且 `frame.seq > replayedSeq`（单调去重）否则拒绝；`lock(runId)` 复位 `replayedSeq = 0`。这保证顺序并防重放二次应用。
- **重建**（`createMessageSink`）：构建 `ReadableStream<UIMessageChunk>` 喂给 AI SDK 的 `readUIMessageStream<TanzoUIMessage>`；每条重建消息进 `handlers.onMessage`。可选 `seedMessage` 续接在途助手消息。
- **connectRun**：拉 `api.runSnapshot`，把门锁到快照的 `runId`，重放 `notifications` 再 `frames`（遥测帧只推进 seq——`shouldReplaySnapshotFrame` 排除 `data-telemetry`），再排空缓冲的 live 帧（attach 前缓冲至多 `MAX_LIVE_FRAMES = 2000`）。终态（`finished` / `failed` / `aborted`）settle 该 run；一个有界的终态 run id LRU（`MAX_TERMINAL_RUN_IDS = 100`）避免重复处理。

`ChatSession.attachRun`（`.../chat-session.ts`）以 `persistent: true` 用 `connectRun`：`onRunStart` 关闭任何前序 sink 并从最后助手基消息播种新 sink（合并基消息），`onChunk` 把 data chunk 路由到 `handleDataPart` 并把 chat chunk 入 sink，`onSettled` 带 revision 守护从 DB 刷新。这是 [02 系统总览](./02-system-overview.md) 数据流的 renderer 半程。

## 4. Part 类型 → 渲染注册表

工具与数据 part 由类注册表渲染（`features/chat/ui/tool/registry.ts`），含三张 map——`byName`、`byComponent`、`dynamicHandlers`。`resolve(context)` 优先级：精确 `toolName` → `shortName` → `componentHint` → 动态（MCP）工具的动态前缀匹配 `${prefix}__`。

注册（`features/chat/ui/tool/renderers/index.ts`）：约 20 个工具名（shell、fileRead、fileEdit、multiEdit、fileWrite、glob、grep、skill、子代理工具 → subagent 渲染器、todo、updateGoal、askQuestion、browserOpen）、约 11 个组件提示（FileCard、DiffCard、ShellCard、FileListCard、MatchCard、SkillCard、SubagentCard、TodoCard、GoalCard、AskQuestionCard、BrowserCard）、动态前缀 `mcp`。注册表由对 `'./renderers'` 的副作用 import 填充。

`ToolRenderer`（`.../tool/renderer-types.ts`）是可选 `Header` / `Output` / `Footer` 组件加 `renderWhenPending` / `fullBleed` 标志。`ToolMessageBlock`（`.../tool/tool-card.tsx`）构建渲染上下文、解析渲染器、回退到默认头/输出。`AssistantMessage`（`.../message/assistant-message.tsx`）分发每个 part：工具 part → `ToolMessageBlock`，数据 part → `DataPartBlock`，plan-review 工具 → `PlanReviewCard`。这是 [01 引言](./01-introduction.md) 不变量 §3.1（"一种物质，按 part 类型分发"）的具体体现。

## 5. 状态分层

四个各司其职的层：

1. **react-query** —— main 拥有数据的缓存（对话、消息、provider/mcp/activity 数据）。`ChatSession` 从中读并写回。
2. **zustand** —— 瞬态 UI 态：`features/chat/model/store.ts`（`useChatUiStore`：活跃对话、草稿、展开）、`app/app-shell-store.ts`（活动设置 section）、preferences 存储。
3. **ChatSession 外部存储** —— 每对话活跃流式/run 状态（§2）。
4. **preferences** —— 从 `window.electron.preferences` 水合的 zustand 存储，经 `onChanged` IPC 同步；变更经 main 往返并重新水合。这是主题与语言的真源，区别于 react-query。

## 6. 设置 section（内嵌特性页）

`features/settings/model/sections.tsx` 定义 `SETTINGS_SECTIONS`。Skills、Plugins、Providers、MCP、Usage 标 `embedded: true` 并渲染自身全高布局（import 各特性的 `page`），而非内嵌 section（theme、permissions、hooks、pet、tools）得到标准 `PageHeader` + 滚动容器。活动 section **由 zustand 驱动而非路由**（`useAppShellStore((s) => s.settingsSection)`，默认 `'theme'`），故整个 Settings 活在单一 `/settings` 路由下并原地切换 section。

这正是 [02 系统总览](./02-system-overview.md) 列出十个特性模块却只有两个路由的原因：Skills、Plugins、Providers、MCP、Usage 以 Settings section 而非顶层路由浮现。

## 7. i18n 与主题

- **i18n**（`i18n.ts`）：两语言 `en` 与 `zh-CN`，资源来自 `@/locales/*`。`initializeI18n` 从系统首选语言/区域选语言（`resolveLanguage` 把任意 `zh*` 映到 `zh-CN`，否则 `en`），`fallbackLng: 'en'`。见 [50 横切关注点](./50-cross-cutting.md)。
- **主题**（`common/theme/store.ts`）：`applyThemeSettings` 在 `document.documentElement` 写 CSS 自定义属性——调色板 `--<key>`，加 `--radius` / `--spacing` / `--font-*` / `--shadow-*` / `--font-size-base`——与 `data-*` 属性。`ThemeInitializer` 在偏好/解析主题变化时经 `useLayoutEffect` 重新应用。预设（`common/theme/presets.ts`）用 OKLCH 色值；自定义主题由快照驱动。

下一篇 → [40 构建与发布](./40-build-and-release.md)
