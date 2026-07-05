import type { ModuleMigrations } from './types'
import { mergeStepMessageRows } from './merge-step-rows-migration'
import { migratePerStepMessages } from './per-step-migration'

const INITIAL_SCHEMA = `
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE UNIQUE INDEX uq_workspaces__root_path ON workspaces (root_path);

CREATE TABLE app_settings (
  scope        TEXT NOT NULL CHECK (scope IN ('app', 'workspace')),
  scope_id     TEXT,
  key          TEXT NOT NULL,
  value_json   TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_id, key),
  FOREIGN KEY (scope_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_app_settings__app_key
  ON app_settings (key)
  WHERE scope = 'app' AND scope_id IS NULL;

CREATE TABLE provider_connections (
  provider_id                    TEXT PRIMARY KEY CHECK (
    provider_id IN ('openai', 'anthropic', 'google', 'deepseek', 'openai-compatible')
  ),
  public_fields_json             TEXT NOT NULL CHECK (json_valid(public_fields_json)),
  secret_fields_encrypted_json   TEXT NOT NULL CHECK (json_valid(secret_fields_encrypted_json)),
  active_key_id                  TEXT,
  connected_at                   INTEGER,
  updated_at                     INTEGER NOT NULL,
  last_validated_at              INTEGER,
  last_validation_succeeded      INTEGER CHECK (last_validation_succeeded IN (0, 1)),
  last_validation_message        TEXT,
  last_validation_latency        INTEGER
);

CREATE TABLE provider_keys (
  id                             TEXT PRIMARY KEY,
  provider_id                    TEXT NOT NULL CHECK (
    provider_id IN ('openai', 'anthropic', 'google', 'deepseek', 'openai-compatible')
  ),
  key_id                         TEXT NOT NULL,
  label                          TEXT NOT NULL,
  encrypted_value                TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'untested' CHECK (
    status IN ('untested', 'valid', 'invalid')
  ),
  created_at                     INTEGER NOT NULL,
  updated_at                     INTEGER NOT NULL,
  last_used_at                   INTEGER,
  last_validated_at              INTEGER,
  last_validation_succeeded      INTEGER CHECK (last_validation_succeeded IN (0, 1)),
  last_validation_message        TEXT,
  last_validation_latency        INTEGER,
  UNIQUE (provider_id, key_id)
);
CREATE INDEX idx_provider_keys__provider_updated ON provider_keys (provider_id, updated_at);
CREATE TRIGGER trg_provider_keys__clear_active_on_delete
AFTER DELETE ON provider_keys
FOR EACH ROW
BEGIN
  UPDATE provider_connections
  SET active_key_id = NULL,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE provider_id = OLD.provider_id
    AND active_key_id = OLD.key_id;
END;

CREATE TABLE provider_models (
  provider_id                    TEXT NOT NULL CHECK (
    provider_id IN ('openai', 'anthropic', 'google', 'deepseek', 'openai-compatible')
  ),
  family                         TEXT NOT NULL CHECK (
    family IN ('language', 'embedding', 'image', 'transcription', 'speech')
  ),
  model_id                       TEXT NOT NULL,
  name                           TEXT NOT NULL,
  enabled                        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_custom                      INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  source                         TEXT NOT NULL DEFAULT 'api' CHECK (
    source IN ('api', 'curated', 'custom')
  ),
  model_json                     TEXT NOT NULL CHECK (json_valid(model_json)),
  context_window_override        INTEGER,
  updated_at                     INTEGER NOT NULL,
  PRIMARY KEY (provider_id, family, model_id)
);
CREATE INDEX idx_provider_models__provider_family ON provider_models (provider_id, family);

CREATE TABLE provider_default_models (
  provider_id TEXT NOT NULL,
  family      TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (provider_id, family),
  FOREIGN KEY (provider_id, family, model_id)
    REFERENCES provider_models(provider_id, family, model_id) ON DELETE CASCADE
);

CREATE TABLE provider_defaults (
  provider_id  TEXT NOT NULL CHECK (
    provider_id IN ('openai', 'anthropic', 'google', 'deepseek', 'openai-compatible')
  ),
  family       TEXT NOT NULL CHECK (
    family IN ('language', 'embedding', 'image', 'transcription', 'speech')
  ),
  defaults_json TEXT NOT NULL CHECK (json_valid(defaults_json)),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (provider_id, family)
);

CREATE TABLE mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  transport   TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
  command     TEXT,
  args_json   TEXT CHECK (args_json IS NULL OR json_valid(args_json)),
  cwd         TEXT,
  url         TEXT,
  headers_json TEXT CHECK (headers_json IS NULL OR json_valid(headers_json)),
  redirect    TEXT CHECK (redirect IS NULL OR redirect IN ('follow', 'error')),
  env_json    TEXT CHECK (env_json IS NULL OR json_valid(env_json)),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_mcp_servers__name ON mcp_servers (name);

CREATE TABLE policy_rules (
  id              TEXT PRIMARY KEY,
  match_json      TEXT NOT NULL CHECK (json_valid(match_json)),
  action          TEXT NOT NULL CHECK (action IN ('allow', 'deny', 'ask')),
  reason          TEXT,
  scope           TEXT NOT NULL CHECK (scope IN ('system', 'project', 'user')),
  scope_target_id TEXT,
  priority        INTEGER NOT NULL DEFAULT 100,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_policy_rules__priority ON policy_rules (priority);

CREATE TABLE policy_decisions (
  tool_name       TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approved', 'denied')),
  scope_target_id TEXT NOT NULL DEFAULT '',
  decided_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  PRIMARY KEY (tool_name, fingerprint, scope_target_id)
);
CREATE INDEX idx_policy_decisions__active ON policy_decisions (expires_at);

CREATE TABLE conversations (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  parent_relation        TEXT CHECK (
    parent_relation IS NULL OR parent_relation IN ('fork', 'subagent')
  ),
  title                  TEXT NOT NULL DEFAULT '',
  agent_id               TEXT NOT NULL DEFAULT 'tanzo',
  model_ref              TEXT NOT NULL DEFAULT '',
  subagent_model_ref     TEXT NOT NULL DEFAULT '',
  reasoning_effort       TEXT NOT NULL DEFAULT '',
  cwd                    TEXT NOT NULL DEFAULT '',
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  archived_at            INTEGER
);
CREATE INDEX idx_conversations__updated ON conversations (updated_at DESC);
CREATE INDEX idx_conversations__workspace_updated
  ON conversations (workspace_id, updated_at DESC);
CREATE INDEX idx_conversations__parent_updated
  ON conversations (parent_conversation_id, updated_at DESC);
CREATE INDEX idx_conversations__parent_relation_updated
  ON conversations (parent_conversation_id, parent_relation, updated_at DESC);

CREATE TABLE messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL DEFAULT 'unknown',
  message_json    TEXT NOT NULL CHECK (json_valid(message_json)),
  metadata_json   TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, id)
);
CREATE INDEX idx_messages__seq ON messages (conversation_id, seq);
CREATE UNIQUE INDEX uq_messages__seq ON messages (conversation_id, seq);

CREATE TABLE message_revisions (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  message_json    TEXT NOT NULL CHECK (json_valid(message_json)),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id, revision),
  FOREIGN KEY (conversation_id, message_id) REFERENCES messages(conversation_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_message_revisions__message
  ON message_revisions (conversation_id, message_id, revision);

CREATE TABLE compaction_overlays (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  generation      INTEGER NOT NULL,
  covers_from_seq INTEGER NOT NULL,
  covers_to_seq   INTEGER NOT NULL,
  summary_text    TEXT NOT NULL,
  usage_json      TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, id)
);
CREATE UNIQUE INDEX uq_compaction_overlays__generation
  ON compaction_overlays (conversation_id, generation);
CREATE INDEX idx_compaction_overlays__coverage
  ON compaction_overlays (conversation_id, covers_from_seq, covers_to_seq);

CREATE TABLE subagent_tasks (
  id               TEXT NOT NULL,
  root_chat_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id          TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_chat_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_type       TEXT NOT NULL,
  objective        TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'blocked', 'done', 'failed', 'cancelled')
  ),
  depends_on_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(depends_on_json)),
  allowed_tools_json TEXT CHECK (allowed_tools_json IS NULL OR json_valid(allowed_tools_json)),
  block_json       TEXT CHECK (block_json IS NULL OR json_valid(block_json)),
  phase            TEXT,
  phases_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(phases_json)),
  result_json      TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  seq              INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  completed_at     INTEGER,
  PRIMARY KEY (root_chat_id, id)
);
CREATE UNIQUE INDEX uq_subagent_tasks__chat ON subagent_tasks (chat_id);
CREATE UNIQUE INDEX uq_subagent_tasks__root_seq ON subagent_tasks (root_chat_id, seq);
CREATE INDEX idx_subagent_tasks__root_seq ON subagent_tasks (root_chat_id, seq);

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_run_id TEXT NOT NULL,
  model_ref       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'finished', 'failed')
  ),
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  error_json      TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  UNIQUE (conversation_id, external_run_id)
);
CREATE INDEX idx_runs__conversation_started ON runs (conversation_id, started_at DESC);

CREATE TABLE run_steps (
  id                     TEXT PRIMARY KEY,
  run_id                 TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_number            INTEGER NOT NULL,
  created_at             INTEGER NOT NULL,
  usage_json             TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  finish_reason          TEXT,
  provider_metadata_json TEXT CHECK (
    provider_metadata_json IS NULL OR json_valid(provider_metadata_json)
  ),
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  total_tokens           INTEGER,
  cache_read_tokens      INTEGER,
  cache_write_tokens     INTEGER,
  UNIQUE (run_id, step_number)
);

CREATE TABLE prompt_diagnostics (
  id                         TEXT PRIMARY KEY,
  run_step_id                TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
  created_at                 INTEGER NOT NULL,
  prompt_cache_key           TEXT,
  prompt_cache_retention     TEXT,
  system_hash                TEXT NOT NULL,
  system_chars               INTEGER NOT NULL,
  messages_hash              TEXT NOT NULL,
  messages_chars             INTEGER NOT NULL,
  tools_hash                 TEXT NOT NULL,
  tools_json                 TEXT NOT NULL CHECK (json_valid(tools_json)),
  provider_options_hash      TEXT NOT NULL,
  provider_options_json      TEXT NOT NULL CHECK (json_valid(provider_options_json)),
  prompt_hash                TEXT NOT NULL,
  prompt_chars               INTEGER NOT NULL,
  segments_json              TEXT NOT NULL CHECK (json_valid(segments_json)),
  previous_id                TEXT,
  diff_json                  TEXT CHECK (diff_json IS NULL OR json_valid(diff_json))
);
CREATE INDEX idx_prompt_diagnostics__created ON prompt_diagnostics (created_at DESC);

CREATE TABLE conversation_goals (
  conversation_id      TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  objective            TEXT NOT NULL,
  user_state           TEXT NOT NULL CHECK (user_state IN ('active', 'paused')),
  outcome              TEXT CHECK (outcome IS NULL OR outcome IN ('complete', 'blocked')),
  goal_limit           TEXT CHECK (goal_limit IS NULL OR goal_limit IN ('budget', 'usage')),
  token_budget         INTEGER,
  tokens_used          INTEGER NOT NULL DEFAULT 0,
  time_budget_seconds  INTEGER,
  time_used_seconds    INTEGER NOT NULL DEFAULT 0,
  idle_streak          INTEGER NOT NULL DEFAULT 0,
  blocker_streak       INTEGER NOT NULL DEFAULT 0,
  blocker_last_run_id  TEXT,
  pending_injection    TEXT CHECK (
    pending_injection IS NULL OR
    pending_injection IN ('continuation', 'budget_limit', 'objective_updated')
  ),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE skill_states (
  name         TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed    INTEGER NOT NULL DEFAULT 0,
  scope        TEXT CHECK (scope IN ('user', 'workspace')),
  install_path TEXT,
  source_path  TEXT,
  installed_at INTEGER,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE tool_executions (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  tool_call_id    TEXT,
  success         INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
  duration_ms     INTEGER,
  error_kind      TEXT,
  error_message   TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_tool_executions__created ON tool_executions (created_at DESC);
CREATE INDEX idx_tool_executions__tool_created ON tool_executions (tool_name, created_at DESC);
CREATE INDEX idx_tool_executions__run ON tool_executions (run_id);

CREATE TABLE quarantined_messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  ord             INTEGER NOT NULL,
  message_json    TEXT NOT NULL,
  reason          TEXT NOT NULL,
  quarantined_at  INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, id)
);

CREATE TABLE queued_messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, position)
);

CREATE TABLE policy_modes (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('default', 'plan', 'yolo', 'dangerous')),
  updated_at      INTEGER NOT NULL
);
`

