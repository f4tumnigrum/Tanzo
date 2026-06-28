import type { SqlDatabase } from '../../database/types'

export interface PluginStateRecord {
  configKey: string
  pluginName: string
  marketplaceName: string
  enabled: boolean
  installed: boolean
  version: string | null
  sourcePath: string | null
  installedAt: number | null
}

export interface RecordInstallInput {
  configKey: string
  pluginName: string
  marketplaceName: string
  enabled: boolean
  version: string
  sourcePath: string | null
  installedAt: number
}

export interface PluginStateStore {
  all(): Map<string, PluginStateRecord>
  get(configKey: string): PluginStateRecord | undefined
  setEnabled(configKey: string, enabled: boolean): void
  recordInstall(input: RecordInstallInput): void
  remove(configKey: string): void
}

interface PluginStateRow {
  config_key: string
  plugin_name: string
  marketplace_name: string
  enabled: number
  installed: number
  version: string | null
  source_path: string | null
  installed_at: number | null
}

function rowToRecord(row: PluginStateRow): PluginStateRecord {
  return {
    configKey: row.config_key,
    pluginName: row.plugin_name,
    marketplaceName: row.marketplace_name,
    enabled: row.enabled !== 0,
    installed: row.installed !== 0,
    version: row.version,
    sourcePath: row.source_path,
    installedAt: row.installed_at
  }
}

export function createPluginStateStore(db: SqlDatabase): PluginStateStore {
  const selectAll = db.prepare('SELECT * FROM plugin_states')
  const selectOne = db.prepare('SELECT * FROM plugin_states WHERE config_key = ?')
  const deleteOne = db.prepare('DELETE FROM plugin_states WHERE config_key = ?')
  const upsertEnabled = db.prepare(`INSERT INTO plugin_states
    (config_key, plugin_name, marketplace_name, enabled, installed, updated_at)
    VALUES (@config_key, @plugin_name, @marketplace_name, @enabled, 0, @updated_at)
    ON CONFLICT(config_key) DO UPDATE SET enabled = @enabled, updated_at = @updated_at`)
  const upsertInstall = db.prepare(`INSERT INTO plugin_states
    (config_key, plugin_name, marketplace_name, enabled, installed, version,
     source_path, installed_at, updated_at)
    VALUES (@config_key, @plugin_name, @marketplace_name, @enabled, 1, @version,
            @source_path, @installed_at, @updated_at)
    ON CONFLICT(config_key) DO UPDATE SET
      plugin_name = @plugin_name, marketplace_name = @marketplace_name,
      enabled = @enabled, installed = 1, version = @version,
      source_path = @source_path, installed_at = @installed_at, updated_at = @updated_at`)

  return {
    all() {
      const map = new Map<string, PluginStateRecord>()
      for (const row of selectAll.all() as PluginStateRow[]) {
        map.set(row.config_key, rowToRecord(row))
      }
      return map
    },
    get(configKey) {
      const row = selectOne.get([configKey]) as PluginStateRow | undefined
      return row ? rowToRecord(row) : undefined
    },
    setEnabled(configKey, enabled) {
      const [pluginName, marketplaceName] = splitKey(configKey)
      upsertEnabled.run({
        config_key: configKey,
        plugin_name: pluginName,
        marketplace_name: marketplaceName,
        enabled: enabled ? 1 : 0,
        updated_at: Date.now()
      })
    },
    recordInstall(input) {
      upsertInstall.run({
        config_key: input.configKey,
        plugin_name: input.pluginName,
        marketplace_name: input.marketplaceName,
        enabled: input.enabled ? 1 : 0,
        version: input.version,
        source_path: input.sourcePath,
        installed_at: input.installedAt,
        updated_at: Date.now()
      })
    },
    remove(configKey) {
      deleteOne.run([configKey])
    }
  }
}

function splitKey(configKey: string): [string, string] {
  const at = configKey.lastIndexOf('@')
  if (at <= 0) return [configKey, '']
  return [configKey.slice(0, at), configKey.slice(at + 1)]
}
