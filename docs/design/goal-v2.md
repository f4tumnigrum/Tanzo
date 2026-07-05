# 设计文档 · Goal 子系统重构（Goal v2）

> 状态：草案（待评审）
> 范围：`src/main/agent/goal/**`、`src/main/agent/context/sections/goal.ts`、
> `src/main/agent/tools/goal.ts`、`runtime/turn-finalizer.ts` / `turn-loop.ts` /
> `stream-runner.ts` / `build-agent.ts` 的 goal 相关分支、`src/shared/goal.ts`、
> `database/schema.ts` 的 `conversation_goals` 表。
> 前提：允许追加持久层列与运行时契约变更；必须兼容 Context v2 的
> append-only 前缀不变式与 Section × Provider 模型；深度对齐 AI SDK v7
> （`streamText` 的 `stopWhen` / `StepResult.usage` / 归一化 `LanguageModelUsage`）；
> KV cache 是一等设计目标。

---

## 0. 摘要

现行 goal 子系统的骨架正确（纯状态机 + 解释器 shell、SQLite 持久化、
continuation-as-new-turn、经 injection 通道进入 transcript），但存在八类缺陷，
可归纳为四句话：

1. **规则活在散文里而不是状态机里** —— "三轮才能 block" 写了三遍散文、
   零执行（G2）；决策无因，停机不可解释（G8）。
2. **goal 对模型时隐时现** —— 普通用户轮次上下文里没有任何 goal 痕迹（G1）；
   每个 continuation 轮却重复注入 ~300 词的静态规则全文（G7）。
3. **预算与 KV cache 架构脱节** —— 记账用 `totalTokens`（90%+ 是 0.1x 价格的
   cache read），长上下文下预算表观二次增长（G3）；预算只在轮末检查，
   单轮可无限超支（G4），而 AI SDK 的 `stopWhen` 正是为此设计、项目已在用却没接。
4. **信号与结算不可靠** —— "做了工作" 的判据（tool kind）与 stalled 模板对模型
   宣称的事实（"没有文件被修改"）不一致，且 MCP 无标注工具默认算工作，
   可致空转 continuation 无限循环（G5）；injection 消费与送达脱钩，存在静默丢失
   （G6）；失败/中止轮次的 token 永不入账（G3b）。

v2 的重构原则一句话：**规则进状态机，静态进 stable 通道，增量进 injection，
预算进 stopWhen，信号进 changeSet**。continuation-as-new-turn 的总体结构保留。

---

## 1. 现状与问题诊断

### 1.1 现行全链路

```
用户 IPC (ipc/goal.ts)
 ├─ create/updateObjective/resume → GoalService → store + broadcast
 │    └─ kick() → turnLoop.startGoalContinuation        # 立即开一轮
 └─ pendingInjection ∈ {continuation, budget_limit, objective_updated}

TurnLoop.run (turn-loop.ts:399)
 ├─ contextEngine.renderInjection                        # goal section (injection 通道)
 │    └─ templates.continuationPrompt / budgetLimit / objectiveUpdated
 │       （~300 词规则全文 + budget 快照，持久化进 transcript）
 ├─ startChatRun → stream-runner
 │    ├─ isWorkToolCall: kind ∈ {edit, exec}，updateGoal/todo 除外 (stream-runner.ts:225)
 │    └─ onFinally → state{producedWorkToolCall, latestUsage, …}
 ├─ runTerminalDispatch → turnFinalizer.dispatch (turn-loop.ts:507)
 │    └─ goal.evaluate({turnTokens: totalTokens, …})     # 记账 + 决策 (turn-finalizer.ts:76)
 │         └─ goalTransition('turn-evaluated')           # 纯状态机 (goal.machine.ts:66)
 └─ settleChangeCapture (turn-loop.ts:518)               # ⚠️ 在 dispatch 之后

updateGoal 工具 (tools/goal.ts) → goal.markOutcome → 'outcome-marked' 事件
```

