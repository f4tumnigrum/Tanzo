# 03 · Process Model

> Scope: the Electron three-process split, startup/shutdown sequences, window and security baseline. Last
> verified against `src/main/index.ts`, `src/main/window.ts`, `src/main/pet-window.ts`,
> `electron.vite.config.ts`, `electron-builder.yml` at v0.2.4.

## 1. Three-process responsibilities

| Process | Responsibility | Must not |
|---|---|---|
| **main** (Node) | All side effects and truth: model calls, files/shell, SQLite, MCP, policy, window lifecycle | Render UI |
| **preload** | Controlled bridge: exposes `window.electron` via `contextBridge`, built only from the two primitives `invoke()` / `subscribe()` | Contain business logic |
| **renderer** (React) | Rendering and interaction; in-memory reconstruction | Persist messages; access Node directly |

There is no second path between `renderer` and `main`: every cross-process call goes through preload's
`window.electron`, and on the renderer side is funneled through the `platform/electron/*` client layer. See
[04 IPC & Contracts](./04-ipc-and-contracts.md) and [30 Renderer](./30-renderer.md).

## 2. Startup sequence

Entry point `src/main/index.ts`, in two phases.

### 2.1 Before `app.ready` (module-evaluation phase)

Executed synchronously in source order:

1. `fixPath()` — repair `PATH` for GUI-launched processes (`index.ts:34`).
2. `registerWallpaperScheme()` — register the privileged protocol `tanzo-asset://`. **Must run before
   `app.ready`**, because `protocol.registerSchemesAsPrivileged` is only effective before ready
   (`index.ts:36`). This is a hard constraint.
3. `initializeLogger()` + `createLogger('main')` (`index.ts:38-39`).
4. `app.requestSingleInstanceLock()` — a duplicate instance that fails to acquire the lock calls `app.exit(0)`;
   the already-running instance focuses the main window on `second-instance` (`index.ts:181-190`).
   **Single-instance is an invariant.**

`markStartup(step, extra)` is a lightweight startup profiler that records the duration of each step throughout
the ready flow (`index.ts:76-85`).

### 2.2 `reserveLoopbackPort()` → `app.whenReady()` → `bootstrap()` (`index.ts:306-316`)

Before `bootstrap`, an **ephemeral loopback port** is reserved and, if allocation succeeds, opened as
Chromium's remote-debugging endpoint bound to `127.0.0.1` only (`index.ts:49-72`). This drives browser
automation via chrome-devtools-mcp over CDP; a random port (never fixed) avoids collisions and shrinks the
guessing window, and Electron's DevTools endpoint enforces a Host-header check. `0` means the feature is
disabled.

`bootstrap()` (`index.ts:192-304`) then runs in order:

1. `Menu.setApplicationMenu(null)` — no native menu.
2. `setAppUserModelId('com.luminstudio.tanzo')`.
3. `ensureMacDockIcon()` (darwin).
4. `installDevProcessLifecycle()` — dev only: polls `process.ppid` every second and quits if the parent (the
   `electron-vite dev` runner) changes or exits (`index.ts:106-133`).
5. `browser-window-created` → `optimizer.watchWindowShortcuts`.
6. **Independent registrations with no DB dependency**: `initPreferences()` + `registerPreferencesIpc()`;
   `registerSystemIpc()`; `registerWallpaperProtocol()` + `registerWallpaperIpc()`;
   `nativeTheme.on('updated', broadcastSystemPreferences)` (`index.ts:206-213`).
7. **The module-factory chain** (each `.registerIpc(ipcMain)`):
   - `databaseModule = createDatabaseModule({ userDataPath, migrations: [tanzoMigrations] })` — first, no IPC
     (`index.ts:215`).
   - `mcpModule = createMcpModule({ db, getWindows, remoteDebuggingPort })` (`index.ts:221`).
   - `providerModule = createProviderModule({ db })` (`index.ts:229`).
   - `agentModule = createAgentModule({ db, providerService, mcpService, workspaceRoot, getWindows,
     getChatWindows, disabledTools })` — consumes the provider/mcp `service` (`index.ts:235`).
   - `slashCommandModule = createSlashCommandModule({ skills: agentModule.skills })` — depends on the agent's
     skills store (`index.ts:247`).
   - `fileMentionModule`, `petAssetsModule` — no dependencies (`index.ts:251-256`).
8. `registerPetWindowIpc({ …, setActiveChatId: (id) => agentModule?.presence.setActiveChatId(id) })`
   (`index.ts:259`).
