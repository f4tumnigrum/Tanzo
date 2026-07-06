# 设计文档 · 上下文压缩子系统重构（Context Compaction v2）

> 状态：草案（待评审）
> 范围：`src/main/agent/context/**`、`src/main/agent/runtime/compaction-coordinator.ts`、
> `runtime/stream-runner.ts` / `turn-loop*.ts` 的压缩相关分支、`repositories/message-repo.ts` 的
> 压缩持久化路径。
> 前提：**不考虑向后兼容**（允许改持久层行格式与运行时契约）；必须兼容现有
> Section × Provider 上下文模型与 `AgentService → RunEngine → TurnLoop` 分层；深度对齐
> AI SDK v7（`ai@7.x`）的 `streamText` 工具循环能力；KV cache 是一等设计目标。

---

## 0. 摘要

现行压缩链路（trigger → plan → fork 摘要 → finalize → 缓存重建）存在四类确定性缺陷：

1. **切点算法在长回合下退化为 no-op**，导致"压缩了但仍然溢出"的 compaction-retry 风暴；
2. **摘要 fork 的 prompt 组装错误**（继承全套 agent 人格 sections、压缩指令不在末尾、无窗口校验、零缓存命中）；
3. **预算测量（锚点 + 全量字符估算取 max）在压缩后级联误触发**，且锚点无失效路径；
4. **prompt 前缀不满足 append-only**，多处机制（step-0 幽灵注入、steering 重排、内存 freeze、
   全局 promptCacheKey）系统性破坏 KV cache 命中。

v2 以四条不变量重建该子系统：**append-only 前缀**、**单一 UI→Model 转换点**、
**持久化 token 账本**、**压缩内联于 `prepareStep`**。同时引入四级降级链，保证任何情况下
下一次请求都能发出。

---

## 1. 现状与问题诊断

### 1.1 现行全链路

```
TurnLoop.run (runtime/turn-loop.ts:316)
 ├─ compaction.prepareMessages            # 预回合压缩；shouldCompact 用锚点+估算
 ├─ startChatRun → stream-runner.ts
 │    streamText({
 │      stopWhen: overCompactionTrigger,  # 中途超限 → 硬停流 (build-agent.ts:64)
 │      prepareStep: contextEngine.build, # 每步重建 prompt（Section × Provider）
 │    })
 ├─ decideTurnOutcome (turn-loop.machine.ts)
 │    ├─ compaction-retry  # 停流 → store.load → 强制压缩 → 新 runId 重开（≤10 pass）
 │    └─ post-compact      # 回合结束后压缩
 └─ CompactionCoordinator.runCompaction (runtime/compaction-coordinator.ts:149)
      ├─ planCompaction    # UI-part 域按 step-start 找切点 (compact/segments.ts:63)
      ├─ runCompactionFork # 单步 streamText 摘要 (compact/fork-agent.ts:140)
      └─ finalizeCompaction# overlay + seq 整体重排 (repositories/message-repo.ts:467)
```

### 1.2 P0 —— 直接产生用户可见错误

**D1. 巨型单条 assistant 消息使切点退化，压缩变 no-op。**
AI SDK 的 UIMessage 流把一个多步回合合并为**一条** assistant 消息（所有 step 在 parts 里）。
`findCut` 的孤儿守卫（`segments.ts:87-89`）只要切点前存在任何 `tool-*` part 就回退到整条消息
边界，而 coding agent 几乎每步都有 tool part → 切点永远无法落进长回合内部。自主运行 50 步的
回合（goal continuation 场景）下：head 为空或全 summary → `planCompaction` 返回 `null`
（`compact.ts:35-36`）→ `prepareMessages` 原样返回 → 流立刻再次触发 `overCompactionTrigger`
→ `compaction-retry` 最多烧 10 个接近满窗口的 pass → 以 provider "prompt too long" 硬错误收场。

**D2. Fork 的 prompt 组装错误。**
`fork-agent.ts:210` 传 `[...head, {user: 压缩指令}]`，但 `prepareStep` 又走了完整的
`contextEngine.build`，实际发出顺序为：

```
[role / plan-mode / tanzo / skills-index / plugins-index 全套 system]
[env leading-user] → [head…] → [压缩指令] → [datetime / git-status]   ← 最后一条是 git 快照
```