### 1.2 缺陷目录

**G1（P0）— 普通轮次模型看不到 goal。**
`sections/goal.ts:18`：`if (!goalInjection) return null`。goal 只在
`pendingInjection` 非空的轮次（continuation / budget_limit / objective_updated）
被渲染。goal 进行中用户发一条普通消息时，该轮上下文里没有 objective ——
它只存在于越来越远的历史 injection 里，压缩后可能彻底消失。系统提示词却要求
"When an injected goal exists, keep working toward it"，模型没有可 keep 的对象。
goal 缺少一个**常驻声明（charter）**，而这正是 Context v2 stable 通道的用途。

**G2（P0）— `blockerStreak` 只写不读，"三轮才能 block" 零执行。**
`goal.machine.ts:136` 在 `outcome-marked(blocked)` 时递增 streak，但没有任何
代码读取它：不做门槛、不进模板、UI 不显示。同一规则以散文写在三处
（tools/goal.ts:9、templates.ts:39、系统提示词），模型第一轮 `blocked` 状态机
照单全收。规则必须由状态机强制，散文只做提示。

**G3（P0）— 预算记账与 KV cache 架构冲突。**
`turn-finalizer.ts:73`：`turnTokens = latestUsage.totalTokens`。totalTokens 含
全部 input tokens，而在缓存架构下其中绝大部分是 0.1x 价格的 cache read。
长上下文 goal 的预算消耗表观二次增长（每轮全量 prompt 计满价），token budget
实际度量的是"对话长度"而非"做了多少工作"。
**G3b**：`turn-finalizer.ts:61/69` —— `state.aborted` 直接 return、
`state.streamFailed` 跳过 evaluate，这两类轮次烧掉的 token 永不入账。

**G4（P1）— 预算只在轮末检查，单轮可无限超支。**
`isBudgetExhausted` 只在 `turn-evaluated`（轮末）运行。一个 continuation 轮内
模型可连跑 `maxSteps` 个 step，预算早爆系统也不知道。`build-agent.ts:69` 的
`stopWhen: StopCondition[]` 机制已存在（maxSteps、hook stop 已接入），
goal 预算却没接 —— 这是与 AI SDK 集成的最明显缺口。

**G5（P1）— idle 检测的信号是错的。**
`isWorkToolCall`（stream-runner.ts:225）以 kind ∈ {edit, exec} 为"做了工作"：
- MCP 工具无 annotations 时默认 kind='edit'（mcp.ts:67）→ 一个只读 MCP 搜索
  工具永远重置 idleStreak → 空转 continuation 无限循环，budget 是唯一刹车；
- `Shell` 是 exec → 每轮跑一句 `ls` 也算工作。
而 stalled 模板对模型宣称 "no files or external state were modified"
（templates.ts:45），实际信号根本不看 worktree。项目已有 changeSet 捕获系统
（before/after tree diff），才是"状态是否改变"的正确信号源。

**G6（P1）— injection 消费与送达脱钩。**
`context/index.ts:143-146`：只要 injection 消息非空（datetime/git 任何 section
渲染出内容）就消费 goal injection。若 goal 在 peek 与 render 之间被 clear
（IPC 与 turn 准备并发），goal section 返回 null 但消息非空 → injection 被消费
但从未到达模型。`renderContextInjection` 已返回实际渲染的 section id 列表
（injection.ts:41），消费端却不看它。

**G7（P2）— 每轮 continuation 注入 ~300 词重复规则。**
`steadyContinuation` 的 Work/Finish/Block 决策规程是静态文本，却每轮全文注入。
30 轮 continuation 的 goal，transcript 里躺 30 份几乎相同的规则（只有 budget
数字不同），推高每轮 token、污染压缩输入。静态规则属于 stable 通道
（缓存后边际成本 ≈ 0），per-turn 注入只应携带增量。

