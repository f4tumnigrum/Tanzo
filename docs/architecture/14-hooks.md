# 14 · 钩子系统（Hooks）

> 适用范围：与 Codex / Claude Code 兼容的用户可配置子进程钩子系统。最后核对：`src/main/agent/hooks/*`、`src/shared/hooks.ts`、`src/main/agent/ipc/hooks.ts`、`src/preload/hooks.ts`、`src/renderer/src/features/settings/ui/settings-hooks-tab.tsx`。

## 1. 当前状态

Hooks 是已落地的 Agent 子系统，不再只是设计稿：

- **配置解析**接受 Codex/Claude 事件集合：`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`。
- **v1 实际触发**：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`，以及 Tanzo 自用的 `Notification` 类型保留在 `HOOK_EVENTS_V1`。
- **配置格式**当前只读 `hooks.json`；TOML `[hooks]` 未接入。
- **设置 UI 已存在**：Settings → Hooks 通过 `HOOKS_CHANNELS` 列表、重载、启停、信任、预览。
- **信任状态**落 `app_settings`，不新增专用表。

## 2. 兼容契约

对脚本可见的线协议沿用 Codex/Claude 形态：

1. 配置事件键为 PascalCase，handler 是 `{ type:"command", command, commandWindows?, timeout?, async?, statusMessage? }`。
2. 执行时把事件载荷作为 **stdin JSON** 写给子进程，输入键为 `snake_case`，包含 `hook_event_name`。
3. stdout 输出为 `camelCase` JSON；未知字段按事件解析器拒绝或忽略到受控结果。
4. 退出码语义：`0` 解析 stdout，`2` 用 stderr 表示阻断/反馈，其它为非阻断失败。

`updatedInput` 与 `updatedMCPToolOutput` 当前接受但不改写实际工具入参/输出；服务会记录保守告警。这是 v1 的明确裁剪。

## 3. 主进程模块结构

```text
src/main/agent/hooks/
  types.ts             事件名、线协议输入/输出、HookEntry、HookOutcome
  config.ts            hooks.json 解析、matcher 编译、schema 守卫
  discovery.ts         项目/用户/app 配置发现与分层合并
  trust.ts             内容哈希、enabled/trusted/modified/untrusted 判断
  store.ts             trust/enabled 状态写入 app_settings
  executor.ts          带 stdin 的子进程执行器，复用 shell 解析与 safeChildEnv
  dispatcher.ts        匹配 handler、执行、按声明顺序聚合结果
  output-parser.ts     按事件解释 stdout/stderr/exitCode
  pending-context.ts   per-chat 待注入上下文缓冲
  context-section.ts   把 pending context 暴露给 ContextEngine
  tool-aliases.ts      Tanzo↔Codex/Claude 工具名静态别名（见 §7）
  service.ts           HookService 对运行时与 UI 的统一入口
```

执行器独立于普通 shell 工具：hooks 需要 stdin，因此不能复用 `shell/runner.ts` 的 `stdio: ['ignore','pipe','pipe']` 形态。

## 4. 发现、信任与存储

`createHookService` 使用 `createHooksStore(db)`，并从 `agent/module.ts` 注入 `userDir` 与 session metadata。

- **项目层**：对话 cwd 下的 `.tanzo/hooks.json`。
- **用户层**：`~/.tanzo/hooks.json` 与 app userData 下的 agent 目录。
- **信任门**：只有 enabled 且 trusted/managed 的 hook 会执行；新 hook 或命令内容变化后保持可见但 inert，直到用户信任。
- **持久化**：enabled/trusted/contentHash 写 `app_settings`，与 settings/preferences 的轻量键值策略一致。

## 5. 生命周期缝点

| 事件 | 当前缝点 | 效果 |
|---|---|---|
| `SessionStart` | `ChatInbox.submitMessage` 首次提交路径 | 可追加上下文；阻断会拒绝本次提交 |
| `UserPromptSubmit` | `ChatInbox.submitMessage` 用户消息入口 | 可追加上下文；可阻断用户 prompt |
| `PreToolUse` | `agent/module.ts` 包裹 `policy.decide` | 在标准策略前短路 deny；不能放宽策略 |
| `PostToolUse` | 工具执行后反馈路径 | 追加上下文/反馈到后续 step；不改写工具输出 |
| `Stop` | `AgentService.run` 完成后 | fire-and-forget；阻断续接不是 v1 行为 |

上下文注入由 `hooks/pending-context.ts` 暂存，再由 `hooks/context-section.ts` 作为 `ContextSection` 注入 `ContextEngine`。这让 hooks 追加内容走同一套 Section × Provider 缓存/布局路径。

## 6. IPC 与 renderer

共享契约在 `src/shared/hooks.ts`：

```ts
HOOKS_CHANNELS = {
  list: 'hooks:list',
  reload: 'hooks:reload',
  setEnabled: 'hooks:set-enabled',
  setTrusted: 'hooks:set-trusted',
  preview: 'hooks:preview'
}
```

preload 在 `src/preload/hooks.ts` 暴露 `window.electron.hooks`；renderer 的 `platform/electron/hooks-client.ts` 包 `withDecodedIpcErrors`；Settings 页面通过 `settings-hooks-tab.tsx` 提供启停、信任、reload 与 preview。

## 7. 工具名匹配

Codex/Claude matcher 常写 `Bash`、`Edit`、`Write`、`Read` 等名；Tanzo 工具名是 `shell`、`fileEdit`、`fileWrite`、`fileRead`。`hooks/tool-aliases.ts` 维护静态别名，使 matcher 可命中 Tanzo 实际工具名或兼容别名。

## 8. 风险与不变量

- [ ] hooks 是任意代码执行入口；未信任 hook 必须 inert。
- [ ] `PreToolUse` 只能收紧策略，永不覆盖内置 deny 或审批规则为 allow。
- [ ] stdin/exitCode/stdout/stderr 语义必须保持 Codex/Claude 兼容。
- [ ] hooks context 只通过 ContextEngine 注入，避免绕开 prompt 布局与缓存策略。
- [ ] v1 不支持改写工具入参/输出，也不触发 PermissionRequest/Compact/Subagent 事件。

下一篇 → [20 供应商运行时](./20-providers.md)
