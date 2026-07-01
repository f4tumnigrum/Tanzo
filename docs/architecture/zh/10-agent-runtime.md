# 10 · Agent 运行时

> 适用范围：Agent 模块工厂、一次运行的端到端执行、并发与状态、持久化时机、压缩续航、子系统协作。最后核对：`src/main/agent/module.ts`、`service.ts`、`runtime/*`（v0.2.4）。

## 1. 心智模型

Agent 运行时由三层组成：

- **入口层 = `AgentService` + `ChatMailbox`**：`service.ts` 暴露 `run`/`submitMessage`/`respondApprovals`/`compact`/`enqueue` 及任务方法等公共能力，并用 `ChatMailbox` 保证每个 chatId 串行执行。
- **生命周期层 = `RunEngine` + `TurnLoop`**：`RunEngine` 管 run 代次、取消、preparing/inflight 状态、stream start/finish；`TurnLoop` 管变更捕获、压缩、续航、计划模式补救、终结化。
- **内层循环 = AI SDK 的 `streamText`**：`streamText<ToolSet>(…)`（`runtime/stream-runner.ts:278`，参数由 `buildAgentCall` 组装，`runtime/build-agent.ts:73`）靠 `stopWhen` + `prepareStep` 自动跑「调模型 → 执行工具 → 回灌 → 再调」，Tanzo 不手写模型工具循环。`buildAgentCall` 返回的是一个 `AgentCall` **配置对象**，不是 Agent 实例。

审批状态活在消息里，不在 main 的闭包状态中（[13 策略与审批](./13-policy-and-approval.md)）。main 在跨调用上承载正确性的状态是 `RunEngine` 的 `AbortController`、epoch、preparing/inflight map 与 active run 集合。

## 2. 模块工厂 `createAgentModule`

```ts
interface AgentModuleOptions {
  db: SqlDatabase
  providerService: ProviderService
  mcpService: McpService
  workspaceRoot: string
  getWindows: () => BrowserWindow[]
  getChatWindows?: () => BrowserWindow[]
  disabledTools?: () => readonly string[]   // 每次 build 时新鲜读取
}
interface AgentModule {
  service: AgentService
  skills: SkillsStore
  plugins: PluginsManager
  presence: PresenceAggregator
  registerIpc(ipcMain: IpcMain): void
  close(): Promise<void>
}
```

（`module.ts:66-75`，返回类型 `module.ts:57-64`。）

构造顺序体现依赖方向（`module.ts:173-442`）：policy store → shell runner + shell sessions → chat event deliverer → chat run-session registry（streams）→ chunk sink → presence → plugins store/installer/manager → skills store → agent identity → agent store（repositories）→ policy engine → hooks store → hook service → `policy` 包装（hooks 前置门）→ goal store/service → git/change-set services → question broker → browser open-request 桥 → context engine → `buildTools` 工厂 → `createAgentService`。

关键接线：

- **hooks** 在 `module.ts` 中创建，`PreToolUse` 通过包裹 `policy.decide` 成为标准审批前的附加门（`module.ts:290-306`）。详见 [14 钩子系统](./14-hooks.md)。
- **`contextEngine`** 通过 `extraSections` 挂载 hooks context section。
- **`buildTools`** 每次按当前 conversation cwd 创建 `WorkspaceFs` / search backend，并把 `mode === 'dangerous'` 映射到沙箱策略（`module.ts:377-422`）。详见 [12 工具系统](./12-tools.md)。
- **`registerAgentIpc`** 聚合 chat/goal/policy/hooks/skills/plugins/activity/git/changeSet handlers。
- **`close()`**：反注册 IPC → dispose presence → `git.unwatchAll()` → cancel running → `settleRuns(3000)` → 关闭 shell sessions（`module.ts:468-498`）。

## 3. 一次运行的端到端

