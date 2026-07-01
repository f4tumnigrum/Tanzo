# 01 · Introduction & Positioning

> Scope: the global mental model and design principles. Last verified against `src/` at v0.2.4.

## 1. Product framing

Tanzo is a **single-package Electron desktop application** (not a monorepo split into packages), positioned as
an AI-native local workspace: you plan, code, and automate inside your own machine's workspace. It is built
around a **conversational agent** that can read and write workspace files, run shell commands, search code,
call MCP servers, and use provider-native tools — completing multi-step tasks under your supervision.

Key facts (from `package.json`):

- `name: tanzo`, `main: ./out/main/index.js`, author `f4tumnigrum`. (`Lumin Studio` appears only as the
  `appUserModelId` `com.luminstudio.tanzo` and as the packaging maintainer in `electron-builder.yml`.)
- The runtime core depends on `ai@7.x-beta` and the `@ai-sdk/*` family of beta provider packages; the UI uses
  React 19, `@tanstack/react-query`, `zustand`, and `react-router-dom@7`; persistence is `better-sqlite3`;
  code search is `@vscode/ripgrep`; MCP uses `@ai-sdk/mcp`.

## 2. Design goals

1. **Reuse the AI SDK v7 agent substrate deeply** instead of reinventing the message protocol, the turn loop,
   or the reducers.
2. **Clear three-process responsibilities**: `main` owns all truth and side effects, `renderer` only renders
   and interacts, `preload` is a controlled bridge and nothing more.
3. **Capability grows by "adding a part"**: a new agent capability = one tool (`main`) + one data/tool part
   type (`shared`) + one renderer component, with zero changes to the core loop.
4. **Secure by default**: sandboxed windows, path sandboxing, credentials that never leave the process,
   destructive-command interception, and controllable tool approval.
5. **Observable**: every run, step, and tool call is written to telemetry so the Usage panel can replay it.

## 3. Architectural principles and invariants

These invariants run through the whole document set. They are the yardstick for judging whether a change
breaks the architecture.

### 3.1 One substance

Everything that flows through a conversation is a `part` of a single `TanzoUIMessage`: text, reasoning, tool
calls, file diffs, plans, sub-agent progress, telemetry — each is one type of part. The type is defined at
`src/shared/agent-message.ts`:

```ts
export type TanzoUIMessage = UIMessage<TanzoMetadata, TanzoDataParts, TanzoTools>
```

`TanzoTools` (the tool vocabulary) and `TanzoDataParts` (the data-part vocabulary) are two open unions shared
across all three processes. See [04 IPC & Contracts](./04-ipc-and-contracts.md).

### 3.2 One seam

Conversation data between `renderer` and `main` flows only through the IPC `chat:*` channels; the payload's
core is `InferUIMessageChunk<TanzoUIMessage>` (a streaming chunk). Settings-style control planes
(`provider:*`, `policy:*`, `mcp:*`, …) are independent CRUD surfaces and do not travel over the conversation
seam. **No local port is opened; there is no localhost SSE.** See
[04 IPC & Contracts](./04-ipc-and-contracts.md).

### 3.3 The inner loop is the AI SDK's `streamText`

`main` does **not** hand-write the turn loop. Each turn uses the AI SDK's `streamText` (parameters assembled
by `buildAgentCall` at `src/main/agent/runtime/build-agent.ts:73`; call site
`src/main/agent/runtime/stream-runner.ts:278`), driving the "call the model → run tools → feed results back →
call again" multi-step loop via `stopWhen` + `prepareStep`. `TurnLoop` wraps only a thin **compaction /
continuation** outer loop around it (cap `MAX_CONTINUATION_PASSES = 10` at
`src/main/agent/runtime/turn-loop.machine.ts:21`). See [10 Agent Runtime](./10-agent-runtime.md).

### 3.4 Approval lives in the message

Tool approval is not a pending state machine held in `main`. When the `toolApproval` decision function returns
`user-approval`, the turn stops naturally; the user's response is written into the message history, and the
next `stream` re-runs with the full history including that response. The SDK sees the now-approved call and
executes it directly. The only cross-call state `main` holds for correctness is the cancellation
`AbortController`. See [13 Policy & Approval](./13-policy-and-approval.md).

### 3.5 `main` is the single source of truth

Messages are persisted only in `main`'s SQLite (an append-log in the `messages` table, plus revisions and
compaction overlays — see [22 Persistence](./22-persistence.md)). The `renderer` never writes to disk — it
reconstructs the current conversation in memory via `ChatSession`, and after a run finishes it re-fetches from
`main` to re-align. See [22 Persistence](./22-persistence.md) and [30 Renderer](./30-renderer.md).

### 3.6 Serial per conversation, concurrent across conversations

All mutations for a given `chatId` execute serially through the `ChatMailbox`; different conversations run
concurrently. At any instant a conversation has at most one active run (enforced by `RunEngine`'s `inflight`
map + per-chat epoch). See [10 Agent Runtime](./10-agent-runtime.md).

### 3.7 Defense-in-depth path and command safety

Every filesystem surface exposed outward — files, search, shell, wallpaper, pet assets — independently applies
a **workspace sandbox + symlink `realpath` check + credential-path denial**; destructive shell commands are
intercepted by the policy engine's built-in rules. Shared constants live at
`src/main/agent/security/path-safety.ts`. See [13 Policy & Approval](./13-policy-and-approval.md) and
[50 Cross-Cutting](./50-cross-cutting.md).

## 4. Invariant self-check

After a change, you should be able to answer:

- [ ] "Where is capability X implemented?" → the answer lands in "one tool + one part type + one renderer
      component" or an existing AI SDK extension slot.
- [ ] Conversation data travels only over `chat:*`, with a `UIMessageChunk` payload; control planes travel over
      their own channels.
- [ ] `main` has no hand-written turn loop; the AI SDK's `streamText` is the inner execution core.
- [ ] `main` holds no approval state machine; approval lives in the message.
- [ ] The `renderer` persists no messages; the only source of truth is `main`'s SQLite.
- [ ] Each conversation is serial (mailbox), with a single active run (epoch + inflight).
- [ ] Credentials never cross IPC in plaintext; destructive commands are intercepted by built-in policy.

## 5. Glossary

| Term | Meaning |
|---|---|
| **Substance** | `TanzoUIMessage`, the one message type flowing through a conversation |
| **Part** | One item in a message's `parts[]`: text / reasoning / tool-* / data-* / file / source |
| **Chunk** | The streaming increment unit `UIMessageChunk`, transported over IPC and reduced back into messages by the AI SDK on each side |
| **Seam** | The renderer ↔ main conversation seam, i.e. the IPC `chat:*` channels |
| **streamText** | The AI SDK's multi-step tool-loop execution core; parameters assembled by `buildAgentCall`, advanced by `stopWhen` + `prepareStep` |
| **Run** | One conversation turn driven by a single `streamText` invocation (may contain multiple steps) |
| **Section** | A declarative unit that assembles system / leading prompts in context engineering |
| **Mailbox** | The per-`chatId` serial task executor |
| **Subagent** | A nested child conversation launched from inside a tool; foreground / background / parallel |
| **Skill** | A progressively-disclosed capability pack described by `SKILL.md` |
| **Module factory** | The `createXxxModule(deps) → { service?, registerIpc, close? }` convention |

Next → [02 System Overview](./02-system-overview.md)
