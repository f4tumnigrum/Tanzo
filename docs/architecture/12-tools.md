# 12 · Tools

> Scope: the three-source tool merge, the built-in tool catalog, the fs/search/shell sandbox, skills, and
> sub-agents. Last verified against `src/main/agent/tools/*`, `fs/workspace-fs.ts`, `search/*`, `shell/*`,
> `security/path-safety.ts` at v0.2.4.

## 1. Three-source merge

`createBuildTools(deps)` returns an async `BuildTools` that assembles one `ToolSet` per turn
(`tools/registry.ts:88-130`). The merge order (later keys win, `registry.ts:101-113`) is:

1. `builtinTools(def, deps)` — the 8 built-ins.
2. `await mcpTools(def, deps)` — MCP tools, namespaced `mcp__<server>__<tool>` (`tools/mcp.ts`).
3. `providerTools(def)` — **currently a no-op stub** returning `{}` (`tools/provider.ts:4-7`). The "three
   sources" are therefore effectively builtin + MCP, plus the orchestration tools injected next.
4. Orchestration tools, added conditionally: `skill`, `todo` always; `askQuestion` only for the main agent;
   `shellBackgroundTools`; `subagentTools` only if `canDelegate`; the sub-agent `note` tool only if the agent
   is itself a sub-agent; `goalTools` (`updateGoal`) only for the main agent; `exitPlanMode` only in plan mode
   or after a prior `exitPlanMode` approval.

Post-merge filtering:

- **User-disabled tools** are dropped first, before the allowlist (`registry.ts:117-122`, via
  `deps.disabledTools()`). See [50 Cross-Cutting](./50-cross-cutting.md).
- **Agent `allowedTools`** allowlist: `null` = everything passes; otherwise glob/prefix match via
  `toolKeyMatchesPattern` (`registry.ts:123-129`).

## 2. Built-in tools and auto-approval

Read-only classification is driven by `metadata.tanzo.kind` on each tool
(`'read' | 'search' | 'edit' | 'exec'`). `build-agent.ts:16-33` extracts this for the policy engine. The 8
built-ins (`tools/builtin/index.ts:18-29`):

| Tool | kind | Read-only (auto-approved) |
|---|---|---|
| `fileRead` | `read` | yes |
| `fileEdit` | `edit` | no |
| `multiEdit` | `edit` | no |
| `fileWrite` | `edit` | no |
| `glob` | `search` | yes |
| `grep` | `search` | yes |
| `shell` | `exec` | no |
| `browserOpen` | `exec` | no |

Orchestration tools follow the same rule: `skill`, `askQuestion`, `await`, `tasks`, `note`, `shellPoll`,
`shellList` are `read` (auto-approvable); `shellStart` / `shellWrite` / `shellStop`, `spawn` / `steer` /
`cancel`, `todo`, and `updateGoal` are `exec` (require approval). `exitPlanMode` has no `kind` — it always
requires approval (see [13 Policy & Approval](./13-policy-and-approval.md)).

MCP tool kinds are derived from annotations (`tools/mcp.ts`): `readOnlyHint === true && destructiveHint !==
true` ⇒ `kind: 'read'`; otherwise `kind: 'edit'` (unknown annotations default to `edit`, i.e. require
approval).

The user-facing catalog (`src/shared/tool-catalog.ts`) mirrors these read-only flags for the settings toggles;
only these 8 tools are user-toggleable (orchestration/MCP/provider tools are intentionally excluded). See
[50 Cross-Cutting](./50-cross-cutting.md).

## 3. Path safety (sandbox, symlink realpath, credential blocking)

Two layers: constants/predicates in `security/path-safety.ts`, and enforcement in `fs/workspace-fs.ts` and
`search/backend.ts`.

### 3.1 Constants (`security/path-safety.ts`)

- `SENSITIVE_PATH_PATTERN` (`.ssh`, `.aws`, `.env` / `.envrc`), `GIT_PATH_PATTERN` (`.git`),
  `SENSITIVE_RIPGREP_EXCLUDES`.
