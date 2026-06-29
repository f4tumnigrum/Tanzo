import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import { createRealDb, type RealDb } from '../../../../helpers/real-db'
import { createMarketplaceSourceStore } from '@main/agent/plugins/marketplace-source-db'
import { createMarketplaceInstaller } from '@main/agent/plugins/marketplace-install'

const tempDirs: string[] = []
const dbs: RealDb[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const db of dbs.splice(0)) db.close()
})

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-marketplace-'))
  tempDirs.push(dir)
  return dir
}

/** Lay out a marketplace.json + one local plugin under `root`. */
function writeMarketplace(root: string, name: string): void {
  const dir = join(root, '.agents', 'plugins')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'marketplace.json'),
    JSON.stringify({
      name,
      plugins: [{ name: 'sample', source: './plugins/sample' }]
    })
  )
  const pluginDir = join(root, 'plugins', 'sample', '.codex-plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'sample' }))
}

function makeInstaller(options?: {
  cloneFrom?: string
  revision?: string
  remoteRevision?: string
}) {
  const installRoot = tempDir()
  const db = createRealDb()
  dbs.push(db)
  const store = createMarketplaceSourceStore(db)
  const cloneGitSource = vi.fn(
    async (
      _source: string,
      _ref: string | undefined,
      _sparse: string[],
      destination: string
    ): Promise<string> => {
      if (options?.cloneFrom) cpSync(options.cloneFrom, destination, { recursive: true })
      return options?.revision ?? 'a'.repeat(40)
    }
  )
  const gitRemoteRevision = vi.fn(
    async (): Promise<string> => options?.remoteRevision ?? 'a'.repeat(40)
  )
  const installer = createMarketplaceInstaller({
    installRoot,
    store,
    logger: silentLogger,
    cloneGitSource,
    gitRemoteRevision
  })
  return { installer, installRoot, store, cloneGitSource, gitRemoteRevision }
}

describe('main/agent/plugins/marketplace-install add (local)', () => {
  it('registers a local source in place without copying', async () => {
    const source = tempDir()
    writeMarketplace(source, 'localmkt')
    const { installer, installRoot } = makeInstaller()

    const outcome = await installer.add({ source })

    expect(outcome.name).toBe('localmkt')
    expect(outcome.sourceType).toBe('local')
    expect(outcome.installedRoot).toBe(source)
    expect(outcome.alreadyAdded).toBe(false)
    // Local sources are never copied into the managed install root.
    expect(existsSync(join(installRoot, 'localmkt'))).toBe(false)
    expect(installer.resolveRoots()).toEqual([source])
  })

  it('rejects a ref for a local source', async () => {
    const source = tempDir()
    writeMarketplace(source, 'localmkt')
    const { installer } = makeInstaller()

    await expect(installer.add({ source, refName: 'main' })).rejects.toBeInstanceOf(
      TanzoValidationError
    )
  })

  it('rejects a local source missing a marketplace.json', async () => {
    const source = tempDir()
    const { installer } = makeInstaller()

    await expect(installer.add({ source })).rejects.toBeInstanceOf(TanzoValidationError)
  })
})

