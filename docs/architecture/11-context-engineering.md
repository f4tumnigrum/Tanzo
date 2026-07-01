# 11 · Context Engineering

> Scope: the Section × Provider model, the cache frontier, budgeting, compaction and fork, and tool-record
> normalization. Last verified against `src/main/agent/context/*` and `runtime/compaction-coordinator.ts` at
> v0.2.4.

## 1. Mental model

Context engineering answers one question per step: *given the transcript so far, what exact prompt do we send
the model?* It is built from two orthogonal axes:

- **Sections** (the *what*): declarative units that render the system and leading-user prompt (role, plan mode,
  environment, git status, skills index, goal, …).
- **Provider strategies** (the *how*): per-provider prompt layout and caching (the "cache frontier") applied on
  top of the assembled prompt.

The entry point is `createContextEngine(deps)` (`context/index.ts:107-255`), exposing `build`, `observeStep`,
`snapshot`, `shouldCompact`, `compactionTriggerTokens`, `retainedRecentSteps`, and `clear`.

## 2. The Section model

`ContextSection` (`context/section.ts:22-29`) is
`{ id, stability: 'stable' | 'volatile', channel: 'system' | 'leading-user', order, prefixCacheScope?,
render() }`.

The fixed section list is in the registry (`context/registry.ts:24-36`): `role`, `plan-mode`, `tanzo`,
`skills-index`, `plugins-index`, `env`, `datetime`, `git-status`, `goal`, `plugins-mention`. Additional sections
can be appended via `deps.extraSections` (`index.ts:108`) — this is how the hooks context section is mounted
(see [14 Hooks](./14-hooks.md)).

- **`stability`** separates content that is stable across steps (cache-friendly) from content that changes
  every step (`datetime`, `git-status`, injected context).
- **`channel`** separates system messages from leading-user messages.
- **`order`** sorts sections within a stability band.
- **`prefixCacheScope`** marks a volatile leading-user section as `conversation`-scoped so it can be frozen into
  the cacheable prefix.

## 3. Assembly and compilation

`compileSections(registry, input, history)` (`context/compile.ts`) renders all sections in parallel, drops
empties, then splits them:

- **System messages** = stable-system ++ volatile-system, each its own `SystemModelMessage`.
- **Leading-user**: stable-leading is merged into one user message; volatile-leading is split by
  `prefixCacheScope === 'conversation'` into a `volatilePrefixUser` block versus a `trailingUser` block.
- `stableBoundary` = the count of stable-system messages, used as the cache anchor.
- Provenance is recorded per section/message and symbol-attached (`attachContextProvenance` /
  `getContextProvenance` in `section.ts`).

The per-turn prompt (`promptMessages`, `index.ts:65-71`) is:

```text
leadingUser ++ history ++ (stepNumber === 0 ? volatilePrefixUser ++ trailingUser : [])
```

So the volatile prefix/trailing user blocks are injected **only on step 0** of a turn.

## 4. Budgeting

Token accounting is **usage-anchored, not estimated** (`context/budget.ts`):

- `anchor(chatId, msgCount, inputTokens)` stores the last reported `inputTokens`.
- `measureUsage` returns `{ inputTokens, source: 'reported' | 'unavailable', exceeds() }` and ignores message
  content entirely — the number comes from real model usage, fed in by `observeStep` (`index.ts:198-206`) from
  the stream.
- `cacheHitRatio` = `cacheReadTokens / inputTokens`.

Model capabilities (`context/capabilities.ts`): `contextWindow`, `maxOutputTokens`, `supportsImages`, with
defaults 128k / 8192.

## 5. Compaction

### 5.1 Trigger

`context/compaction-policy.ts`: `compactionTriggerTokens = floor((contextWindow − maxOutputTokens) × 0.9)`, and
`retainedRecentSteps = 6`. `shouldCompact()` is "reported usage `exceeds(trigger)`" (`index.ts:227-230`).