9. `showMainWindow()` — lazily creates the main window (`index.ts:266`).
10. `syncPetWindow()` — reconciles the pet window's existence against `getPreferences().petEnabled`;
    `onPreferencesChanged` makes it reactive (`index.ts:269-292`).
11. `void mcpModule.initialize()` — async fire-and-forget; MCP servers connect only after the UI is up
    (`index.ts:294`).
12. `app.on('activate', showMainWindow)`.

## 3. Shutdown sequence

`before-quit` (`index.ts:318-337`) is guarded by `isQuitting`; after `preventDefault()` it tears down
asynchronously in a deliberate order:

```text
destroyPetWindow
  → slashCommandModule.close() → fileMentionModule.close()
  → await agentModule.close()  → await mcpModule.close()
  → providerModule.close()     → databaseModule.close()
  → app.exit(0)
```

The DB closes last (everyone depends on it); agent/mcp teardown is async and awaited. `agentModule.close()`
internally: unregister IPC → dispose presence → `git.unwatchAll()` → cancel all running conversations →
`settleRuns(3000)` → close shell sessions (`src/main/agent/module.ts:468`). The failure path calls
`app.exit(1)`.

`window-all-closed`: quit on non-darwin; stay alive on darwin. On macOS the main window's `close` hides
instead of closing — standard single-window mac behavior (`index.ts:147-160`).

## 4. Window model

Two window kinds, the same preload, different HTML entries.

### 4.1 Main window (`window.ts:48-114`)

- Lazily created, sized by `initialBounds()` (clamped to 82% × 86% of the work area, minimum 1024 × 680).
- Platform chrome: on macOS `titleBarStyle: 'hidden'` + `transparent` + `vibrancy: 'under-window'`; on Windows
  `frame: false` + acrylic/solid. A custom frameless title bar in either case.
- Loads dev's `ELECTRON_RENDERER_URL` or prod's `../renderer/index.html`.

### 4.2 Pet window (`pet-window.ts`)

- A floating, transparent, frameless overlay: `alwaysOnTop`, `skipTaskbar` (non-mac), not resizable/movable/
  fullscreen-able.
- Stacking level `'screen-saver'` on mac, `'pop-up-menu'` elsewhere; on mac
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
- **Click-through + hit-rect polling**: defaults to `setIgnoreMouseEvents(true, { forward: true })`, and every
  ~90 ms toggles interactivity based on whether the cursor is inside the renderer-reported `hitRect` (or a drag
  is in progress). The renderer drives this via `pet:set-hit-rect` / `pet:set-dragging`.
- Lifecycle coupling: the main window's `closed` also destroys the pet window — the pet cannot outlive the main
  window (`index.ts:155-159`).

### 4.3 Security baseline (identical for both windows — an invariant)

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: true,          // main window hosts <webview> guests for browser automation
  backgroundThrottling: false
}
```

- **Navigation allowlist**: `setWindowOpenHandler` denies all `window.open` and sends `http(s)` to the external
  browser; `will-navigate` allows only the renderer origin (dev same-origin / prod `file://` resolved into
  `../renderer`) (`window.ts:96-105`).
- `installEmbeddedBrowserHardening(window)` hardens the `<webview>` guests used by browser automation
  (`window.ts:85`). See [50 Cross-Cutting](./50-cross-cutting.md).
- Both windows share the safe `webPreferences`; this is a security invariant to preserve.

## 5. Dual renderer entries

`electron.vite.config.ts` is a standard electron-vite three-target build (main / preload / renderer), and the
renderer has **two HTML inputs**:

```ts
input: {
  main: resolve('src/renderer/index.html'),  // main window
  pet:  resolve('src/renderer/pet.html')      // pet overlay
}
```

These map one-to-one to the two window kinds in §4. Path aliases: `@` / `@renderer` → `src/renderer/src`,
`@shared` → `src/shared`. Build details are in [40 Build & Release](./40-build-and-release.md).

## 6. Process-model invariants

- [ ] `registerWallpaperScheme()` is called before `app.ready`.
- [ ] Single-instance lock; a duplicate instance exits immediately and focuses the existing one.
- [ ] Both windows use `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`.
- [ ] Navigation allowlist: external links go to the system browser; internal navigation is limited to the
      renderer origin.
- [ ] Shutdown order: windows → light modules → agent/mcp (await) → provider → database.
- [ ] The pet window never outlives the main window.

Next → [04 IPC & Contracts](./04-ipc-and-contracts.md)
