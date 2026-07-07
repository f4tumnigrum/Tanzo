import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type { Logger } from '../logging'
import { findMarketplacePath, loadMarketplace } from './marketplace'
import { validatePluginSegment } from './plugin-id'
import {
  cloneGitSource as defaultCloneGitSource,
  gitRemoteRevision as defaultGitRemoteRevision
} from './git'
import {
  marketplaceSourceDisplay,
  parseMarketplaceSource,
  type GitMarketplaceSource,
  type LocalMarketplaceSource,
  type MarketplaceSource
} from './marketplace-source'
import type { MarketplaceSourceRecord, MarketplaceSourceStore } from './marketplace-source-db'

const RESERVED_MARKETPLACE_NAMES = new Set<string>()

const STAGING_DIR = '.staging'

export interface AddMarketplaceInput {
  source: string

  refName?: string

  sparsePaths?: string[]
}

export interface AddMarketplaceOutcome {
  name: string
  sourceType: 'git' | 'local'
  sourceDisplay: string

  installedRoot: string
  alreadyAdded: boolean
}

export interface UpgradeMarketplaceOutcome {
  name: string

  updated: boolean
  revision: string | null
}

export interface MarketplaceInstallerDeps {
  installRoot: string
  store: MarketplaceSourceStore
  logger: Logger

  cloneGitSource?: typeof defaultCloneGitSource

  gitRemoteRevision?: typeof defaultGitRemoteRevision
}

export interface MarketplaceInstaller {
  add(input: AddMarketplaceInput): Promise<AddMarketplaceOutcome>
  remove(name: string): void
  upgrade(name: string): Promise<UpgradeMarketplaceOutcome>

  resolveRoots(): string[]

  list(): MarketplaceSourceRecord[]
}

