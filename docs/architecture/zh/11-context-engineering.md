# 11 · 上下文工程

> 适用范围：Section × Provider 模型、缓存前沿、预算、压缩与 fork、工具记录规整。最后核对：`src/main/agent/context/*` 与 `runtime/compaction-coordinator.ts`（v0.2.4）。

## 1. 心智模型

上下文工程每步回答一个问题：*给定至今的 transcript，我们该发给模型的确切 prompt 是什么？* 它由两条正交轴构成：

- **Sections（"是什么"）**：渲染系统与前导用户 prompt 的声明单元（role、计划模式、环境、git 状态、技能索引、目标……）。
- **Provider 策略（"怎么发"）**：叠加在组装后 prompt 上的按供应商的 prompt 布局与缓存（"缓存前沿"）。

入口是 `createContextEngine(deps)`（`context/index.ts:107-255`），暴露 `build`、`observeStep`、`snapshot`、`shouldCompact`、`compactionTriggerTokens`、`retainedRecentSteps`、`clear`。

## 2. Section 模型

`ContextSection`（`context/section.ts:22-29`）是 `{ id, stability: 'stable' | 'volatile', channel: 'system' | 'leading-user', order, prefixCacheScope?, render() }`。

固定 section 列表在注册表（`context/registry.ts:24-36`）：`role`、`plan-mode`、`tanzo`、`skills-index`、`plugins-index`、`env`、`datetime`、`git-status`、`goal`、`plugins-mention`。可经 `deps.extraSections`（`index.ts:108`）追加——hooks context section 即由此挂载（见 [14 钩子系统](./14-hooks.md)）。

- **`stability`** 分离跨步稳定（利于缓存）与每步变化（`datetime`、`git-status`、注入上下文）的内容。
- **`channel`** 分离系统消息与前导用户消息。
- **`order`** 在同一稳定带内排序。
- **`prefixCacheScope`** 把 volatile 前导用户 section 标为 `conversation` 作用域，以便冻进可缓存前缀。

## 3. 组装与编译

`compileSections(registry, input, history)`（`context/compile.ts`）并行渲染所有 section、丢弃空的，再切分：

- **系统消息** = stable-system ++ volatile-system，各自一条 `SystemModelMessage`。
- **前导用户**：stable-leading 合并成一条用户消息；volatile-leading 按 `prefixCacheScope === 'conversation'` 切成 `volatilePrefixUser` 块与 `trailingUser` 块。
- `stableBoundary` = stable-system 消息数，作缓存锚点。
- 每 section/消息记录 provenance，并符号附着（`section.ts` 的 `attachContextProvenance` / `getContextProvenance`）。

每回合 prompt（`promptMessages`，`index.ts:65-71`）：

```text
leadingUser ++ history ++ (stepNumber === 0 ? volatilePrefixUser ++ trailingUser : [])
```

故 volatile 前缀/尾部用户块**仅在回合的第 0 步**注入。

## 4. 预算

token 计量是**用量锚定，非估算**（`context/budget.ts`）：

- `anchor(chatId, msgCount, inputTokens)` 存最近一次上报的 `inputTokens`。
- `measureUsage` 返回 `{ inputTokens, source: 'reported' | 'unavailable', exceeds() }`，完全忽略消息内容——数字来自真实模型用量，由 `observeStep`（`index.ts:198-206`）从流回灌。
- `cacheHitRatio` = `cacheReadTokens / inputTokens`。

模型能力（`context/capabilities.ts`）：`contextWindow`、`maxOutputTokens`、`supportsImages`，默认 128k / 8192。

## 5. 压缩

### 5.1 触发

`context/compaction-policy.ts`：`compactionTriggerTokens = floor((contextWindow − maxOutputTokens) × 0.9)`，`retainedRecentSteps = 6`。`shouldCompact()` 即「上报用量 `exceeds(trigger)`」（`index.ts:227-230`）。

