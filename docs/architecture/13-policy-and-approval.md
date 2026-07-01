# 13 · Policy & Approval

> Scope: the `toolApproval` decision function, the policy engine (rule priority, permission modes, built-in
> guardrails, approval memory), and how approval lives in the message history rather than a server state
> machine. Last verified against `src/main/agent/policy/*`, `src/shared/policy.ts`,
> `src/shared/approval-responses.ts`, and `src/main/agent/module.ts` at v0.2.4.

> Note: `src/main/agent/policy/engine.ts` contains a byte that trips text file-reads (some tools report it as
> binary). It is ordinary TypeScript; read it with a shell (`sed`/`grep`). Line numbers below are from the file
> on disk.

## 1. The `toolApproval` decision function

The AI SDK's `streamText` calls a `toolApproval` callback before executing any tool call. Its return type is
`ToolApprovalStatus` (from `ai`):

- `'approved'` — execute immediately.
- `'user-approval'` — pause and request user confirmation.
- `'not-applicable'` — no policy applies (treated as approved).
- `{ type: 'denied', reason? }` — a hard block with a reason.

`buildAgentCall` constructs the callback (`runtime/build-agent.ts:85-96`): it reads per-tool metadata
(`kind`, `fingerprintFields`) from `tool.metadata.tanzo` (`build-agent.ts:16-33`) and forwards a
`PolicyDecisionInput` to `input.decide(...)`. It is wired into the stream at `runtime/stream-runner.ts:282`.

### The hooks pre-gate

The `policy` object passed to `createAgentService` wraps the engine's `decide` with a `PreToolUse` hook check
(`module.ts:290-306`): it resolves the chat id from the runtime context, runs `hooks.runPreToolUse(...)`, and
returns `{ type: 'denied', reason }` if a hook blocks — otherwise it defers to `policyEngine.decide(input)`.
Decision order is therefore **hooks PreToolUse → policy engine**. See [14 Hooks](./14-hooks.md).

## 2. The policy engine

Types are in `src/shared/policy.ts` and `src/main/agent/policy/types.ts`.

- `PolicyRule` = `{ action: 'allow' | 'deny' | 'ask', source: 'builtin' | 'user', scope, priority, match }`,
  where `match` is `{ toolName?, toolNameGlob?, argMatch?: { path, equals?, regex? } }`.
- `PermissionMode` = `'default' | 'plan' | 'yolo' | 'dangerous'`.
- `PolicyUserDecision` = `{ toolName, inputFingerprint, decision, scope: 'session' | 'forever', decidedAt,
  expiresAt?, scopeTargetId? }`.

### 2.1 Rule ordering (`engine.ts:124-134`)

`mergeRules(builtin, user)` produces a single ordered list:

```text
builtin deny  →  user deny (by priority)  →  user allow (by priority)  →  builtin allow  →  user ask (by priority)
```

`matchRule` (`engine.ts:113-120`) matches on exact `toolName`, a `toolNameGlob` (compiled via `globToRegExp`,
`engine.ts:79-94`), and an `argMatch` that reads a JSON path from the tool input and compares by `equals` or
`regex`.

### 2.2 `decide()` flow (`engine.ts:183-231`)

For each tool call, in order:

1. **Deny rules first.** If any `deny` rule matches, return `{ type: 'denied', reason }` (`engine.ts:189-190`).
2. **`exitPlanMode` always asks.** Return `'user-approval'` (`engine.ts:192`).
3. **Plan-mode write block.** Resolve the active mode (`engine.ts:194-195`); in `plan` mode, any non-read-only
   tool returns `{ type: 'denied', reason: 'plan mode: writes are blocked' }` (`engine.ts:196-198`). This
   happens *before* remembered decisions, so plan mode cannot be bypassed by a prior approval.
4. **Remembered decision.** Compute the `fingerprint` (`engine.ts:200`) and look up a persisted decision (scoped
   to the workspace via `scopeTargetId`, or a legacy unscoped one) then the session cache; if found, return it
   (`engine.ts:201-214`).
5. **Allow rules.** If any `allow` rule matches, return `'approved'` (`engine.ts:216-218`).
6. **Yolo / dangerous.** Return `'approved'` (`engine.ts:220`).
7. **Ask rules.** If any `ask` rule matches, return `'user-approval'` (`engine.ts:222-223`).
8. **Default fallback.** Read-only tools return `'not-applicable'`; everything else returns `'user-approval'`
   (`engine.ts:225-226`).