- 压缩指令不是最后一条消息，摘要模型的注意力被 volatile 尾部稀释；
- fork 继承完整 agent 人格 + plan-mode 限制 + 技能/插件索引，污染摘要并浪费 token；
- `applyCaching` 给一次性请求打 1h cache 写标记（Anthropic 缓存写 1.25×/2× 溢价，纯亏损）。

**D3. Fork 无窗口校验、无降级路径。**
head ≈ 主模型窗口 × 90% 直接发给 `compactionModelRef`。压缩模型窗口更小时（配置便宜小模型是
常见做法）必然 400 → `Compaction stream failed`。整条链路没有任何分块或机械降级兜底；压缩失败
后会话实际处于"永久超限、无法继续"状态。

**D4. 预算测量级联误触发。**
`budget.ts:74-94` 取 `max(reported 锚点, 4 chars/token 全量估算)`：

- 压缩成功后 `engine.clear` 清锚点，只剩估算路径；tool 输出按 JSON 全长计（结构开销、base64
  全算），保留的"最近 6 步"若带大 grep/fileRead 输出，估算立即再超 trigger → **每回合压缩一次**
  的级联；
- 反方向：CJK 文本按 4 chars/token **低估 2~3 倍**，触发过晚；
- 锚点无失效路径：用户删除消息后锚点仍为旧高值 → 小会话被莫名强制压缩。

### 1.3 P1 —— KV cache 系统性失效

**D5. OpenAI `promptCacheKey` 全局共享。**
`providers/openai.ts:5`：`tanzo:global:<modelRef>`。所有会话（含 fork）共享一个缓存路由键，
不同前缀家族互相挤兑分片，命中率被拉低。

**D6. 前缀不满足 append-only（四处破坏源）。**
1. step 0 注入的 volatile 尾消息（datetime/git-status/goal）在 step ≥ 1 从 prompt 中消失
   （`context/index.ts:65-71`），同回合内 transcript 自相矛盾；且从不持久化 → 重启 rehydrate
   后历史与模型当时所见不一致；
2. steering 持久化位置（`run-persistence-registry.ts:106-123`，插在生成块之前）≠ 发送位置
   （prompt 末尾 append），下一回合前缀在插入点失配；
3. DeepSeek 的 `freezeVolatilePrefix` 只存于内存 Map（`context/index.ts:112`），重启即换新
   datetime → 整条会话前缀缓存作废；
4. skills/plugins index 是 stable-system，但每次 build 重渲染；会话中途安装技能会静默改写
   system → 前缀家族全灭。

**D7. Fork 请求零缓存命中。**
fork 换 system、去 tools，前缀与主会话完全不同 → head（≈90% 窗口）全价重算。压缩恰好发生在
窗口最大的时刻，这是全链路最贵的一次请求。

### 1.4 P2 —— 结构性负债

**D8. 三条压缩路径 × 状态机耦合。** pre-turn / mid-turn（停流→重载→强制压缩→新 run）/
post-turn 三路径牵动 runId 更迭、stream finish、steering reconcile、change-capture 延期等补丁
逻辑（`turn-loop.ts:362-473`）。mid-turn 的"停掉 streamText 再开一个"是对 v7 能力的误用——
`prepareStep` 返回的 `messages` 会 **carry forward 到后续步骤**（`ai/dist/index.d.ts:1644`），
可以在流内直接替换 transcript。

**D9. UI↔Model 转换散落 5 处**（prepareMessages 检查 / stream-runner initialMessages /
每步 prepareStep / 快照发布 / 压缩计划），参数不一致（`tools` 有传有不传），行为微妙分叉。

**D10. O(n²) 主进程开销。** 每步 `persistStepMessages` 对全量 transcript 做
`convertToModelMessages` + 全量 `JSON.stringify` 估算（快照发布），长会话拖慢 Electron 主进程。

**D11. `retainedRecentSteps = 6` 按步数保留，与 token 无关**；保留的 6 步可能比 trigger 还大。

---

## 2. 设计不变量

后续所有模块设计都从这四条推导；评审时先审这四条。

- **I1 · Append-only prefix。** 两次压缩事件之间，每一步发出的 prompt 必须是上一步 prompt 的
  严格前缀扩展。任何会破坏它的机制（volatile 注入、steering 重排、section 内容漂移）要么持久化
  进 transcript，要么只允许发生在压缩事件点（该时刻缓存反正已失效）。此不变量同时服务
  Anthropic 显式 cache_control、OpenAI key 路由、DeepSeek 磁盘 prefix-unit 完整匹配、Gemini 隐式缓存。
