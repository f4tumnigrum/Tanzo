# 10 · Agent 运行时

> 适用范围：Agent 模块工厂、一次运行的端到端执行、并发与状态、持久化时机、压缩续航、子系统协作。最后核对：`src/main/agent/module.ts`、`service.ts`、`runtime/*`、`ipc/*`、`repositories/*`。

## 1. 心智模型

Agent 运行时由三层组成：

- **入口层 = `AgentService` + `ChatMailbox`**：`service.ts` 暴露 `run`/`submitMessage`/`respondApprovals`/`compact`/`enqueue` 等公共能力，并用 `ChatMailbox` 保证每个 chatId 串行执行。
- **生命周期层 = `RunEngine` + `TurnLoop`**：`RunEngine` 管 run 代次、取消、preparing/inflight 状态、stream start/finish；`TurnLoop` 管变更捕获、压缩、续航、计划模式补救、终结化。
- **内层循环 = ai-sdk `ToolLoopAgent`**：一次 `agent.stream()` 内自动跑「调模型 → 执行工具 → 回灌 → 再调」，Tanzo 不手写模型工具循环（[ADR-0001](./adr/0001-use-ai-sdk-toolloopagent.md)）。

审批状态仍活在消息里，不在 main 的闭包状态中（[13 策略与审批](./13-policy-and-approval.md)）。main 在跨调用上承载正确性的状态是 `RunEngine` 的 `AbortController`、epoch、preparing/inflight map 与 active run 集合。

## 2. 模块工厂 `createAgentModule`

```ts
interface AgentModuleOptions {
  db: SqlDatabase
  providerService: ProviderService
  mcpService: McpService
  workspaceRoot: string
  getWindows: () => BrowserWindow[]
  getChatWindows?: () => BrowserWindow[]
}
interface AgentModule {
  service: AgentService
  skills: SkillsStore
  presence: PresenceAggregator
  registerIpc(ipcMain: IpcMain): void
  close(): Promise<void>
}
```

构造顺序体现依赖方向：policy store/engine → shell + shell sessions → chat stream registry/sink → presence → skills → identity/store → hooks → goal → git/change-set → questions → context engine → tools builder → service。

关键接线：

- `hooks` 在 `module.ts` 中创建，`PreToolUse` 通过包裹 `policy.decide` 成为标准审批前的附加门。
- `contextEngine` 通过 `extraSections` 挂载 hooks context section。
- `buildTools` 每次按当前 conversation cwd 创建 `WorkspaceFs` / search backend，并把 `mode === 'dangerous'` 映射到沙箱策略。
- `registerAgentIpc` 聚合 chat/goal/policy/hooks/skills/activity/git/changeSet handlers。
- `close()` 反注册 IPC → dispose presence → `git.unwatchAll()` → cancel running → `settleRuns(3000)` → 关闭 shell sessions。

## 3. 一次运行的端到端

```text
chat:submit → ipc/chat.ts(zod 校验) → service.submitMessage
  → mailbox.enqueue(chatId, ...)
  → ChatInbox.submitMessage
      → hooks SessionStart/UserPromptSubmit（可能阻断或追加上下文）
      → 有 parentConversationId? 子代理后台驱动 : service.run

service.run
  → mailbox.enqueue(chatId, () => runWithStopHook)
  → TurnLoop.run
      → RunEngine.setPreparing
      → changeSet.captureBeforeRun（若 cwd 是 git repo）
      → loop pass ≤ 10:
          resolveAgentDefinition
          store.save(incoming)
          compaction.prepareMessages(force = pass > 0)
          RunEngine.run(kind='chat')
            → streams.start + runPersistence.start
            → startAgentStream
              → buildTools(def, chatId, depth, mode)
              → contextEngine.prepareStep(...)
              → buildAgent(... new ToolLoopAgent)
              → agent.stream(...)
              → writer.merge(result.toUIMessageStream())
            → onFinally: turnFinalizer + markRunOutcome + persistence finish
      → changeSet.captureAfterRun + 写入 data-changePreview
      → streams.finish
  → Stop hook（fire-and-forget）
```

