# 10 · Agent Runtime

> Scope: the agent module factory, the end-to-end execution of a run, concurrency and state, persistence
> timing, compaction/continuation, and subsystem collaboration. Last verified against
> `src/main/agent/module.ts`, `service.ts`, `runtime/*` at v0.2.4.

## 1. Mental model

The agent runtime is three layers:

- **Entry layer = `AgentService` + `ChatMailbox`.** `service.ts` exposes public capabilities (`run`,
  `submitMessage`, `respondApprovals`, `compact`, `enqueue`, task methods, …) and uses `ChatMailbox` to keep
  each `chatId` serial.
- **Lifecycle layer = `RunEngine` + `TurnLoop`.** `RunEngine` manages run epochs, cancellation,
  preparing/inflight state, and stream start/finish. `TurnLoop` manages change capture, compaction,
  continuation, plan-mode remediation, and finalization.
- **Inner loop = the AI SDK's `streamText`.** `streamText<ToolSet>(…)`
  (`runtime/stream-runner.ts:278`; parameters assembled by `buildAgentCall`, `runtime/build-agent.ts:73`)
  automatically runs "call model → run tools → feed back → call again" via `stopWhen` + `prepareStep`. Tanzo
  does not hand-write the model/tool loop. `buildAgentCall` returns an `AgentCall` **config object**, not an
  Agent instance.

Approval state lives in the message, not in `main`'s closure state
([13 Policy & Approval](./13-policy-and-approval.md)). The cross-call state `main` holds for correctness is
`RunEngine`'s `AbortController`, the epoch, the preparing/inflight maps, and the active-run set.

## 2. Module factory `createAgentModule`

```ts
interface AgentModuleOptions {
  db: SqlDatabase
  providerService: ProviderService
  mcpService: McpService
  workspaceRoot: string
  getWindows: () => BrowserWindow[]
  getChatWindows?: () => BrowserWindow[]
  disabledTools?: () => readonly string[]   // read fresh on each build
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

(`module.ts:66-75`, return type `module.ts:57-64`.)

Construction order reflects the dependency direction (`module.ts:173-442`): policy store → shell runner + shell
sessions → chat event deliverer → chat run-session registry (streams) → chunk sink → presence → plugins store /
installer / manager → skills store → agent identity → agent store (repositories) → policy engine → hooks store →
hook service → the `policy` wrapper (hooks pre-gate) → goal store/service → git/change-set services → question
broker → browser open-request bridge → context engine → `buildTools` factory → `createAgentService`.

Key wiring:

- **Hooks** are created in `module.ts`; `PreToolUse` becomes an extra pre-approval gate by wrapping
  `policy.decide` (`module.ts:290-306`). See [14 Hooks](./14-hooks.md).
- **`contextEngine`** mounts a hooks context section via `extraSections`.
- **`buildTools`** creates a fresh `WorkspaceFs` / search backend per turn keyed on the current conversation
  cwd, and maps `mode === 'dangerous'` to the sandbox policy (`module.ts:377-422`). See [12 Tools](./12-tools.md).
- **`registerAgentIpc`** aggregates the chat/goal/policy/hooks/skills/plugins/activity/git/changeSet handlers.
- **`close()`**: unregister IPC → dispose presence → `git.unwatchAll()` → cancel running →
  `settleRuns(3000)` → close shell sessions (`module.ts:468-498`).

## 3. End-to-end of a run

```text
chat:submit → ipc/chat.ts (zod validate) → service.submitMessage
  → mailbox.enqueue(chatId, ...)
  → ChatInbox.submitMessage
      → hooks SessionStart / UserPromptSubmit (may block or append context)
      → conversation is a subagent? background-driven : service.run

service.run
  → mailbox.enqueue(chatId, () => runWithStopHook)
  → TurnLoop.run
      → engine.setPreparing
      → changeSet.captureBeforeRun (if cwd is a git repo)
      → for pass in 0.. (≤ MAX_CONTINUATION_PASSES = 10):
          resolveAgentDefinition
          store.save(incoming)                          (if non-empty and conversation exists)
          compaction.prepareMessages(force = previous pass hit a compaction trigger)
          startChatRun(...) with deferTerminal
            → streams.start + runPersistence.start
            → startAgentStream
              → buildTools(def, chatId, depth, mode)
              → buildAgentCall(...)
              → streamText({ ...agentCall, prepareStep → contextEngine.build(...) })
              → for await chunk: deps.send(chatId, chunk, { runId })
            → onFinally: turnFinalizer + markRunOutcome + persistence finish
          decideTurnOutcome(state, ctx) → finalize | compaction-retry | post-compact | plan-exit-retry
      → changeSet.captureAfterRun + write data-changePreview
      → streams.finish
  → Stop hook (fire-and-forget)