- **I2 · 单一转换点。** UI→Model 每个 run 只转换一次；run 内以 `ModelMessage[]` transcript 为
  唯一工作表示。
- **I3 · Token ledger。** 预算 = 持久化的**每消息 token 账本**，由 provider 报告的步间
  usage 增量归因而来；估算只允许用于**未测量的增量**，误差有界。禁止全局单值锚点与全量估算。
- **I4 · 压缩内联。** 自动压缩发生在 `prepareStep` 内、同一个流之中；禁止"停流→重开 run"。
  压缩必然收敛：摘要失败时降级链保证产出可发送 transcript。

---

## 3. 目标架构

### 3.1 模块布局

实现完成后的最终布局（与代码一致）：

```
src/shared/
  message-steps.ts     # 仅供迁移 22/23 使用（splitAssistantSteps / groupAssistantSteps）
src/main/agent/context/
  ledger.ts            # 新：token 账本（替换 budget.ts）
  compile.ts           # 简化：system + leadingUser + history 三段
  section.ts           # 通道收敛为 system | leading-user | injection
  injection.ts         # 新：volatile 注入持久化（renderContextInjection）
  sections/            # datetime/git-status/goal/plugins-mention 改 injection 通道
  capabilities.ts      # 不变
  providers/           # applyCaching({plan, summaryIndex})；实现修正（见 4.9）
  compact/
    policy.ts          # computeCompactionPolicy：trigger / retainBudget / hardCeiling
    cut.ts             # 新：findCut/partitionAtCut/splitForCompaction（UI 域）+ splitModelTranscript（模型域）
    summarize.ts       # fork 重写：runSummarizeFork 前缀复用路径 A + 分块路径 B
    inline.ts          # 新：compactModelTranscript（流内压缩，不碰持久化）
    degrade.ts         # 新：degradeTranscript L3/L4（基于 ai 的 pruneMessages）
    prompt.ts          # 保留（COMPACT_PROMPT / stripAnalysis）
src/main/agent/runtime/
  compaction-coordinator.ts  # prepareMessages（预回合）+ reconcileInline（流内压缩对账）+ compact（手动）
  turn-loop.machine.ts       # 两态：plan-exit-retry | finalize
  stream-runner.ts           # prepareStep 内联压缩；持久化聚合消息（与直播域同构）
  run-persistence-registry.ts# steering 按 stepNumber 插位（聚合行下降为回复前/后，D6-2）
src/main/database/
  per-step-migration.ts      # 迁移 22：per-step 拆行（已被 23 回退）
  merge-step-rows-migration.ts # 迁移 23：片段行合并回聚合行 + overlay 覆盖向外取整
```

### 3.2 数据流（v2）

```
TurnLoop.run
 ├─ contextEngine.renderInjection(def, chatId, cwd, {isFirstTurn})   # volatile 持久化 (I1)
 ├─ compaction.prepareMessages(chatId, def, incoming, runId)         # 预回合压缩
 └─ startChatRun → stream-runner
      initialMessages = convertToModelMessages(ui)   # 唯一转换点 (I2)
      streamText({
        prepareStep: async ({ responseMessages, stepNumber }) => {
          let transcript = [...base, ...liveResponses, ...steering]
          if (lastStepInputTokens > policy.compactionTriggerTokens) {
            const r = await compactModelTranscript(deps, {...})   # inline.ts
            if (r) transcript = r.transcript  # v7: 返回的 messages carry forward (I4)
          }
          return contextEngine.build(def, chatId, cwd, transcript, stepNumber)
        },
        onStepEnd: (step) => { lastStepInputTokens = step.usage.inputTokens }  # (I3)
      })
 └─ 运行结束后：if (finalState.inlineCompaction)
      compaction.reconcileInline(chatId, def, record)   # 把流内摘要对账到持久层
      └─ 只在 record.baseMessageIds 前缀内重新切割（域一致性护栏）
```

`turn-loop.machine.ts` 的决策收敛为两态：`plan-exit-retry | finalize`。

---

## 4. 模块设计

### 4.1 Token Ledger（`context/ledger.ts`，替换 `budget.ts`）

