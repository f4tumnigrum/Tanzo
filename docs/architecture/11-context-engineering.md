# 11 · 上下文工程

> 适用范围：系统/前导提示如何按 Section × Provider 组装、缓存前沿、token 预算、压缩与 fork、工具记录规整。最后核对：`src/main/agent/context/*`。

## 1. 心智模型

每一步调用模型前，上下文引擎把一组**声明式 Section** 编译成 prompt 消息，并按当前模型的**供应商策略**放置缓存断点。核心目标：

1. **缓存前沿稳定**——把会变的内容尽量后置或冻结，让供应商的 prompt 缓存命中率最大化。
2. **预算可控**——按供应商**上报**的 token 用量决定何时压缩，不靠估算。
3. **声明式清理**——压缩把旧历史塌缩成一段摘要，保留近期步骤。

## 2. 引擎与 `build`（`context/index.ts`）

`createContextEngine(deps)` 持有 Section 注册表、`Budget`、`capabilitiesFor`、每对话 `lastUsage` 与 `frozenVolatilePrefixes`。

```ts
interface ContextEngine {
  build(def, chatId, cwd, transcript, stepNumber, options?): Promise<BuiltContext>
  observeStep(chatId, messageCount, usage): void
  snapshot(def, chatId, messages): ContextSnapshot
  shouldCompact(def, chatId, messages): boolean
  compactionTriggerTokens(def): number
  retainedRecentSteps(def): number
  clear(chatId): void
}
```

ai-sdk 的 `PrepareStepFunction` 包装在 runtime 层（`runtime/stream-runner.ts:290`），其每步调用 `contextEngine.build(...)`（`index.ts`，内部 `compilePlan`）：

1. `projectHistory(messages, capabilities)` 规整工具记录（§6）。
2. `stepNumber === 0` 且未禁用消费时，按需窥探目标注入（`deps.goal.peekInjection`）。
3. `compileSections(...)` → `CompiledContext`。
4. `strategy.applyPromptLayout?.(...)`（仅 DeepSeek）。
5. `strategy.applyCaching(plan)`（供应商缓存断点）。
6. 消费目标注入（仅 `consumeGoalInjection !== false` 时；压缩 fork 路径以 `false` 调用 `build`，不消费）。
7. `promptMessages(plan, stepNumber)` 生成最终 prompt，附 `attachContextProvenance` 溯源。

runtime 的 `prepareStep` 还在 `build` 前后追加：排空 steering、对 transcript 规整、对产出消息再次规整、按激活技能过滤工具、记录诊断（`stream-runner.ts:291-319`）。

**缓存不变量**：volatile 前缀 + 尾部 user section 只在 `stepNumber === 0` 发出（`promptMessages`，`index.ts:64-70`）。后续步骤只复用 `leadingUser + history`，让缓存前缀稳定。

## 3. Section → CompiledContext（`context/compile.ts`）

```ts
interface ContextSection {
  id: string
  stability: 'stable' | 'volatile'
  channel: 'system' | 'leading-user'
  order: number
  prefixCacheScope?: 'conversation'
  render(input: BuildInput): string | null | Promise<…>
}
```

`compileSections`（`compile.ts:50`）：并行渲染所有 section、丢空、按 `stability` 分组再按 `order` 排序。

- **system 通道**：stable system 在前，volatile system 在后 → `SystemModelMessage[]`。`stableBoundary` = stable system 数（缓存标记用）。
- **leading-user 通道**：stable leading 合一条 `leadingUser`；volatile leading 按 `prefixCacheScope === 'conversation'` 分成 `volatilePrefixUser`（可缓存的对话级前缀）与 `trailingUser`（每回合重算）。
- 每桶并行产出 `provenance`。

## 4. Section 目录（`context/sections/*`，`registry.ts:20`）

放置由 `order` + `stability` + `channel` 决定，非数组顺序。

| Section | id | stability | channel | order | 注入 |
|---|---|---|---|---|---|
| role | `role` | stable | system | 0 | `def.systemPrompt`（`.trim()`；空则不渲染） |
| plan-mode | `plan-mode` | volatile | system | 1 | 计划模式指令（仅 `def.kind==='main'` 且模式为 `plan`） |
| tanzo | `tanzo` | stable | system | 20 | `<tanzo-instructions priority="binding">` 包裹全局+项目指令文件 |
| skills-index | `skills-index` | stable | system | 30 | `<skills>` 已启用技能 `name: description` 清单 |
| env | `env` | stable | leading-user | 0 | `<environment>` cwd/platform/os/shell |
| datetime | `datetime` | volatile | leading-user | 0 | `<datetime>`；`prefixCacheScope: conversation` |
| git-status | `git-status` | volatile | leading-user | 10 | `<git-status>` 对话起点快照；`prefixCacheScope: conversation` |
| goal | `goal` | volatile | leading-user | 5 | 目标续接/预算/objective（仅有待注入时） |
| hooks | `hooks` | volatile | system | 25 | `SessionStart` / `UserPromptSubmit` / `PostToolUse` 追加的上下文，包在 `<hook-context>`（由 `extraSections` 注入，`hooks/context-section.ts`） |

`registry.ts` 提供内建 sections；`agent/module.ts` 通过 `createContextEngine({ extraSections: [createHooksContextSection(...)] })` 挂载 hooks section。

指令文件解析（`context/deps.ts:11`）：项目候选 `TANZO.md`、`.tanzo/TANZO.md`、`AGENTS.md`、`CLAUDE.md`、`.claude/CLAUDE.md`；全局来自 app `userDir` 与 `~`。git 状态经 `execFileSync` 取分支/主分支/用户/porcelain（截 40 行）/近 5 次提交。