**G8（P2）— 决策无因。**
`GoalDecision { continue: boolean }` —— 停了不知为何停（idle 上限？plan mode？
被排队消息抑制？预算？）。对比 prompt-diagnostics 的精细度，goal 是观测盲区。

**G9（P2，附带）— GoalSectionReader 接口污染。**
`sections/goal.ts:5-9` 声明了 `peekInjection/takeInjection` 但 section 从不调用
（消费在 engine 层），死接口误导维护者。

---

## 2. 设计不变量

- **I1（呈现分层）**：goal 的静态部分（objective + 决策规程）常驻 stable 通道，
  跨轮 byte-identical；动态部分（预算余量、idle 警告、事件通知）只经 injection
  通道以增量形式进入 transcript。任何一轮，模型都能看到 goal 的完整语义。
- **I2（规则单点）**：可执行的规则（block 门槛、idle 上限、预算判定）只存在于
  状态机；模板与工具描述引用同一常量，只做提示不做执行。
- **I3（记账口径）**：预算消耗 = 真实新增算力
  `effectiveTokens = noCacheTokens + cacheWriteTokens + outputTokens`，
  与 KV cache 命中解耦；所有轮次（含失败/中止）入账。
- **I4（轮内执行）**：预算在 step 边界经 `stopWhen` 即时截停；状态机的轮末判定
  保留为兜底与 wrap-up 触发器。同一 `effectiveTokens` 函数供两处使用。
- **I5（信号诚实）**：告诉模型的事实必须来自能验证它的信号源。"worktree 未变"
  只在 changeSet diff 证实时宣称。
- **I6（结算精确）**：一次性注入状态（goal injection、plugin mention）只在
  对应 section 实际渲染进消息时消费。
- **I7（前缀纪律）**：charter 变更（create/edit/clear/pause）只发生在 turn
  boundary；run 内 section 渲染结果冻结（run 级快照），杜绝 stable 声明失效。

---

## 3. 目标架构

### 3.1 呈现：charter / pulse 双 section

```
goal-charter   stability: stable    channel: system     order: 40
goal-pulse     stability: volatile  channel: injection  order: 5（沿用）
```

**goal-charter**（新增，替代 G1 的缺位）：

- 渲染条件：`def.kind === 'main'` 且 goal 存在且 `deriveStatus(goal)` ∈
  {active, budget_limited}（wrap-up 轮仍需看到 objective）。paused/complete/
  blocked 渲染 null —— charter 消失本身就是给模型的信号。
- 内容 = objective + 静态决策规程全文（现 `steadyContinuation` 的
  Work/Finish/Block 三选一规程移入此处，改写为与轮次无关的表述）+
  block 门槛常量的引用。**不含任何预算数字**（预算每轮变，进 charter 会杀缓存）。
- 缓存效果：charter 落在 stable system 段，进入 Anthropic 1h 锚点覆盖范围 /
  OpenAI 前缀 hash；goal 生命周期事件（创建/编辑/清除）导致一次前缀重写，
  与编辑 AGENTS.md 同类，可接受。

**goal-pulse**（现 goal section 瘦身）：

- 只发增量，目标 2-6 行：
  - `continuation`：`<goal_pulse>` + 剩余预算一行（tokens/time）+
    （idleStreak ≥ 1 时）一行 stalled 警告（措辞见 3.4，基于真实信号）；
  - `budget_limit`：预算耗尽通告 + wrap-up 指令（现模板压缩到 ~5 行）;
  - `objective_updated`："objective 已更新，见系统声明" + 新旧行为衔接指令。
- 规则全文不再出现在 pulse 里 —— charter 常驻，pulse 只需引用。
- 模板层拆分：`templates.ts` → `charterText(goal)` 与
  `pulseText(goal, injection, signals)`。

**净效果**：每 continuation 轮注入量从 ~300 词降到 ~40 词；30 轮 goal 的
transcript 少 ~8k token 的重复文本；charter 由 provider 缓存承担，边际成本 ≈ 0。

### 3.2 状态机：规则内置 + 决策有因