// Per-plugin enable/install state. Identity is the `<plugin>@<marketplace>`
// config key, mirroring Codex's PluginId. The plugin's cached artifacts and
// manifest live on disk under `<userData>/plugins/`; this table only overlays
// durable enable/install bookkeeping.
const PLUGIN_STATES_SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin_states (
  config_key       TEXT PRIMARY KEY,
  plugin_name      TEXT NOT NULL,
  marketplace_name TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  installed        INTEGER NOT NULL DEFAULT 0 CHECK (installed IN (0, 1)),
  version          TEXT,
  source_path      TEXT,
  installed_at     INTEGER,
  updated_at       INTEGER NOT NULL
);
`

// Registered marketplace sources. A marketplace is either a local directory
// (referenced in place, never copied) or a git repository cloned into a
// Tanzo-owned install root. Identity is the marketplace `name` read from the
// cloned/local `marketplace.json`. Mirrors Codex's `[marketplaces.<name>]`
// config blocks, but persisted in SQLite rather than config.toml.
const PLUGIN_MARKETPLACES_SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin_marketplaces (
  name          TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL CHECK (source_type IN ('git', 'local')),
  source        TEXT NOT NULL,
  ref_name      TEXT,
  sparse_paths  TEXT,
  last_revision TEXT,
  installed_at  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
`