数据源现成：`TanzoStepUsageMetadata`（每步 usage）已随消息 metadata 持久化。最终实现是
**纯函数模块**（无 per-chat 可变状态，重启安全），比早期设想的有状态账本更简单：

```ts
function estimateTextTokens(text: string): number          // CJK 感知：latin/4 + cjk/1.5
function estimateUIMessageTokens(m: TanzoUIMessage): number // 跳过 step-start / data-* part
function estimateModelMessagesTokens(ms: ModelMessage[]): number
function isSummaryUIMessage(m: TanzoUIMessage): boolean

/** 锚点 + 增量：找最新 summary 之后、最新的 reported inputTokens 锚点，
 *  锚点之前全部由 inputTokens 覆盖，之后逐条增量（reported 优先，否则估算） */
function measureTranscript(messages: TanzoUIMessage[]): {
  totalTokens: number
  source: 'reported' | 'estimated'
}
```

规则：

- **锚点即消息**：每条 assistant 消息携带 `metadata.steps[]`，锚点取末步的
  `usage.inputTokens`（该步 prompt 已含前面各步输出）；锚点自身增量 = 末步 outputTokens。
- **锚点失效即构造失效**：插入 summary 改变前缀 → 只认最新 summary 之后的锚点，
  无需显式 invalidate（修复 D4 的级联误触发）。
- **估算只用于增量**：锚点之后的消息逐条估算（CJK 用 1.5 chars/token，其余 4）；
  永不全量估算整个 transcript。
- `snapshot()` 变 O(1)，删除每步全量 stringify（修复 D10 的一半；另一半见 4.6）。

### 4.2 切点算法（`compact/cut.ts`，替换 `segments.ts`）

两个域、同一形状：

```
round := 一条 user 消息 → 到下一条 user 消息前的全部内容（闭合对话轮）
step  := assistant(tool-calls) + 紧随其后的 tool(results) 消息组（天然成对闭合）
```

```ts
// UI 域（持久化 transcript，整行优先；切点落在多步回复内部时 partitionAtCut 劈消息）
function findCut(messages: TanzoUIMessage[], retainBudgetTokens: number): Cut | null
function partitionAtCut(messages: TanzoUIMessage[], cut: Cut): Partition
function splitForCompaction(
  messages: TanzoUIMessage[], retainBudgetTokens: number
): { head; tail; archivedIds } | null

// 模型域（流内 live transcript）
function splitModelTranscript(
  messages: ModelMessage[], retainBudgetTokens: number
): { head: ModelMessage[]; tail: ModelMessage[] } | null
```

算法：从尾部向前按估算累加 token；首选切点为 **round 边界**；若尾部单个 round 已超
`retainBudget`，降级到 **step 组边界**（UI 域即消息内 `step-start` 边界，落在回复内部时
由 `partitionAtCut` 劈消息，见 4.5）；扫描遇上一条
summary 停止（summary 本身可被滚入 head，但其前方不可重归档）。

性质：

- step 组边界天然保证 tool call/result 配对完整；`canonicalizeToolTranscript` 降级为安全网；
- 长回合可以在内部被切开（修复 D1）；
- 保留量以 token 计，与步数解耦（修复 D11）；
- UI 域切点落在多步回复内部时，头片段保留原 id 归档、尾片段新 id 留在 tail（见 4.5）。

### 4.3 压缩执行：内联 `prepareStep`（重写 `compaction-coordinator.ts`）

最终接口（与实现一致）：

```ts
interface CompactionCoordinator {
  /** 预回合：持久 transcript 超触发线时先跑完整 fork 压缩，再开 run */
  prepareMessages(
    chatId: string, def: AgentDefinition,
    incoming: TanzoUIMessage[], runId: string,
    options?: { signal?: AbortSignal }
  ): Promise<TanzoUIMessage[]>
  /** 流内压缩对账：把 inline 摘要落到持久层（不二次 fork）。
   *  只在 record.baseMessageIds 前缀内重新切割 —— 域一致性护栏：
   *  摘要只覆盖压缩时刻的 transcript，run 后续产出不可被归档。 */
  reconcileInline(
    chatId: string, def: AgentDefinition,
    inline: InlineCompactionRecord,
    options?: { signal?: AbortSignal }
  ): Promise<boolean>
  /** 手动 /compact；同一条 fork 路径 */
  compact(chatId: string, options?: { instructions?: string }): Promise<CompactionOutcome>
}

interface InlineCompactionRecord {
  summaryText: string
  baseMessageIds: string[]   // run 起点的持久消息 id（覆盖边界）
  usage?: TanzoUsageMetadata
  degraded?: 'prune' | 'drop-oldest'
}
```

