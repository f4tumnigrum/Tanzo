# 30 · Renderer Architecture

> Scope: the app shell, `ChatSession`, stream transport, the part-renderer registry, state layering, and
> feature modules. Last verified against `src/renderer/src/*` at v0.2.4.

## 1. App shell

`src/renderer/src/App.tsx` nests providers in this order (`App.tsx:38-54`):
`QueryClientProvider` → `ThemeProvider` → (`I18nLanguageSync` + `WallpaperLayer` siblings) → `HashRouter` →
sidebar wrapper → `AppShell` wrapping `AppRoutes` → `McpElicitationHost` + `Toaster`.

- i18n is **not** a React provider — it is initialized imperatively (`initializeI18n(systemPreferences)`) and
  kept in sync by `I18nLanguageSync`. The app renders `null` until `systemPreferences && preferencesReady &&
  i18nReady` (`App.tsx:36`).
- The `QueryClient` is a singleton (`common/query-client.ts`: `staleTime: 30_000`,
  `refetchOnWindowFocus: false`).
- `ThemeProvider` (`components/theme/theme-provider.tsx`) is hand-rolled (not `next-themes`, which is a
  vestigial dependency): it reads `usePreferences().themeMode`, tracks the system scheme via
  `onSystemPreferencesChanged`, and toggles the `.dark` class plus `colorScheme`.

**Two top-level routes** (`app/route-registry.tsx:11-21`): `'/'` → `ChatPage` with `keepAlive: true`, and
`'/settings'` → `SettingsPage`. Keep-alive is implemented in `AppRoutes` (`App.tsx:57-89`): keep-alive routes
are always mounted and toggled via CSS (`hidden` + `aria-hidden`) using `matchPath`, so **ChatPage never
unmounts** when you navigate to Settings; non-keep-alive routes render inside `<Routes>` only when no keep-alive
route is active.

## 2. `ChatSession` — the external store

Live conversation state (messages, streaming, run status) lives in a per-conversation external store, not in
react-query or zustand.

- **Hook** (`features/chat/model/conversation/use-chat-session.ts`): `getChatSession(chatId)` →
  `useEffect(() => session.retain(), [session])` → `useSyncExternalStore(session.subscribe, session.getState)`.
- **Store** (`.../chat-session.ts`): a plain closure store. `subscribe` adds/removes a listener `Set`;
  `getState` returns the closure `state`; `setState` shallow-merges and notifies. A module-level
  `Map<string, ChatSession>` memoizes one session per `chatId`, ref-counted via `retain()` with a debounced
  `dispose` (`TEARDOWN_DELAY_MS = 1000`).
- **Optimistic mutations with rollback**: `sendMessage`, `editMessage`, and `respondApprovals` each snapshot the
  previous messages and restore them on error.
- Initial state is seeded from the react-query cache (`chatKeys.messages`) when present.

## 3. Stream transport — the frame gate

`platform/electron/run-stream.ts` turns the IPC `chat:event` stream into rebuilt `TanzoUIMessage` objects:

- **Frame gate** (`createFrameGate`): tracks `activeRunId` + `replayedSeq`; `accept(frame)` rejects a frame
  unless its `runId` matches and `frame.seq > replayedSeq` (monotonic de-dup); `lock(runId)` resets
  `replayedSeq = 0`. This guarantees ordering and prevents replays from double-applying.
- **Rebuild** (`createMessageSink`): builds a `ReadableStream<UIMessageChunk>` fed to the AI SDK's
  `readUIMessageStream<TanzoUIMessage>`; each rebuilt message goes to `handlers.onMessage`. An optional
  `seedMessage` continues an in-flight assistant message.
- **connectRun**: fetches `api.runSnapshot`, locks the gate to the snapshot's `runId`, replays `notifications`
  then `frames` (telemetry frames only advance the seq — `shouldReplaySnapshotFrame` excludes `data-telemetry`),
  then drains buffered live frames (buffered up to `MAX_LIVE_FRAMES = 2000` before attach). Terminal states
  (`finished` / `failed` / `aborted`) settle the run; a bounded LRU of terminal run ids
  (`MAX_TERMINAL_RUN_IDS = 100`) avoids reprocessing.

