# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-07-08

### Added

- Channels: a multi-channel Chat SDK bridge connects the local agent to QQ,
  Discord, Lark, and WeChat. Each channel is independent — its own adapter,
  encrypted secret, and permission posture — sharing one agent and one safety
  model. New Channels settings feature with per-channel credential forms and an
  allowlist editor. Secrets are write-only from the renderer and stored via the
  shared secret codec (OS keyring when available).
- Browser: allowed popups are forwarded to a new tab; added keyboard shortcuts,
  a loading indicator, an `about:blank` home with Bing search, and an
  address-bar editing guard.
- Providers: Zhipu and MiniMax support.

### Changed

- Reasoning: unified reasoning-effort into a single provider capability model
  derived from each AI SDK options type, routed through the `getReasoning` IPC.
  The composer badge now reads provider defaults instead of a duplicated
  string/select schema.
- MCP: reconnect once and retry remote requests on stale connections, wiring the
  session-expired hook, `maxRetries`, and redirect following.
- CI/build: enable macOS hardened runtime, code signing, and notarization via
  GitHub Secrets.

### Fixed

- Permission badge no longer flickers to `default` on conversation switch;
  `permissionMode` is carried on the conversation summary and resolved at the
  chat IPC boundary.
- Cross-platform: resolved Windows/POSIX path handling in plugin manifest
  containment, MCP cwd detection, and git/marketplace tests.

## [0.4.2] - 2026-07-06

### Added

- Git sync now returns a structured result so the UI reports real outcomes
  (received/published commits, conflicts, no-op) instead of silently refreshing.
- Chat: long pasted text is externalized to a temp `.txt` file and handed to the
  model as a `fileRead` pointer, while the attachment chip stays in the
  transcript. New `openPath`/`revealInFolder` system IPC channels.

### Changed