运行时，停止条件 `overCompactionTrigger` 在最后一步 `usage.inputTokens > trigger` 时中止流（`build-agent.ts:65-71`，接线于 `stream-runner.ts`）。回合后 `stream-runner.ts` 计算 `exceededCompactionTrigger` / `hitCompactionTrigger` 交给 `onFinally`，`TurnLoop` 据此决定 `compaction-retry` 还是 `post-compact`（见 [10 Agent 运行时](./10-agent-runtime.md)）。

### 5.2 协调器

`runtime/compaction-coordinator.ts` 执行实际压缩：`prepareMessages`（回合前，若 `shouldCompact`）、`compactAfterRun`（回合后，受 `exceededCompactionTrigger && !hitCompactionTrigger` 门控）、手动 `compact`。

### 5.3 机制

`context/compact/`：

- `planCompaction`（`compact/compact.ts`）在切点处切分 transcript，并把头部规范化为模型消息；头部为空或全是摘要则放弃。
- `findCut`（`compact/segments.ts`）从末尾按 step 段回走，保留 `retainedRecentSteps`，遇到既有摘要即停；`partitionAtCut` 产出 `{ head, tail, archivedIds }` 并给尾部重加 `step-start`。step 边界来自 `step-start` part；摘要经 `data-compaction` part 识别。
- 摘要由**fork**（见下）产出，`buildCompactionResult` 再构造一条助手摘要消息（携 before/after/reduced token 的 `data-compaction` part），使后续消息为 `[summary, ...tail]`。

### 5.4 压缩 fork

`context/compact/fork-agent.ts`：`runCompactionFork` 以 `toolChoice: 'none'` 与**空工具集**跑单步 `streamText`（完全跳过 `buildTools`），因为 fork 只需摘要。配置时用专用压缩模型（`def.compactionModelRef ?? def.modelRef`），并带节流把部分摘要流给 UI。prompt 为 `[...head, { role: 'user', content: prompt }]`。

## 6. Provider 策略（缓存前沿）

`context/providers/`：`ProviderContextStrategy` 是 `{ cacheKind, applyPromptLayout?, applyCaching }`（`providers/strategy.ts`），`cacheKind` 为 `'ephemeral' | 'auto' | 'unsupported'`。策略按模型供应商前缀选择（`providers/index.ts:21-38`）：anthropic / openai / openai-compatible / google / deepseek / passthrough。

在 `index.ts`（`:146-160`），引擎先应用 `applyPromptLayout`（带 `freezeVolatilePrefix`，每对话记忆化），再 `applyCaching`；冻结前缀状态在 `clear()` 时清除。

- **Anthropic —— ephemeral 缓存前沿**（`providers/anthropic.ts`）：给最后一条 stable-system 消息标 `cacheControl ttl: '1h'`，最后一条 stable 前导用户标 `1h`，最后两条历史消息标 `5m`。`cacheKind: 'ephemeral'`。
- **OpenAI / OpenAI-compatible**（`providers/openai.ts`）：注入 `promptCacheKey = tanzo:global:<modelRef>` 与 `promptCacheRetention: '24h'`。`cacheKind: 'auto'`。
- **Google / DeepSeek / passthrough**：`cacheKind: 'unsupported'`（无显式缓存标记）。

## 7. 工具记录规整

`context/tool-transcript.ts`（由 `context/project.ts` 调用，`index.ts:193`）：

- `ensureToolPairing`：对每个助手工具调用块，只保留有匹配 `tool-result`（或末块的审批响应）的调用；丢弃孤立调用与孤立结果；移除清空的消息。这防止压缩/编辑后残留悬空的 `tool_use` / `tool_result` 对。
- `canonicalizeToolContent`：重排 `tool` 消息内部 part 以匹配助手调用顺序（结果先于审批响应）。

同样的规范化也应用于压缩头部，故摘要后的 transcript 不会重新引入悬空工具对。

下一篇 → [12 工具系统](./12-tools.md)
