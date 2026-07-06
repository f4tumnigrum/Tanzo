# 11 · Context Engineering

> Scope: the Section × Provider model, the append-only prefix invariant, the token ledger, in-stream
> compaction with the degradation chain, and tool-record normalization. Last verified against
> `src/main/agent/context/*` and `runtime/compaction-coordinator.ts` at v0.3.x (compaction v2).
> Design rationale: [`docs/design/context-compaction-v2.md`](../design/context-compaction-v2.md).

## 1. Mental model

Context engineering answers one question per step: *given the transcript so far, what exact prompt do we send
the model?* Four invariants drive the design:

- **I1 — Append-only prefix.** Between two compaction events, every step's prompt is a strict prefix
  extension of the previous step's prompt. Anything that would break this (per-turn volatile content,
  steering reordering, section drift) is either persisted into the transcript or confined to compaction
  event points. This is what makes provider KV caching (Anthropic explicit, OpenAI key-routed, DeepSeek
  disk prefix-units, Gemini implicit) effective.
- **I2 — Single conversion point.** UI→Model conversion happens once per run; the run works on
  `ModelMessage[]`.
- **I3 — Token ledger.** Budgeting reads provider-reported usage anchors persisted in message metadata;
  estimation is only used for unmeasured increments.
- **I4 — Inline compaction.** Automatic compaction happens inside `prepareStep`, in the same stream —
  never by stopping and restarting a run.

## 2. The Section model

`ContextSection` (`context/section.ts`) is `{ id, stability: 'stable' | 'volatile', channel, order, render() }`
with three channels:

- **`system`** — rendered into system messages. Stable within a run.
- **`leading-user`** — merged into one user message placed before history (the environment block).
- **`injection`** — rendered once at turn start and **persisted into the transcript** as a synthetic user
  message carrying a `data-contextInjection` part (`context/injection.ts`). This is how volatile per-turn
  content (datetime, git snapshot, goal nudges, plugin focus, hook context) reaches the model without
  breaking I1. The renderer hides these messages.

The registry (`context/registry.ts`) wires: `role`, `plan-mode`, `tanzo`, `skills-index`, `plugins-index`
(system/leading-user) and `datetime`, `git-status`, `goal`, `plugins-mention`, plus the hooks section via
`deps.extraSections` (all `injection`). The git snapshot renders only on the first turn — it is persisted,
so re-rendering it would only duplicate stale data.

## 3. Assembly

`compileSections` (`context/compile.ts`) renders the non-injection sections and produces
`{ system, stableBoundary, leadingUser, history }`. The engine (`context/index.ts`) exposes:

- `build(def, chatId, cwd, transcript, stepNumber)` — pure per-step prompt assembly:
  `leadingUser ++ history`, with provider caching applied. Same transcript ⇒ same prompt (I1).
- `renderInjection(def, chatId, cwd, { isFirstTurn })` — the persistable injection message; consumes
  one-shot state (goal injection, plugin mentions). Called by `TurnLoop.run` once per logical turn, and
  skipped when the transcript ends in an unexecuted tool call (approval resume).
- `measure` / `shouldCompact` / `snapshot` / `compactionPolicy` — ledger-based accounting (below).

Provenance is symbol-attached (`attachContextProvenance`) with shape `{ system, leadingUser, history,
messages }` and feeds the prompt-cache diagnostics (`diagnostics/prompt-cache.ts`).

## 4. The token ledger

`context/ledger.ts` replaces the old anchor+full-estimate budget. Measurement is restart-safe and pure:

- Every assistant message persists its per-step usage (`metadata.steps[].usage.inputTokens`) — the exact
  prompt size the provider reported.
- `measureTranscript` uses the **newest reported anchor after the latest compaction summary** (anchors
  before a summary are stale — the prefix changed), then adds increments for later messages: reported when
  available, estimated otherwise.
- Estimation is CJK-aware (`estimateTextTokens`: ~4 chars/token latin, ~1.5 CJK) and skips `data-*` parts
  and step markers.

## 5. Compaction (v2)

### 5.1 Policy

`context/compact/policy.ts`:

- `compactionTriggerTokens = floor((contextWindow − maxOutputTokens) × 0.8)`
- `retainBudgetTokens = min(30_000, contextWindow × 0.15)` — the tail kept after a cut, in tokens
- `hardCeilingTokens = contextWindow − maxOutputTokens` — the emergency red line

### 5.2 The cut

`context/compact/cut.ts` operates on two domains with the same shape:

- **UI domain** (`findCut` / `splitForCompaction`) for persisted transcripts. Persistence stores **one row
  per model step** (§7.1), so every message boundary is a valid cut point: preferred cuts are round
  boundaries (user message → next user message); a giant single round degrades to a step-fragment boundary
  between its rows. Cuts always cover whole rows — there is no mid-message split. The scan never crosses
  the latest summary, but the summary itself may be archived (rolling summarization).
- **Model domain** (`splitModelTranscript`) for live in-stream transcripts: assistant + trailing tool
  messages form closed step groups, so a cut can never orphan a tool call/result pair.

### 5.3 In-stream compaction (I4)

In `stream-runner.ts` `prepareStep`: when the last step's reported `inputTokens` exceeds the trigger,
`compactModelTranscript` (`context/compact/inline.ts`) cuts the live transcript, summarizes the head, and
returns `[summary, ...tail]` — which prepareStep returns as `messages`, and the AI SDK **carries forward to
later steps**. The stream never stops; the UI sees `data-compaction` transient parts. The final state
carries an `inlineCompaction` record; after the run, `CompactionCoordinator.reconcileInline` re-cuts the
*persisted* transcript and archives the head under the already-produced summary (no second fork).

