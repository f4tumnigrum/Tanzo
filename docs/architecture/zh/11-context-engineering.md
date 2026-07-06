# 11 · 上下文工程

> 适用范围：Section × Provider 模型、append-only 前缀不变量、token 账本、流内压缩与降级链、
> 工具记录规整。最后核对：`src/main/agent/context/*` 与 `runtime/compaction-coordinator.ts`
> （v0.3.x，compaction v2）。设计依据：
> [`docs/design/context-compaction-v2.md`](../../design/context-compaction-v2.md)。

## 1. 心智模型

上下文工程每步回答一个问题：*给定至今的 transcript，我们该发给模型的确切 prompt 是什么？*
四条不变量驱动整个设计：

- **I1 —— append-only 前缀**：两次压缩事件之间，每一步的 prompt 都是上一步 prompt 的严格前缀
  扩展。任何会破坏它的东西（每回合易变内容、steering 重排、section 漂移）要么持久化进
  transcript，要么被限制在压缩事件点。这是各 provider KV 缓存（Anthropic 显式、
  OpenAI key 路由、DeepSeek 磁盘 prefix-unit 完整匹配、Gemini 隐式）生效的根基。
- **I2 —— 单一转换点**：UI→Model 转换每 run 一次；run 内部全程使用 `ModelMessage[]`。
- **I3 —— token 账本**：预算读取持久化在消息 metadata 里的 provider 上报 usage 锚点；
  估算只用于未测量的增量。
- **I4 —— 内联压缩**：自动压缩发生在 `prepareStep` 内、同一条流里——绝不通过停流重开实现。

## 2. Section 模型

`ContextSection`（`context/section.ts`）是 `{ id, stability: 'stable' | 'volatile', channel, order, render() }`，
三个通道：

- **`system`** —— 渲染进系统消息，run 内稳定。
- **`leading-user`** —— 合并为一条置于 history 之前的用户消息（环境块）。
- **`injection`** —— 每回合开始渲染一次并**持久化进 transcript**，形态为携带
  `data-contextInjection` part 的合成用户消息（`context/injection.ts`）。datetime、git 快照、
  goal 提示、插件焦点、hook 上下文等易变内容由此进入模型而不破坏 I1。渲染器隐藏这些消息。

注册表（`context/registry.ts`）接线：`role`、`plan-mode`、`tanzo`、`skills-index`、
`plugins-index`（system/leading-user）与 `datetime`、`git-status`、`goal`、`plugins-mention`，
外加经 `deps.extraSections` 挂载的 hooks section（均为 `injection`）。git 快照只在首回合渲染——
它已被持久化，重复渲染只会堆积过期数据。

## 3. 组装

`compileSections`（`context/compile.ts`）渲染非 injection section，产出
`{ system, stableBoundary, leadingUser, history }`。引擎（`context/index.ts`）暴露：

- `build(def, chatId, cwd, transcript, stepNumber)` —— 纯函数式的每步 prompt 组装：
  `leadingUser ++ history`，叠加 provider 缓存策略。相同 transcript ⇒ 相同 prompt（I1）。
- `renderInjection(def, chatId, cwd, { isFirstTurn })` —— 可持久化的注入消息；消费一次性状态
  （goal 注入、插件 mention）。由 `TurnLoop.run` 每逻辑回合调用一次；transcript 以未执行的
  tool call 结尾（审批恢复）时跳过。
- `measure` / `shouldCompact` / `snapshot` / `compactionPolicy` —— 基于账本的核算（见下）。

Provenance 经 symbol 附着（`attachContextProvenance`），形状为 `{ system, leadingUser, history,
messages }`，供 prompt 缓存诊断（`diagnostics/prompt-cache.ts`）消费。

## 4. Token 账本

`context/ledger.ts` 替换旧的锚点+全量估算预算。测量纯函数化、重启安全：

- 每条 assistant 消息持久化其每步 usage（`metadata.steps[].usage.inputTokens`）——即 provider
  报告的该步精确 prompt 体积。
