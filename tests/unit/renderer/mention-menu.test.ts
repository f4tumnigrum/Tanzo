import { describe, expect, it } from 'vitest'
import {
  buildMentionInsertion,
  getMentionContext,
  matchPlugins,
  type MentionItem
} from '@renderer/features/chat/ui/compose/use-mention-menu'

describe('chat/use-mention-menu/matchPlugins', () => {
  const plugins = [
    { name: 'sales', description: 'sell' },
    { name: 'data-analytics' },
    { name: 'sales-ops' }
  ]

  it('returns all plugins for an empty query (every name "starts with" "")', () => {
    expect(matchPlugins(plugins, '').map((p) => p.name)).toEqual([
      'data-analytics',
      'sales',
      'sales-ops'
    ])
  })

  it('ranks prefix matches before substring matches', () => {
    // "ops" is a substring of sales-ops; nothing prefixes with it.
    expect(matchPlugins(plugins, 'ops').map((p) => p.name)).toEqual(['sales-ops'])
  })

  it('prefers a prefix hit over a substring hit', () => {
    const set = [{ name: 'analytics' }, { name: 'data-analytics' }]
    // query "anal": "analytics" is a prefix match, "data-analytics" a substring.
    expect(matchPlugins(set, 'anal').map((p) => p.name)).toEqual(['analytics', 'data-analytics'])
  })

  it('is case-insensitive and carries the description through', () => {
    const out = matchPlugins(plugins, 'SAL')
    expect(out[0]).toEqual({ kind: 'plugin', name: 'sales', description: 'sell' })
  })

  it('returns nothing when no name matches', () => {
    expect(matchPlugins(plugins, 'zzz')).toEqual([])
  })
})

describe('chat/use-mention-menu/buildMentionInsertion', () => {
  it('keeps the @ for a plugin and adds a trailing space', () => {
    const item: MentionItem = { kind: 'plugin', name: 'sales' }
    expect(buildMentionInsertion(item)).toEqual({ text: '@sales', trailing: ' ' })
  })

  it('keeps the @ and trailing slash for a directory, no separator', () => {
    const item: MentionItem = { kind: 'file', type: 'directory', path: 'src/app', name: 'app' }
    expect(buildMentionInsertion(item)).toEqual({ text: '@src/app/', trailing: '' })
  })

  it('drops the @ for a file and resolves to a bare path', () => {
    const item: MentionItem = { kind: 'file', type: 'file', path: 'src/main.ts', name: 'main.ts' }
    expect(buildMentionInsertion(item)).toEqual({ text: 'src/main.ts', trailing: ' ' })
  })

  it('quotes a file path that contains whitespace', () => {
    const item: MentionItem = { kind: 'file', type: 'file', path: 'my docs/a.md', name: 'a.md' }
    expect(buildMentionInsertion(item)).toEqual({ text: '"my docs/a.md"', trailing: ' ' })
  })
})

describe('chat/use-mention-menu/getMentionContext', () => {
  it('detects an @ token at the cursor', () => {
    expect(getMentionContext('@sal', 4)).toEqual({ query: 'sal', start: 0, end: 4 })
  })

  it('detects an @ token mid-message after whitespace', () => {
    expect(getMentionContext('hi @sal', 7)).toEqual({ query: 'sal', start: 3, end: 7 })
  })

  it('does not trigger on an @ embedded in a word (email)', () => {
    expect(getMentionContext('bob@x', 5)).toBeNull()
  })
})