- Predicates `isSensitivePath` / `isGitPath` and asserts `assertNonSensitivePath` / `assertNonGitPath` (which
  throw `TanzoValidationError`).

### 3.2 Workspace sandbox + symlink realpath (`fs/workspace-fs.ts`)

- `within(target, base)` = a relative path that does not start with `..` and is not absolute.
- Read paths: `resolveRead` asserts non-sensitive (lexically) and requires the path to be inside the root or a
  registered read-root, else `FS_PATH_ESCAPE`. Write paths: `resolveWrite`.
- **Symlink realpath check (read):** `assertRealWithinRead` calls `realpath(abs)` and re-checks containment
  against `realpath(root)` and the real read-roots, re-asserting non-sensitive on the resolved real path. Every
  reader applies it.
- **Symlink realpath check (write):** `assertRealWithinWrite`; parent directories are verified per-segment via
  `realpath`; writes are atomic (tmp + rename).
- **Dangerous mode** (`options.dangerous`) bypasses containment everywhere but **still blocks credential paths**
  on the resolved real path.
- Read-roots are extended by the skill tool: `deps.fs.registerReadRoot(resolved.skillDir)` (`tools/skill.ts`),
  so a skill can read its own bundle directory.

### 3.3 Search sandbox (`search/backend.ts`)

`assertSafeSearchPath` = non-git + non-sensitive; default excludes (`.git` + sensitive globs) are injected into
every ripgrep call. `resolveScope` enforces `within` on the resolved target and re-checks the `realpath` of
root + target for symlink escape.

### 3.4 Policy-level credential/git denials

Independently of the fs layer, the policy engine denies tool calls whose `path` argument matches `.git`
(`b.git`) or the sensitive pattern (`b.ssh`), and denies shell commands that read credential files. See
[13 Policy & Approval](./13-policy-and-approval.md).

## 4. Shell execution

### 4.1 Stripped environment (`src/main/safe-env.ts`)

`SENSITIVE_ENV_KEY_RE` matches API keys / secrets / tokens / passwords and provider names (OPENAI, ANTHROPIC,
GEMINI, AWS, GCP, AZURE, …). `safeChildEnv(overrides?, source = process.env)` copies the environment minus the
sensitive keys, and is applied to **every** shell spawn — foreground (`shell/runner.ts`) and background
(`shell/session-service.ts`).

### 4.2 Shell resolution (`shell/resolve.ts`)

Candidates: POSIX `$SHELL → bash → sh` with `-lc`; Windows `pwsh.exe → powershell.exe → cmd.exe`.

### 4.3 Foreground shell (`shell/runner.ts` + `tools/builtin/shell.ts`)

A streaming generator; `detached` on non-Windows (its own process group) with a process-tree kill (POSIX
`process.kill(-pid, 'SIGKILL')`, Windows `taskkill /t /f`). Kill reasons map to exit codes (timeout = 124,
abort/closed = 130) with a grace teardown. The `shell` tool defaults to a 120 000 ms timeout (clamped to
`[1s, 30min]`), caps output head+tail at 30 000 chars, strips ANSI, and resolves the workdir via
`deps.fs.resolveWorkspace` (sandboxed).

### 4.4 Background sessions (`shell/session-service.ts` + `tools/shell-background.ts`)

Per-chat sessions with `assertOwnSession` blocking cross-chat access; a max of 32 sessions with LRU pruning of
non-running ones; a head/tail text window (default 60 000 chars). The tool surface is `shellStart` / `shellPoll`
/ `shellWrite` / `shellStop` / `shellList`, with the workdir sandboxed the same way. This is how dev servers,
watch tasks, and log tailing keep running while the agent continues.

### 4.5 Destructive-command interception