- App: refined update checks and reasoning defaults.
- Git: read branch ahead/behind and upstream via `for-each-ref` (previously left
  at zero by simple-git's `branchLocal()`); `git-sync-history-views` split into
  `git-sync-view` and `git-history-view`; `restore-confirm` renamed to
  `discard-confirm`.

### Fixed

- Git discard partitions tracked vs. untracked paths, so mixed batches no longer
  leave tracked files un-reverted.

## [0.4.1] - 2026-07-05

### Added

- Sub-agents: read-only drill-down into a sub-agent's transcript, presented as a
  full-screen view with a back button and a header that matches the app header
  and shows the agent name.
- Task rows now expose cancel, retry, and steer actions.

### Changed

- Sub-agent scheduling hardened: dependents are re-evaluated on every settle
  path, tasks stay alive on chat cancel, steer is guarded against terminal and
  dependency-blocked tasks, approval waiters register before the block is
  surfaced, and dependency failures are tracked with structured
  unknown/failureKind feedback in the tools.

### Fixed

- Steer input schema no longer uses a top-level union.
- Locale parity restored with the missing `zh-CN` sub-agent keys.

## [0.3.0] - 2026-07-04

### Added

- Typography settings: a new Settings → Theme section replaces the old
  font-size preset with separate interface-font and code-font pickers (bundled:
  Geist, Inter, Geist Mono, JetBrains Mono; system fonts enumerated via the
  Local Font Access API), a font-size slider (12–20 px), a code-size slider
  (9–16 px), and a line-height slider (1.40–2.00), with a live preview panel.
- Window state persistence: the main window's position, size, and
  maximized state are saved to `window-state.json` in userData and restored on
  next launch. Saved bounds are validated against the current displays so an
  off-screen position (e.g. after unplugging a monitor) falls back to a
  centered default.

### Changed

- Wallpaper system overhauled: the settings UI now manages a library of up to
  12 stored assets with per-thumbnail previews. Separate light-mode and
  dark-mode wallpapers can be assigned independently (sun/moon badges),
  fit mode is selectable (cover / contain / fill / tile), and a new surface
  (panel) opacity slider controls the transparency of the sidebar, toolbar, and
  main area when a wallpaper is active.
- Dependencies: four `@fontsource-variable` packages (Geist, Geist Mono,
  Inter, JetBrains Mono) added to bundle the typography fonts.
- Preferences schema: `fontSizePresetId` replaced by a `typography` object;
  `WallpaperSettings` expanded with `assets`, `activeId`, `darkAssetId`, `fit`,
  and `surfaceOpacity`.

## [0.2.7] - 2026-07-03

### Changed

- Chat message list and conversation sidebar no longer use virtualization
  (`react-virtuoso` removed). Both render plain scrollers; off-screen content
  is skipped via CSS `content-visibility: auto`, and streaming sticky-bottom
  is a single ResizeObserver re-pin with native scroll anchoring disabled.

### Added

- Liquid-glass UI primitive applied across the compose menus, buttons, and the
  scroll-to-bottom control.

## [0.2.6] - 2026-07-03

### Added

- Providers: OpenAI Chat Completions is available as a separate `openai-chat`
  provider alongside the existing OpenAI Responses API provider, with dedicated
  Chat Completions options, model discovery, context strategy routing, and a
  migration that preserves existing provider data while widening provider-id
  constraints.

### Changed

- Dependencies: AI SDK moved from the v7 beta line to stable releases
  (`ai@7.0.12`, `@ai-sdk/anthropic@4.0.6`, `@ai-sdk/openai@4.0.6`,
  `@ai-sdk/openai-compatible@3.0.4`, `@ai-sdk/google@4.0.7`,
  `@ai-sdk/deepseek@3.0.4`, `@ai-sdk/mcp@2.0.6`, `@ai-sdk/provider@4.0.1`,
  `@ai-sdk/provider-utils@5.0.4`). No source changes were required; the API
  surface is unchanged from the tracked beta.
- Dependencies: routine patch/minor updates across the stack (TanStack Query
  5.101, better-sqlite3 12.11, recharts 3.9, Vite 8.1, Vitest 4.1.9,
  Tailwind 4.3.2, electron-builder 26.15.3, and others).
- Message persistence now keeps a per-conversation in-memory mirror and memoizes
  message JSON validation, removing the synchronous O(conversation) hot paths
  that ran during active streams and conversation loads.
- Streaming chat scrolling now uses React Virtuoso's native follow/autoscroll
  machinery instead of a manual sticky-bottom hook, avoiding competing scroll
  writers while messages grow in place.

## [0.2.5] - 2026-07-03

### Added

- Sub-agents: a result switcher for multiple `await` outputs — a compact
  dropdown picks the sub-agent and shows the chosen result in one panel instead
  of stacking every result, defaulting to the first failure. Task entity layout
  restructured around a status rail with the objective as hero text.
- Context: a character-based token estimate as a fallback for the context
  budget, so compaction still triggers when no provider anchor exists (first
  turn, post-compaction) or when a large paste makes the anchor stale.

### Changed

- UI: window chrome is unified into a single app header that owns the drag
  strip, traffic-light inset, and sidebar toggle; pages project their title,
  stats, and actions into it via portals, gated so hidden keep-alive routes
  cannot leak content.
- Compaction: the summary prompt now asks for plain text instead of
  `<analysis>`/`<summary>` tags (tag stripping kept only as a legacy fallback).
- Agent runtime concurrency contract is now documented at every call site —
  the epoch vs cancel-generation clocks and the single run-status authority —
  backed by a new characterization test net, and the two hottest functions
  (`turn-loop.run`, `task-service.runTask`) were decomposed into cohesive
  helpers. Behavior-preserving.
- Docs: all 17 architecture documents rewritten from the current source
  (English with a Simplified-Chinese mirror).

### Fixed

- Chat frames were silently dropped when `attach()` locked onto a running turn
  whose snapshot was not yet queryable (e.g. the run right after an
  auto-compaction); the consumer is now notified with empty base messages so it
  builds its sink before live frames replay.
- Sub-agent driver lifecycle races: `instruct`/`redefine`/`resumeByChat` now
  await the previous driver's full teardown before restarting, preventing two
  drivers writing to the same chat. Self-dependencies fail fast, failed
  dependency ids are quoted so cascade retry can trace them, and late
  `set-result` events are ignored once a task is terminal.
- Pending questions self-resolve as declined after 30 minutes so a turn can
  never hang forever when the user walks away without responding.
- Workspace filesystem: a SHA-256 content hash on `FileStamp` makes same-length
  concurrent writes within the mtime resolution still trigger stale-write
  detection, and credential/`.git` path guards are enforced at the write
  boundary.
- Compaction split cuts fall back to a whole-message boundary when the head of a
  split assistant message contains tool invocations, so tool results in the tail
  are never orphaned.
- Sensitive environment-variable filtering for child processes broadened
  (webhooks, DB URLs, passphrases, encryption keys); hook-provided overrides go
  through the same deny-list so stripped secrets cannot be re-injected.

## [0.1.1] - 2026-06-27

### Fixed

- Shell tool no longer hangs on Windows when a command leaves a detached
  grandchild holding the inherited stdout/stderr pipe; the runner and background
  sessions now tear down their own pipe handles and settle instead of waiting on
  a `close` event that never fires.
- Chat session drops late streamed messages that arrived after a run settled, so
  the refreshed store messages are no longer overwritten by streaming-only state.

### Changed

- Renderer UI strings are routed through i18next with English and Simplified
  Chinese locale resources.
- Test suite made robust on Windows: shell/path assertions use `basename`/`join`
  and the stdin round-trip test polls for output instead of a fixed window.

## [0.1.0] - 2026-06-26

Initial public release.

### Added

- Local-first agent runtime working on real workspace files and processes, built
  on a layered `AgentService` / `RunEngine` / `TurnLoop` design over the AI SDK
  tool loop.
- Multi-provider AI configuration (Anthropic, OpenAI, Google, DeepSeek, and any
  OpenAI-compatible endpoint) with credentials in the OS secure store.
- Model Context Protocol (MCP) integration exposing server tools to the agent.
- Sandboxed tools: workspace-confined filesystem access with symlink-escape and
  credential-path protection, and shell execution with a stripped environment.
- Approval system with a policy engine, configurable rules, and permission modes,
  including consolidated single-card handling for concurrent tool approvals.
- Context engineering with section/provider model, budgeting, compaction, and
  forking.
- Subprocess hooks compatible with Codex / Claude Code event triggers.
- Architecture reference under `docs/architecture/`.

[Unreleased]: https://github.com/f4tumnigrum/Tanzo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/f4tumnigrum/Tanzo/compare/v0.2.9...v0.3.0
[0.2.7]: https://github.com/f4tumnigrum/Tanzo/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/f4tumnigrum/Tanzo/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/f4tumnigrum/Tanzo/compare/v0.2.4...v0.2.5
[0.1.1]: https://github.com/f4tumnigrum/Tanzo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/f4tumnigrum/Tanzo/releases/tag/v0.1.0