`send` 是 `module.ts` 里构建的 `ChunkSink`：先让 presence 观察 data/text chunk，再进 `ChatRunSessionRegistry.publish`。非 data chunk 必须属于已跟踪 run；data chunk 可作为 notification 保留并推给窗口。

**流式批处理**：`run-session-registry.ts` 对 delta chunk 做短窗口合并，按 `chat:event:<chatId>` 发帧；renderer 用 `runSnapshot` + frame gate 重放。

## 4. 并发与跨调用状态

| 状态 | 所在 | 作用 |
|---|---|---|
| `inflight` | `RunEngine` | 当前活跃流，开始新 run 会 abort 前驱 |
| `preparing` | `RunEngine` | 流启动前的准备阶段（压缩/变更捕获/解析） |
| `epochs` | `RunEngine` | 单调代次，检测 run 是否被取代 |
| `cancelGenerations` | `RunEngine` | 目标续接调度用，取消后旧调度失效 |
| `activeRuns` | `RunEngine` | `settleRuns(timeout)` 优雅关停 |
| `steerQueue` | `AgentService` | 中途转向文本，在 `prepareStep` 排空 |
| `messageQueue` | `AgentService` | 排队用户消息，持久化到 `queued_messages` 并启动恢复 |
| `mailbox` | `AgentService` | 每对话串行执行器 |
| `runPersistence` | `AgentService` | 每 run 的消息持久化会话 |

**每对话串行**：`ChatMailbox` 按 chatId 串接任务；不同对话可并发。`run`、`submitMessage`、`respondApprovals`、`compact`、goal continuation、queued message 分发都走这条队列。

**单活跃 run**：`RunEngine.beginRun` bump epoch 并 abort 前驱。持久化侧通过 `canPersist()` / `canPersistFinal()` 检查 abort、当前 owner 与 conversation 是否仍存在，被取消/取代/删除的 run 不写消息。

## 5. 持久化时机

经 `ChatRunPersistenceRegistry`，不是单一 `onFinish`：

- `persistStepMessages` 来自每步完成，`persistFinalMessages` 来自最终输出。
- 每次持久化都会合并当前 DB 态、重插被消费的 steering、`store.save`、把用量喂给 context engine，并发 `data-context` 快照。
- run outcome 写 `runs`，工具遥测写 `tool_executions`，prompt 诊断写 `prompt_diagnostics`。

存储形态见 [22 持久化](./22-persistence.md)。

## 6. 压缩、停止条件、续航

**停止条件**：`buildStopWhen(def, contextEngine)` = `isStepCount(def.maxSteps)`（若设）+ `overCompactionTrigger`。当上报 token 超过 `contextEngine.compactionTriggerTokens(def)` 且模型还在发工具调用时，内层循环停下，把控制权交回外层。

`TurnLoop.run` 的续航逻辑：

- `hitCompactionTrigger`：加载最新消息，强制压缩后继续下一 pass，最多 `MAX_CONTINUATION_PASSES = 10`。
- `exceededCompactionTrigger` 但未命中 step 内停止：run 后尝试 `compaction.compactAfterRun`，不再续接当前输出。
- 计划模式若以纯文本计划结束且未调用 `exitPlanMode`，最多追加两次提醒；第二次强制 `toolChoice: exitPlanMode`。

压缩本身见 [11 上下文工程](./11-context-engineering.md)。

### 6.1 状态机层

有状态的领域逻辑统一为「纯转移核心（functional core）+ 副作用解释器（imperative shell）」，规范与基座见 `runtime/machine/`（`Machine`/`Transition`/`createInterpreter`）。约定：状态/事件/副作用均为判别联合；`transition` 纯函数，非法转移即 no-op（不抛异常）；时钟、随机、UUID 经事件载荷传入。