- `measureTranscript` 使用**最新压缩摘要之后、最新的上报锚点**（摘要之前的锚点已失效——前缀
  变了），随后对更晚的消息逐条加增量：有上报用上报，否则估算。
- 估算 CJK 感知（`estimateTextTokens`：latin ~4 chars/token、CJK ~1.5），跳过 `data-*` part
  与 step 标记。

## 5. 压缩（v2）

### 5.1 策略

`context/compact/policy.ts`：

- `compactionTriggerTokens = floor((contextWindow − maxOutputTokens) × 0.8)`
- `retainBudgetTokens = min(30_000, contextWindow × 0.15)` —— 切割后保留的尾部（token 制）
- `hardCeilingTokens = contextWindow − maxOutputTokens` —— 紧急红线

### 5.2 切点

`context/compact/cut.ts` 在两个域上运作，形状相同：

- **UI 域**（`findCut` / `splitForCompaction`）：持久 transcript。持久层按**每模型步一行**
  存储（§7.1），所以每个消息边界都是合法切点：首选 round 边界（user 消息 → 下一条 user 消息）；
  巨型单 round 降级到其行间的 step 片段边界。切割永远覆盖整行——不存在 mid-message 分裂。
  扫描不越过最新 summary，但 summary 本身可被归档（滚动摘要）。
- **模型域**（`splitModelTranscript`）：流内 live transcript。assistant + 尾随 tool 消息构成
  闭合 step 组，切点绝不孤立 tool call/result 对。

### 5.3 流内压缩（I4）

`stream-runner.ts` 的 `prepareStep` 内：上一步上报的 `inputTokens` 超过触发线时，
`compactModelTranscript`（`context/compact/inline.ts`）切割 live transcript、摘要 head，返回
`[summary, ...tail]`——prepareStep 把它作为 `messages` 返回，AI SDK **carry forward 到后续
步骤**。流不停止；UI 收到 `data-compaction` transient part。终态携带 `inlineCompaction`
记录；run 结束后 `CompactionCoordinator.reconcileInline` 重切*持久* transcript，把 head 归档
到已产出的摘要之下（不二次 fork）。

### 5.4 预回合压缩

`CompactionCoordinator.prepareMessages`（turn loop 与子代理驱动）：持久 transcript 在 run
开始前测量超触发线时，先跑完整 fork 压缩。手动 `/compact` 走同一路径。持久化仍经
`finalizeCompaction`（overlay + `repositories/message-repo.ts` 的 `expectedActiveIds`
乐观并发校验）。

### 5.5 摘要 fork

`context/compact/summarize.ts`（`runSummarizeFork`）两条路径：

- **路径 A —— 前缀复用**（默认；无专用压缩模型、调用方传入主 run 的 tools）：请求保持与主
  会话*完全一致*的 system section、tools 序列化与 leading-user 块，只在末尾追加一条摘要指令
  用户消息。稳定缓存断点（system / leading-user / summary）与主 run 一致，head——全 run 最贵
  的 prompt——命中 provider KV 缓存（只有最后一个稳定断点之后的尾部重新 tokenize）。tools 经
  `execute` 剥离传入（线上格式不变）；Anthropic 上 `toolChoice` 保持 `auto`，因为 tool_choice
  已序列化进缓存前缀。
- **路径 B —— 独立摘要器**（配置了 `compactionModelRef`，或 head 超出 fork 模型窗口）：
  纯摘要器 system prompt + 文本序列化 transcript，单次放不下时分块 map-reduce（滚动摘要，
  块 = fork 窗口 × 0.6 × 0.8）。

### 5.6 降级链

压缩绝不搁浅会话：

```
L1/L2  摘要 fork（路径 A / 路径 B 分块）
L3     fork 失败 → 机械降级：pruneMessages(toolCalls before-last-8) + 剪 reasoning
       （流内：context/compact/degrade.ts；持久：coordinator 的 mechanicalSummary）
L4     仍超 hardCeiling → 丢最旧 rounds，保留前导 summary + 最近 rounds
```