## 5. Provider × Section 缓存模型（`context/providers/*`）

`strategyFor(modelRef, chatId)`（`providers/index.ts:21`）按 `modelRef` 的供应商前缀分派。

```ts
interface ProviderContextStrategy {
  cacheKind: 'ephemeral' | 'auto' | 'unsupported'
  applyPromptLayout?(plan, helpers): CompiledContext
  applyCaching(plan): CompiledContext   // 引擎 reassign plan = strategy.applyCaching(plan)（index.ts:155）
}
```

| 供应商 | cacheKind | 行为 |
|---|---|---|
| anthropic | ephemeral | 显式放 `cacheControl: {type:'ephemeral', ttl}` 断点：最后一条 stable system（`1h`）、stable leading user（`1h`）、history 尾部 2 条（`5m`） |
| openai | auto | 设 `providerOptions.openai.promptCacheKey = "tanzo:global:<modelRef>"` + `promptCacheRetention: '24h'` |
| openai-compatible | auto | 同上但写入 `providerOptions.openaiCompatible.*`（非 `openai.*`） |
| deepseek | auto | `applyPromptLayout` → `freezeVolatilePrefix`：每对话把 volatile 前缀挪进 `leadingUser` 一次（缓存于 `frozenVolatilePrefixes`），此后不变 |
| google | auto | no-op（passthrough） |
| 默认 | unsupported | no-op |

`clear(chatId)`（`index.ts:234`）丢弃预算锚、上次用量与冻结前缀；每次压缩后调用。

## 6. 预算（`context/budget.ts`）

token 计量是**基于上报、非估算**。`observeStep`（`index.ts:192`）记录供应商上报的 `inputTokens`（`budget.anchor`）。`measureUsage` 返回上次上报值；`exceeds(n)` 仅在有上报值且超 `n` 时为真。无上报时 `source: 'unavailable'`，自动压缩**不触发**。`cacheHitRatio = cacheReadTokens / inputTokens`。

能力与策略：`createCapabilities`（`capabilities.ts:18`）返回 `{contextWindow, maxOutputTokens, supportsImages}`，原始供应商元数据字段为 `{contextWindow, maxOutput, vision}`（`deps.ts:52-59`）；默认 `128_000` / `8_192`，`maxOutput` 被夹到 `contextWindow`。`computeCompactionPolicy`（`compaction-policy.ts:11`）：

```
inputWindow = max(contextWindow - maxOutputTokens, 0)
compactionTriggerTokens = floor(inputWindow * 0.9)
retainedRecentSteps = 6
```

## 7. 压缩与 fork（`context/compact/*`）

由 `CompactionCoordinator`（`runtime/compaction-coordinator.ts`）触发，不是引擎直接做。

- `prepareMessages`：非 `force` 时查 `engine.shouldCompact`；超阈则压缩。
- `planCompaction(messages, retainedRecentSteps)`（`compact/compact.ts:30`）：按助手 step 边界切分（`findCut`/`partitionAtCut`，`segments.ts`），`findCut` 保留固定的 `retainedRecentSteps` 步数（非 char/4 token 估算）。返回 `head`（待摘要）、`tail`（保留）、`archivedIds`、`sourceMessages`。
- `runCompactionFork`（`compact/fork-agent.ts:137`）：一步 `streamText`，`toolChoice: 'none'`、`stopWhen: [isStepCount(1)]`，输入 `[...head, {role:'user', content: COMPACT_PROMPT}]`，流式产出摘要并上报用量。
- `COMPACT_PROMPT`（`compact/prompt.ts`）：先私有 `<analysis>` 草稿，再 9 段 `<summary>`；`stripAnalysis` 只留摘要。
- `buildCompactionResult`（`compact/compact.ts:80`）：构造一条合成 `assistant` 摘要消息（标 `data-compaction`；数据形状为 `summaryId/summary/usage`，**无** `metadata.compaction.isSummary`），前置到保留的 tail。
- `store.finalizeCompaction` 用 `expectedActiveIds` 守卫；底层以 overlay 形式落库（`compaction_overlays` 表；`finalizeCompaction` 在 `message-repo.ts:366`，`expectedActiveIds` 守卫在 `message-repo.ts:307-320`），冲突抛 `CHAT_COMPACTION_STALE` 并优雅跳过。

**子代理自动续接**：流在压缩触发处中途停止时，协调器以 `forceCompaction` 重入，上限 `MAX_CONTEXT_CONTINUATION_PASSES = 10`。

## 8. 工具记录规整（`context/tool-transcript.ts`）

`canonicalizeToolTranscript`（`tool-transcript.ts:244`）依次跑 `ensureToolPairing` 与 `canonicalizeToolContent`，强制**有效供应商 transcript 不变量**：以 `validCallIds`（有 `tool-result` 或 final-block approval response）为准，孤儿 `tool-result`/approval 及未配对的 `tool-call`/`tool-approval-request` part 被剥离；每条工具消息**内部按调用顺序排序** part（非整条消息重排）。注：`tool-approval-request` 并非必须有匹配 response 才保留。`projectHistory`（实时）与 `planCompaction`（压缩源）都跑它。

## 9. 上下文不变量

- [ ] 缓存前缀稳定：volatile 前缀/尾部 section 仅 step 0 发出；DeepSeek 额外每对话冻结前缀。
- [ ] 预算靠上报 token；无上报则不自动压缩；`findCut` 按固定 `retainedRecentSteps` 选切点。
- [ ] 工具记录在每次发送与每次压缩前配对规整，剥离孤儿 `tool-result`/未配对调用 part。
- [ ] anthropic 在 stable 边界放 ephemeral 缓存断点。

下一篇 → [12 工具系统](./12-tools.md)