```

`deps.send` is the `ChunkSink` built in `module.ts`: presence observes data/text chunks first, then the chunk
enters `ChatRunSessionRegistry.publish`. Non-data chunks must belong to a tracked run; a `data-*` chunk may be
retained as a notification and pushed to windows even when untracked (`module.ts:121-137`).

**Streaming batching.** `run-session-registry.ts` merges delta chunks in a short window
(`DEFAULT_DELTA_BATCH_MS = 24`, `run-session-registry.ts:60`) and emits frames on `chat:event:<chatId>`; the
renderer replays via `runSnapshot` + a frame gate. See [30 Renderer](./30-renderer.md).

## 4. Concurrency and cross-call state

### 4.1 `ChatMailbox` — per-chatId serialization

`runtime/chat-mailbox.ts` keeps `tails: Map<string, Promise<unknown>>`, one promise chain per `chatId`.
`enqueue(chatId, task)` chains `.then(() => task(), () => task())` so the next task always runs even if the
previous one threw; the tracked promise resolves to `undefined` so errors never propagate down the chain, and
the map self-cleans when a chain drains. Effect: all operations on one `chatId` are strictly serial; different
conversations run independently.

### 4.2 `RunEngine` — epoch, cancellation, inflight

`runtime/run-engine.ts` holds:

- `inflight: Map<string, AbortController>` — the currently executing run per chat.
- `preparing: Map<string, AbortController>` — the pre-run preparation phase (context build, compaction check)
  per chat, so it can be aborted before a run even starts.
- `epochs: Map<string, number>` — a monotonically increasing integer per chat, bumped on every `beginRun` and
  `abort`.
- `cancelGenerations: Map<string, number>` — a separate counter bumped on explicit user cancels (goal
  continuation uses it to detect stale schedules).
- `activeRuns: Set<Promise<unknown>>` — all tracked run promises for `settle()`.

`beginRun` increments the epoch, aborts any existing inflight controller, and registers a new one. `abort`
increments the epoch and aborts both `preparing` and `inflight`. `isRunning` is true if either map has an entry.
`settle(timeoutMs)` polls `activeRuns` in 50 ms increments until empty or the deadline. `hasAdvancedSince(chatId,
epoch)` lets the sub-agent task service detect whether a new run started.

Single active run per conversation is thus enforced by the mailbox (serial enqueue) plus `inflight` + epoch.

## 5. `TurnLoop` — compaction, continuation, finalization

Constants (`runtime/turn-loop.machine.ts`): `MAX_CONTINUATION_PASSES = 10` (`:21`),
`MAX_PLAN_EXIT_PASSES = 2` (`:22`).

`decideTurnOutcome(state, ctx)` is a pure function (`turn-loop.machine.ts:45`) returning one of:

- **`plan-exit-retry`** — live, ended with text only, `exitPlanMode` not called, plan mode, and
  `planExitPasses < 2`: append a `PLAN_EXIT_NUDGE` user message, increment the counter, and force
  `exitPlanMode` once passes reach 2.
- **`compaction-retry`** — live, a compaction trigger was hit, and `pass < 10`: reload messages, set
  `forceCompactionOnPrepare = true`, and loop.
- **`post-compact`** — the trigger was exceeded but not hit this run, and the run is not aborted/failed/inflight:
  call `compaction.compactAfterRun`, then terminal dispatch, then break.
- **`finalize`** — everything else: terminal dispatch, then break.

**ChangeSet finalization** (`turn-loop.ts`): if the turn ended awaiting approval, the `changeSetRunId` is stored
in `pendingChangeCapture` to carry over to the resuming run. Otherwise `finalizeChangeSet` loads messages,
captures the after-tree, appends a diff preview as a `data-changePreview` part on the last assistant message,
saves, and sends the preview chunk. See [23 Workspace Integrations](./23-workspace-integrations.md).

**Terminal dispatch** (via `turnFinalizer.dispatch`): evaluates goal continuation (main agent only, only when a
goal exists and the run was not aborted/failed); if queued messages exist it shifts the next one and calls
`submitUserMessage`; else, if the goal wants continuation, it calls `startGoalContinuation`.

## 6. The inner loop: `streamText`, `buildAgentCall`, `prepareStep`

`buildAgentCall` (`runtime/build-agent.ts:73-104`) returns an `AgentCall` with:

- `model` — resolved from `providerService` for the agent definition's model ref.
- `tools` — the full `ToolSet` from `deps.buildTools`.
- `runtimeContext: { chatId, mode }`.
- `toolApproval` — wraps `policy.decide`, attaching each tool's `kind` / `fingerprintFields` metadata from
  `tool.metadata.tanzo` (`build-agent.ts:16-33,85-96`). See [13 Policy & Approval](./13-policy-and-approval.md).
- `stopWhen` — an array of stop conditions: optional step-count `isStepCount(def.maxSteps)`, the compaction
  trigger `overCompactionTrigger(triggerTokens)` (`build-agent.ts:65-71`), and a hook-stop flag
  `() => shouldStop()`.
- `callSettings` and `providerOptions` from the resolved model config; optional `toolChoice` (set to
  `{ type: 'tool', toolName: 'exitPlanMode' }` on a forced plan exit).

The `streamText` call (`stream-runner.ts:278-394`) passes these through, plus `messages`, `abortSignal`, a
`prepareStep` callback, and an `onStepEnd` handler.

`prepareStep → contextEngine.build` (`stream-runner.ts:290-337`):

1. Drain the `steerQueue` for the chat and inject consumed steering as `{ role: 'user' }` model messages.
2. Call `contextEngine.build(def, chatId, cwd, transcript, stepNumber, { consumeGoalInjection: true })`. If it
   returns `undefined`, skip step injection.
3. Call `skillActiveTools(messages, tools)` to restrict active tools to a skill's `allowedTools` patterns when a
   skill is active.
4. Return `{ instructions, messages, activeTools?, providerOptions? }`.

`onStepEnd` (`stream-runner.ts:339-393`) updates usage / finish reason / step counters, sets
`producedToolCall` / `exitPlanModeCalled` flags, runs `hooks.runPostToolUse(...)` per tool result (setting
`hookRequestedStop` if any hook returns `stopped`), and emits trace entries.

## 7. Persistence timing

- **Pre-run save** (`turn-loop.ts:317-319`): before each pass, if `messages.length > 0` and the conversation
  exists, `deps.store.save(chatId, messages)` persists the incoming messages (including any prepended nudge).
- **Per-step save** (`run-persistence-registry.ts`): `persistStepMessages`, called from `onStepEnd`, persists
  with `{ observeUsage: true, publishContext: true }`, guarded by `!signal.aborted && handle.isCurrent() &&
  hasConversation`.
- **Final save**: `persistFinalMessages`, called from `onEnd`, persists with `{ allowAfterFailure: true, isFinal:
  true }`.
- **Approval-partial save** (`chat-inbox.ts`): when approvals are applied but more remain pending,
  `deps.store.save(chatId, messages)` persists the partially-resolved messages without starting a run.
- **ChangeSet preview save** (`turn-loop.ts`): after a non-approval completion, the diff preview is attached to
  the last assistant message and saved.

Message storage is an append-log with revisions and compaction overlays — not one JSON blob per conversation.
See [22 Persistence](./22-persistence.md).

## 8. Key constants

| Constant | Value | Location |
|---|---|---|
| `MAX_CONTINUATION_PASSES` | 10 | `turn-loop.machine.ts:21` |
| `MAX_PLAN_EXIT_PASSES` | 2 | `turn-loop.machine.ts:22` |
| `DEFAULT_DELTA_BATCH_MS` | 24 ms | `run-session-registry.ts:60` |
| `close()` settle timeout | 3000 ms | `module.ts:493` |
| `settle()` poll interval | 50 ms | `run-engine.ts` |

Next → [11 Context Engineering](./11-context-engineering.md)