// Rebuild provider tables so their CHECK constraints accept the
// 'openai-chat' provider id (Chat Completions API alongside Responses API).
// SQLite cannot alter CHECK constraints in place, so each table is recreated
// and data copied over. provider_default_models rows are backed up and
// restored around the provider_models rebuild because dropping the parent
// table cascades into it.
const PROVIDER_IDS_V21 =
  "('openai', 'openai-chat', 'anthropic', 'google', 'deepseek', 'openai-compatible')"

const PROVIDER_TABLES_V21 = `
DROP TRIGGER trg_provider_keys__clear_active_on_delete;

CREATE TABLE provider_connections_new (
  provider_id                    TEXT PRIMARY KEY CHECK (
    provider_id IN ${PROVIDER_IDS_V21}
  ),
  public_fields_json             TEXT NOT NULL CHECK (json_valid(public_fields_json)),
  secret_fields_encrypted_json   TEXT NOT NULL CHECK (json_valid(secret_fields_encrypted_json)),
  active_key_id                  TEXT,
  connected_at                   INTEGER,
  updated_at                     INTEGER NOT NULL,
  last_validated_at              INTEGER,
  last_validation_succeeded      INTEGER CHECK (last_validation_succeeded IN (0, 1)),
  last_validation_message        TEXT,
  last_validation_latency        INTEGER
);
INSERT INTO provider_connections_new SELECT * FROM provider_connections;
DROP TABLE provider_connections;
ALTER TABLE provider_connections_new RENAME TO provider_connections;

CREATE TABLE provider_keys_new (
  id                             TEXT PRIMARY KEY,
  provider_id                    TEXT NOT NULL CHECK (
    provider_id IN ${PROVIDER_IDS_V21}
  ),
  key_id                         TEXT NOT NULL,
  label                          TEXT NOT NULL,
  encrypted_value                TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'untested' CHECK (
    status IN ('untested', 'valid', 'invalid')
  ),
  created_at                     INTEGER NOT NULL,
  updated_at                     INTEGER NOT NULL,
  last_used_at                   INTEGER,
  last_validated_at              INTEGER,
  last_validation_succeeded      INTEGER CHECK (last_validation_succeeded IN (0, 1)),
  last_validation_message        TEXT,
  last_validation_latency        INTEGER,
  UNIQUE (provider_id, key_id)
);
INSERT INTO provider_keys_new SELECT * FROM provider_keys;
DROP TABLE provider_keys;
ALTER TABLE provider_keys_new RENAME TO provider_keys;
CREATE INDEX idx_provider_keys__provider_updated ON provider_keys (provider_id, updated_at);
CREATE TRIGGER trg_provider_keys__clear_active_on_delete
AFTER DELETE ON provider_keys
FOR EACH ROW
BEGIN
  UPDATE provider_connections
  SET active_key_id = NULL,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE provider_id = OLD.provider_id
    AND active_key_id = OLD.key_id;
END;

CREATE TABLE provider_default_models_backup AS SELECT * FROM provider_default_models;

CREATE TABLE provider_models_new (
  provider_id                    TEXT NOT NULL CHECK (
    provider_id IN ${PROVIDER_IDS_V21}
  ),
  family                         TEXT NOT NULL CHECK (
    family IN ('language', 'embedding', 'image', 'transcription', 'speech')
  ),
  model_id                       TEXT NOT NULL,
  name                           TEXT NOT NULL,
  enabled                        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_custom                      INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  source                         TEXT NOT NULL DEFAULT 'api' CHECK (
    source IN ('api', 'curated', 'custom')
  ),
  model_json                     TEXT NOT NULL CHECK (json_valid(model_json)),
  context_window_override        INTEGER,
  updated_at                     INTEGER NOT NULL,
  PRIMARY KEY (provider_id, family, model_id)
);
INSERT INTO provider_models_new SELECT * FROM provider_models;
DROP TABLE provider_models;
ALTER TABLE provider_models_new RENAME TO provider_models;
CREATE INDEX idx_provider_models__provider_family ON provider_models (provider_id, family);

DELETE FROM provider_default_models;
INSERT INTO provider_default_models SELECT * FROM provider_default_models_backup;
DROP TABLE provider_default_models_backup;

CREATE TABLE provider_defaults_new (
  provider_id  TEXT NOT NULL CHECK (
    provider_id IN ${PROVIDER_IDS_V21}
  ),
  family       TEXT NOT NULL CHECK (
    family IN ('language', 'embedding', 'image', 'transcription', 'speech')
  ),
  defaults_json TEXT NOT NULL CHECK (json_valid(defaults_json)),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (provider_id, family)
);
INSERT INTO provider_defaults_new SELECT * FROM provider_defaults;
DROP TABLE provider_defaults;
ALTER TABLE provider_defaults_new RENAME TO provider_defaults;
`

