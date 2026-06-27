# 13 · 策略与审批

> 适用范围：`toolApproval` 决策函数、规则优先级、权限模式、内置护栏、审批记忆、无状态重跑。最后核对：`src/main/agent/policy/*`、`runtime/build-agent.ts`、`src/shared/policy.ts`、`src/shared/approval-responses.ts`。

## 1. 心智模型

工具审批是一个**集中决策点**而非分散在各工具里的逻辑。每次工具调用前，`streamText` 调 `toolApproval` 回调（由 `buildAgentCall` 构造，`runtime/build-agent.ts:85`）。`agent/module.ts` 会先用 hooks 包裹 `PolicyEngine.decide`：`PreToolUse` 钩子可拒绝，否则继续交给标准策略引擎返回 ai-sdk 的 `ToolApprovalStatus`：

```
'approved' | 'denied' | 'user-approval' | 'not-applicable'
```

返回 `user-approval` 时该回合**自然停止**、把审批请求 part 流回 renderer——此刻 main **不持有任何审批状态**。用户响应被写进消息历史，下一次 `submit` 用含响应的完整历史重跑，SDK 看到已批准的调用直接执行。

## 2. 决策函数 `decide`（`policy/engine.ts:183`）

`buildAgentCall` 从 `metadata.tanzo` 取 `kind`/`fingerprintFields`，从 `runtimeContext` 取活跃模式与 chatId，传入 `decide`。`createAgentModule` 包裹后的实际求值顺序是：

0. **PreToolUse hooks**：受信任且启用的钩子若返回 deny，直接 `{type:'denied', reason}`；钩子只能收紧，不能放宽策略。
1. **内置 + 用户 DENY 规则**（最先匹配）→ `{type:'denied', reason}`。
2. `exitPlanMode` → 恒 `user-approval`。
3. **计划模式 + 非只读工具** → denied（"plan mode: writes are blocked"）。
4. **已记忆决策**（持久 `listDecisions` 或 session 缓存），按 `fingerprint(toolName, input, fingerprintFieldsFor(toolName))` 匹配。注：`decide` 忽略传入的 `fingerprintFields`，改用静态 `FINGERPRINT_FIELDS` 映射（`engine.ts:19-27`）。
5. **ALLOW 规则**（内置 + 用户）→ `approved`。
6. **yolo / dangerous 模式** → `approved`。
7. **ASK 规则** → `user-approval`。
8. **只读工具** → `not-applicable`（无需审批直接跑）。
9. 否则 → `user-approval`。

**失败安全**：任何异常降级为 `user-approval` 并记日志（`engine.ts:227-229`）——规则求值 bug 永不会静默批准。

`isReadOnlyTool`（`engine.ts:30`）：`kind ∈ read|search` 或 name ∈ `{fileRead, glob, grep, skill, subagentCheck, askQuestion}`。

## 3. 规则模式（`src/shared/policy.ts`）

```ts
type PolicyRule = {
  id, source, scope, action: 'allow'|'deny'|'ask',
  priority, match, reason
}
type PolicyMatch = {
  toolName?, toolNameGlob?,            // 大括号/星号 glob → globToRegExp
  argMatch?: { path, equals | regex }  // 按入参路径匹配
}
```

`mergeRules`（`engine.ts:124`）固定优先级：内置 deny → 用户 deny → 用户 allow → 内置 allow → 用户 ask。`PolicyStore` 持久化规则、决策、每对话模式。

## 4. 内置护栏（`policy/builtin-rules.ts`）

全部 `source:'builtin', scope:'system', priority:0`：

- **拒绝**任何 `path` 入参匹配 `.git/`。
- **拒绝**任何 `path` 入参匹配敏感路径模式（`.ssh`/`.aws`/`.env` 凭证）。
- **拒绝 shell**（`shell`/`shellStart` 的 command **与** `shellWrite` 的 input 双向量）：`rm -rf /|~|.|*`、`rm --no-preserve-root`、fork 炸弹、`dd of=/dev/<block>`、`mkfs`、`> /dev/<block>`。
- **拒绝凭证读取**（`b.cred-read`，`builtin-rules.ts:41-45`）：经 `cat|less|more|head|tail|bat|nl|xxd|od|strings|base64|openssl` 等读取 `.ssh/`、`.aws/`、`.env*`、`id_rsa/ed25519` 等（同样对 shell command 与 shellWrite input 双向量）。
- **允许** `{fileRead, glob, grep, skill, askQuestion}`（priority 100）。

