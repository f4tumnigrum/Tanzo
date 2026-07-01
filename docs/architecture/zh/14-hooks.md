# 14 · 钩子系统

> 适用范围：与 Codex / Claude Code 兼容的子进程钩子——事件触发、载荷契约、信任模型、设置。最后核对：`src/main/agent/hooks/*` 与 `src/shared/hooks.ts`（v0.2.4）。

## 1. 钩子是什么

钩子是用户或插件提供的子进程，Tanzo 在生命周期节点运行它们。`PreToolUse` 钩子可阻断或改写工具调用；`UserPromptSubmit` 钩子可阻断 prompt 或注入上下文；`PostToolUse` / `Stop` 钩子可把消息回灌给 agent。它们有意与 Codex / Claude Code 钩子兼容，故现有钩子脚本大体可用。

## 2. 事件类型

`src/shared/hooks.ts` 定义两套：

- **完整 Tanzo 集**（`HOOK_EVENTS`，`:1-11`）：`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`。
- **v1 / Claude Code 兼容集**（`HOOK_EVENTS_V1`，`:16-22`）：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`Notification`。

配置键为 snake_case（`pre_tool_use`、`post_tool_use`……），在 `hooks/config.ts` 映射。

> 完整集里的部分事件（`PermissionRequest`、`PreCompact` / `PostCompact`、`SubagentStart` / `SubagentStop`）已声明但未必都有对应载荷类型或派发点——除非能找到派发处，否则视为预留。

## 3. 子进程执行（`hooks/executor.ts`）

钩子经 Node `child_process.spawn` 用解析出的 shell 派生：

- `detached: platform !== 'win32'`（`executor.ts:75`）—— Unix 上成进程组，用 `process.kill(-pid, 'SIGKILL')` 杀；Windows 用 `taskkill … /t /f`。
- 超时：默认 600 000 ms（`DEFAULT_TIMEOUT_MS`，`executor.ts:8`），最小 1 000 ms；每项 `timeout` 字段可覆盖。
- stdout/stderr 各封顶 1 MB（`MAX_CAPTURE_BYTES`，`executor.ts:9`）。
- stdin：写入 JSON 载荷后关闭流。

## 4. 载荷契约（`hooks/types.ts`）

stdin 恒为 `JSON.stringify(HookInput)`。公共字段：`session_id`、`turn_id`、`transcript_path`、`cwd`、`model`、`permission_mode`。事件特有追加：

- `PreToolUse`：`tool_name`、`tool_input`、`tool_use_id`。
- `PostToolUse`：`tool_name`、`tool_input`、`tool_response`、`tool_use_id`。
- `UserPromptSubmit`：`prompt`。
- `SessionStart`：`source: 'startup' | 'resume' | 'clear' | 'compact'`。
- `Stop`：`stop_hook_active`、`last_assistant_message`。

`permission_mode` 线上值把内部模式映射到 Claude Code 名（`hooks/service.ts`）：`default → 'default'`、`plan → 'plan'`、`yolo → 'dontAsk'`、`dangerous → 'bypassPermissions'`。

## 5. 输出 / 退出码契约（`hooks/output-parser.ts`）

- 退出 0 且无 stdout → 直通（无效果）。
- 退出 0 且 JSON stdout → 对照每事件 Zod schema 解析。
- 退出 2 → stderr 文本成为阻断/拒绝原因（`PreToolUse` / `UserPromptSubmit` = 拒绝；`PostToolUse` / `Stop` = 反馈消息）。
- 其它非零 → 错误条目，记日志。

`PreToolUse` JSON 识别 `decision: 'approve' | 'block'`、`reason`，以及 `hookSpecificOutput.permissionDecision: 'allow' | 'deny' | 'ask'` 带原因与 `additionalContext`。通用字段含 `continue: false`（非 PreToolUse → 停 agent）、`stopReason`、`suppressOutput`、`systemMessage`。注意：`hookSpecificOutput.updatedInput`（PreToolUse）与 `updatedMCPToolOutput`（PostToolUse）当前被解析但忽略并告警。

## 6. 工具名别名（Codex / Claude Code 兼容）

`hooks/tool-aliases.ts` 把 Tanzo 工具名同时对本地名与其 Claude Code 别名匹配：

```text
shell / shellStart → Bash
fileEdit           → Edit
multiEdit          → MultiEdit, Edit
fileWrite          → Write
fileRead           → Read
glob / grep        → Glob / Grep
```

`matchNamesForTool(toolName)` 返回 `[toolName, ...aliases]`，故 `matcher` 指向 `Bash` 的钩子会为 Tanzo 的 `shell` 触发。配合 `HOOK_EVENTS_V1`，使 Claude Code 钩子配置大体可移植。

## 7. 信任模型（`hooks/trust.ts`）

每个钩子条目有 `contentHash` = `{ command, commandWindows, event, matcher }` 的 SHA-256（`hooks/config.ts`）。信任状态：

| 状态 | 条件 |
|---|---|
| `managed` | 来源为 `managed`（插件贡献）—— 恒活跃 |
| `trusted` | 存储哈希等于当前 `contentHash` |
| `modified` | 存储哈希存在但不再匹配（命令被改） |
| `untrusted` | 无存储哈希 |

`isActive(entry, state) = isEnabled && (managed || trusted)`（`trust.ts:17-20`）。`untrusted` 与 `modified` 钩子都不执行——编辑受信钩子的命令会静默解除其武装，直到重新批准。`setTrusted(key, contentHash)` 批准钩子于当前内容；`setEnabled(key, enabled)` 切换而不改信任。

## 8. 发现与设置

配置发现分层，低 → 高优先级（`hooks/discovery.ts`）：

1. `{userDir}/hooks.json`（自定义用户目录）—— 来源 `user`。
2. `~/.tanzo/hooks.json` —— 来源 `user`。
3. `.tanzo/hooks.json`（cwd）—— 来源 `project`。
4. 插件贡献的配置 —— 来源 `managed`（自动受信，无需用户批准）。

信任/启用状态存在共享的 `app_settings` 表，键前缀 `hooks.state:`，按 `workspaceId`（或 app 作用域）作用域，值为 `{ enabled, trustedHash? }`（`hooks/store.ts`）。无专用 hooks 表。详见 [22 持久化](./22-persistence.md)。

## 9. 上下文注入

`hooks/context-section.ts`：钩子的 `additionalContext` 与 `feedback` 字符串按 chatId 缓冲（`PendingHookContext`），并在每步作为 volatile 的 `<hook-context>…</hook-context>` section 排进系统 prompt。这就是经 `contextEngine` 的 `extraSections` 挂载的额外 section。详见 [11 上下文工程](./11-context-engineering.md)。

下一篇 → [20 供应商运行时](./20-providers.md)
