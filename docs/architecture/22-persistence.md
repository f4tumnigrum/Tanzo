# 22 · 持久化

> 适用范围：SQLite 连接、迁移框架、表与归属、消息存储形态、恢复与隔离。最后核对：`src/main/database/*`、`src/main/agent/store.ts`、`agent/repositories/*`。

## 1. 连接（`database/connection.ts`）

`openDatabase({databasePath})` 打开 `better-sqlite3`，应用 PRAGMA：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`、`temp_store=MEMORY`。返回 `{ db: SqlDatabase, raw }`，其中 `SqlDatabase`（`types.ts:7`）是薄封装接口（`exec/prepare/get/all/run/transaction/pragma/close`）——每个 store 都依赖这个接口，与 better-sqlite3 解耦。打开失败 → `DATABASE_OPEN_FAILED`。

## 2. 模块（`database/module.ts`）

`createDatabaseModule({userDataPath, databaseFileName?, migrations})` 拼路径（默认 `tanzo.sqlite`），打开 DB，运行迁移，返回 `{ db, backupTo, close }`。`backupTo` 用 `raw.backup()`；`close()` 先 `wal_checkpoint(TRUNCATE)` 再关。

## 3. 迁移框架（`database/migrations.ts`）

- 注册表 `_tanzo_migrations(module, version, name, applied_at)`，PK `(module, version)`。
- `runMigrations(db, modules: ModuleMigrations[])`：每模块断言版本严格递增，跳过已应用版本，**在事务内**应用每个 `Migration.up(db)` 连同注册插入。失败 → `DATABASE_MIGRATION_FAILED`（带模块/版本）。

```ts
type Migration = { version: number; name: string; up(db): void }
type ModuleMigrations = { moduleName: string; files: readonly Migration[] }
```

当前唯一注册模块 `tanzoMigrations`，**1 个版本**（`tanzoMigrations`/`INITIAL_SCHEMA` 定义在 `database/schema.ts:381`/`:3`）。v1（`INITIAL_SCHEMA`）一次建出全部表/索引/触发器。框架仍支持多版本增量迁移，后续 schema 变更追加新版本即可。

## 4. 表与归属

| 表                                                   | 归属                       | 备注                                                                                   |
| ---------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `workspaces`                                         | chat/workspace 层          | UNIQUE `root_path`                                                                     |
| `app_settings`                                       | preferences/settings/hooks | scope app/workspace；hooks 的 enabled/trusted/contentHash 也存在这里                   |
| `provider_connections`                               | provider store             | PK `provider_id`（5 id CHECK）                                                         |
| `provider_keys`                                      | provider store             | UNIQUE `(provider_id,key_id)`；删除触发器清活跃 key                                    |
| `provider_models`                                    | provider store             | PK `(provider_id,family,model_id)`                                                     |
| `provider_default_models` / `provider_defaults`      | provider store             | 每 family 一条默认/defaults_json                                                       |
| `mcp_servers`                                        | mcp store                  | UNIQUE `name`                                                                          |
| `policy_rules` / `policy_decisions` / `policy_modes` | policy                     | 规则按 priority 索引；模式每对话                                                       |
| `conversations`                                      | chat                       | 自引 parent，`parent_relation` fork/subagent，`model_ref`/`subagent_model_ref`         |
| `messages` / `message_revisions`                     | chat                       | PK `(conversation_id,id)`；`seq` 是会话内历史顺序；revisions 记录消息 payload 变更快照 |
| `compaction_overlays`                                | chat                       | 压缩摘要与覆盖的 `seq` 区间，独立于消息日志                                            |
| `subagent_tasks`                                     | agent runtime (subagent)   | PK `(root_chat_id,id)`；UNIQUE `chat_id` 与 `(root_chat_id,seq)`；status pending/running/blocked/done/failed/cancelled |
| `quarantined_messages`                               | chat                       | 畸形消息隔离                                                                           |
| `queued_messages`                                    | chat                       | 持久化消息队列                                                                         |
| `runs` / `run_steps` / `prompt_diagnostics`          | agent runtime / telemetry  | token 用量、finish 原因、prompt 缓存诊断                                               |
| `tool_executions`                                    | activity/telemetry         | 喂 `activity:*` 查询                                                                   |
| `conversation_goals`                                 | goal                       | 正交状态(user_state + outcome + limit)                                                 |
| `skill_states`                                       | skills                     | enabled/installed/scope                                                                |


## 5. AgentStore（`agent/store.ts` + `repositories/*`）

`AgentStore`（`store-types.ts`）由七个 repository 组成，各自基于 `SqlDatabase`（同步预编译语句 + `db.transaction`）：

- **conversation-repo**：会话 CRUD；`depthOf`/`rootOf` 沿 parent 链走（上限 64）。
- **message-repo**：消息 payload 存为版本化 `{ v: 1, message }` JSON。`messages` 是按 `seq` 排序的历史锚点；`message_revisions` 追加 payload 修订并作为读取最新内容的投影来源；压缩结果写入 `compaction_overlays`，摘要不落成真实消息行。
- **queued-message-repo**：持久化消息队列。
- **prompt-diagnostic-repo**：`runs`/`run_steps`/`prompt_diagnostics`，run 状态 `running`→`finished`/`failed`。
- **tool-execution-repo**：每工具调用成功/时长/错误，由 DB 遥测 sink 写。
- **subagent-task-repo**：子代理任务（`subagent_tasks`），按 `root_chat_id` 归属，状态机 pending/running/blocked/done/failed/cancelled，暴露为 `store.tasks`。
- **activity-repo**：聚合上述表供 Usage 面板。

`store.ts` 编排 repository，负责 cwd 规整（`realpathSync` 且须为目录）、agent-id 校验、标题派生、fork 逻辑、事务边界。

## 6. 消息存储形态与恢复

- **存储**：完整 `TanzoUIMessage` JSON，版本化。**不是**事件溯源，无自定义 reducer——ai-sdk 的归约在内存里完成；main 以 `messages(seq)` 保存顺序锚点，以 `message_revisions` 追加 payload 修订。
- **写时机**：经 `ChatRunPersistenceRegistry` 在 `onStepFinish`/`onFinish` 触发（[10 Agent 运行时](./10-agent-runtime.md) §5），受 `canPersist()` 守卫。
- **恢复**：`load` 返回上下文投影（最新 overlay 摘要 + tail），`loadFullHistory` 返回原始历史日志，`loadDisplay` 返回带合成摘要标记的 UI 时间线；校验失败的消息移入 `quarantined_messages` 而非静默丢弃。`loadUnvalidated` 在持久化合并快路径跳过校验。
- **压缩归档**：`finalizeCompaction` 只追加 overlay，消息日志保持完整；`expectedActiveIds` 仍作为上下文投影的乐观并发守卫。
- **崩溃恢复**：启动 `sweepInterruptedRuns` 把残留 `running` 标 `failed`；排队消息从 `queued_messages` 重新水合。

## 7. 持久化不变量

- [ ] WAL + `foreign_keys=ON`；迁移事务化、严格递增、幂等守卫。
- [ ] 消息存完整 `TanzoUIMessage` JSON（版本化），非事件溯源。
- [ ] 唯一真源在 main 的 SQLite；renderer 不落盘。
- [ ] 畸形消息隔离到 `quarantined_messages`，不丢失。
- [ ] 每个 store 依赖 `SqlDatabase` 接口，与 better-sqlite3 解耦。

下一篇 → [23 工作区集成](./23-workspace-integrations.md)