export const tanzoMigrations: ModuleMigrations = {
  moduleName: 'tanzo',
  files: [
    {
      version: 1,
      name: 'initial_schema',
      up: (db) => db.exec(INITIAL_SCHEMA)
    },
    {
      version: 19,
      name: 'plugin_states',
      up: (db) => db.exec(PLUGIN_STATES_SCHEMA)
    },
    {
      version: 20,
      name: 'plugin_marketplaces',
      up: (db) => db.exec(PLUGIN_MARKETPLACES_SCHEMA)
    },
    {
      version: 21,
      name: 'provider_openai_chat',
      up: (db) => db.exec(PROVIDER_TABLES_V21)
    },
    {
      version: 22,
      name: 'per_step_message_rows',
      up: (db) => migratePerStepMessages(db)
    },
    {
      // Rollback of 22: per-step rows gave one reply two identities (live SDK
      // message vs. persisted fragments); storage returns to one row per reply.
      version: 23,
      name: 'merge_step_message_rows',
      up: (db) => mergeStepMessageRows(db)
    },
    {
      // Reasoning effort becomes a per-conversation setting (same scope as
      // model_ref) instead of a provider-wide default.
      version: 24,
      name: 'conversation_reasoning_effort',
      up: (db) => {
        const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{
          name: string
        }>
        if (columns.some((column) => column.name === 'reasoning_effort')) return
        db.exec("ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''")
      }
    },
    {
      // Goal v2: same-run dedupe for rejected block attempts (blocker streak
      // gate). See docs/design/goal-v2.md §3.2.
      version: 25,
      name: 'goal_blocker_last_run_id',
      up: (db) => {
        const columns = db.prepare('PRAGMA table_info(conversation_goals)').all() as Array<{
          name: string
        }>
        if (columns.some((column) => column.name === 'blocker_last_run_id')) return
        db.exec('ALTER TABLE conversation_goals ADD COLUMN blocker_last_run_id TEXT')
      }
    }
  ]
}