`goal.machine.ts` 变更：

```ts
export const BLOCK_ATTEMPTS_REQUIRED = 3   // 单点常量，模板/工具描述引用

export type GoalEffect =
  | { kind: 'persist' }
  | { kind: 'broadcast' }
  | { kind: 'decision'; continue: boolean; reason: GoalDecisionReason }
  | { kind: 'reject'; code: 'blocked-too-early'; attempts: number }   // 新增

export type GoalDecisionReason =
  | 'continue'          // 正常续轮
  | 'wrap-up'           // 预算耗尽，给收尾轮
  | 'idle-limit'        // 连续空转达上限
  | 'budget-exhausted'  // 收尾后彻底停
  | 'plan-mode'
  | 'queued-message'    // 被用户排队消息抑制
  | 'not-active'        // paused/outcome/limit 状态
```

**block 门槛（G2）**：`outcome-marked(blocked)` 且 `blockerStreak + 1 <
BLOCK_ATTEMPTS_REQUIRED` 时：递增 streak、**不置 outcome**，返回 `reject`
效果。工具层把 reject 转成结果文本：
`"Blocker 已记录（2/3）。继续尝试替代路径；同一阻塞再持续 1 轮后 blocked 才会生效。"`
同轮重复调用不重复递增：`markOutcome` 携带 `runId`，机器以
`blockerLastRunId` 去重（新列，见 §4）。`turn-evaluated` 中有工作证据
（见 3.4）的轮次将 streak 清零 —— "同一阻塞持续"的近似语义。

**决策有因（G8）**：`evaluateTurn` 的每个分支给出 reason；service 原样透传，
`GoalDecision { continue, reason }` 随 goal 一起 broadcast → UI 可解释
"为什么停了"。turn-finalizer 在日志里记录 reason。

### 3.3 预算：stopWhen 轮内截停 + cache 感知记账

**记账函数（I3）**，放在 `goal/accounting.ts`，两处共用：

```ts
export function effectiveTokens(usage: LanguageModelUsage | undefined): number {
  if (!usage) return 0
  const details = usage.inputTokenDetails
  if (details?.noCacheTokens != null) {
    return (details.noCacheTokens ?? 0)
         + (details.cacheWriteTokens ?? 0)
         + (usage.outputTokens ?? 0)
  }
  // 细分不可用（部分 openai-compatible 后端）→ 保守回退全量
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}
```

AI SDK v7 已把各 provider 的 usage 归一化到
`inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`
（Anthropic 的 cache_read/creation、OpenAI 的 cached_tokens 均映射），
此函数 provider 无关。

**轮内截停（G4 / I4）**：`buildAgentCall` 增加可选输入
`goalBudget?: { remainingTokens: number }`（由 stream-runner 在 run 开始时从
goal 读快照，仅 goal active 且设了 tokenBudget 的主 agent 传入）：

```ts
if (input.goalBudget) {
  const { remainingTokens } = input.goalBudget
  stopWhen.push(({ steps }) =>
    steps.reduce((n, s) => n + effectiveTokens(s.usage), 0) >= remainingTokens
  )
}
```

截停后该轮正常走 onFinally → evaluate：轮末记账把 `tokensUsed` 推过预算线 →
状态机进入 `budget_limit` 路径（wrap-up 轮照旧）。stopWhen 只防轮内失控，
**预算的唯一事实源仍是状态机** —— 不引入第二个判定点。
时间预算同理可加 `Date.now() - runStartedAt` 条件，实现代价一行。

**记账口径切换（G3）**：`turn-finalizer` 的 `turnTokens` 改为
`effectiveTokens(state.latestUsage)`。**行为变更**：既有 goal 的 tokenBudget
语义从"对话长度"变为"新增算力"，同额预算下 goal 能跑更多轮 —— 发布说明里注明,
UI 的预算文案改为 "compute tokens"。

**泄漏封堵（G3b）**：`turnFinalizer.dispatch` 重排 ——