export function createMarketplaceInstaller(deps: MarketplaceInstallerDeps): MarketplaceInstaller {
  const { installRoot, store, logger } = deps
  const cloneGitSource = deps.cloneGitSource ?? defaultCloneGitSource
  const gitRemoteRevision = deps.gitRemoteRevision ?? defaultGitRemoteRevision

  function marketplaceNameAt(root: string): string {
    const manifestPath = findMarketplacePath(root)
    if (!manifestPath) {
      throw new TanzoValidationError(
        'MARKETPLACE_MANIFEST_MISSING',
        `No marketplace.json found under "${root}".`
      )
    }
    const market = loadMarketplace(manifestPath, logger)
    if (!market) {
      throw new TanzoValidationError(
        'MARKETPLACE_MANIFEST_INVALID',
        `Failed to load marketplace manifest at "${manifestPath}".`
      )
    }
    const nameError = validatePluginSegment(market.name, 'marketplace name')
    if (nameError) {
      throw new TanzoValidationError('MARKETPLACE_NAME_INVALID', nameError)
    }
    return market.name
  }

  function managedRoot(name: string): string {
    return join(installRoot, name)
  }

  function recordRoot(record: MarketplaceSourceRecord): string {
    return record.sourceType === 'local' ? record.source : managedRoot(record.name)
  }

  function assertNotReserved(name: string): void {
    if (RESERVED_MARKETPLACE_NAMES.has(name)) {
      throw new TanzoValidationError(
        'MARKETPLACE_NAME_RESERVED',
        `Marketplace "${name}" is reserved and cannot be added from this source.`
      )
    }
  }

  function assertNoConflictingSource(name: string, source: MarketplaceSource): void {
    const existing = store.get(name)
    if (!existing || sourceMatchesRecord(source, existing)) return
    throw new TanzoValidationError(
      'MARKETPLACE_NAME_CONFLICT',
      `Marketplace "${name}" is already added from a different source; remove it before adding this source.`
    )
  }

  function addLocal(source: LocalMarketplaceSource): AddMarketplaceOutcome {
    let isDir = false
    try {
      isDir = statSync(source.path).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      throw new TanzoValidationError(
        'MARKETPLACE_SOURCE_INVALID',
        `Local marketplace source is not a directory: ${source.path}`
      )
    }

    const name = marketplaceNameAt(source.path)
    assertNotReserved(name)
    assertNoConflictingSource(name, source)

    store.record({
      name,
      sourceType: 'local',
      source: source.path,
      refName: null,
      sparsePaths: [],
      lastRevision: null,
      installedAt: Date.now()
    })
    return {
      name,
      sourceType: 'local',
      sourceDisplay: marketplaceSourceDisplay(source),
      installedRoot: source.path,
      alreadyAdded: false
    }
  }

  async function addGit(source: GitMarketplaceSource): Promise<AddMarketplaceOutcome> {
    mkdirSync(installRoot, { recursive: true })
    const stagingRoot = join(installRoot, STAGING_DIR)
    mkdirSync(stagingRoot, { recursive: true })
    const staged = mkdtempSync(join(stagingRoot, 'marketplace-add-'))

    let revision: string
    let name: string
    try {
      revision = await cloneGitSource(source.url, source.refName, source.sparsePaths, staged)
      name = marketplaceNameAt(staged)
      assertNotReserved(name)
      assertNoConflictingSource(name, source)
    } catch (error) {
      rmSync(staged, { recursive: true, force: true })
      throw error
    }

    const destination = managedRoot(name)
    if (existsSync(destination)) {
      rmSync(staged, { recursive: true, force: true })
      assertNoConflictingSource(name, source)
      store.record({
        name,
        sourceType: 'git',
        source: source.url,
        refName: source.refName ?? null,
        sparsePaths: source.sparsePaths,
        lastRevision: revision,
        installedAt: store.get(name)?.installedAt ?? Date.now()
      })
      return {
        name,
        sourceType: 'git',
        sourceDisplay: marketplaceSourceDisplay(source),
        installedRoot: destination,
        alreadyAdded: true
      }
    }

    try {
      renameSync(staged, destination)
    } catch (error) {
      rmSync(staged, { recursive: true, force: true })
      throw error
    }

    try {
      store.record({
        name,
        sourceType: 'git',
        source: source.url,
        refName: source.refName ?? null,
        sparsePaths: source.sparsePaths,
        lastRevision: revision,
        installedAt: Date.now()
      })
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      throw error
    }

    return {
      name,
      sourceType: 'git',
      sourceDisplay: marketplaceSourceDisplay(source),
      installedRoot: destination,
      alreadyAdded: false
    }
  }

  return {
    async add(input) {
      const parsed = parseMarketplaceSource(input.source, {
        ...(input.refName ? { refName: input.refName } : {}),
        ...(input.sparsePaths ? { sparsePaths: input.sparsePaths } : {})
      })
      if (!parsed.ok) {
        throw new TanzoValidationError('MARKETPLACE_SOURCE_INVALID', parsed.error)
      }
      return parsed.source.kind === 'local' ? addLocal(parsed.source) : addGit(parsed.source)
    },

    remove(name) {
      const record = store.get(name)
      const root = managedRoot(name)
      const hasManaged = existsSync(root)
      if (!record && !hasManaged) {
        throw new TanzoNotFoundError('MARKETPLACE_NOT_FOUND', `Marketplace "${name}" is not added.`)
      }
      store.remove(name)

      if (hasManaged) {
        rmSync(root, { recursive: true, force: true })
      }
    },

    async upgrade(name) {
      const record = store.get(name)
      if (!record) {
        throw new TanzoNotFoundError('MARKETPLACE_NOT_FOUND', `Marketplace "${name}" is not added.`)
      }
      if (record.sourceType !== 'git') {
        throw new TanzoValidationError(
          'MARKETPLACE_NOT_UPGRADEABLE',
          `Marketplace "${name}" is a local source and cannot be upgraded.`
        )
      }

      const remoteRevision = await gitRemoteRevision(record.source, record.refName ?? undefined)
      const destination = managedRoot(name)
      if (remoteRevision === record.lastRevision && findMarketplacePath(destination) !== null) {
        return { name, updated: false, revision: remoteRevision }
      }

      mkdirSync(installRoot, { recursive: true })
      const stagingRoot = join(installRoot, STAGING_DIR)
      mkdirSync(stagingRoot, { recursive: true })
      const staged = mkdtempSync(join(stagingRoot, 'marketplace-upgrade-'))

      let revision: string
      try {
        revision = await cloneGitSource(
          record.source,
          record.refName ?? undefined,
          record.sparsePaths,
          staged
        )
        const clonedName = marketplaceNameAt(staged)
        if (clonedName !== name) {
          throw new TanzoValidationError(
            'MARKETPLACE_NAME_CHANGED',
            `Upgraded marketplace name "${clonedName}" does not match the registered name "${name}".`
          )
        }
      } catch (error) {
        rmSync(staged, { recursive: true, force: true })
        throw error
      }

      const backup = existsSync(destination)
        ? join(stagingRoot, `marketplace-backup-${Date.now().toString(36)}`)
        : null
      if (backup) renameSync(destination, backup)
      try {
        renameSync(staged, destination)
      } catch (error) {
        if (backup && existsSync(backup)) renameSync(backup, destination)
        rmSync(staged, { recursive: true, force: true })
        throw error
      }
      if (backup) rmSync(backup, { recursive: true, force: true })

      store.updateRevision(name, revision)
      return { name, updated: true, revision }
    },

    resolveRoots() {
      const roots: string[] = []
      for (const record of store.all().values()) {
        const root = recordRoot(record)
        if (findMarketplacePath(root)) roots.push(root)
      }
      return roots
    },

    list() {
      return [...store.all().values()].sort((a, b) => b.installedAt - a.installedAt)
    }
  }
}

function sourceMatchesRecord(source: MarketplaceSource, record: MarketplaceSourceRecord): boolean {
  if (source.kind === 'local') {
    return record.sourceType === 'local' && record.source === source.path
  }
  return (
    record.sourceType === 'git' &&
    record.source === source.url &&
    (record.refName ?? undefined) === source.refName &&
    sparsePathsEqual(record.sparsePaths, source.sparsePaths)
  )
}

function sparsePathsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