Built-in policy deny rules apply to `{shell, shellStart}.command` and `shellWrite.input`: recursive/forced `rm`
of `/ ~ * ..` (`b.rmrf`), credential-file reads (`b.cred-read`), `rm --no-preserve-root`, fork bombs, `dd` to a
block device, `mkfs*`, and redirects to `/dev/disk…`. All are `action: 'deny'`, priority 0, source builtin. See
[13 Policy & Approval](./13-policy-and-approval.md).

## 5. Search backend (ripgrep)

The binary is resolved from `@vscode/ripgrep` with an `.asar` → `.asar.unpacked` fallback and an executable
check (`search/ripgrep.ts`). `createSearchBackend(root, { dangerous })` (`search/backend.ts`) spawns rg with a
30 s timeout and a 16 MiB stdout cap (SIGKILL on cap), always passing `--hidden` plus the default excludes
(`.git` + sensitive globs). Modes: `content` (`--json`, parsed, columns capped at 500), `files` (`-l`,
mtime-sorted), and `count` (`-c`). `glob` uses `--files --glob` with mtime-desc sorting. An invalid `type`
filter (validated against `rg --type-list`) surfaces as `GREP_INVALID_TYPE`. Result caps: grep and glob default
head 50, max 500.

## 6. Sub-agents

### 6.1 Tool surface (`tools/subagent.ts`)

`subagentTools(deps, parentChatId, agentTypes)` returns `{ spawn, await, tasks, steer, cancel }`:

- `spawn` validates each `spec.agent` against the available types, calls `deps.spawnTask(...)` per task, and
  **returns immediately** with readable ids (e.g. `explore-1`) plus an `await(...)` hint. Multiple specs in one
  call become **parallel/concurrent** background tasks. Static dependency errors (self-dependency, unknown dep
  id) are rejected before any writes, so a bad spawn leaves no orphaned executor conversation. If a later spec
  in a batch fails, the error names the already-started ids. `kind: 'exec'`.
- `await` blocks on `deps.awaitTask` with `settle: 'all' | 'first'` and an optional `timeoutMs` (tasks keep
  running past a timeout). It is **event-driven, not poll-driven**: the wait races task settlement against a
  **note wake** and the optional timeout. When an awaited task sends a note (`waitForNoteTask`), `await`
  returns early instead of forcing the parent to poll. `notedTasks` lists **exactly which awaited tasks
  produced a new note during this call** — computed from a per-task note-count baseline taken at the start of
  the wait, so it is precise in the multi-task case and survives the "one task settles while another notes in
  the same pass" race (a single boolean could not). On a note wake or timeout, `pending` is a structured
  snapshot per unfinished task — `{ task, status, phase, latestNote, updatedAt }` — where `phase` is derived
  automatically from the sub-agent's tool activity (not self-reported). Unknown ids are returned in the
  `unknown` field rather than silently dropped; results carry `failureKind`
  (`app-restart` | `logic-error` | `await-cancelled`) and any collected `notes`. Each `await` pass scopes its
  settle/note waiters to a local `AbortController` so abandoned waiters detach rather than accumulate across
  repeated awaits. `kind: 'read'`.
- `tasks` (read), `steer` (`instruction` appends via `instructTask`; `objective` restarts via `redefineTask` —
  the input schema is a union so exactly one is required), `cancel`.

Steering is rejected with an actionable error when the task is already settled (its result is final; spawn a
new task instead) or dependency-blocked (the gate may not be bypassed).

The sub-agent is a standard agent loop: its **deliverable is the final assistant message its run naturally
converges to**, taken verbatim by `completeTask` via `lastAssistantText` — there is no separate "submit" step
and no `explicit`/`inferred` confidence tiers. If that final text is empty, the task **fails**
(`failureKind: 'logic-error'`) rather than completing with an empty summary. The one thing a sub-agent reports
back is a **note**, via the `note` tool (`tools/subagent-control.ts`, `note → addTaskNote`; added only for
sub-agents): a mid-task signal — a surprise, a blocker, a fork in approach, a partial result — that is carried
into `pending.latestNote` and `result.notes` **and wakes any parent currently awaiting the task** (the
`wake-note` effect drains note waiters without settling). Notes are not the deliverable and do not end the run.
Live progress needs no self-reporting: `runStreamPass` wires the run's `onTrace` to `setPhaseByChat`, so each
tool the sub-agent runs becomes its current `phase`. Progress reaches the UI over `chat:task-event` (see
[04 IPC & Contracts](./04-ipc-and-contracts.md)).