流内压缩本体在 `context/compact/inline.ts`（`compactModelTranscript`）：纯模型域，
不碰持久化；fork 失败时先试 `degradeTranscript`（L3/L4），仍在 hardCeiling 之下则返回
null 继续本步。

- **删除**：`overCompactionTrigger` stopWhen、`compaction-retry` / `post-compact` 决策分支、
  `MAX_CONTINUATION_PASSES`、`forceCompactionOnPrepare`、
  `exceededCompactionTrigger / hitCompactionTrigger` 终态字段（修复 D8）。
- **同流不中断**：runId 不更迭；UI 通过既有 `data-compaction` transient part 展示进度
  （id 为 `compaction:inline:<runId>`）。
- **滞回**：触发条件读上一步的 reported `inputTokens`，压缩后下一步上报的就是压缩后
  体积，天然自滞回，无需额外常量。steering 在压缩时已烙进 transcript，
  `consumedSteering` 清零防重复追加。
- **持久化衔接**：`finalizeCompaction` 的 overlay + `expectedActiveIds` 乐观并发校验**保留**；
  流内压缩不碰 run 期间的持久化，由 run 结束后的 `reconcileInline` 对账（替代早期设想的
  `runPersistence.rebase`，更简单且不侵入 run 期间写路径）。
- **并发**：手动 `compact` 仍走 `engine.run({kind:'compaction'})` 生命周期；reconcile 走
  同一 per-chat 串行队列。

### 4.4 压缩策略（`compact/policy.ts`）

```ts
const TRIGGER_FRACTION = 0.8            // 从 0.9 下调：留出摘要 fork 自身的余量
const HYSTERESIS = 1.2

interface CompactionPolicyV2 {
  trigger: number         // floor((contextWindow − maxOutputTokens) × 0.8)
  retainBudget: number    // min(30_000, contextWindow × 0.15)
  hardCeiling: number     // contextWindow − maxOutputTokens（L4 红线）
}
```

### 4.5 持久层：每条回复一行（per-step 行已实现后回退）

曾按"一条 UI 消息 ≠ 一个可切割单元"的判断实现过 per-step 行（migration 22：
`splitAssistantSteps` 在 `onStepEnd`/`onEnd` 拆行，`groupAssistantSteps` 渲染还原）。
**实践否决**：同一条回复因此拥有两种身份（直播 SDK 单消息 id vs 落库片段 id 串），渲染器
所有 id-based 路径（`upsertMessage`、`mergeRunBaseMessages`、缓存种子、fork/edit 定位）
都要对齐两种表示，接连产出重复渲染 bug（continuation 双拼、切换会话 ABAB、fork 截断）。
收益仅是持久层 UI 域切割免劈消息——而最常触发的自动压缩走模型域，与此无关。

**现行方案**：存储保持直播域同构（一个模型 pass 一行，`step-start` 分隔 parts）。UI 域切点
落在多步回复内部时，`partitionAtCut` 在切割瞬间于内存中劈开：头片段保留原 id 归档，尾片段
`randomUUID` 新 id 留在尾部（`normalizeTailParts` 修补开头）。劈消息复杂度关在 `cut.ts`
一个函数、一个瞬间。

- **steering 插位（D6-2）**：`recordConsumedSteering` 仍携带 prepareStep 的 `stepNumber`；
  聚合行下按 `metadata.steps[0].stepNumber` 解析为回复前（step 0）或回复后。
- **迁移**：migration 22（拆行）+ migration 23（`merge-step-rows-migration.ts`，合并回
  聚合行、overlay 覆盖向外取整到整行、丢弃片段 revision）。22→23 净效果为无操作；
  `@shared/message-steps` 仅为迁移保留，运行时代码禁止使用。
- `load / loadDisplay / loadArchived`、`message-repo.ts` 不变。

### 4.6 摘要 Fork 重写（`compact/summarize.ts`，`runSummarizeFork`）

两条路径：

**路径 A（默认，未配置 `compactionModelRef` 且调用方传入主 run 的 tools）—— 前缀复用：**

