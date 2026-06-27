# 03 · 进程模型

> 适用范围：Electron 三进程切分、启动/关闭时序、窗口与安全基线。最后核对：`src/main/index.ts`、`src/main/window.ts`、`src/main/pet-window.ts`、`electron.vite.config.ts`、`electron-builder.yml`。

## 1. 三进程职责

| 进程 | 职责 | 不可做 |
|---|---|---|
| **main** (Node) | 所有副作用与真源：模型调用、文件/shell、SQLite、MCP、策略、窗口生命周期 | 不渲染 UI |
| **preload** | 受控桥接：通过 `contextBridge` 暴露 `window.electron`，仅由 `invoke()` / `subscribe()` 两原语构成 | 不含业务逻辑 |
| **renderer** (React) | 呈现与交互，内存态重建 | 不落盘消息、不直接访问 Node |

renderer 与 main 之间没有第二条通路：所有跨进程调用都经 preload 的 `window.electron`，且 renderer 侧统一收敛在 `platform/electron/*` 客户端层。详见 [04 跨进程契约](./04-ipc-and-contracts.md)、[30 渲染层](./30-renderer.md)。

## 2. 启动时序

入口 `src/main/index.ts`。分两段：

### 2.1 `app.ready` 之前（模块求值期）

按源码顺序同步执行：

1. `fixPath()` —— 修正 GUI 启动进程的 `PATH`（`index.ts:33`）。
2. `registerWallpaperScheme()` —— 注册特权协议 `tanzo-asset://`。**必须在 `app.ready` 前**，因为 `protocol.registerSchemesAsPrivileged` 只在 ready 前有效（`index.ts:35`，`wallpaper.ts:24`）。这是一条硬约束。
3. `initializeLogger()` + `createLogger('main')`（`index.ts:37-38`）。
4. `app.requestSingleInstanceLock()` —— 未获取锁的重复实例 `app.exit(0)`；已运行实例收到 `second-instance` 时聚焦主窗口（`index.ts:147-156`）。**单实例是不变量。**

`markStartup(step, extra)` 是一个轻量启动剖析器，记录每步耗时，贯穿整个 ready 流程（`index.ts:42-51`）。

### 2.2 `app.whenReady().then(...)`（`index.ts:158-271`）

按序：

1. `Menu.setApplicationMenu(null)` —— 无原生菜单。
2. `setAppUserModelId('com.luminstudio.tanzo')`。
3. `ensureMacDockIcon()`（darwin）。
4. `installDevProcessLifecycle()` —— 仅 dev：每秒轮询 `process.ppid`，父进程（`electron-vite dev` 运行器）变化/退出则退出。
5. `browser-window-created` → `optimizer.watchWindowShortcuts`。
6. **无 DB 依赖的独立注册**：`initPreferences()` + `registerPreferencesIpc()`；`registerSystemIpc()`；`registerWallpaperProtocol()` + `registerWallpaperIpc()`；`nativeTheme.on('updated', broadcastSystemPreferences)`。
7. **模块工厂链**（每个 `.registerIpc(ipcMain)`）：
   - `databaseModule = createDatabaseModule({ userDataPath, migrations: [tanzoMigrations] })` —— 最先，无 IPC。
   - `mcpModule = createMcpModule({ db, getWindows })`。
   - `providerModule = createProviderModule({ db })`。
   - `agentModule = createAgentModule({ db, providerService, mcpService, workspaceRoot, getWindows, getChatWindows })` —— 消费 provider/mcp 的 `service`（`index.ts:201-209`）。
   - `slashCommandModule = createSlashCommandModule({ skills: agentModule.skills })` —— 依赖 agent 的技能库。
   - `fileMentionModule`、`petAssetsModule`（无依赖）。