`ChatSession.attachRun` (`.../chat-session.ts`) uses `connectRun` with `persistent: true`: `onRunStart` closes
any prior sink and seeds a new one from the last assistant base message (merging base messages), `onChunk`
routes data chunks to `handleDataPart` and enqueues chat chunks to the sink, and `onSettled` refreshes from the
DB with a revision guard. This is the renderer half of the data flow in
[02 System Overview](./02-system-overview.md).

## 4. The part-type → renderer registry

Tool and data parts are rendered by a class registry (`features/chat/ui/tool/registry.ts`) with three maps —
`byName`, `byComponent`, and `dynamicHandlers`. `resolve(context)` precedence is: exact `toolName` →
`shortName` → `componentHint` → a dynamic prefix match `${prefix}__` for dynamic (MCP) tools.

Registrations (`features/chat/ui/tool/renderers/index.ts`): ~20 tool names (shell, fileRead, fileEdit,
multiEdit, fileWrite, glob, grep, skill, the sub-agent tools → a subagent renderer, todo, updateGoal,
askQuestion, browserOpen), ~11 component hints (FileCard, DiffCard, ShellCard, FileListCard, MatchCard,
SkillCard, SubagentCard, TodoCard, GoalCard, AskQuestionCard, BrowserCard), and a dynamic prefix `mcp`. The
registry is populated by a side-effect import of `'./renderers'`.

A `ToolRenderer` (`.../tool/renderer-types.ts`) is optional `Header` / `Output` / `Footer` components plus
`renderWhenPending` / `fullBleed` flags. `ToolMessageBlock` (`.../tool/tool-card.tsx`) builds a render context,
resolves the renderer, and falls back to a default header/output. `AssistantMessage`
(`.../message/assistant-message.tsx`) dispatches each part: tool parts → `ToolMessageBlock`, data parts →
`DataPartBlock`, the plan-review tool → `PlanReviewCard`. This is the concrete expression of invariant §3.1
("one substance, dispatched by part type") from [01 Introduction](./01-introduction.md).

## 5. State layering

Four distinct layers, each with a clear job:

1. **react-query** — the cache for data owned by `main` (conversations, messages, provider/mcp/activity data).
   `ChatSession` reads from and writes back into this cache.
2. **zustand** — ephemeral UI state: `features/chat/model/store.ts` (`useChatUiStore`: active chat, drafts,
   disclosure), `app/app-shell-store.ts` (the active settings section), and the preferences store.
3. **ChatSession external store** — per-conversation live streaming/run state (§2).
4. **preferences** — a zustand store hydrated from `window.electron.preferences`, IPC-synced via `onChanged`;
   mutations round-trip through `main` and re-hydrate. This is the source of truth for theme and language,
   distinct from react-query.

## 6. Settings sections (embedded feature pages)

`features/settings/model/sections.tsx` defines `SETTINGS_SECTIONS`. Skills, Plugins, Providers, MCP, and Usage
are marked `embedded: true` and render their own full-height layout (importing each feature's `page`), while
non-embedded sections (theme, permissions, hooks, pet, tools) get the standard `PageHeader` + scroll container.
The active section is **zustand-driven, not routed** (`useAppShellStore((s) => s.settingsSection)`, default
`'theme'`), so all of Settings lives under the single `/settings` route and switches sections in place.

This is why [02 System Overview](./02-system-overview.md) lists ten feature modules but only two routes: Skills,
Plugins, Providers, MCP, and Usage are surfaced as Settings sections rather than top-level routes.

## 7. i18n and theming

- **i18n** (`i18n.ts`): two languages, `en` and `zh-CN`, with resources from `@/locales/*`. `initializeI18n`
  picks the language from the system's preferred languages/locale (`resolveLanguage` maps any `zh*` → `zh-CN`,
  else `en`), with `fallbackLng: 'en'`. See [50 Cross-Cutting](./50-cross-cutting.md).
- **Theming** (`common/theme/store.ts`): `applyThemeSettings` writes CSS custom properties on
  `document.documentElement` — palette `--<key>`, plus `--radius` / `--spacing` / `--font-*` / `--shadow-*` /
  `--font-size-base` — and `data-*` attributes. `ThemeInitializer` re-applies via `useLayoutEffect` on prefs /
  resolved-theme change. Presets (`common/theme/presets.ts`) use OKLCH color values; custom themes are
  snapshot-driven.

Next → [40 Build & Release](./40-build-and-release.md)