## 5. 权限模式

```ts
type PermissionMode = 'default' | 'plan' | 'yolo' | 'dangerous'
```

每对话解析，回落全局（`modeFor`，`engine.ts:146`），经 `policyStore.saveMode` 持久化。活跃模式同时传入模型 `runtimeContext`（`build-agent.ts:58`），供 `extractMode` 读取。

| 模式 | 行为 |
|---|---|
| `default` | 标准审批流（按上面优先级） |
| `plan` | 写类工具被拦截；只读子代理可用；`exitPlanMode` 走审批 |
| `yolo` | ASK 类直接批准（仍受 DENY 与内置护栏约束） |
| `dangerous` | 绕过沙箱包含校验（仍强制凭证路径拒绝）；批准 ASK 类 |

## 6. 审批记忆指纹

`fingerprint(toolName, input, fields)`（`engine.ts:55`）= 对 `toolName` + 仅 `fingerprintFields` 投影的稳定串化做 sha256（如 `shell→[command]`，编辑类 `→[path]`）。这把"记住这个决策"限定到有意义的入参——批准一条 shell 命令不会盲批所有 shell。决策作用域 `SubagentApprovalScope = 'once' | 'session' | 'forever'`：`session` 存内存缓存，`forever` 持久化到 `policy_decisions` 表。

## 7. 无状态重跑链路

审批续航全由消息承载，main 无状态：

```
PolicyEngine 在 toolApproval 返回 'user-approval'
  → ai-sdk 吐 tool-approval-request chunk，回合自然停止，stream 返回
  → renderer 从 approval-requested 状态渲染审批 UI（ApprovalGroup）
  → 用户点批准/拒绝 → 经 chat:respond-approvals 把响应写进消息
  → applyApprovalResponses(messages, responses)（shared/approval-responses.ts）
       把 approval-requested 工具 part 迁移到 approval-responded
  → main 用含审批响应的完整历史起全新 streamText 运行
  → SDK 在 step 起点看到已批准调用，直接执行、继续
```

`applyApprovalResponses`（`approval-responses.ts:34`）是纯共享逻辑：遍历 assistant 工具 part，用 ai-sdk 的 `isToolUIPart`/`isDynamicToolUIPart`/`getToolName` 识别并迁移状态，返回新消息 + `AppliedApprovalResponse[]`。

子代理审批经 `subagent/approval-utils.ts`（`extractPendingApprovals`/`applyApprovalResponse`）+ `subagent/task-service.ts`（`listApprovals`/`respondApproval`，发 `data-taskApproval`）路由到 root 对话（[12 工具系统](./12-tools.md) §6）。

## 8. 策略 IPC（`POLICY_CHANNELS`）

`listRules`/`saveRule`/`deleteRule`/`listDecisions`/`revokeDecision`/`getMode`/`setMode`。renderer 在 Settings → Permissions 标签编辑（[30 渲染层](./30-renderer.md)）。Hooks 的 list/reload/trust/preview 属于独立 `HOOKS_CHANNELS`，但会在审批前参与 `decide`。

## 9. 策略不变量

- [ ] 优先级：PreToolUse hooks deny > deny > 计划模式写拦截 > 已记忆 > allow > yolo/dangerous > ask > 只读跳过 > 默认 ask。
- [ ] 求值异常降级为 `user-approval`，永不静默批准。
- [ ] main 不持有审批状态机；审批活在消息里，经 `applyApprovalResponses` 迁移。
- [ ] 凭证/`.git` 路径与破坏性 shell 命令由内置规则硬拒。
- [ ] 审批记忆按 `fingerprintFields` 指纹限定作用域。

下一篇 → [20 供应商运行时](./20-providers.md)