```ts
// 记账对所有非 pure-abort 轮次执行；决策仅在正常轮次执行
if (deps.goal && isMainAgent && deps.goal.get(chatId)) {
  const decision = deps.goal.evaluate(chatId, {
    ...,
    outcomeEligible: !state.aborted && !state.streamFailed,  // 新字段
  })
  goalWantsContinuation = decision.continue && !state.aborted && !state.streamFailed
}
if (state.aborted) return   // 早退守卫移到 evaluate 之后
```

机器侧：`outcomeEligible === false` 时只记账、decision 恒
`{ continue: false, reason: 'not-active' }`（复用现有 "非 active 也持久化记账"
分支）。

### 3.4 idle 信号：changeSet 优先，tool-kind 修正兜底

**信号源（G5 / I5）**：`GoalTurnInput` 变更 ——

```ts
export interface GoalTurnInput {
  isGoalContinuation: boolean
  worktreeChanged: boolean | null   // null = changeSet 不可用（非 git cwd 等）
  producedWorkToolCall: boolean     // 修正后的兜底信号
  ...
}
```

工作证据判定（机器内）：
`workEvidence = worktreeChanged === true || (worktreeChanged === null && producedWorkToolCall)`。
worktree 证实未变（`=== false`）时，exec 工具调用不再重置 idleStreak ——
`ls` 空转轮从此计入 streak；确有非文件系统副作用的 goal（部署、消息发送类 MCP）
依赖 3.4b 的修正信号,在 changeSet 不可用时仍能计工作。

**时序（关键实现点）**：现行 `runTerminalDispatch`（turn-loop.ts:507）在
`settleChangeCapture`（turn-loop.ts:518）**之前**执行，preview 尚不存在。
调整：非 approval-pause 的终局路径上，把 `settleChangeCapture` 提到
`runTerminalDispatch` 之前执行并返回 `preview: ChangePreviewData | null`；
`worktreeChanged = preview ? preview.fileCount > 0 : null` 装入 state 传给
dispatch。finally 中的 settle 改为幂等二次调用（已 settle 则 no-op），
错误路径行为不变。approval-pause 轮（capture 挂起携带）本就不 evaluate goal,
不受影响。

**兜底信号修正（3.4b）**：MCP 无 annotations 时 `mapAnnotations` 保持
kind='edit'（审批策略维持保守），但新增 `tanzo.workSignal?: boolean` 元数据：
显式 `destructiveHint/readOnlyHint` 缺失 → `workSignal: false`。
`isWorkToolCall` 改读 `workSignal ?? (kind ∈ {edit, exec})` ——
未知副作用的 MCP 工具不再作为"做了工作"的证据。审批与 idle 判定从此解耦。

**模板诚实化**：stalled 措辞按信号分级 ——
`worktreeChanged === false` → "上一轮 worktree 没有任何变化"；
`worktreeChanged === null && !producedWorkToolCall` → "上一轮没有产生任何
修改类操作"。不再无条件宣称文件未变。

### 3.5 injection 结算按 section（G6 / I6）

`contextEngine.renderInjection`（context/index.ts:143）改为按
`renderContextInjection` 返回的 `kept` section id 结算：

```ts
const message = await renderContextInjection(registry, input)
if (message) {
  const kept = new Set(sectionsOf(message))       // data-contextInjection.sections
  if (goalInjection && kept.has('goal-pulse')) deps.goal.takeInjection(chatId)
  if (pluginMention?.length && kept.has('plugins-mention')) deps.pluginMention.take(chatId)
}
```

未渲染 → 不消费 → 下一轮重试，注入不再静默丢失。

### 3.6 接口清理（G9）

- `GoalSectionReader` 收缩为 `{ get(chatId): ThreadGoal | null }`；
  injection kind 一律从 `BuildInput.goalInjection` 来（数据流单向）。
- charter section 另用同一 reader；不引入新依赖面。

---