L3/L4 只在压缩事件点运行（此刻缓存前缀已注定失效）。摘要消息在其 `data-compaction` part
记录 `degraded: 'prune' | 'drop-oldest'`。

### 5.7 Turn loop 形态

`turn-loop.machine.ts` 只有两个出口：`plan-exit-retry | finalize`。v1 的
`compaction-retry` / `post-compact` 路径、`overCompactionTrigger` 停止条件、
`exceededCompactionTrigger` / `hitCompactionTrigger` 终态字段全部删除。

## 6. Provider 策略（缓存前沿）

`context/providers/`：`ProviderContextStrategy = { cacheKind, applyCaching({ plan, summaryIndex }) }`。

- **Anthropic**（`anthropic.ts`）—— 四个 `cacheControl` 断点（provider 上限）：最后一条稳定
  system 消息（1h）、最后一条 leading-user 消息（1h）、**最新压缩摘要（1h）**——当前前缀族的
  根——以及最后一条 history 消息（5m，移动前沿）。
- **OpenAI / OpenAI 兼容**（`openai.ts`）—— `promptCacheKey = tanzo:chat:<chatId>`（按会话，
  不再全局）+ `promptCacheRetention: '24h'`。路径 A 的 fork 请求携带同一 key。
- **DeepSeek**（`deepseek.ts`）—— no-op 策略：磁盘缓存全自动、**无请求侧控制面**（无标记、无 key）。
  它按完整的 *cache prefix unit* 匹配（在用户输入末尾 / 模型输出末尾及固定 token 间隔处落桩，Sliding
  Window Attention 下），命中需请求*完整匹配*某个已持久化 unit —— I1 的逐字稳定前缀正是命中的来源。
  best-effort（不保证 100%）、< 64 token 不缓存、unit 数小时至数天后清除，故其 `cacheReadTokens` 天然比
  Anthropic 更抖，**不要假设稳态每步命中率**。指标仍可见：SDK 把 `prompt_cache_hit_tokens` 映射到
  `cacheReadTokens`，并反算 `noCacheTokens = promptTokens − cacheHit`。
- **Google** —— 自动隐式缓存，无显式标记。两者的 v1 前缀冻结机制均已删除——I1 使其不再必要。

工具序列化顺序经 `build-agent.ts` 的 `toolOrder`（排序）钉死，因为 Anthropic 缓存前缀包含
tools 块。

## 7. 消息行表示（每条回复一行）

存储保持**直播域形状**：每个模型 pass 一条 assistant 行，parts 以 `step-start` 分隔，per-step
usage 在 `metadata.steps[]`。这是刻意的——AI SDK 用单一消息 id 流式输出整条回复，给同一条回复
造第二种持久化身份被证明是系统性 bug 源（直播视图与落库视图按 id 相遇处全都可能双倍渲染）。

当 UI 域压缩切点必须落在多步回复内部时，`cut.ts` **在切割瞬间于内存中**劈开该消息
（`partitionAtCut`）：头片段保留原 id 进入归档，尾片段获得新 id 留在尾部。劈消息的复杂度被
关在一个函数、一个瞬间——而不是摊进存储 schema。

run 中 steering 持久化在贴近模型实际所见的位置（D6-2）：`recordConsumedSteering` 携带
prepareStep 的 `stepNumber`；聚合行下解析为回复之前（run 前 steer）或之后（run 中 steer），
存在 `metadata.steps[0].stepNumber` 时以其为准。

历史：migration 22 曾把存储拆为每步一行（`{baseId}::step-k` id）；migration 23
（`database/merge-step-rows-migration.ts`）把这些片段串合并回聚合行、把压缩 overlay 覆盖范围
向外取整到整行、丢弃片段 revision。`@shared/message-steps` 仅为这两个迁移保留。

## 8. 工具记录规整

`context/tool-transcript.ts`（`canonicalizeToolTranscript`）不变：丢弃孤儿 call/result，按
call 顺序把 result 排在 approval-response 之前。模型域切割产出闭合 step 组之后，它退居安全网
而非每步修补器。

下一篇 → [12 工具](./12-tools.md)
