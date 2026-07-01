# 14 · Hooks

> Scope: the Codex / Claude Code–compatible subprocess hooks — event triggers, the payload contract, the trust
> model, and settings. Last verified against `src/main/agent/hooks/*` and `src/shared/hooks.ts` at v0.2.4.

## 1. What hooks are

Hooks are user- or plugin-provided subprocesses that Tanzo runs at lifecycle points. A `PreToolUse` hook can
block or rewrite a tool call; a `UserPromptSubmit` hook can block a prompt or inject context; `PostToolUse` /
`Stop` hooks can feed a message back to the agent. They are deliberately compatible with Codex / Claude Code
hooks so existing hook scripts largely work.

## 2. Event types

`src/shared/hooks.ts` defines two sets:

- **Full Tanzo set** (`HOOK_EVENTS`, `:1-11`): `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`,
  `PostCompact`, `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`.
- **v1 / Claude Code–compatible set** (`HOOK_EVENTS_V1`, `:16-22`): `SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PostToolUse`, `Stop`, `Notification`.

Config keys are snake_case (`pre_tool_use`, `post_tool_use`, …) mapped in `hooks/config.ts`.

> Some events in the full set (`PermissionRequest`, `PreCompact` / `PostCompact`, `SubagentStart` /
> `SubagentStop`) are declared but do not all have a corresponding payload type or dispatcher yet — treat them
> as reserved unless you can find a dispatch site.

## 3. Subprocess execution (`hooks/executor.ts`)

Hooks are spawned with Node `child_process.spawn` using the resolved shell:

- `detached: platform !== 'win32'` (`executor.ts:75`) — a process group on Unix, killed with
  `process.kill(-pid, 'SIGKILL')`; Windows uses `taskkill … /t /f`.
- Timeout: default 600 000 ms (`DEFAULT_TIMEOUT_MS`, `executor.ts:8`), minimum 1 000 ms; a per-entry `timeout`
  field overrides.
- stdout/stderr are each capped at 1 MB (`MAX_CAPTURE_BYTES`, `executor.ts:9`).
- stdin: the JSON payload is written then the stream is closed.

## 4. Payload contract (`hooks/types.ts`)

stdin is always `JSON.stringify(HookInput)`. Common fields: `session_id`, `turn_id`, `transcript_path`, `cwd`,
`model`, `permission_mode`. Event-specific additions:

- `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`.
- `PostToolUse`: `tool_name`, `tool_input`, `tool_response`, `tool_use_id`.
- `UserPromptSubmit`: `prompt`.
- `SessionStart`: `source: 'startup' | 'resume' | 'clear' | 'compact'`.
- `Stop`: `stop_hook_active`, `last_assistant_message`.

The `permission_mode` wire values map internal modes to Claude Code names (`hooks/service.ts`):
`default → 'default'`, `plan → 'plan'`, `yolo → 'dontAsk'`, `dangerous → 'bypassPermissions'`.

## 5. Output / exit-code contract (`hooks/output-parser.ts`)

- Exit 0 with no stdout → pass-through (no effect).
- Exit 0 with JSON stdout → parsed against a per-event Zod schema.
- Exit 2 → stderr text becomes a block/deny reason (`PreToolUse` / `UserPromptSubmit` = deny; `PostToolUse` /
  `Stop` = feedback message).
- Other non-zero → an error entry, logged.

`PreToolUse` JSON understands `decision: 'approve' | 'block'`, `reason`, and
`hookSpecificOutput.permissionDecision: 'allow' | 'deny' | 'ask'` with a reason and `additionalContext`.
Universal fields include `continue: false` (non-PreToolUse → stop the agent), `stopReason`, `suppressOutput`,
and `systemMessage`. Note: `hookSpecificOutput.updatedInput` (PreToolUse) and `updatedMCPToolOutput`
(PostToolUse) are currently parsed but ignored with a warning.

## 6. Tool-name aliases (Codex / Claude Code compatibility)

`hooks/tool-aliases.ts` matches Tanzo tool names against both native names and their Claude Code aliases:

```text
shell / shellStart → Bash
fileEdit           → Edit
multiEdit          → MultiEdit, Edit
fileWrite          → Write
fileRead           → Read
glob / grep        → Glob / Grep
```

`matchNamesForTool(toolName)` returns `[toolName, ...aliases]`, so a hook whose `matcher` targets `Bash` fires
for Tanzo's `shell`. Combined with `HOOK_EVENTS_V1`, this makes Claude Code hook configs largely portable.

## 7. Trust model (`hooks/trust.ts`)

Every hook entry has a `contentHash` = SHA-256 of `{ command, commandWindows, event, matcher }`
(`hooks/config.ts`). Trust status:

| Status | Condition |
|---|---|
| `managed` | source is `managed` (plugin-contributed) — always active |
| `trusted` | the stored hash equals the current `contentHash` |
| `modified` | a stored hash exists but no longer matches (the command changed) |
| `untrusted` | no stored hash |

`isActive(entry, state) = isEnabled && (managed || trusted)` (`trust.ts:17-20`). Neither `untrusted` nor
`modified` hooks execute — editing a trusted hook's command silently disarms it until re-approved.
`setTrusted(key, contentHash)` approves the hook at its current content; `setEnabled(key, enabled)` toggles it
without changing trust.

## 8. Discovery and settings

Config discovery layers, lowest → highest precedence (`hooks/discovery.ts`):

1. `{userDir}/hooks.json` (custom user dir) — source `user`.
2. `~/.tanzo/hooks.json` — source `user`.
3. `.tanzo/hooks.json` (cwd) — source `project`.
4. Plugin-contributed configs — source `managed` (auto-trusted, no user approval needed).

Trust/enabled state is stored in the shared `app_settings` table under the key prefix `hooks.state:`, scoped by
`workspaceId` (or the app scope), with value `{ enabled, trustedHash? }` (`hooks/store.ts`). There is no
dedicated hooks table. See [22 Persistence](./22-persistence.md).

## 9. Context injection

`hooks/context-section.ts`: a hook's `additionalContext` and `feedback` strings are buffered per chatId
(`PendingHookContext`) and drained into the system prompt as a volatile `<hook-context>…</hook-context>`
section on each step. This is the extra section mounted via `contextEngine`'s `extraSections`. See
[11 Context Engineering](./11-context-engineering.md).

Next → [20 Providers](./20-providers.md)