Foreground vs background: spawning is always background/async; "foreground" is simply the parent calling `await`
to block on results. The actual scheduling is delegated to `AgentService` (`deps.spawnTask` / `awaitTask`), and
task ids are rooted at `deps.rootOf(parentChatId)`.

### 6.2 Depth and availability (`tools/registry.ts`)

`DEFAULT_MAX_SUBAGENT_DEPTH = 3` (`registry.ts:35`); the effective max is `def.maxSubagentDepth ?? 3`.
`canDelegate = depth < maxDepth && hasAvailableTypes`; if false, no sub-agent tools are added.

**Plan-mode restriction:** in `plan` mode only read-only sub-agents are available. A sub-agent is "safe
read-only" iff its `allowedTools` are all in `READ_ONLY_SUBAGENT_TOOLS` (`fileRead`, `glob`, `grep`, `skill`,
`await`, `tasks`, `note`, `shellPoll`, `shellList`, `web_search`). Unavailable types carry the reason "plan
mode allows read-only sub-agents only".

The four built-in agents (`tanzo`, `explore`, `verify`, `review`) are defined as markdown at
`src/main/agent/agents/builtin/`. See [10 Agent Runtime](./10-agent-runtime.md).

### 6.3 Concurrency model (`subagent/task-service.ts`)

Two semaphore layers bound how many sub-agent streams run at once: a **global** ceiling (100) across every
conversation and a **per-root** cap (20) so one conversation cannot starve the others. A driver acquires the
per-root slot first, then the global one; aborting mid-acquire rolls back any slot already held. Both limits
are injectable via `createTaskService(..., limits)` for tests. A freshly started task shows the phase
`queued: waiting for capacity` until its first stream pass begins.

### 6.4 Dependency scheduling and failure propagation

`spawn` with `dependsOn` creates the task as `pending` with `block: { kind: 'dependency', taskIds }`. Every
settle edge — a driver finishing, `cancel`, `cancelTree`, or a spawn fail-fast — reevaluates the graph
(`maybeUnblockDependents`): tasks whose deps are all `done` start automatically; tasks with a failed/cancelled/
missing dep fail fast with the root cause propagated in `errorMessage` **and** structurally in
`result.failedDependencyId`. Retrying a dependency (`retry`) cascade-resets dependents that failed *because of
it* (matched on `failedDependencyId`, with a legacy fallback that parses the quoted id from old error messages)
back to pending-blocked so they auto-restart when the dep completes.

Stopping a parent chat (`service.cancel`) deliberately does **not** cancel the task tree: spawned tasks keep
running in the background, their results persist, and the user stops individual tasks from the task panel.
Deleting the conversation still tears the whole tree down (`cancelTree`).

### 6.5 Restart recovery

In-memory drivers die with the process. On startup `reconcileOrphans()` marks every persisted
pending/running/blocked task as `failed` with `failureKind: 'app-restart'`, so awaiters resolve instead of
hanging and the UI can render the softer "interrupted" treatment with a retry affordance instead of a red
failure.

### 6.6 Approval bubbling

When a sub-agent's stream pauses on a tool approval, the task enters `blocked` with
`block: { kind: 'approval', approvals }` and the approvals are surfaced to the **root** conversation
(`data-taskApproval` part + `chat:task-event`), where the user responds via the approval card. The driver
registers its waiters **before** surfacing (a response can arrive the moment the block is broadcast; a waiter
registered after the response would hang forever), applies the response to the executor transcript, optionally
persists the decision via the policy engine (`session`/`forever` scope), and resumes the stream loop.

Next → [13 Policy & Approval](./13-policy-and-approval.md)
