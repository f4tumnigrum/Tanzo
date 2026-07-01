# 13 · 策略与审批

> 适用范围：`toolApproval` 决策函数、策略引擎（规则优先级、权限模式、内置护栏、审批记忆），以及审批为何活在消息历史而非服务端状态机。最后核对：`src/main/agent/policy/*`、`src/shared/policy.ts`、`src/shared/approval-responses.ts`、`src/main/agent/module.ts`（v0.2.4）。

> 提示：`src/main/agent/policy/engine.ts` 含一个会绊倒文本读取的字节（部分工具将其误报为二进制）。它是普通 TypeScript，请用 shell（`sed`/`grep`）阅读。下文行号取自磁盘文件。

## 1. `toolApproval` 决策函数

AI SDK 的 `streamText` 在执行任何工具调用前调用 `toolApproval` 回调。其返回类型是 `ToolApprovalStatus`（来自 `ai`）：

- `'approved'` —— 立即执行。
- `'user-approval'` —— 暂停并请求用户确认。
- `'not-applicable'` —— 无策略适用（视为放行）。
- `{ type: 'denied', reason? }` —— 带原因的硬阻断。

`buildAgentCall` 构造该回调（`runtime/build-agent.ts:85-96`）：从 `tool.metadata.tanzo` 读每工具的 `kind`、`fingerprintFields`（`build-agent.ts:16-33`），把 `PolicyDecisionInput` 转发给 `input.decide(...)`。接线于 `runtime/stream-runner.ts:282`。

### hooks 前置门

传给 `createAgentService` 的 `policy` 对象用 `PreToolUse` hook 检查包裹引擎的 `decide`（`module.ts:290-306`）：从 runtime context 解析 chat id，跑 `hooks.runPreToolUse(...)`，若某 hook 阻断则返回 `{ type: 'denied', reason }`，否则交给 `policyEngine.decide(input)`。故决策顺序是**hooks PreToolUse → 策略引擎**。详见 [14 钩子系统](./14-hooks.md)。

## 2. 策略引擎

类型在 `src/shared/policy.ts` 与 `src/main/agent/policy/types.ts`。

- `PolicyRule` = `{ action: 'allow' | 'deny' | 'ask', source: 'builtin' | 'user', scope, priority, match }`，`match` 为 `{ toolName?, toolNameGlob?, argMatch?: { path, equals?, regex? } }`。
- `PermissionMode` = `'default' | 'plan' | 'yolo' | 'dangerous'`。
- `PolicyUserDecision` = `{ toolName, inputFingerprint, decision, scope: 'session' | 'forever', decidedAt, expiresAt?, scopeTargetId? }`。

### 2.1 规则排序（`engine.ts:124-134`）

`mergeRules(builtin, user)` 产出单一有序列表：

```text
builtin deny  →  user deny(按优先级)  →  user allow(按优先级)  →  builtin allow  →  user ask(按优先级)
```

`matchRule`（`engine.ts:113-120`）按精确 `toolName`、`toolNameGlob`（经 `globToRegExp` 编译，`engine.ts:79-94`）、以及从工具入参读 JSON 路径并按 `equals` 或 `regex` 比较的 `argMatch` 匹配。

### 2.2 `decide()` 流程（`engine.ts:183-231`）

对每个工具调用，按序：

1. **deny 优先。** 任一 `deny` 规则匹配则返回 `{ type: 'denied', reason }`（`engine.ts:189-190`）。
2. **`exitPlanMode` 恒问。** 返回 `'user-approval'`（`engine.ts:192`）。
3. **计划模式写拦截。** 解析活动模式（`engine.ts:194-195`）；`plan` 模式下任何非只读工具返回 `{ type: 'denied', reason: 'plan mode: writes are blocked' }`（`engine.ts:196-198`）。这发生在记忆决策**之前**，故计划模式无法被此前的放行绕过。
4. **记忆决策。** 计算 `fingerprint`（`engine.ts:200`），先查持久化决策（经 `scopeTargetId` 作用域到工作区，或旧的无作用域项）再查会话缓存；命中即返回（`engine.ts:201-214`）。
5. **allow 规则。** 任一 `allow` 规则匹配则返回 `'approved'`（`engine.ts:216-218`）。
6. **yolo / dangerous。** 返回 `'approved'`（`engine.ts:220`）。
7. **ask 规则。** 任一 `ask` 规则匹配则返回 `'user-approval'`（`engine.ts:222-223`）。
8. **默认回退。** 只读工具返回 `'not-applicable'`；其余返回 `'user-approval'`（`engine.ts:225-226`）。