- 通过 `contextEngine.build` 用**与主 run 完全相同的方式**生成 system/leading-user/
  providerOptions（`instructions` 逐字透传，保留缓存标记），messages =
  `[...引导段, ...head, {user: 压缩指令}]`，压缩指令是最后一条；
- 稳定缓存断点（system / leading-user / summary）与主请求一致 → head（≈80% 窗口）
  命中 KV cache（修复 D7），这是全链路最大的成本节省（注：移动的 5m 尾标记位置不同，
  尾部重新 tokenize，非逐字节相同）；
- tools 用 `withoutExecute` 剥离 execute（线上序列化不变，客户端不可执行）；
  Anthropic 改 `tool_choice` 会使 tools/system 段缓存失效 → 该路径保持 `auto`，靠指令
  约束 + `stopWhen: isStepCount(1)`；OpenAI key 路由与 DeepSeek 自动磁盘缓存均不受 tool_choice 影响，
  照常 `none`。

**路径 B（配置了专用压缩模型 / head 超出其窗口）—— 分块 map-reduce：**

- 块大小 = 压缩模型窗口 × 0.6，rolling summary：`summarize(chunk_i + summary_{i−1})`；
- system 只有一句摘要器指令；无缓存标记；
- 修复 D3 的窗口校验就在此路径入口：`estimatedTokens(head) > forkWindow × 0.8` 即走分块。

保留现有 `onError` 捕获真实流错误的处理（`fork-agent.ts:231-236` 是对的，SDK 会把多数流错误
掩蔽为 `NoOutputGeneratedError`）。

### 4.7 降级链（`compact/degrade.ts`，今天完全缺失）

```
L1  摘要压缩（4.6 路径 A/B）
L2  = 路径 B（head 超窗自动进入）
L3  fork 失败/超时 → 机械降级（无模型调用，必然收敛）：
      pruneMessages({ messages, toolCalls: 'before-last-8-messages' })   # ai 内置
      + 更旧的超长 tool 输出替换为 "[elided N tokens: toolName]"
L4  仍超 hardCeiling → 丢弃最旧 round，保 system + 上一 summary + 最近 rounds
```

约束：L3/L4 只允许发生在**压缩事件点**（此刻缓存已注定失效）；平时严禁渐进式修剪——否则破坏
I1。L3/L4 产出同样走 `finalizeCompaction` 持久化（summary 为机械说明文本），用户可见
`data-compaction` 卡片标注降级级别。

### 4.8 Volatile 注入持久化（满足 I1，修复 D6-1/2/3）

datetime / git-status / goal 注入改为**持久化的合成 user 消息**（带 `data-context-injection`
part，渲染层折叠显示），在**回合开始**写入 transcript，而非 step 0 的幽灵消息：

- 同回合 step ≥ 1 不再消失；重启 rehydrate 后 transcript 与模型实际所见一致；
- 删除：`prefixCacheScope`、`volatilePrefixUser` / `trailingUser` 通道、
  `withFrozenVolatilePrefix`、DeepSeek freeze Map —— `CompiledContext` 收敛为
  `{ system, leadingUser, history }`；
- steering 持久化位置改为与发送位置一致（append 于消费点；删除
  `withConsumedSteering` 的重排逻辑）；
- stable-system sections（role/tanzo/skills-index/plugins-index）按**会话快照**渲染 + 内容
  哈希：只在回合边界允许变更并记录哈希变化（= 已知缓存失效点，进遥测）（修复 D6-4）。

### 4.9 Provider 缓存策略修正（`context/providers/`）

接口 `ProviderContextStrategy { cacheKind, applyCaching }` 不变（`applyPromptLayout` 随
freeze 机制删除）。

| Provider | 现状 | v2 |
|---|---|---|
| Anthropic | system 尾 1h + leading 尾 1h + history 尾 2×5m | 保留 4 断点；第 3 断点改打在**最近一条 summary 消息**（1h）——压缩边界是新前缀家族的根，值得长 TTL；history 尾留 1 个 5m |
| OpenAI / compatible | `promptCacheKey = tanzo:global:<model>`（D5） | `tanzo:chat:<chatId>`；fork 请求不带 key |
| DeepSeek | 内存 freeze volatile prefix | 删除 freeze；纯 no-op（无请求侧控制面；注入已持久化 → I1 逐字前缀天然命中磁盘 prefix-unit；best-effort、<64 token 不缓存、hitRatio 更抖） |
| Google | unsupported | 保持无显式标记；I1 使 Gemini 隐式缓存自然受益 |

