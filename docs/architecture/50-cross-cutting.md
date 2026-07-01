# 50 · Cross-Cutting Concerns

> Scope: the error model, logging, telemetry, security posture, i18n, and theming — concerns that span every
> subsystem. Last verified against `src/shared/errors.ts`, `src/main/logger.ts`, `src/main/agent/telemetry/*`,
> `src/main/agent/security/*`, `src/main/safe-env.ts`, `src/renderer/src/i18n.ts`, and
> `src/renderer/src/common/theme/*` at v0.2.4.

## 1. Error model

`src/shared/errors.ts` is the single error contract used across all three processes:

- **Hierarchy**: base `TanzoError extends Error` with `{ code, recoverable, details }`, and subclasses
  `Invariant / Configuration / Validation / NotFound / Operation / Integration / Auth / Timeout`
  (`TanzoTimeoutError` defaults `recoverable: true`). A central `ERROR_CODES` map names codes for chat,
  runtime, agent, policy, database, and AI-SDK domains, plus `UNEXPECTED_ERROR`.
- **IPC transport**: because Electron IPC can only carry an `Error.message` string, `encodeIpcError` wraps a
  serialized error behind the marker `__TANZO_IPC_ERROR__:`, and `decodeIpcError` parses it back on the
  renderer. The router (`src/main/ipc/router.ts`) encodes both sync throws and rejected promises, and normalizes
  Zod errors to `IPC_INPUT_INVALID`. `details` are sanitized via a JSON round-trip. See
  [04 IPC & Contracts](./04-ipc-and-contracts.md).
- **Renderer consumption**: client wrappers (`platform/electron/ipc-errors.ts`) re-throw a decoded `TanzoError`,
  and UI code branches on `error instanceof TanzoError ? error.code`.

## 2. Logging (`electron-log`)

- **Main** (`src/main/logger.ts`): uses `electron-log/main`. `initializeLogger` sets a file level of `info`
  (5 MB max, `main.log`), a console level of `warn` when packaged / `debug` in dev, scope padding, and a global
  uncaught-error catcher that logs without a dialog. `createLogger(scope)` yields scoped loggers (default scope
  `main`); subsystems create their own (`'agent.module'`, `'policy'`, `'agent.ipc'`, …).
- **Renderer** (`src/renderer/src/common/logger.ts`): uses `electron-log/renderer`, with per-scope loggers
  (default `renderer`). This is why `electron-log` is excluded from preload externalization (see
  [40 Build & Release](./40-build-and-release.md)).

## 3. Telemetry

Telemetry (`src/main/agent/telemetry/*`) wraps the AI SDK's telemetry integration and fans normalized events out
to four sinks: a UI sink (transient `data-telemetry` chunk), a logger sink, a memory sink, and a DB sink that
persists `tool-finish` events into `tool_executions`. Token/usage accounting is kept separately on `runs` /
`run_steps`. The Usage panel reads it back via `repositories/activity-repo.ts`. See
[22 Persistence](./22-persistence.md) and [23 Workspace Integrations](./23-workspace-integrations.md).

## 4. Security posture

Security is defense-in-depth, applied independently at each surface (invariant §3.7 in
[01 Introduction](./01-introduction.md)):

- **Window sandbox** — both windows use `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a
  navigation allowlist, and `<webview>` hardening. See [03 Process Model](./03-process-model.md).
- **Path sandbox** — every filesystem surface applies workspace containment + a symlink `realpath` check +
  credential-path denial (`security/path-safety.ts`, `fs/workspace-fs.ts`, `search/backend.ts`). Even
  `dangerous` mode still blocks credential paths. See [12 Tools](./12-tools.md).
- **Stripped shell environment** — `safeChildEnv` (`src/main/safe-env.ts`) removes API keys / secrets / tokens /
  provider names from the environment of every spawned shell, background session, hook, and stdio MCP server.
- **Destructive-command interception** — the policy engine's built-in rules deny `rm -rf /`, credential reads,
  `mkfs`, `dd` to block devices, fork bombs, and similar. See [13 Policy & Approval](./13-policy-and-approval.md).
- **Credentials never cross IPC in plaintext** — provider secrets are encrypted with Electron `safeStorage` and
  only ever leave `main` masked. See [20 Providers](./20-providers.md).
- **Browser automation boundary** — the built-in chrome-devtools-mcp server is launched against a loopback-only
  debugging port with `--blockedUrlPattern file://**`, so the agent cannot drive the app's own renderers. See
  [21 MCP](./21-mcp.md).
- **Approval gate** — sensitive tool calls pass through hooks `PreToolUse` and the policy engine; approval lives
  in the message. See [13 Policy & Approval](./13-policy-and-approval.md).

## 5. Internationalization

`src/renderer/src/i18n.ts` supports `en` and `zh-CN` via `i18next` / `react-i18next`. The initial language is
derived from the system's preferred languages/locale (`resolveLanguage` maps any `zh*` → `zh-CN`, else `en`),
with `fallbackLng: 'en'` and an English-fallback re-init on error. `getLocale` returns `zh-CN` / `en-US`. The
active language follows `preferences.language` via `I18nLanguageSync`. Locale resources live in
`src/renderer/src/locales/`. See [30 Renderer](./30-renderer.md).

## 6. Theming

Theming is CSS-variable based (`src/renderer/src/common/theme/*`). `applyThemeSettings` writes palette variables
(`--<key>`) and override variables (`--radius`, `--spacing`, `--font-*`, `--shadow-*`, `--font-size-base`) plus
`data-*` attributes onto `document.documentElement`; `ThemeInitializer` re-applies them on preference or
resolved-theme change. Presets use OKLCH color values, and custom themes are snapshot-driven. The dark/light
resolution is stored in preferences (the source of truth), not react-query. See [30 Renderer](./30-renderer.md).

---

This completes the architecture set. Return to the [index](../README.md) for reading paths, or start again at
[01 Introduction](./01-introduction.md).
