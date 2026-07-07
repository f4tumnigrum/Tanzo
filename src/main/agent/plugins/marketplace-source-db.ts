import type { SqlDatabase } from '../../database/types'

export type MarketplaceSourceType = 'git' | 'local'

export interface MarketplaceSourceRecord {
  name: string
  sourceType: MarketplaceSourceType

  source: string

  refName: string | null

  sparsePaths: string[]

  lastRevision: string | null
  installedAt: number
}

export interface RecordMarketplaceInput {
  name: string
  sourceType: MarketplaceSourceType
  source: string
  refName: string | null
  sparsePaths: string[]
  lastRevision: string | null
  installedAt: number
}

export interface MarketplaceSourceStore {
  all(): Map<string, MarketplaceSourceRecord>
  get(name: string): MarketplaceSourceRecord | undefined
  record(input: RecordMarketplaceInput): void
  updateRevision(name: string, revision: string): void
  remove(name: string): void
}

interface MarketplaceSourceRow {
  name: string
  source_type: string
  source: string
  ref_name: string | null
  sparse_paths: string | null
  last_revision: string | null
  installed_at: number
}

function parseSparsePaths(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

function rowToRecord(row: MarketplaceSourceRow): MarketplaceSourceRecord {
  return {
    name: row.name,
    sourceType: row.source_type === 'git' ? 'git' : 'local',
    source: row.source,
    refName: row.ref_name,
    sparsePaths: parseSparsePaths(row.sparse_paths),
    lastRevision: row.last_revision,
    installedAt: row.installed_at
  }
}

export function createMarketplaceSourceStore(db: SqlDatabase): MarketplaceSourceStore {
  const selectAll = db.prepare('SELECT * FROM plugin_marketplaces')
  const selectOne = db.prepare('SELECT * FROM plugin_marketplaces WHERE name = ?')
  const deleteOne = db.prepare('DELETE FROM plugin_marketplaces WHERE name = ?')
  const upsert = db.prepare(`INSERT INTO plugin_marketplaces
    (name, source_type, source, ref_name, sparse_paths, last_revision, installed_at, updated_at)
    VALUES (@name, @source_type, @source, @ref_name, @sparse_paths, @last_revision, @installed_at, @updated_at)
    ON CONFLICT(name) DO UPDATE SET
      source_type = @source_type, source = @source, ref_name = @ref_name,
      sparse_paths = @sparse_paths, last_revision = @last_revision,
      installed_at = @installed_at, updated_at = @updated_at`)
  const updateRevisionStmt = db.prepare(
    'UPDATE plugin_marketplaces SET last_revision = @last_revision, updated_at = @updated_at WHERE name = @name'
  )

  return {
    all() {
      const map = new Map<string, MarketplaceSourceRecord>()
      for (const row of selectAll.all() as MarketplaceSourceRow[]) {
        map.set(row.name, rowToRecord(row))
      }
      return map
    },
    get(name) {
      const row = selectOne.get([name]) as MarketplaceSourceRow | undefined
      return row ? rowToRecord(row) : undefined
    },
    record(input) {
      upsert.run({
        name: input.name,
        source_type: input.sourceType,
        source: input.source,
        ref_name: input.refName,
        sparse_paths: input.sparsePaths.length > 0 ? JSON.stringify(input.sparsePaths) : null,
        last_revision: input.lastRevision,
        installed_at: input.installedAt,
        updated_at: Date.now()
      })
    },
    updateRevision(name, revision) {
      updateRevisionStmt.run({ name, last_revision: revision, updated_at: Date.now() })
    },
    remove(name) {
      deleteOne.run([name])
    }
  }
}