8. `registerPetWindowIpc({ ..., setActiveChatId: agentModule.presence.setActiveChatId })`。
9. `showMainWindow()` —— 惰性创建主窗口。
10. `syncPetWindow()` —— 按 `getPreferences().petEnabled` 协调 pet 窗口存在性；`onPreferencesChanged` 使其响应式。
11. `void mcpModule.initialize()` —— 异步 fire-and-forget，UI 起来后才连 MCP 服务器。
12. `app.on('activate', showMainWindow)`。

## 3. 关闭时序

`before-quit`（`index.ts:273-292`）由 `isQuitting` 守卫，`preventDefault()` 后异步拆解，顺序刻意：

```
destroyPetWindow
  → slashCommandModule.close() → fileMentionModule.close()
  → await agentModule.close()  → await mcpModule.close()
  → providerModule.close()     → databaseModule.close()
  → app.exit(0)
```

DB 最后关（所有人依赖它）；agent/mcp 异步拆解需 `await`。`agentModule.close()` 内部：反注册 IPC → 释放 presence → 取消所有运行中对话 → `settleRuns(3000)` → 关闭 shell 会话。失败路径 `app.exit(1)`。

`window-all-closed`：非 darwin 退出；darwin 保活。主窗口 `close` 在 macOS 上隐藏而非关闭——标准 mac 单窗口行为。

## 4. 窗口模型

两类窗口，同一 preload，不同 HTML 入口。

### 4.1 主窗口（`window.ts:47-109`）

- 惰性创建，尺寸 `initialBounds()`（夹到工作区 82%×86%，最小 1024×680）。
- 平台 chrome：macOS `titleBarStyle: 'hiddenInset'` + `transparent` + `vibrancy: 'under-window'`；Windows `frame: false` + 亚克力/实色。无边框自定义标题栏。
- 加载 dev 的 `ELECTRON_RENDERER_URL` 或 prod 的 `../renderer/index.html`。

### 4.2 Pet 窗口（`pet-window.ts:148-214`）

- 浮动、透明、无边框覆盖层：`alwaysOnTop`、`skipTaskbar`（非 mac）、不可缩放/移动/全屏。
- 置顶层级 mac `'screen-saver'`、其它 `'pop-up-menu'`；mac 上 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`。
- **点击穿透 + 命中矩形轮询**：默认 `setIgnoreMouseEvents(true, { forward: true })`，90ms 轮询根据光标是否落在 renderer 上报的 `hitRect`（或拖拽中）切换可交互。renderer 通过 `pet:set-hit-rect` / `pet:set-dragging` 驱动。
- 生命周期耦合：主窗口 `closed` 同时销毁 pet 窗口——pet 不能比主窗口活得久。

### 4.3 安全基线（两窗口一致，不变量）

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
}
```

- **导航白名单**：`setWindowOpenHandler` 拒绝所有 `window.open`，`http(s)` 转外部浏览器；`will-navigate` 仅允许 renderer 源（dev 同源 / prod `file://` 解析进 `../renderer`）。
- 两窗口共用安全 `webPreferences`，是一条须保持的安全不变量。详见 [50 横切关注点](./50-cross-cutting.md)。

## 5. 双渲染入口

`electron.vite.config.ts` 是标准 electron-vite 三入口（main / preload / renderer），renderer 有**两个 HTML 输入**：

```ts
input: {
  main: resolve('src/renderer/index.html'),  // 主窗口
  pet:  resolve('src/renderer/pet.html')      // pet 覆盖层
}
```

这与 §4 的两类窗口一一对应。构建细节见 [40 构建与发布](./40-build-and-release.md)。

## 6. 进程模型不变量

- [ ] `registerWallpaperScheme()` 在 `app.ready` 前调用。
- [ ] 单实例锁；重复实例立即退出并聚焦已有实例。
- [ ] 两窗口都 `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`。
- [ ] 导航白名单：外链走系统浏览器，内部导航限 renderer 源。
- [ ] 关闭顺序：窗口 → 轻量模块 → agent/mcp(await) → provider → database。
- [ ] pet 窗口不超出主窗口生命周期。

下一篇 → [04 跨进程契约](./04-ipc-and-contracts.md)
