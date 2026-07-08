# 22 · Persistence

> Scope: the SQLite connection and migration framework, the tables and their ownership, how messages are
> stored, and recovery/isolation. Last verified against `src/main/database/*` and `src/main/agent/repositories/*`
> at v0.2.4.

## 1. Connection

The driver is `better-sqlite3`. `openDatabase({ databasePath })` (`database/connection.ts:22-36`) opens the DB
and applies these pragmas (`connection.ts:5-11`):

```text
journal_mode = WAL
synchronous  = NORMAL
foreign_keys = ON
busy_timeout = 5000
temp_store   = MEMORY
```

The `SqlDatabase` wrapper (`connection.ts:39-71`) exposes `prepare` / `run` / `get` / `all` / `transaction` /
`pragma` / `close`, where `transaction = raw.transaction(fn)()`. The module `createDatabaseModule`
(`database/module.ts:24-62`) opens `tanzo.sqlite` under Electron's `userData`, supports `backupTo` via
`raw.backup`, and on `close()` runs `wal_checkpoint(TRUNCATE)` before closing.

## 2. Migration framework

`database/migrations.ts` maintains a registry table `_tanzo_migrations(module, version, name, applied_at)`. Each
`ModuleMigrations` is per-module and version-tracked; every migration's `up(db)` runs inside a transaction with
an applied-row insert, and versions must be strictly increasing.

There is a single module, `tanzoMigrations` (moduleName `'tanzo'`, `database/schema.ts`), wired in at
`src/main/index.ts` (`migrations: [tanzoMigrations]`) — the only module registered. Its files start at v1
`initial_schema` (the v2–v18 gap reflects a flattened history: the initial schema already contains everything
through v18) and continue through incremental migrations up to v28 `subagent_task_notes` (adds
`subagent_tasks.notes_json` for the sub-agent `report({note})` channel).

## 3. Tables and ownership

The initial schema (`database/schema.ts`) defines these tables (line numbers are the `CREATE TABLE` sites):

| Table | Line | Owner (writer) |
|---|---|---|
| `workspaces` | 4 | agent conversation repo |
| `app_settings` (scope app/workspace, JSON value) | 14 | shared; hooks state writer `hooks/store.ts` |
| `provider_connections` | 27 | `provider/store.ts` |
| `provider_keys` | 42 | `provider/store.ts` |
| `provider_models` | 74 | `provider/store.ts` |
| `provider_default_models` | 95 | `provider/store.ts` |
| `provider_defaults` | 105 | `provider/store.ts` |
| `mcp_servers` | 117 | `mcp/store.ts` |
| `policy_rules` | 135 | `policy/policy-store.ts` |
| `policy_decisions` | 148 | `policy/policy-store.ts` |
| `conversations` | 159 | `repositories/conversation-repo.ts` |
| `messages` | 183 | `repositories/message-repo.ts` |
| `message_revisions` | 196 | `repositories/message-repo.ts` |
| `compaction_overlays` | 208 | `repositories/message-repo.ts` |
| `subagent_tasks` | 224 | `repositories/subagent-task-repo.ts` |
| `runs` | 250 | `repositories/prompt-diagnostic-repo.ts` |
| `run_steps` | 269 | `repositories/prompt-diagnostic-repo.ts` |
| `prompt_diagnostics` | 287 | `repositories/prompt-diagnostic-repo.ts` |
| `conversation_goals` | 309 | `goal/store.ts` |
| `skill_states` | 329 | `skills/skill-state-db.ts` |
| `tool_executions` | 340 | `repositories/tool-execution-repo.ts` |
| `quarantined_messages` | 356 | `repositories/message-repo.ts` |
| `queued_messages` | 366 | `repositories/queued-message-repo.ts` |
| `policy_modes` | 374 | `policy/policy-store.ts` |
| `plugin_states` (v19) | 386 | `plugins/*` |
| `plugin_marketplaces` (v20) | 405 | `plugins/*` |

The agent repositories are aggregated in `src/main/agent/store.ts` and wired into the module at
`src/main/agent/module.ts`.

> Two common misconceptions, corrected: messages are **not** one JSON blob per conversation (see §4); hooks
> trust/enabled is **not** its own table — it lives in `app_settings` under `hooks.state:` (see
> [14 Hooks](./14-hooks.md)).

## 4. Message storage (an append-log, not a blob)

The `messages` table (`schema.ts:183-194`) is
`(conversation_id, id, seq, role, message_json, metadata_json, created_at)` with PK `(conversation_id, id)` and a
unique `(conversation_id, seq)`. There is **one row per message**; `message_json` is a versioned envelope
`{ v: 1, message }`. On save, `message-repo.ts` diffs existing versus incoming and inserts new rows or records
revisions.

- **Edits** append to `message_revisions` (`schema.ts:196-206`); the load projection prefers the latest revision
  via a LEFT JOIN.
- **Compaction summaries** go to `compaction_overlays` (`schema.ts:208-222`), carrying `generation`,
  `covers_from/to_seq`, `summary_text`, and `usage_json`; `finalizeCompaction` inserts an overlay and renumbers
  the tail.
- **`load()`** returns the latest overlay summary plus the tail after its coverage; `loadFullHistory` /
  `loadDisplay` provide the un-compacted views.
- **Recovery**: messages are validated with `safeValidateUIMessages`; invalid ones are salvaged or moved to
  `quarantined_messages` (`schema.ts:356`) so one corrupt message cannot break a whole conversation.

This is the substrate for the runtime's persistence timing (pre-run / per-step / final / approval-partial saves)
described in [10 Agent Runtime](./10-agent-runtime.md).

## 5. Runs, steps, and telemetry

`runs` and `run_steps` carry token/usage accounting: `run_steps.usage_json` / `input` / `output` / `total` /
`cache_read` / `cache_write` are updated per step (`repositories/prompt-diagnostic-repo.ts`), and `runs` totals
are rolled up via SUM on finish. Interrupted runs are swept to `failed` on startup, and old runs are pruned.

The `tool_executions` table is written only by the telemetry DB sink, which persists `tool-finish` events at
chat scope. Token/usage lives on runs/run_steps, not the telemetry sink. The read/reporting layer for the Usage
panel (`repositories/activity-repo.ts`) aggregates KPIs, trends, and reliability over
runs/run_steps/tool_executions/conversations. See [23 Workspace Integrations](./23-workspace-integrations.md)
and [50 Cross-Cutting](./50-cross-cutting.md).

## 6. What is not in SQLite

- **ChangeSet** checkpoints are git refs plus a `workspace-change-sets.json` file under `userData` — see
  [23 Workspace Integrations](./23-workspace-integrations.md).
- **Slash commands** and **file mentions** read the filesystem directly (markdown files and ripgrep).
- **Skills** and **plugins** load their bundles from disk; only their enabled/state rows live in SQLite
  (`skill_states`, `plugin_states`).

Next → [23 Workspace Integrations](./23-workspace-integrations.md)
