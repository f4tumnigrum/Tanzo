import { describe, expect, it } from 'vitest'
import { runMigrations } from '@main/database/migrations'
import { tanzoMigrations } from '@main/database/schema'
import { createRealDb } from '../../../helpers/real-db'

describe('database/migrations on real sqlite', () => {
  it('applies the initial schema migration and stays idempotent on re-run', () => {
    const db = createRealDb()
    const versions = (): number[] =>
      (
        db
          .prepare('SELECT version FROM _tanzo_migrations WHERE module = ? ORDER BY version')
          .all(['tanzo']) as Array<{ version: number }>
      ).map((row) => row.version)

    expect(versions()).toEqual([1, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])
    expect(() => runMigrations(db, [tanzoMigrations])).not.toThrow()
    expect(versions()).toEqual([1, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])
  })

  it('adds reasoning_effort to conversations created by the initial schema (v24)', () => {
    const db = createRealDb()
    const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'reasoning_effort')).toBe(true)
    // Idempotent: re-running against a schema that already has the column is a no-op.
    expect(() => runMigrations(db, [tanzoMigrations])).not.toThrow()
    db.close()
  })

  it('adds pinned_at to conversations created by the initial schema (v26)', () => {
    const db = createRealDb()
    const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'pinned_at')).toBe(true)
    // Idempotent: re-running against a schema that already has the column is a no-op.
    expect(() => runMigrations(db, [tanzoMigrations])).not.toThrow()
    db.close()
  })

  it('applies plugin_states for databases that already used earlier migration versions', () => {
    const db = createRealDb({ migrate: false })
    db.exec(`
      CREATE TABLE _tanzo_migrations (
        module TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        PRIMARY KEY (module, version)
      );
    `)
    const insert = db.prepare(
      'INSERT INTO _tanzo_migrations (module, version, name, applied_at) VALUES (?, ?, ?, ?)'
    )
    for (let version = 2; version <= 18; version++) {
      insert.run(['tanzo', version, `legacy_${version}`, 1])
    }

    runMigrations(db, [tanzoMigrations])

    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(['plugin_states'])
    ).toEqual({ name: 'plugin_states' })
    expect(
      db
        .prepare('SELECT version, name FROM _tanzo_migrations WHERE module = ? AND version = ?')
        .get(['tanzo', 19])
    ).toEqual({ version: 19, name: 'plugin_states' })
    db.close()
  })

  it('applies plugin_marketplaces for databases that already used earlier migration versions', () => {
    const db = createRealDb({ migrate: false })
    db.exec(`
      CREATE TABLE _tanzo_migrations (
        module TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        PRIMARY KEY (module, version)
      );
    `)
    const insert = db.prepare(
      'INSERT INTO _tanzo_migrations (module, version, name, applied_at) VALUES (?, ?, ?, ?)'
    )
    for (let version = 2; version <= 19; version++) {
      insert.run(['tanzo', version, `legacy_${version}`, 1])
    }

    runMigrations(db, [tanzoMigrations])

    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(['plugin_marketplaces'])
    ).toEqual({ name: 'plugin_marketplaces' })
    expect(
      db
        .prepare('SELECT version, name FROM _tanzo_migrations WHERE module = ? AND version = ?')
        .get(['tanzo', 20])
    ).toEqual({ version: 20, name: 'plugin_marketplaces' })
    db.close()
  })

  it('adds telemetry_v2 columns and model_calls to the initial schema (v29)', () => {
    const db = createRealDb()
    const runColumns = (db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
    expect(runColumns).toEqual(
      expect.arrayContaining(['aborted', 'error_kind', 'ttft_ms', 'retry_count'])
    )
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(['model_calls'])
    ).toEqual({ name: 'model_calls' })
    // Idempotent: re-running against a schema that already has them is a no-op.
    expect(() => runMigrations(db, [tanzoMigrations])).not.toThrow()
    db.close()
  })

  it('applies telemetry_v2 for databases that stopped at v28', () => {
    const db = createRealDb({ migrate: false })
    // Minimal pre-v29 shape: a runs table without the new columns and no model_calls.
    db.exec(`
      CREATE TABLE _tanzo_migrations (
        module TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        PRIMARY KEY (module, version)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        external_run_id TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        error_json TEXT
      );
      -- Provider tables/trigger as a real v28 database would have them (post-v27 rebuild).
      CREATE TABLE provider_connections (
        provider_id TEXT PRIMARY KEY,
        public_fields_json TEXT NOT NULL DEFAULT '{}',
        secret_fields_encrypted_json TEXT NOT NULL DEFAULT '{}',
        active_key_id TEXT,
        connected_at INTEGER,
        updated_at INTEGER NOT NULL,
        last_validated_at INTEGER,
        last_validation_succeeded INTEGER,
        last_validation_message TEXT,
        last_validation_latency INTEGER
      );
      CREATE TABLE provider_keys (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        label TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'untested',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        last_validated_at INTEGER,
        last_validation_succeeded INTEGER,
        last_validation_message TEXT,
        last_validation_latency INTEGER,
        UNIQUE (provider_id, key_id)
      );
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
        provider_id TEXT NOT NULL,
        family TEXT NOT NULL,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_custom INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'api',
        model_json TEXT NOT NULL DEFAULT '{}',
        context_window_override INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, family, model_id)
      );
      CREATE TABLE provider_default_models (
        provider_id TEXT NOT NULL,
        family TEXT NOT NULL,
        model_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, family)
      );
      CREATE TABLE provider_defaults (
        provider_id TEXT NOT NULL,
        family TEXT NOT NULL,
        defaults_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, family)
      );
    `)
    const insert = db.prepare(
      'INSERT INTO _tanzo_migrations (module, version, name, applied_at) VALUES (?, ?, ?, ?)'
    )
    for (const version of [1, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
      insert.run(['tanzo', version, `legacy_${version}`, 1])
    }

    runMigrations(db, [tanzoMigrations])

    const runColumns = (db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
    expect(runColumns).toEqual(
      expect.arrayContaining(['aborted', 'error_kind', 'ttft_ms', 'retry_count'])
    )
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(['model_calls'])
    ).toEqual({ name: 'model_calls' })
    db.close()
  })

  it('creates the core tables with foreign keys enforced', () => {
    const db = createRealDb()
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all([]) as Array<{ name: string }>
    ).map((row) => row.name)

    for (const expected of [
      'conversations',
      'messages',
      'message_revisions',
      'compaction_overlays',
      'quarantined_messages',
      'queued_messages',
      'policy_modes',
      'runs',
      'run_steps',
      'prompt_diagnostics',
      'tool_executions',
      'subagent_tasks',
      'conversation_goals',
      'skill_states',
      'policy_rules',
      'workspaces'
    ]) {
      expect(tables).toContain(expected)
    }
    expect(tables).not.toContain('conversation_response_anchors')

    expect(() =>
      db
        .prepare(
          `INSERT INTO messages (conversation_id, id, seq, role, message_json, created_at)
           VALUES ('missing-conversation', 'm1', 0, 'user', '{}', 0)`
        )
        .run()
    ).toThrow()
    db.close()
  })

  it('does not drop unrelated pre-existing tables while applying the initial schema', () => {
    const db = createRealDb({ migrate: false })
    db.exec(`
      CREATE TABLE user_owned_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO user_owned_table (id, value) VALUES ('keep', 'data');
    `)

    runMigrations(db, [tanzoMigrations])

    expect(db.prepare('SELECT value FROM user_owned_table WHERE id = ?').get(['keep'])).toEqual({
      value: 'data'
    })
    db.close()
  })

  it('preserves provider data through the v21 provider_openai_chat rebuild', () => {
    const db = createRealDb({ migrate: false })
    runMigrations(db, [{ moduleName: 'tanzo', files: [tanzoMigrations.files[0]] }])
    db.exec(`
      INSERT INTO provider_connections (
        provider_id, public_fields_json, secret_fields_encrypted_json, active_key_id, updated_at
      ) VALUES ('openai', '{"baseUrl":"https://api.openai.com/v1"}', '{}', 'primary', 1);
      INSERT INTO provider_keys (
        id, provider_id, key_id, label, encrypted_value, status, created_at, updated_at
      ) VALUES ('openai:primary', 'openai', 'primary', 'Primary', 'enc:key', 'valid', 1, 1);
      INSERT INTO provider_models (
        provider_id, family, model_id, name, model_json, updated_at
      ) VALUES ('openai', 'language', 'gpt-5', 'GPT 5', '{"id":"gpt-5","name":"GPT 5"}', 1);
      INSERT INTO provider_default_models (provider_id, family, model_id, updated_at)
        VALUES ('openai', 'language', 'gpt-5', 1);
      INSERT INTO provider_defaults (provider_id, family, defaults_json, updated_at)
        VALUES ('openai', 'language', '{"callDefaults":{}}', 1);
    `)

    runMigrations(db, [tanzoMigrations])

    expect(
      db
        .prepare('SELECT active_key_id FROM provider_connections WHERE provider_id = ?')
        .get(['openai'])
    ).toEqual({ active_key_id: 'primary' })
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM provider_keys WHERE provider_id = ?').get(['openai'])
    ).toEqual({ n: 1 })
    expect(
      db
        .prepare('SELECT model_id FROM provider_default_models WHERE provider_id = ?')
        .get(['openai'])
    ).toEqual({ model_id: 'gpt-5' })
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM provider_defaults WHERE provider_id = ?')
        .get(['openai'])
    ).toEqual({ n: 1 })

    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_connections (
             provider_id, public_fields_json, secret_fields_encrypted_json, updated_at
           ) VALUES ('openai-chat', '{}', '{}', 2)`
        )
        .run()
    ).not.toThrow()
    db.close()
  })

  it('accepts zhipu and minimax provider ids after the v27 rebuild', () => {
    const db = createRealDb()

    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_connections (
             provider_id, public_fields_json, secret_fields_encrypted_json, updated_at
           ) VALUES (?, '{}', '{}', 2)`
        )
        .run(['zhipu'])
    ).not.toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_connections (
             provider_id, public_fields_json, secret_fields_encrypted_json, updated_at
           ) VALUES (?, '{}', '{}', 2)`
        )
        .run(['minimax'])
    ).not.toThrow()
    db.close()
  })

  it('accepts the grok provider id after the v30 rebuild', () => {
    const db = createRealDb()

    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_connections (
             provider_id, public_fields_json, secret_fields_encrypted_json, updated_at
           ) VALUES (?, '{}', '{}', 2)`
        )
        .run(['grok'])
    ).not.toThrow()
    db.close()
  })

  it('preserves provider data through the v27 provider rebuild', () => {
    const db = createRealDb({ migrate: false })
    // Apply every migration up to and including v26.
    runMigrations(db, [
      { moduleName: 'tanzo', files: tanzoMigrations.files.filter((file) => file.version < 27) }
    ])
    db.exec(`
      INSERT INTO provider_connections (
        provider_id, public_fields_json, secret_fields_encrypted_json, active_key_id, updated_at
      ) VALUES ('deepseek', '{"baseUrl":"https://api.deepseek.com"}', '{}', 'primary', 1);
      INSERT INTO provider_keys (
        id, provider_id, key_id, label, encrypted_value, status, created_at, updated_at
      ) VALUES ('deepseek:primary', 'deepseek', 'primary', 'Primary', 'enc:key', 'valid', 1, 1);
      INSERT INTO provider_models (
        provider_id, family, model_id, name, model_json, updated_at
      ) VALUES ('deepseek', 'language', 'deepseek-chat', 'DeepSeek Chat', '{"id":"deepseek-chat","name":"DeepSeek Chat"}', 1);
      INSERT INTO provider_default_models (provider_id, family, model_id, updated_at)
        VALUES ('deepseek', 'language', 'deepseek-chat', 1);
      INSERT INTO provider_defaults (provider_id, family, defaults_json, updated_at)
        VALUES ('deepseek', 'language', '{"callDefaults":{}}', 1);
    `)

    runMigrations(db, [tanzoMigrations])

    expect(
      db
        .prepare('SELECT active_key_id FROM provider_connections WHERE provider_id = ?')
        .get(['deepseek'])
    ).toEqual({ active_key_id: 'primary' })
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM provider_keys WHERE provider_id = ?').get(['deepseek'])
    ).toEqual({ n: 1 })
    expect(
      db
        .prepare('SELECT model_id FROM provider_default_models WHERE provider_id = ?')
        .get(['deepseek'])
    ).toEqual({ model_id: 'deepseek-chat' })
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM provider_defaults WHERE provider_id = ?')
        .get(['deepseek'])
    ).toEqual({ n: 1 })

    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_connections (
             provider_id, public_fields_json, secret_fields_encrypted_json, updated_at
           ) VALUES ('minimax', '{}', '{}', 2)`
        )
        .run()
    ).not.toThrow()
    db.close()
  })

  it('keeps only the newest global provider default after v31', () => {
    const db = createRealDb({ migrate: false })
    runMigrations(db, [
      { moduleName: 'tanzo', files: tanzoMigrations.files.filter((file) => file.version < 31) }
    ])
    db.exec(`
      INSERT INTO provider_models (
        provider_id, family, model_id, name, model_json, updated_at
      ) VALUES
        ('openai', 'language', 'gpt-5', 'GPT 5', '{"id":"gpt-5","name":"GPT 5"}', 1),
        ('anthropic', 'language', 'claude', 'Claude', '{"id":"claude","name":"Claude"}', 2);
      INSERT INTO provider_default_models (provider_id, family, model_id, updated_at) VALUES
        ('openai', 'language', 'gpt-5', 1),
        ('anthropic', 'language', 'claude', 2);
    `)

    runMigrations(db, [tanzoMigrations])

    expect(db.prepare('SELECT provider_id, model_id FROM provider_default_models').all()).toEqual([
      { provider_id: 'anthropic', model_id: 'claude' }
    ])
    expect(() =>
      db
        .prepare(
          'INSERT INTO provider_default_models (provider_id, family, model_id, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run(['openai', 'language', 'gpt-5', 3])
    ).toThrow()
    db.close()
  })

  it('adds full compaction overlay payload storage after v31', () => {
    const db = createRealDb({ migrate: false })
    runMigrations(db, [
      { moduleName: 'tanzo', files: tanzoMigrations.files.filter((file) => file.version < 32) }
    ])

    expect(
      (db.prepare('PRAGMA table_info(compaction_overlays)').all() as Array<{ name: string }>).some(
        (column) => column.name === 'data_json'
      )
    ).toBe(false)

    runMigrations(db, [tanzoMigrations])

    expect(
      (db.prepare('PRAGMA table_info(compaction_overlays)').all() as Array<{ name: string }>).some(
        (column) => column.name === 'data_json'
      )
    ).toBe(true)
    db.close()
  })

  it('clears only active_key_id when deleting the active provider key', () => {
    const db = createRealDb()
    db.exec(`
      INSERT INTO provider_keys (
        id, provider_id, key_id, label, encrypted_value, status, created_at, updated_at
      ) VALUES (
        'openai:primary', 'openai', 'primary', 'Primary', 'enc:key', 'valid', 1, 1
      );
      INSERT INTO provider_connections (
        provider_id, public_fields_json, secret_fields_encrypted_json, active_key_id, updated_at
      ) VALUES (
        'openai', '{}', '{}', 'primary', 1
      );
    `)

    db.prepare('DELETE FROM provider_keys WHERE provider_id = ? AND key_id = ?').run([
      'openai',
      'primary'
    ])

    expect(
      db
        .prepare(
          'SELECT provider_id, active_key_id FROM provider_connections WHERE provider_id = ?'
        )
        .get(['openai'])
    ).toEqual({ provider_id: 'openai', active_key_id: null })
    expect(db.prepare('PRAGMA foreign_key_list(provider_connections)').all()).toEqual([])
  })

  it('scopes policy_decisions by workspace so the same fingerprint is independent per target', () => {
    const db = createRealDb()

    const pk = (
      db.prepare('PRAGMA table_info(policy_decisions)').all([]) as Array<{
        name: string
        pk: number
      }>
    )
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort()
    expect(pk).toEqual(['fingerprint', 'scope_target_id', 'tool_name'])

    db.prepare(
      `INSERT INTO policy_decisions (tool_name, fingerprint, decision, scope_target_id, decided_at)
       VALUES ('shell', 'fp1', 'approved', '', 1)`
    ).run()
    db.prepare(
      `INSERT INTO policy_decisions (tool_name, fingerprint, decision, scope_target_id, decided_at)
       VALUES ('shell', 'fp1', 'denied', 'ws-b', 2)`
    ).run()
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM policy_decisions WHERE fingerprint = ?').get(['fp1'])
    ).toEqual({ n: 2 })
    db.close()
  })
})