```text
chat:submit → ipc/chat.ts(zod 校验) → service.submitMessage
  → mailbox.enqueue(chatId, ...)
  → ChatInbox.submitMessage
      → hooks SessionStart / UserPromptSubmit（可能阻断或追加上下文）
      → 该对话是子代理? 后台驱动 : service.run

service.run
  → mailbox.enqueue(chatId, () => runWithStopHook)
  → TurnLoop.run
      → engine.setPreparing
      → changeSet.captureBeforeRun（若 cwd 是 git repo）
      → for pass in 0.. (≤ MAX_CONTINUATION_PASSES = 10):
          resolveAgentDefinition
          store.save(incoming)                          （非空且对话存在时）
          compaction.prepareMessages(force = 上一 pass 命中压缩触发时才 true)
          startChatRun(...) with deferTerminal
            → streams.start + runPersistence.start
            → startAgentStream
              → buildTools(def, chatId, depth, mode)
              → buildAgentCall(...)
              → streamText({ ...agentCall, prepareStep → contextEngine.build(...) })
              → for await chunk: deps.send(chatId, chunk, { runId })
            → onFinally: turnFinalizer + markRunOutcome + persistence finish
          decideTurnOutcome(state, ctx) → finalize | compaction-retry | post-compact | plan-exit-retry
      → changeSet.captureAfterRun + 写入 data-changePreview
      → streams.finish
  → Stop hook（fire-and-forget）
```

`deps.send` 是 `module.ts` 里构建的 `ChunkSink`：presence 先观察 data/text chunk，再进 `ChatRunSessionRegistry.publish`。非 data chunk 必须属于已跟踪 run；data chunk 即使未跟踪也可作为 notification 保留并推给窗口（`module.ts:121-137`）。

**流式批处理**：`run-session-registry.ts` 对 delta chunk 做短窗口合并（`DEFAULT_DELTA_BATCH_MS = 24`，`run-session-registry.ts:60`），按 `chat:event:<chatId>` 发帧；renderer 用 `runSnapshot` + frame gate 重放。详见 [30 渲染层](./30-renderer.md)。

## 4. 并发与跨调用状态

### 4.1 `ChatMailbox` —— 每 chatId 串行

`runtime/chat-mailbox.ts` 维护 `tails: Map<string, Promise<unknown>>`，每 `chatId` 一条 promise 链。`enqueue(chatId, task)` 用 `.then(() => task(), () => task())` 链接，使上一步即便抛错下一任务仍执行；被跟踪 promise 恒 resolve 为 `undefined`，故错误不沿链传播，链排空时 map 自清。效果：同一 `chatId` 上所有操作严格串行；不同对话独立并发。

### 4.2 `RunEngine` —— epoch、取消、inflight

`runtime/run-engine.ts` 持有：

- `inflight: Map<string, AbortController>` —— 每对话当前执行中的 run。
- `preparing: Map<string, AbortController>` —— 每对话的预备阶段（上下文构建、压缩检查），以便 run 尚未开始即可被中止。
- `epochs: Map<string, number>` —— 每对话单调递增整数，每次 `beginRun`/`abort` 递增。
- `cancelGenerations: Map<string, number>` —— 显式用户取消时递增的独立计数（goal 续航借它检测过期调度）。
- `activeRuns: Set<Promise<unknown>>` —— 供 `settle()` 用的全部被跟踪 run promise。

`beginRun` 递增 epoch、中止任何现存 inflight 控制器并注册新的；`abort` 递增 epoch 并中止 `preparing` 与 `inflight`；`isRunning` 在任一 map 有项即 true；`settle(timeoutMs)` 以 50ms 步长轮询 `activeRuns` 直到空或超时；`hasAdvancedSince(chatId, epoch)` 供子代理任务服务检测是否有新 run 开始。

「每对话单活跃 run」由 mailbox（串行入队）加 `inflight` + epoch 共同强制。

## 5. `TurnLoop` —— 压缩、续航、终结化

常量（`runtime/turn-loop.machine.ts`）：`MAX_CONTINUATION_PASSES = 10`（`:21`）、`MAX_PLAN_EXIT_PASSES = 2`（`:22`）。

`decideTurnOutcome(state, ctx)` 是纯函数（`turn-loop.machine.ts:45`），返回其一：

- **`plan-exit-retry`** —— live、只以文本结束、未调 `exitPlanMode`、计划模式且 `planExitPasses < 2`：追加 `PLAN_EXIT_NUDGE` 用户消息、递增计数，达 2 次时强制 `exitPlanMode`。
- **`compaction-retry`** —— live、命中压缩触发且 `pass < 10`：重载消息，置 `forceCompactionOnPrepare = true` 后继续循环。
- **`post-compact`** —— 超过触发但本次未命中，且未 aborted/failed/inflight：调 `compaction.compactAfterRun`，再终结派发，再 break。
- **`finalize`** —— 其余：终结派发，再 break。

