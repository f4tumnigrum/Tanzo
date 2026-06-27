import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TanzoConfigurationError } from '@shared/errors'

const mocks = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn() }
  const db = { close: vi.fn() }
  const raw = { backup: vi.fn(async () => undefined), pragma: vi.fn() }
  return {
    logger,
    db,
    raw,
    openDatabase: vi.fn(() => ({ db, raw })),
    runMigrations: vi.fn()
  }
})

vi.mock('@main/logger', () => ({
  createLogger: vi.fn(() => mocks.logger)
}))

vi.mock('@main/database/connection', () => ({
  openDatabase: mocks.openDatabase
}))

vi.mock('@main/database/migrations', () => ({
  runMigrations: mocks.runMigrations
}))

describe('database/module', () => {
  it('opens the configured database, runs migrations, and closes', async () => {
    const { createDatabaseModule } = await import('@main/database/module')
    const migrations = [{ moduleName: 'agent', files: [] }]

    const module = createDatabaseModule({
      userDataPath: '/tmp/tanzo',
      databaseFileName: 'custom.sqlite',
      migrations
    })

    expect(mocks.openDatabase).toHaveBeenCalledWith({
      databasePath: path.join('/tmp/tanzo', 'custom.sqlite')
    })
    expect(mocks.runMigrations).toHaveBeenCalledWith(mocks.db, migrations)
    expect(mocks.logger.info).toHaveBeenCalledWith('initialized', {
      databasePath: path.join('/tmp/tanzo', 'custom.sqlite'),
      modules: ['agent']
    })
    expect(module.db).toBe(mocks.db)

    await module.backupTo('/tmp/backup.sqlite')
    expect(mocks.raw.backup).toHaveBeenCalledWith('/tmp/backup.sqlite')

    module.close()
    expect(mocks.raw.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    expect(mocks.db.close).toHaveBeenCalled()
    expect(mocks.logger.info).toHaveBeenCalledWith('closed')
  })

  it('uses the default filename and wraps backup failures', async () => {
    const { createDatabaseModule } = await import('@main/database/module')
    mocks.raw.backup.mockRejectedValueOnce(new Error('disk full'))
    const module = createDatabaseModule({ userDataPath: '/tmp/defaults', migrations: [] })

    expect(mocks.openDatabase).toHaveBeenLastCalledWith({
      databasePath: path.join('/tmp/defaults', 'tanzo.sqlite')
    })
    await expect(module.backupTo('/tmp/fail.sqlite')).rejects.toThrow(TanzoConfigurationError)
  })
})