## 4. 数据模型与契约变更

**schema（追加列，不迁移旧数据语义）**：

```sql
ALTER TABLE conversation_goals ADD COLUMN blocker_last_run_id TEXT;
```

**shared/goal.ts**：

```ts
export interface ThreadGoal {
  ...
  blockerLastRunId: string | null      // 新增
}
export interface GoalDecision {        // service 层类型提升到 shared（UI 要用 reason）
  continue: boolean
  reason: GoalDecisionReason
}
```

**GoalService**：
`markOutcome(chatId, outcome, opts?: { runId?: string })`；
`evaluate` 返回 `GoalDecision`（带 reason）；其余签名不变。
broadcast payload 增加最近一次 decision（可选字段，UI 展示停机原因）。

**GoalRuntime（runtime/types.ts）**：`evaluate` 入参替换
`producedWorkToolCall` → `worktreeChanged + producedWorkToolCall`,
增加 `outcomeEligible`。

**工具层（tools/goal.ts）**：`updateGoal` 的 execute 处理 reject 效果 →
返回 `{ recorded: true, attempts, required: BLOCK_ATTEMPTS_REQUIRED }`
而非 `{ updated: true }`；描述文本引用 `BLOCK_ATTEMPTS_REQUIRED`。
`buildTools` 调用点已按 run 构建（stream-runner.ts:282），把 `runId` 传入
`goalTools(deps, chatId, runId)`。

---

## 5. 与 AI SDK v7 的对齐点

| 能力 | 现状 | v2 用法 |
|---|---|---|
| `stopWhen: StopCondition[]` | 只用于 maxSteps / hook stop | goal 预算轮内截停（3.3），条件函数读 `steps[].usage` |
| `LanguageModelUsage.inputTokenDetails` | 只用于 hitRatio 展示 | 记账口径 `effectiveTokens`（3.3），provider 无关 |
| `onStepEnd(step.usage)` | 已接 contextEngine.observeStep | 不变；stopWhen 与其共享同一 usage 流 |
| tool `metadata` | kind 用于审批 + work 判定（耦合） | 增加 `workSignal`，审批与 idle 信号解耦（3.4b） |
| `prepareStep` | 上下文重建 + inline 压缩 | **不动** —— goal 不进入 prepareStep,避免第三个 rebase 事件源 |

明确不做：不用 `prepareStep` 每步注入 goal 状态（会破坏 append-only 前缀）；
不用 `activeTools` 按轮开关 updateGoal（工具集合变化改写缓存前缀里的 tools 块）。

## 6. 与上下文 / KV cache 架构的对齐点

- charter 进入 stable system 段 → 被 Anthropic `stableBoundary` 1h 锚点与
  OpenAI/DeepSeek/Google 前缀 hash 天然覆盖，**不新增任何 cache 断点**
  （Anthropic 4 断点预算不变）。
- pulse 仍走 injection 通道持久化进 transcript —— run 内前缀 append-only
  不变式（I7）不受影响。
- charter 引入后,"stable 声明未被强制"的既有风险（compile 每步重渲染,
  run 中途 goal 编辑会破坏前缀）**必须**一并关闭：`build()` 在 run 首步
  渲染 stable + volatile-system section 后按 `(chatId, runId)` 缓存快照,
  后续步骤复用；run 结束清除。这同时修复 AGENTS.md / skills-index 的
  同类风险（前次 KV cache 分析的缺陷 3）,实现集中在 `compile.ts` +
  `context/index.ts`,约 30 行。
- 每 continuation 轮注入量下降一个数量级 → 压缩触发频率下降,
  summarizer 输入更干净（不再反复咀嚼 30 份规则文本）。

## 7. 实施计划

每步独立可验证、可单独合入；顺序按依赖与风险排列。

