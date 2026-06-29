/**
 * Parse a marketplace *source* string into a typed source.
 *
 * Wire-compatible with Codex (`codex-rs/core-plugins/src/marketplace_add/source.rs`):
 * - Local paths (`./`, `../`, `~/`, absolute, Windows drive/UNC, `.`/`..`) become
 *   `local` sources resolved to an absolute directory.
 * - SSH (`ssh://`, `git@host:...`) and `http(s)://` URLs become `git` sources.
 * - A bare `owner/repo` GitHub shorthand expands to `https://github.com/owner/repo.git`.
 * - A `#ref` suffix (any source) or `@ref` suffix (non-URL sources) selects a
 *   branch/tag/SHA; an explicit ref overrides a parsed one.
 *
 * Unlike Codex's CLI parser this returns a discriminated result rather than
 * throwing, matching `marketplace.ts`'s parse-and-skip style. Filesystem
 * existence is *not* checked here — the add orchestrator validates that.
 */

import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

export interface GitMarketplaceSource {
  kind: 'git'
  url: string
  refName?: string
  sparsePaths: string[]
}

export interface LocalMarketplaceSource {
  kind: 'local'
  /** Absolute path to the local marketplace directory. */
  path: string
}

export type MarketplaceSource = GitMarketplaceSource | LocalMarketplaceSource

export type ParseMarketplaceSourceResult =
  | { ok: true; source: MarketplaceSource }
  | { ok: false; error: string }

export interface ParseMarketplaceSourceOptions {
  /** Explicit `--ref`, overriding any ref parsed from the source string. */
  refName?: string
  /** Sparse-checkout paths; only valid for git sources. */
  sparsePaths?: string[]
}

/**
 * Parse a user-supplied marketplace source plus optional ref/sparse options.
 */
export function parseMarketplaceSource(
  rawSource: string,
  options: ParseMarketplaceSourceOptions = {}
): ParseMarketplaceSourceResult {
  const source = rawSource.trim()
  if (source.length === 0) {
    return { ok: false, error: 'marketplace source must not be empty' }
  }

  const sparsePaths = (options.sparsePaths ?? []).map((path) => path.trim()).filter(Boolean)
  const [baseSource, parsedRef] = splitSourceRef(source)
  const refName = options.refName?.trim() || parsedRef

  if (looksLikeLocalPath(baseSource)) {
    if (refName) {
      return { ok: false, error: '--ref is only supported for git marketplace sources' }
    }
    if (sparsePaths.length > 0) {
      return { ok: false, error: '--sparse is only supported for git marketplace sources' }
    }
    return { ok: true, source: { kind: 'local', path: resolveLocalSourcePath(baseSource) } }
  }

  if (isSshGitUrl(baseSource) || isHttpGitUrl(baseSource)) {
    return {
      ok: true,
      source: {
        kind: 'git',
        url: normalizeGitUrl(baseSource),
        ...(refName ? { refName } : {}),
        sparsePaths
      }
    }
  }

  if (looksLikeGithubShorthand(baseSource)) {
    return {
      ok: true,
      source: {
        kind: 'git',
        url: `https://github.com/${baseSource}.git`,
        ...(refName ? { refName } : {}),
        sparsePaths
      }
    }
  }

  return {
    ok: false,
    error:
      'invalid marketplace source format; expected owner/repo, a git URL, or a local marketplace path'
  }
}

/** Render a source back to a display string (`url#ref`, or the local path). */
export function marketplaceSourceDisplay(source: MarketplaceSource): string {
  if (source.kind === 'local') return source.path
  return source.refName ? `${source.url}#${source.refName}` : source.url
}

function splitSourceRef(source: string): [string, string | undefined] {
  const hash = source.lastIndexOf('#')
  if (hash !== -1) {
    return [source.slice(0, hash), nonEmptyRef(source.slice(hash + 1))]
  }
  if (!source.includes('://') && !isSshGitUrl(source)) {
    const at = source.lastIndexOf('@')
    if (at !== -1) {
      return [source.slice(0, at), nonEmptyRef(source.slice(at + 1))]
    }
  }
  return [source, undefined]
}

function nonEmptyRef(ref: string): string | undefined {
  const trimmed = ref.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeGitUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.startsWith('https://github.com/') && !trimmed.endsWith('.git')) {
    return `${trimmed}.git`
  }
  return trimmed
}

function looksLikeLocalPath(source: string): boolean {
  return (
    isAbsolute(source) ||
    looksLikeWindowsAbsolutePath(source) ||
    source.startsWith('./') ||
    source.startsWith('.\\') ||
    source.startsWith('../') ||
    source.startsWith('..\\') ||
    source.startsWith('~/') ||
    source === '.' ||
    source === '..'
  )
}

function looksLikeWindowsAbsolutePath(source: string): boolean {
  if (source.startsWith('\\\\')) return true
  if (source.length < 3) return false
  const drive = source.charCodeAt(0)
  const isAlpha = (drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122)
  return isAlpha && source[1] === ':' && (source[2] === '\\' || source[2] === '/')
}

function resolveLocalSourcePath(source: string): string {
  const expanded = expandTilde(source)
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
}

function expandTilde(source: string): string {
  if (!source.startsWith('~/')) return source
  const home = homedir()
  return home ? resolve(home, source.slice(2)) : source
}

function isSshGitUrl(source: string): boolean {
  return source.startsWith('ssh://') || (source.startsWith('git@') && source.includes(':'))
}

function isHttpGitUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

function looksLikeGithubShorthand(source: string): boolean {
  const segments = source.split('/')
  if (segments.length !== 2) return false
  return segments.every(isGithubShorthandSegment)
}

function isGithubShorthandSegment(segment: string): boolean {
  return segment.length > 0 && /^[A-Za-z0-9._-]+$/.test(segment)
}
