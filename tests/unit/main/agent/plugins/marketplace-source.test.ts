import { describe, expect, it } from 'vitest'
import {
  marketplaceSourceDisplay,
  parseMarketplaceSource
} from '@main/agent/plugins/marketplace-source'

function parseOk(source: string, options?: Parameters<typeof parseMarketplaceSource>[1]) {
  const result = parseMarketplaceSource(source, options)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.source
}

describe('main/agent/plugins/marketplace-source', () => {
  it('rejects an empty source', () => {
    const result = parseMarketplaceSource('   ')
    expect(result).toEqual({ ok: false, error: 'marketplace source must not be empty' })
  })

  it('parses a github shorthand with an @ref suffix', () => {
    expect(parseOk('owner/repo@main')).toEqual({
      kind: 'git',
      url: 'https://github.com/owner/repo.git',
      refName: 'main',
      sparsePaths: []
    })
  })

  it('parses a git url with a #ref fragment', () => {
    expect(parseOk('https://example.com/team/repo.git#v1')).toEqual({
      kind: 'git',
      url: 'https://example.com/team/repo.git',
      refName: 'v1',
      sparsePaths: []
    })
  })

  it('lets an explicit ref override a parsed ref', () => {
    expect(parseOk('owner/repo@main', { refName: 'release' })).toEqual({
      kind: 'git',
      url: 'https://github.com/owner/repo.git',
      refName: 'release',
      sparsePaths: []
    })
  })

  it('normalizes a github shorthand and full url to the same source', () => {
    const shorthand = parseOk('owner/repo')
    const url = parseOk('https://github.com/owner/repo.git')
    expect(shorthand).toEqual(url)
    expect(shorthand).toEqual({
      kind: 'git',
      url: 'https://github.com/owner/repo.git',
      sparsePaths: []
    })
  })

  it('strips a trailing slash from a github url without adding a path segment', () => {
    expect(parseOk('https://github.com/owner/repo/')).toEqual({
      kind: 'git',
      url: 'https://github.com/owner/repo.git',
      sparsePaths: []
    })
  })

  it('keeps a non-github https url as-is', () => {
    expect(parseOk('https://gitlab.com/owner/repo')).toEqual({
      kind: 'git',
      url: 'https://gitlab.com/owner/repo',
      sparsePaths: []
    })
  })

  it('parses an ssh url with a #ref fragment', () => {
    expect(parseOk('ssh://git@github.com/owner/repo.git#main')).toEqual({
      kind: 'git',
      url: 'ssh://git@github.com/owner/repo.git',
      refName: 'main',
      sparsePaths: []
    })
  })

  it('carries sparse paths onto git sources', () => {
    expect(parseOk('owner/repo', { sparsePaths: ['plugins/foo', ' ', 'plugins/bar'] })).toEqual({
      kind: 'git',
      url: 'https://github.com/owner/repo.git',
      sparsePaths: ['plugins/foo', 'plugins/bar']
    })
  })

  it('rejects a file:// url', () => {
    const result = parseMarketplaceSource('file:///tmp/marketplace.git')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('invalid marketplace source format')
  })

  it('parses a relative local path to an absolute directory', () => {
    const source = parseOk('./local-market')
    expect(source.kind).toBe('local')
    if (source.kind === 'local') expect(source.path.startsWith('/')).toBe(true)
  })

  it('treats `.` as a local path', () => {
    const source = parseOk('.')
    expect(source.kind).toBe('local')
  })

  it('treats windows absolute paths as local on every host', () => {
    expect(parseOk('C:\\Users\\alice\\marketplace').kind).toBe('local')
    expect(parseOk('C:/Users/alice/marketplace').kind).toBe('local')
    expect(parseOk('\\\\server\\share\\marketplace').kind).toBe('local')
  })

  it('rejects a --ref on a local source', () => {
    const result = parseMarketplaceSource('./marketplace', { refName: 'main' })
    expect(result).toEqual({
      ok: false,
      error: '--ref is only supported for git marketplace sources'
    })
  })

  it('rejects sparse paths on a local source', () => {
    const result = parseMarketplaceSource('./marketplace', { sparsePaths: ['plugins/foo'] })
    expect(result).toEqual({
      ok: false,
      error: '--sparse is only supported for git marketplace sources'
    })
  })

  it('renders a display string for git and local sources', () => {
    expect(
      marketplaceSourceDisplay({
        kind: 'git',
        url: 'https://github.com/owner/repo.git',
        refName: 'main',
        sparsePaths: []
      })
    ).toBe('https://github.com/owner/repo.git#main')
    expect(marketplaceSourceDisplay({ kind: 'local', path: '/tmp/market' })).toBe('/tmp/market')
  })
})