### 5.4 Pre-turn compaction

`CompactionCoordinator.prepareMessages` (turn loop and sub-agent driver): when the persisted transcript
measures over the trigger before a run starts, run the full fork-based compaction first. Manual `/compact`
uses the same path. Persistence still goes through `finalizeCompaction` (overlay + `expectedActiveIds`
optimistic concurrency check in `repositories/message-repo.ts`).

### 5.5 The summarize fork

`context/compact/summarize.ts` (`runSummarizeFork`) has two paths:

- **Path A — prefix reuse** (default; no dedicated compaction model, caller passes the main run's tools):
  the request keeps the *exact* system sections, tools serialization, and leading-user block of the main
  conversation and appends only the summarization instruction as the last user message. The stable cache
  breakpoints (system / leading-user / summary) match the main run's, so the head — the most expensive
  prompt of the whole run — hits the provider KV cache (only the tail past the last stable breakpoint
  re-tokenizes). Tools are passed with `execute` stripped (wire format unchanged); on Anthropic,
  `toolChoice` stays `auto` because tool_choice is serialized into the cached prefix.
- **Path B — standalone summarizer** (dedicated `compactionModelRef`, or head exceeds the fork model's
  window): plain summarizer system prompt over a text-serialized transcript, chunked map-reduce (rolling
  summary) when the head does not fit in one call (chunk = fork window × 0.6 × 0.8).

### 5.6 Degradation chain

Compaction can never strand a conversation:

```
L1/L2  summarize fork (path A / path B chunked)
L3     fork failed → mechanical: pruneMessages(toolCalls before-last-8) + prune reasoning
       (inline: context/compact/degrade.ts; persisted: coordinator's mechanicalSummary)
L4     still over hardCeiling → drop oldest rounds, keep leading summary + recent rounds
```

L3/L4 only ever run at a compaction event point (the cache prefix is already invalidated there). The
summary message records `degraded: 'prune' | 'drop-oldest'` in its `data-compaction` part.

### 5.7 Turn loop shape

`turn-loop.machine.ts` has exactly two outcomes: `plan-exit-retry | finalize`. The v1
`compaction-retry` / `post-compact` paths, the `overCompactionTrigger` stop condition, and the
`exceededCompactionTrigger` / `hitCompactionTrigger` final-state fields are gone.

## 6. Provider strategies (the cache frontier)

`context/providers/`: `ProviderContextStrategy = { cacheKind, applyCaching({ plan, summaryIndex }) }`.

- **Anthropic** (`anthropic.ts`) — four `cacheControl` breakpoints (provider maximum): last stable-system
  message (1h), last leading-user message (1h), **the latest compaction summary (1h)** — the root of the
  current prefix family — and the last history message (5m, the moving frontier).
- **OpenAI / OpenAI-compatible** (`openai.ts`) — `promptCacheKey = tanzo:chat:<chatId>` (per-conversation,
  not global) + `promptCacheRetention: '24h'`. Fork requests carry the same key on path A.
- **DeepSeek** (`deepseek.ts`) — no-op strategy: DeepSeek's on-disk caching is fully automatic with **no
  request-side control surface** (no markers, no cache key). It matches whole *cache prefix units* (carved at
  user-input / model-output ends and fixed token intervals under Sliding Window Attention), so a hit needs a
  request to *fully match* a persisted unit — I1's byte-stable prefix is what earns those matches. It is
  best-effort (no 100% guarantee), skips inputs < 64 tokens, and evicts units after hours-to-days, so its
  `cacheReadTokens` is inherently choppier than Anthropic's — do not assume a steady per-step hit ratio.
  Metrics still surface: the SDK maps `prompt_cache_hit_tokens` to `cacheReadTokens` and derives
  `noCacheTokens = promptTokens − cacheHit`.
- **Google** — automatic implicit caching; no explicit markers. For both, the v1 prefix-freeze machinery is
  deleted — I1 makes it unnecessary.

Tool serialization order is pinned via `toolOrder` (sorted) in `build-agent.ts`, since the Anthropic cache
prefix includes the tools block.

## 7. Message-row representation (one row per reply)

Storage keeps the **live-domain shape**: one assistant row per model pass, parts delimited by
`step-start`, per-step usage in `metadata.steps[]`. This is intentional — the AI SDK streams a whole
reply under a single message id, and giving that reply a second persisted identity proved to be a
systematic bug source (duplicate rendering wherever live and persisted views met by id).

When a UI-domain compaction cut must land inside a multi-step reply, `cut.ts` splits the message
**in memory at that moment** (`partitionAtCut`): the head fragment keeps the original id and is
archived; the tail fragment gets a fresh id and stays in the tail. The split complexity lives in one
function, at one instant — not in the storage schema.

Mid-run steering persists near the position the model saw it (D6-2): `recordConsumedSteering` carries
the prepareStep `stepNumber`; with aggregated rows this resolves to before the reply (pre-run steers)
or after it (mid-run steers), using `metadata.steps[0].stepNumber` when present.

History: migration 22 briefly split storage into one row per step (`{baseId}::step-k` ids); migration
23 (`database/merge-step-rows-migration.ts`) merges those fragment runs back into aggregated rows,
remaps compaction-overlay coverage outward to whole rows, and drops fragment revisions.
`@shared/message-steps` remains only to serve these two migrations.

## 8. Tool-record normalization

`context/tool-transcript.ts` (`canonicalizeToolTranscript`) is unchanged: drop orphan calls/results, order
results before approval-responses by call order. With model-domain cuts producing closed step groups it now
acts as a safety net rather than a per-step repair pass.

Next → [12 Tools](./12-tools.md)