At runtime the stop condition `overCompactionTrigger` halts the stream when the last step's
`usage.inputTokens > trigger` (`build-agent.ts:65-71`, wired in `stream-runner.ts`). After the turn,
`stream-runner.ts` computes `exceededCompactionTrigger` / `hitCompactionTrigger` and hands them to `onFinally`,
which `TurnLoop` uses to decide `compaction-retry` versus `post-compact` (see
[10 Agent Runtime](./10-agent-runtime.md)).

### 5.2 Coordinator

`runtime/compaction-coordinator.ts` performs the actual compaction: `prepareMessages` (pre-turn, if
`shouldCompact`), `compactAfterRun` (post-turn, gated by `exceededCompactionTrigger && !hitCompactionTrigger`),
and a manual `compact`.

### 5.3 Mechanics

`context/compact/`:

- `planCompaction` (`compact/compact.ts`) splits the transcript at a cut and canonicalizes the head into model
  messages; it aborts if the head is empty or all-summary.
- `findCut` (`compact/segments.ts`) walks step segments from the end, keeping `retainedRecentSteps`, and stops
  at a prior summary; `partitionAtCut` produces `{ head, tail, archivedIds }` and re-heads the tail with a
  `step-start`. Step boundaries come from `step-start` parts; a summary is detected via a `data-compaction`
  part.
- The summary is produced by a **fork** (below), then `buildCompactionResult` builds an assistant summary
  message (a `data-compaction` part carrying before/after/reduced tokens) so the next messages are
  `[summary, ...tail]`.

### 5.4 The compaction fork

`context/compact/fork-agent.ts`: `runCompactionFork` runs a single-step `streamText` with `toolChoice: 'none'`
and an **empty tool set** (it skips `buildTools` entirely), because the fork only needs to summarize. It uses a
dedicated compaction model when configured (`def.compactionModelRef ?? def.modelRef`) and streams the partial
summary to the UI with throttling. The prompt is `[...head, { role: 'user', content: prompt }]`.

## 6. Provider strategies (the cache frontier)

`context/providers/`: a `ProviderContextStrategy` is
`{ cacheKind, applyPromptLayout?, applyCaching }` (`providers/strategy.ts`), where `cacheKind` is
`'ephemeral' | 'auto' | 'unsupported'`. The strategy is selected by the model provider prefix
(`providers/index.ts:21-38`): anthropic / openai / openai-compatible / google / deepseek / passthrough.

In `index.ts` (`:146-160`), the engine applies `applyPromptLayout` first (with `freezeVolatilePrefix`, memoized
per chat) and then `applyCaching`. The frozen-prefix state is cleared on `clear()`.

- **Anthropic — ephemeral cache frontier** (`providers/anthropic.ts`): marks the last stable-system message
  with `cacheControl ttl: '1h'`, the last stable leading-user message with `1h`, and the last two history
  messages with `5m`. `cacheKind: 'ephemeral'`.
- **OpenAI / OpenAI-compatible** (`providers/openai.ts`): injects `promptCacheKey = tanzo:global:<modelRef>`
  plus `promptCacheRetention: '24h'`. `cacheKind: 'auto'`.
- **Google / DeepSeek / passthrough**: `cacheKind: 'unsupported'` (no explicit cache markers).

## 7. Tool-record normalization

`context/tool-transcript.ts` (invoked from `context/project.ts`, called at `index.ts:193`):

- `ensureToolPairing`: for each assistant tool-call block, keep only calls that have a matching `tool-result`
  (or, in the final block, an approval-response); drop orphan calls and orphan results; remove emptied
  messages. This prevents dangling `tool_use` / `tool_result` pairs after compaction or edits.
- `canonicalizeToolContent`: reorder parts inside `tool` messages to match the assistant call order (results
  before approval-responses).

The same canonicalization is applied to the compaction head, so a summarized transcript never re-introduces a
dangling tool pair.

Next → [12 Tools](./12-tools.md)
