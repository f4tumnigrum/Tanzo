# 22 · 持久化

> 适用范围：SQLite 连接与迁移框架、表与归属、消息如何存储、恢复与隔离。最后核对：`src/main/database/*` 与 `src/main/agent/repositories/*`（v0.2.4）。

## 1. 连接

驱动是 `better-sqlite3`。`openDatabase({ databasePath })`（`database/connection.ts:22-36`）打开 DB 并应用这些 pragma（`connection.ts:5-11`）：

```text
journal_mode = WAL
synchronous  = NORMAL
foreign_keys = ON
busy_timeout = 5000
temp_store   = MEMORY
```

`SqlDatabase` 包装（`connection.ts:39-71`）暴露 `prepare` / `run` / `get` / `all` / `transaction` / `pragma` / `close`，其中 `transaction = raw.transaction(fn)()`。模块 `createDatabaseModule`（`database/module.ts:24-62`）在 Electron `userData` 下打开 `tanzo.sqlite`，支持经 `raw.backup` 的 `backupTo`，并在 `close()` 时先 `wal_checkpoint(TRUNCATE)` 再关闭。

## 2. 迁移框架

`database/migrations.ts` 维护注册表 `_tanzo_migrations(module, version, name, applied_at)`。每个 `ModuleMigrations` 按模块、按版本追踪；每条迁移的 `up(db)` 在事务内运行并插入 applied 行，版本须严格递增。

只有一个模块 `tanzoMigrations`（moduleName `'tanzo'`，`database/schema.ts`），在 `src/main/index.ts`（`migrations: [tanzoMigrations]`）接线——唯一注册的模块。其文件自 v1 `initial_schema` 起（v2–v18 缺口反映扁平化历史：初始 schema 已含至 v18 的一切），经增量迁移至 v28 `subagent_task_notes`（为子代理 `report({note})` 通道新增 `subagent_tasks.notes_json` 列）。

## 3. 表与归属

初始 schema（`database/schema.ts`）定义这些表（行号为 `CREATE TABLE` 处）：

| 表 | 行 | 归属（写者） |
|---|---|---|
| `workspaces` | 4 | agent conversation repo |
| `app_settings`（scope app/workspace，JSON 值） | 14 | 共享；hooks 状态写者 `hooks/store.ts` |
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
| `plugin_states`（v19） | 386 | `plugins/*` |
| `plugin_marketplaces`（v20） | 405 | `plugins/*` |

agent 仓储在 `src/main/agent/store.ts` 聚合，并在 `src/main/agent/module.ts` 接线。

> 两个常见误解，纠正：消息**不是**每对话一个 JSON blob（见 §4）；hooks 信任/启用**不是**独立表——它在 `app_settings` 的 `hooks.state:` 下（见 [14 钩子系统](./14-hooks.md)）。

## 4. 消息存储（追加日志，非 blob）

`messages` 表（`schema.ts:183-194`）是 `(conversation_id, id, seq, role, message_json, metadata_json, created_at)`，主键 `(conversation_id, id)`，唯一 `(conversation_id, seq)`。**每条消息一行**；`message_json` 是版本化信封 `{ v: 1, message }`。保存时 `message-repo.ts` 对现存与入参做 diff，插入新行或记录 revision。

- **编辑**追加到 `message_revisions`（`schema.ts:196-206`）；加载投影经 LEFT JOIN 优先最新 revision。
- **压缩摘要**进 `compaction_overlays`（`schema.ts:208-222`），携 `generation`、`covers_from/to_seq`、`summary_text`、`usage_json`；`finalizeCompaction` 插入 overlay 并给尾部重编号。
- **`load()`** 返回最新 overlay 摘要加其覆盖之后的尾部；`loadFullHistory` / `loadDisplay` 提供未压缩视图。
- **恢复**：消息经 `safeValidateUIMessages` 校验；无效者被抢救或移入 `quarantined_messages`（`schema.ts:356`），使单条损坏消息不至于毁掉整条对话。

这是运行时持久化时机（run 前 / 每步 / 最终 / 审批半程保存）的底座，详见 [10 Agent 运行时](./10-agent-runtime.md)。

## 5. 运行、步与遥测

`runs` 与 `run_steps` 承载 token/用量计量：`run_steps.usage_json` / `input` / `output` / `total` / `cache_read` / `cache_write` 每步更新（`repositories/prompt-diagnostic-repo.ts`），`runs` 汇总在结束时以 SUM 上卷。中断的 run 在启动时被扫成 `failed`，旧 run 被剪枝。

`tool_executions` 表只由遥测 DB sink 写入，它以 chat 作用域持久化 `tool-finish` 事件。token/用量在 runs/run_steps，而非遥测 sink。Usage 面板读层（`repositories/activity-repo.ts`）在 runs/run_steps/tool_executions/conversations 上聚合 KPI、趋势、可靠性。详见 [23 工作区集成](./23-workspace-integrations.md) 与 [50 横切关注点](./50-cross-cutting.md)。

## 6. 不在 SQLite 里的

- **ChangeSet** 检查点是 git ref 加 `userData` 下的 `workspace-change-sets.json` 文件——见 [23 工作区集成](./23-workspace-integrations.md)。
- **斜杠命令**与**文件提及**直接读文件系统（markdown 文件与 ripgrep）。
- **技能**与**插件**从磁盘加载 bundle；只有其启用/状态行在 SQLite（`skill_states`、`plugin_states`）。

下一篇 → [23 工作区集成](./23-workspace-integrations.md)