| 机器 | 纯核心 | 解释器/shell | 要点 |
|---|---|---|---|
| TurnLoop 决策 | `runtime/turn-loop.machine.ts`（`decideTurnOutcome`） | `runtime/turn-loop.ts` | 四条续跑路径（plan-exit / compaction-retry / post-compact / finalize）的优先级级联；可不 mock 流而表驱动测试；`finalize.deferredDispatch` 消除了旧的「改标志再调一次 finalizer」 |
| Goal | `goal/goal.machine.ts`（`goalTransition`） | `goal/service.ts` | 6 态转移表，集中 `pendingInjection` 与「非 active 即 no-op」守卫 |
| SubagentTask | `subagent/task.machine.ts`（`taskTransition`） | `subagent/task-service.ts` | 收敛 10+ 处散落的 `{...task,status}`+`delete block`+`persist`+`notify`；`isTaskTerminal` 单一来源 |

`RunEngine` / `ChatMailbox` / `RunPersistenceRegistry` 是并发原语与累加器，**不** FSM 化（见设计文档 §2.3）。

## 7. 终结化

`runtime/turn-finalizer.ts` 在流结束后：

- owner run 清空 steering；abort 或压缩触发时提前返回。
- 子代理场景排空待处理的父运行。
- main agent 且当前无 inflight 时，评估目标续接；若有排队消息，排队消息优先于目标续接。
- 目标续接由 `startGoalContinuationQueued` 重新进入 mailbox，并用 cancel generation 防止取消后的旧调度启动。

## 8. 子系统职责速览

| 子系统 | 文件 | 职责 |
|---|---|---|
| Hooks | `hooks/*` | Codex/Claude 兼容钩子；Session/UserPrompt/PreToolUse/PostToolUse/Stop 接线；上下文注入 |
| Goal | `goal/service.ts` | 每对话目标：预算、状态、outcome、pendingInjection、idle/blocker 续接 |
| Question | `question/broker.ts` | `askQuestion` 交互：挂起 promise、响应/拒绝、按 chat 清理 |
| Presence | `presence/aggregator.ts` | 从遥测/审批/变更/text chunk 推导 pet 状态并广播 |
| Telemetry | `telemetry/*` | 适配 ai-sdk Telemetry，发 UI/logger/DB sink |
| Diagnostics | `diagnostics/prompt-cache.ts` | prompt 缓存分段诊断，落 `prompt_diagnostics` |
| ChangeSet | `git/change-set-service.ts` | run 前后 git checkpoint，生成/应用变更预览 |

## 9. Agent IPC 通道

`registerAgentIpc` 聚合 `chatHandlers` / `goalHandlers` / `policyHandlers` / `hooksHandlers` / `skillHandlers` / `activityHandlers` / `gitHandlers` / `changeSetHandlers`，经 `registerIpcHandlers` 做错误归一化。核心 `chat:*` 见 [04 跨进程契约](./04-ipc-and-contracts.md) §5.2。

出站：`chat:event[:id]`、`pet:presence-changed`、`git:event` 与 `data-*` 瞬态 chunk。

## 10. 运行时不变量

- [ ] 每对话串行（`ChatMailbox`），跨对话并发。
- [ ] 单活跃 run/对话（`RunEngine` inflight + epoch），新 run 取代前驱。
- [ ] `ToolLoopAgent` 是内层；`TurnLoop` 是外层压缩/续航/终结化。
- [ ] `canPersist()` 守卫：abort/取代/删除的 run 不写消息。
- [ ] 压缩用 `expectedActiveIds` 乐观并发；冲突 → 可恢复 `CHAT_COMPACTION_STALE` 且 no-op。
- [ ] 启动 `sweepInterruptedRuns` 把残留 run 标 `failed`，排队消息从 `queued_messages` 恢复。

下一篇 → [11 上下文工程](./11-context-engineering.md)