describe('main/agent/plugins/marketplace-install add (git)', () => {
  it('clones a git source into the managed install root and records it', async () => {
    const cloneFrom = tempDir()
    writeMarketplace(cloneFrom, 'gitmkt')
    const { installer, installRoot, store, cloneGitSource } = makeInstaller({
      cloneFrom,
      revision: 'b'.repeat(40)
    })

    const outcome = await installer.add({ source: 'owner/repo' })

    expect(cloneGitSource).toHaveBeenCalledWith(
      'https://github.com/owner/repo.git',
      undefined,
      [],
      expect.any(String)
    )
    expect(outcome.name).toBe('gitmkt')
    expect(outcome.sourceType).toBe('git')
    expect(outcome.alreadyAdded).toBe(false)
    expect(existsSync(join(installRoot, 'gitmkt', '.agents', 'plugins', 'marketplace.json'))).toBe(
      true
    )
    expect(store.get('gitmkt')?.source).toBe('https://github.com/owner/repo.git')
    expect(store.get('gitmkt')?.lastRevision).toBe('b'.repeat(40))
    // No staging dir should linger.
    expect(existsSync(join(installRoot, '.staging', 'gitmkt'))).toBe(false)
  })

  it('treats a re-add of the same git source as already added', async () => {
    const cloneFrom = tempDir()
    writeMarketplace(cloneFrom, 'gitmkt')
    const { installer } = makeInstaller({ cloneFrom })

    await installer.add({ source: 'owner/repo' })
    const second = await installer.add({ source: 'owner/repo' })

    expect(second.alreadyAdded).toBe(true)
  })

  it('cleans up staging when the clone produces no marketplace manifest', async () => {
    const emptyClone = tempDir() // no marketplace.json
    const { installer, installRoot } = makeInstaller({ cloneFrom: emptyClone })

    await expect(installer.add({ source: 'owner/repo' })).rejects.toBeInstanceOf(
      TanzoValidationError
    )
    // Staging tempdir is removed on failure.
    const stagingRoot = join(installRoot, '.staging')
    const leftovers = existsSync(stagingRoot) ? readdirSync(stagingRoot) : []
    expect(leftovers).toEqual([])
  })
})

describe('main/agent/plugins/marketplace-install remove', () => {
  it('removes a git marketplace and its managed root', async () => {
    const cloneFrom = tempDir()
    writeMarketplace(cloneFrom, 'gitmkt')
    const { installer, installRoot, store } = makeInstaller({ cloneFrom })
    await installer.add({ source: 'owner/repo' })

    installer.remove('gitmkt')

    expect(store.get('gitmkt')).toBeUndefined()
    expect(existsSync(join(installRoot, 'gitmkt'))).toBe(false)
  })

  it('removes a local record without deleting the source directory', async () => {
    const source = tempDir()
    writeMarketplace(source, 'localmkt')
    const { installer, store } = makeInstaller()
    await installer.add({ source })

    installer.remove('localmkt')

    expect(store.get('localmkt')).toBeUndefined()
    // The user's directory must survive removal.
    expect(existsSync(join(source, '.agents', 'plugins', 'marketplace.json'))).toBe(true)
  })

  it('throws when removing an unknown marketplace', () => {
    const { installer } = makeInstaller()
    expect(() => installer.remove('nope')).toThrow(TanzoNotFoundError)
  })
})

describe('main/agent/plugins/marketplace-install upgrade', () => {
  it('skips re-clone when the remote revision is unchanged', async () => {
    const cloneFrom = tempDir()
    writeMarketplace(cloneFrom, 'gitmkt')
    const { installer, cloneGitSource } = makeInstaller({
      cloneFrom,
      revision: 'c'.repeat(40),
      remoteRevision: 'c'.repeat(40)
    })
    await installer.add({ source: 'owner/repo' })
    cloneGitSource.mockClear()

    const result = await installer.upgrade('gitmkt')

    expect(result.updated).toBe(false)
    expect(cloneGitSource).not.toHaveBeenCalled()
  })

  it('re-clones and activates when the remote revision changed', async () => {
    const cloneFrom = tempDir()
    writeMarketplace(cloneFrom, 'gitmkt')
    const { installer, store } = makeInstaller({
      cloneFrom,
      revision: 'd'.repeat(40),
      remoteRevision: 'e'.repeat(40)
    })
    await installer.add({ source: 'owner/repo' })

    const result = await installer.upgrade('gitmkt')

    expect(result.updated).toBe(true)
    expect(result.revision).toBe('d'.repeat(40))
    expect(store.get('gitmkt')?.lastRevision).toBe('d'.repeat(40))
  })

  it('refuses to upgrade a local marketplace', async () => {
    const source = tempDir()
    writeMarketplace(source, 'localmkt')
    const { installer } = makeInstaller()
    await installer.add({ source })

    await expect(installer.upgrade('localmkt')).rejects.toBeInstanceOf(TanzoValidationError)
  })
})