Any thrown error is caught and downgraded to `'user-approval'` — the engine fails safe (`engine.ts:227-229`).

### 2.3 Built-in guardrails (`policy/builtin-rules.ts`)

All built-in rules have `priority: 0` and `source: 'builtin'`. Deny rules:

- `b.git` — deny any tool whose `path` matches `(^|/)\.git(?:/|$)`.
- `b.ssh` — deny credential file paths (`SENSITIVE_PATH_PATTERN`).
- `b.rmrf` — deny destructive `rm -rf` of `/ ~ * ..` in `{shell, shellStart}.command` / `shellWrite.input`.
- `b.cred-read` — deny reading `.ssh/`, `.aws/`, `.env`, key files via cat/less/base64/openssl/…
- `b.rm-no-preserve`, `b.forkbomb`, `b.dd-device`, `b.mkfs`, `b.dev-redirect` — other destructive patterns.

One allow rule: `b.read` (`priority: 100`, action `allow`) — `{ fileRead, glob, grep, skill, askQuestion }` are
always allowed. See [12 Tools](./12-tools.md).

### 2.4 Fingerprinting and memory

`fingerprint(toolName, input, fields?)` (`engine.ts:56-60`) is a stable, order-independent SHA-256 over the
tool name and a canonically-stringified projection of the input. When `fingerprintFields` are given
(`FINGERPRINT_FIELDS`: `shell → [command]`, `fileEdit`/`multiEdit`/`fileWrite → [path]`, `engine.ts:19-23`),
only those fields are hashed, so "approve this command" survives unrelated argument changes.

`remember(decision, chatId)` (`engine.ts:248-258`): a `'session'` decision goes into an in-memory
`sessionCache` keyed by workspace scope + fingerprint; a `'forever'` decision is persisted to SQLite via
`policyStore.saveDecision`, tagged with the workspace `scopeTargetId`. Decisions are thus **workspace-scoped**:
an approval in workspace A does not apply to workspace B (legacy unscoped rows apply globally). Expired
decisions are filtered out on read.

Permission modes are per-chat with a global fallback: `setMode(next, chatId?)` stores a chat override (persisted
via `policyStore.saveMode`) or sets the global mode (`engine.ts:236-247`); `modeFor(chatId)` prefers the chat
override (`engine.ts:166-169`).

### 2.5 Persistence

`policy/policy-store.ts` owns three tables: `policy_rules` (user rules), `policy_decisions` (remembered
decisions), and `policy_modes` (per-chat mode overrides). See [22 Persistence](./22-persistence.md).

## 3. Approval lives in the message

There is no server-side approval state machine. Approval state is entirely encoded in tool-call parts inside
assistant `UIMessage` objects, with a two-state lifecycle:

- `'approval-requested'` — emitted by the SDK when `toolApproval` returns `'user-approval'`; the part carries an
  `approval.id` (UUID) and the tool `input`.
- `'approval-responded'` — written back after the user responds, embedding `approval: { id, approved, reason? }`.

Key helpers (`src/shared/approval-responses.ts`):

- `hasPendingApprovalRequest(messages)` scans all assistant parts for `state === 'approval-requested'`.
- `applyApprovalResponses(messages, responses)` rewrites matching parts to `'approval-responded'` and returns a
  new message array plus the applied responses.

On the sub-agent path (`src/main/agent/subagent/approval-utils.ts`): `extractPendingApprovals` scopes to the
**current turn** (everything after the last user message) so a stale approval from an aborted turn cannot
re-surface; `applyApprovalResponse` is the single-approval variant; `hasUnresolvedApproval` checks only the last
assistant message.

The mechanism: when a run stops awaiting approval, the request part streams to the renderer and the run ends
(the `AbortController` is the only cross-call state `main` keeps). The user's response is written into the
history and `submit` fires again; `main` re-runs `streamText` with the **complete** history, and the SDK reads
`approval.approved` from the part and proceeds or cancels the call accordingly. This is invariant §3.4 from
[01 Introduction](./01-introduction.md).

Next → [14 Hooks](./14-hooks.md)