任何抛出的错误都被捕获并降级为 `'user-approval'`——引擎失败即安全（`engine.ts:227-229`）。

### 2.3 内置护栏（`policy/builtin-rules.ts`）

所有内置规则 `priority: 0`、`source: 'builtin'`。deny 规则：

- `b.git` —— 拒绝 `path` 匹配 `(^|/)\.git(?:/|$)` 的任何工具。
- `b.ssh` —— 拒绝凭证文件路径（`SENSITIVE_PATH_PATTERN`）。
- `b.rmrf` —— 拒绝 `{shell, shellStart}.command` / `shellWrite.input` 中对 `/ ~ * ..` 的破坏性 `rm -rf`。
- `b.cred-read` —— 拒绝经 cat/less/base64/openssl/… 读取 `.ssh/`、`.aws/`、`.env`、密钥文件。
- `b.rm-no-preserve`、`b.forkbomb`、`b.dd-device`、`b.mkfs`、`b.dev-redirect` —— 其它破坏性模式。

一条 allow 规则：`b.read`（`priority: 100`，action `allow`）—— `{ fileRead, glob, grep, skill, askQuestion }` 恒放行。详见 [12 工具系统](./12-tools.md)。

### 2.4 指纹与记忆

`fingerprint(toolName, input, fields?)`（`engine.ts:56-60`）是对工具名与入参规范化字符串投影的稳定、顺序无关的 SHA-256。给定 `fingerprintFields` 时（`FINGERPRINT_FIELDS`：`shell → [command]`，`fileEdit`/`multiEdit`/`fileWrite → [path]`，`engine.ts:19-23`），只哈希这些字段，故"批准此命令"能在无关参数变化时仍生效。

`remember(decision, chatId)`（`engine.ts:248-258`）：`'session'` 决策进内存 `sessionCache`（按工作区作用域 + 指纹为键）；`'forever'` 决策经 `policyStore.saveDecision` 持久化到 SQLite，并标上工作区 `scopeTargetId`。故决策**作用域到工作区**：工作区 A 的批准不适用于工作区 B（旧的无作用域行全局适用）。读取时过滤过期决策。

权限模式是每对话带全局回退：`setMode(next, chatId?)` 存对话覆盖（经 `policyStore.saveMode` 持久化）或设全局模式（`engine.ts:236-247`）；`modeFor(chatId)` 优先对话覆盖（`engine.ts:166-169`）。

### 2.5 持久化

`policy/policy-store.ts` 拥有三张表：`policy_rules`（用户规则）、`policy_decisions`（记忆决策）、`policy_modes`（每对话模式覆盖）。详见 [22 持久化](./22-persistence.md)。

## 3. 审批活在消息里

不存在服务端审批状态机。审批状态完全编码在助手 `UIMessage` 内的工具调用 part，采用两态生命周期：

- `'approval-requested'` —— `toolApproval` 返回 `'user-approval'` 时由 SDK 发出；该 part 携 `approval.id`（UUID）与工具 `input`。
- `'approval-responded'` —— 用户响应后写回，内嵌 `approval: { id, approved, reason? }`。

关键助手（`src/shared/approval-responses.ts`）：

- `hasPendingApprovalRequest(messages)` 扫描所有助手 part 找 `state === 'approval-requested'`。
- `applyApprovalResponses(messages, responses)` 把匹配 part 改写为 `'approval-responded'`，返回新消息数组与已应用响应。

子代理路径（`src/main/agent/subagent/approval-utils.ts`）：`extractPendingApprovals` 作用域到**当前回合**（最后用户消息之后的一切），使中止回合的过期审批无法重现；`applyApprovalResponse` 是单审批变体；`hasUnresolvedApproval` 仅查最后一条助手消息。

机制：run 停在等待审批时，请求 part 流向 renderer 且 run 结束（`AbortController` 是 main 仅存的跨调用状态）。用户响应写回历史后再次 `submit`；main 用**完整**历史重跑 `streamText`，SDK 从 part 读 `approval.approved` 并据此继续或取消该调用。此即 [01 引言](./01-introduction.md) 的不变量 §3.4。

下一篇 → [14 钩子系统](./14-hooks.md)