配套：`buildTools` 输出用 v7 `toolOrder` 固定确定性排序；每回合**快照工具集**——MCP server
中途上线不得改变本回合 tools 序列化（Anthropic 缓存前缀含 tools）。

---

## 5. 删除清单

| 删除项 | 位置 | 由谁取代 |
|---|---|---|
| `budget.ts`（锚点 + 全量估算） | context/ | `ledger.ts` |
| `segments.ts`（UI-part 域切点 + 守卫） | context/compact/ | `cut.ts` |
| `overCompactionTrigger` stopWhen | build-agent.ts | prepareStep 内联触发 |
| `compaction-retry` / `post-compact` 分支 | turn-loop.machine.ts / turn-loop.ts | I4 |
| `exceededCompactionTrigger` / `hitCompactionTrigger` | stream-runner.ts 终态 | — |
| `prefixCacheScope` / volatilePrefix / trailing 通道 | section.ts / compile.ts | 持久化注入 |
| `freezeVolatilePrefix` + 内存 Map | context/index.ts / providers/deepseek.ts | 持久化注入 |
| `withConsumedSteering` 重排 | run-persistence-registry.ts | 消费点 append（携 stepNumber） |
| fork 走 `contextEngine.build` | fork-agent.ts | summarize.ts 直组 prompt |

---

## 6. 实施顺序（每步独立可验证）

| 阶段 | 内容 | 验证 |
|---|---|---|
| 1 | `ledger.ts` + `cut.ts`（纯函数）+ 表驱动测试：巨型单回合、连续 summary、超大 tool 输出、CJK、删除消息 | `vitest run tests/unit/main/agent/context` |
| 2 | 注入持久化（per-step 行已实现后回退，见 4.5） | message-repo 单测（load/loadDisplay/overlay）；迁移 22→23 往返幂等校验 |
| 3 | prepareStep 内联压缩；删三路径状态机；`rebase` | `spike/` 长回合模拟 + `pnpm diagnose:prompt-cache` |
| 4 | `summarize.ts`（A/B 路径）+ `degrade.ts` L3/L4 | 构造 head>fork 窗口、fork 报错两个用例，断言必产出可发送 transcript |
| 5 | Provider 缓存修正 + toolOrder/工具集快照 | `diagnose:prompt-cache` 对比改前后 `cacheHitRatio`；账本含 cacheReadTokens，可做回归指标：稳态 run 步间 hitRatio > 0.9 |

回归红线（阶段 3 起持续跑）：

1. 50 步自主回合触发压缩后，下一请求 inputTokens < trigger（D1 消失）；
2. 任一 provider 稳态 run 的步间 cacheHitRatio > 0.9（I1 成立）；
3. fork 强制失败注入下，会话仍能继续（降级链兜底）；
4. 压缩后连续 3 回合不再自动触发压缩（滞回生效，D4 消失）。

---

## 7. 风险与取舍

- **prepareStep 内 await fork** 会让某一步停顿数十秒。缓解：`data-compaction` 进度流（沿用
  onSummary 节流）；相比现在"停流→重开 run"的断裂体验反而更连贯。abort 语义：fork 挂在同一
  run signal 上，用户取消即中止，transcript 保持压缩前状态。
- **per-step 行（已实现后回退）**：曾落地迁移 22 + 全链路拆行/分组，但同一条回复的双重
  身份（直播单消息 id vs 落库片段 id）在渲染器所有 id-based 路径上反复制造重复渲染
  bug，收益（持久层 UI 域免劈消息）不抵复杂度，由迁移 23 回退。`partitionAtCut` 特殊
  情形族保留在 `cut.ts` 内部，作为可接受的局部复杂度。
- **prepareStep messages carry-forward** 依赖 `ai@7.x` 行为（d.ts 已明示）。升级 SDK 时须有
  一条冒烟测试盯住该语义。
- **Anthropic 断点预算**：cache_control 断点上限 4，v2 的分配（system 尾 / leading 尾 /
  summary / history 尾）已占满；后续如需为 skills 快照单加断点，必须先裁撤 history 尾 5m。
- **归因误差**：provider 报告的 inputTokens 含缓存读写差异，步间差分在个别 provider 上可能
  出现小幅负值；ledger 对负增量归零并计入遥测，不影响触发判定的量级正确性。
