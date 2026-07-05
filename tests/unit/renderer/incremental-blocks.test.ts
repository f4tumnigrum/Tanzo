import { describe, expect, it } from 'vitest'
import {
  createIncrementalSplitter,
  findFreezeBoundary,
  normalizeMathDelimiters,
  splitSegments
} from '@renderer/features/chat/ui/message/incremental-blocks'

describe('message/incremental-blocks findFreezeBoundary', () => {
  it('freezes at the last blank-line boundary', () => {
    const text = 'first paragraph\n\nsecond paragraph\n\nthird still streaming'
    const boundary = findFreezeBoundary(text)
    expect(text.slice(0, boundary)).toBe('first paragraph\n\nsecond paragraph\n\n')
    expect(text.slice(boundary)).toBe('third still streaming')
  })

  it('returns 0 when no boundary exists', () => {
    expect(findFreezeBoundary('single paragraph still streaming')).toBe(0)
  })

  it('does not freeze inside an open code fence', () => {
    const text = 'intro\n\n```ts\nconst a = 1\n\nconst b = 2\n'
    const boundary = findFreezeBoundary(text)
    expect(text.slice(0, boundary)).toBe('intro\n\n')
  })

  it('freezes past a closed code fence', () => {
    const text = 'intro\n\n```ts\ncode\n```\n\nafter fence streaming'
    const boundary = findFreezeBoundary(text)
    expect(text.slice(0, boundary)).toBe('intro\n\n```ts\ncode\n```\n\n')
  })

  it('does not freeze inside an unclosed recognized xml tag', () => {
    const text = 'intro\n\n<thinking>\nsome reasoning\n\nmore reasoning'
    const boundary = findFreezeBoundary(text)
    expect(text.slice(0, boundary)).toBe('intro\n\n')
  })

  it('does not freeze while $$ math is unbalanced', () => {
    const text = 'intro\n\n$$\nE = mc^2\n\nstill math'
    const boundary = findFreezeBoundary(text)
    expect(text.slice(0, boundary)).toBe('intro\n\n')
  })
})

describe('message/incremental-blocks splitter', () => {
  it('freezes segments append-only with stable identities', () => {
    const splitter = createIncrementalSplitter()

    const first = splitter.update('para one\n\npara two streaming')
    expect(first.frozen.map((s) => (s.kind === 'md' ? s.content : ''))).toEqual(['para one'])
    expect(first.tail).toBe('para two streaming')
    const frozenRef = first.frozen[0]

    const second = splitter.update('para one\n\npara two done\n\npara three streaming')
    expect(second.frozen[0]).toBe(frozenRef)
    expect(second.frozen.map((s) => (s.kind === 'md' ? s.content : ''))).toEqual([
      'para one',
      'para two done'
    ])
    expect(second.tail).toBe('para three streaming')
  })

  it('resets when content is not an append of the frozen prefix', () => {
    const splitter = createIncrementalSplitter()
    splitter.update('alpha\n\nbeta streaming')
    const replaced = splitter.update('completely different')
    expect(replaced.frozen).toEqual([])
    expect(replaced.tail).toBe('completely different')
  })

  it('extracts recognized xml tags as segments', () => {
    const segments = splitSegments('before\n\n<thinking>inner</thinking>\n\nafter')
    expect(segments).toMatchObject([
      { kind: 'md', content: 'before' },
      { kind: 'xml', tag: 'thinking', body: 'inner' },
      { kind: 'md', content: 'after' }
    ])
  })

  it('keeps fenced code as a single segment', () => {
    const segments = splitSegments('```ts\nconst a = 1\n\nconst b = 2\n```')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ kind: 'md' })
  })
})

describe('message/incremental-blocks normalizeMathDelimiters', () => {
  it('converts LaTeX display delimiters to $$', () => {
    expect(normalizeMathDelimiters('\\[ x^2 \\]')).toContain('$$')
  })

  it('converts inline \\( \\) to $', () => {
    expect(normalizeMathDelimiters('a \\(x+1\\) b')).toBe('a $x+1$ b')
  })

  it('leaves fenced code untouched', () => {
    const code = '```\n\\[ raw \\]\n```'
    expect(normalizeMathDelimiters(code)).toBe(code)
  })

  it('promotes standalone bracketed math lines', () => {
    const result = normalizeMathDelimiters('[ E = mc^2 ]')
    expect(result).toContain('$$')
  })

  it('ignores plain bracketed text', () => {
    expect(normalizeMathDelimiters('[ not math ]')).toBe('[ not math ]')
  })
})