**P1 — 记账与预算（G3 / G3b / G4）**
`goal/accounting.ts` 新增；`turn-finalizer` 换口径 + 重排 aborted 守卫；
machine 增加 `outcomeEligible`；`build-agent` 接 `goalBudget` stopWhen;
stream-runner 传预算快照。
验证：`goal/service.test.ts` 扩展 —— cache-heavy usage 下 tokensUsed 只计
新增算力；failed/aborted 轮入账；stopWhen 单测（伪造 steps usage 累计）。

**P2 — 状态机规则化（G2 / G8）**
`BLOCK_ATTEMPTS_REQUIRED` + reject 效果 + `blockerLastRunId` 去重列 +
decision.reason；tools/goal.ts 处理 reject；三处散文改引用常量。
验证：machine 纯函数测试全覆盖（提前 block 被拒、同轮去重、工作轮清零 streak、
第三轮生效）；`tools/goal.test.ts` 断言 reject 文案。

**P3 — charter / pulse 拆分（G1 / G7）+ run 级 section 快照（I7）**
`sections/goal-charter.ts` 新增、goal section 改造为 pulse、templates 拆分;
registry 注册；compile/index 快照；`GoalSectionReader` 收缩（G9）。
验证：`context.test.ts` —— charter 出现在 stable 段、`stableBoundary` 计数
正确、byte-identical 跨轮；pulse 尺寸断言（< 600 chars）；prompt-diagnostics
预期 segment 更新;快照测试（run 内改 goal,前缀不变;新 run 生效）。

**P4 — 信号与结算（G5 / G6）**
turn-loop settle 时序调整 + `worktreeChanged` 贯通；mcp `workSignal`;
`isWorkToolCall` 改造；renderInjection 按 kept 结算。
验证：turn-loop 测试 —— settle 先于 dispatch 且幂等；机器测试 ——
`worktreeChanged=false` + exec 调用不清 streak；injection 结算测试 ——
goal 清除竞态下不消费。

回归面：P1-P2 纯 main 侧,现有测试目录齐备（`tests/unit/main/agent/goal/`）;
P3 触碰 prompt 组装,需跑 `prompt-diagnostics` 全套 + `scripts/
prompt-cache-diagnostics.mjs` 人工核对一次 continuation 序列的
`commonPrefixSegments`；P4 触碰 turn-loop 时序,跑 runtime 全目录。

## 8. 风险与权衡

- **charter 令 goal 编辑变成前缀重写**：goal create/edit/clear 后首轮全量
  cache write。频度低（用户操作）,收益（每轮 ~300 词 → 缓存）远大于代价。
- **记账口径变更是行为变更**：同额预算跑更多轮。缓解：UI 文案更新 +
  发布说明；不做旧数据换算（tokensUsed 继续累计,语义前向一致）。
- **worktreeChanged 对非文件系统 goal 偏严**：部署/通知类 goal 在 git cwd 下
  会被计 idle。缓解：兜底信号仍算 exec 工具（3.4b 只排除了无标注 MCP）;
  idle 上限只是停自动续轮,用户可随时 resume。
- **settle 时序调整**：changeSet 捕获失败路径需保持"discard 而非泄漏"语义,
  幂等化 settle 是本设计里唯一动 turn-loop 主干的点,P4 单独合入、单独回归。
- **blockerStreak 语义是近似**："三次尝试 + 期间无工作证据" ≈ "同一阻塞持续
  三轮",不验证 blocker 内容同一性。精确验证需要 blocker 指纹,复杂度不成比例,
  列为非目标。

## 9. 非目标

- 多 goal / goal 队列、跨会话 goal、goal 模板库 —— 单会话单 goal 模型不变。
- blocker 内容指纹与同一性验证（见 §8）。
- 预算的价格加权（cache write 1.25x/2x 溢价按 provider 定价折算）——
  `effectiveTokens` 保持 provider 无关；定价感知留给未来的成本面板。
- 子 agent 的 goal 参与 —— goal 仍是 main agent 专属。
- 服务端 goal（provider 侧 task budget 等 beta 能力）—— 本地状态机是唯一事实源。