**ChangeSet 终结化**（`turn-loop.ts`）：若回合以等待审批结束，`changeSetRunId` 存入 `pendingChangeCapture` 由恢复的 run 承接；否则 `finalizeChangeSet` 加载消息、捕获 after 树、把 diff 预览作为 `data-changePreview` part 附到最后一条助手消息、保存并发送预览 chunk。详见 [23 工作区集成](./23-workspace-integrations.md)。

**终结派发**（经 `turnFinalizer.dispatch`）：评估目标续航（仅主 agent，仅在存在目标且未 aborted/failed 时）；有队列消息则取下一条并 `submitUserMessage`；否则若目标要续航则 `startGoalContinuation`。

## 6. 内层循环：`streamText`、`buildAgentCall`、`prepareStep`

`buildAgentCall`（`runtime/build-agent.ts:73-104`）返回的 `AgentCall` 含：

- `model` —— 依 agent 定义的 model ref 从 `providerService` 解析。
- `tools` —— `deps.buildTools` 产出的完整 `ToolSet`。
- `runtimeContext: { chatId, mode }`。
- `toolApproval` —— 包裹 `policy.decide`，从 `tool.metadata.tanzo` 附上每工具的 `kind` / `fingerprintFields`（`build-agent.ts:16-33,85-96`）。详见 [13 策略与审批](./13-policy-and-approval.md)。
- `stopWhen` —— 停止条件数组：可选步数 `isStepCount(def.maxSteps)`、压缩触发 `overCompactionTrigger(triggerTokens)`（`build-agent.ts:65-71`）、hook 停止标志 `() => shouldStop()`。
- `callSettings` 与 `providerOptions` 来自解析后的模型配置；可选 `toolChoice`（强制退出计划时设为 `{ type: 'tool', toolName: 'exitPlanMode' }`）。

`streamText` 调用（`stream-runner.ts:278-394`）把上述透传，另加 `messages`、`abortSignal`、`prepareStep` 回调与 `onStepEnd`。

`prepareStep → contextEngine.build`（`stream-runner.ts:290-337`）：

1. 排空该对话的 `steerQueue`，把已消费的 steering 作为 `{ role: 'user' }` 模型消息注入。
2. 调 `contextEngine.build(def, chatId, cwd, transcript, stepNumber, { consumeGoalInjection: true })`；返回 `undefined` 则跳过本步注入。
3. 调 `skillActiveTools(messages, tools)`：技能激活时把可用工具限制到该技能的 `allowedTools`。
4. 返回 `{ instructions, messages, activeTools?, providerOptions? }`。

`onStepEnd`（`stream-runner.ts:339-393`）更新 usage/结束原因/步计数，设置 `producedToolCall` / `exitPlanModeCalled` 标志，对每个工具结果跑 `hooks.runPostToolUse(...)`（若任一 hook 返回 `stopped` 则置 `hookRequestedStop`），并发出 trace。

## 7. 持久化时机

- **run 前保存**（`turn-loop.ts:317-319`）：每 pass 前，若 `messages.length > 0` 且对话存在，`deps.store.save(chatId, messages)` 持久化入参消息（含任何前置 nudge）。
- **每步保存**（`run-persistence-registry.ts`）：`persistStepMessages`（由 `onStepEnd` 触发）以 `{ observeUsage: true, publishContext: true }` 持久化，受 `!signal.aborted && handle.isCurrent() && hasConversation` 守护。
- **最终保存**：`persistFinalMessages`（由 `onEnd` 触发）以 `{ allowAfterFailure: true, isFinal: true }` 持久化。
- **审批半程保存**（`chat-inbox.ts`）：审批已应用但仍有 pending 时，`deps.store.save(chatId, messages)` 持久化半解析消息而不启动 run。
- **ChangeSet 预览保存**（`turn-loop.ts`）：非审批完成后，diff 预览附到最后助手消息并保存。

消息存储是带 revisions 与 compaction overlays 的追加日志——不是每对话一个 JSON blob。详见 [22 持久化](./22-persistence.md)。

## 8. 关键常量

| 常量 | 值 | 位置 |
|---|---|---|
| `MAX_CONTINUATION_PASSES` | 10 | `turn-loop.machine.ts:21` |
| `MAX_PLAN_EXIT_PASSES` | 2 | `turn-loop.machine.ts:22` |
| `DEFAULT_DELTA_BATCH_MS` | 24 ms | `run-session-registry.ts:60` |
| `close()` settle 超时 | 3000 ms | `module.ts:493` |
| `settle()` 轮询间隔 | 50 ms | `run-engine.ts` |

下一篇 → [11 上下文工程](./11-context-engineering.md)
