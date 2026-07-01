# 23 · Workspace Integrations

> Scope: Git, ChangeSet, slash commands, file mentions, Usage/Activity, and Pet — the integration boundaries
> between the agent and the surrounding workspace. Last verified against `src/main/agent/git/*`,
> `src/main/agent/*change-set*`, `src/main/slash-command/*`, `src/main/file-mention/*`,
> `src/main/agent/telemetry/*` at v0.2.4.

## 1. Git

The Git integration wraps `simple-git` with a per-cwd client pool (`agent/git/ops.ts`). Reads: status
(`git.status` + `diff --numstat[ --cached]`), an overview, diffs (commit / staged / worktree; untracked via
`diff --no-index` against an empty file), history, commit details (`--numstat` / `--name-status -z -M -C`),
branches, remote branches, remotes, and user. Diffs are capped at 400 000 bytes. Writes
(`agent/git/ops-write.ts`) cover stage/restore/discard/commit/fetch/pull/push/checkout/branch/remote/init,
surfaced through `agent/git/service.ts`.

The Git domain returns results wrapped in `GitResult<T>` rather than throwing (see
[04 IPC & Contracts](./04-ipc-and-contracts.md)).

**Watcher** (`agent/git/watcher.ts`, chokidar): watches the `.git` signal files (`HEAD`, `index`, `MERGE_HEAD`,
`ORIG_HEAD`, `FETCH_HEAD`, `packed-refs`, `COMMIT_EDITMSG`, …) plus `refs/`, resolving worktree `.git` files
(`gitdir:` indirection). Changes are debounced (250 ms) and broadcast; watches are ref-counted so multiple
conversations on the same repo share one watcher.

## 2. ChangeSet (run checkpoints)

ChangeSet gives every agent run a before/after snapshot so its file edits can be previewed and reverted, without
touching the user's working tree or index.

- **Storage**: a `workspace-change-sets.json` file under `userData` (atomic write, capped at 500, versioned) —
  **not** SQLite. See [22 Persistence](./22-persistence.md).
- **Capture** (`captureBeforeRun` / `captureAfterRun`): builds a tree via a scoped temporary index
  (`read-tree --empty`, `add -A`, `write-tree`), then `commit-tree`, then
  `update-ref refs/tanzo/runs/<runId>/{before|after}`. All git invocations use a scoped environment
  (`GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` / `GIT_INDEX_FILE`) and a Tanzo author/committer identity, so
  the user's real index is never modified.
- **Preview** (`ChangePreviewData`): computed by comparing the before/after/current blob maps, with per-file
  patches via `diff-tree -p … --binary`; apply/restore uses `checkout-index` to a target tree, guarded by
  path-safety.
- **Run wiring** (`agent/runtime/turn-loop.ts`): `captureBeforeRun` runs before the run; after the run the
  ChangeSet is finalized (or discarded), and the diff preview is attached to the last assistant message as a
  `data-changePreview` part. Capture is deferred across an approval pause so the before-tree spans the whole
  logical turn. See [10 Agent Runtime](./10-agent-runtime.md).

## 3. Slash commands

Slash commands are filesystem markdown, no SQLite. The store (`slash-command/store.ts`) scans
`~/.tanzo/commands`, `<userData>/commands`, and `<workspace>/.tanzo/commands` for `*.md` (later roots override
earlier ones). Each file has frontmatter (`description`, `argument-hint`) and a body template (`kind: 'prompt'`).
The service (`slash-command/service.ts`) merges file commands with enabled skills exposed as `kind: 'skill'`
(file names win on collision). The slash-command module depends on the agent's skills store (see
[03 Process Model](./03-process-model.md)).

## 4. File mentions (`@`)

`@`-mention search is ripgrep-backed, no SQLite (`file-mention/service.ts`): it runs
`rg --files --hidden --glob '!**/.git/**'` plus the sensitive-path excludes, caps the scan at 20 000 files and
8 MB of output, and returns up to 20 ranked results. Ranking is a fuzzy match (`file-mention/fuzzy.ts`) that
supports `dir/leaf` prefix navigation. This shares the credential-exclusion constants with the search backend
(see [12 Tools](./12-tools.md)).

## 5. Usage / Activity (telemetry)

Telemetry is a controller (`agent/telemetry/index.ts`) that wraps the AI SDK's telemetry integration
(`onStart` / `onStepStart` / `onLanguageModelCall*` / `onToolExecution*` / `onStep*` / `onEnd` / `onError`) and
emits normalized events to sinks (`agent/telemetry/sinks.ts`):

- **UI sink** — a transient `data-telemetry` chunk streamed to the renderer.
- **Logger sink**, **memory sink**.
- **DB sink** — persists only `tool-finish` events (chat scope) into `tool_executions`.

Token/usage accounting is separate: it lives on `runs` / `run_steps` (see [22 Persistence](./22-persistence.md)).
The Usage panel's read layer (`repositories/activity-repo.ts`) computes KPIs, trends, reliability, and per-run
detail over runs/run_steps/tool_executions/conversations. See [30 Renderer](./30-renderer.md).

## 6. Pet

The desktop Pet is an optional overlay window that mirrors agent presence and surfaces quick approvals. Its
window mechanics (click-through, hit-rect polling, lifecycle coupling to the main window) are covered in
[03 Process Model](./03-process-model.md); its presence data comes from the agent's `PresenceAggregator`
(`agent/presence/*`), and its assets are served by the `pet` module. The renderer side is the `pet` feature and
the `pet.html` entry (see [30 Renderer](./30-renderer.md)).

Next → [30 Renderer](./30-renderer.md)
