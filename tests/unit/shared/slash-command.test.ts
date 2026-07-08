import { describe, expect, it } from 'vitest'
import {
  expandTemplate,
  isSlashCommandAvailable,
  parseSlashInput,
  slashCommandAvailability,
  type SlashCommandDef
} from '@shared/slash-command'

describe('shared/slash-command parseSlashInput', () => {
  it('parses a bare command', () => {
    expect(parseSlashInput('/compact')).toEqual({ name: 'compact', args: '' })
  })

  it('parses a command with inline args', () => {
    expect(parseSlashInput('/review src/foo')).toEqual({ name: 'review', args: 'src/foo' })
  })

  it('keeps remaining whitespace-separated args verbatim', () => {
    expect(parseSlashInput('/review  a   b')).toEqual({ name: 'review', args: 'a   b' })
  })

  it('joins trailing lines into args', () => {
    expect(parseSlashInput('/review foo\nbar')).toEqual({ name: 'review', args: 'foo\nbar' })
  })

  it('returns null for a lone slash', () => {
    expect(parseSlashInput('/')).toBeNull()
  })

  it('returns null for non-slash text', () => {
    expect(parseSlashInput('hello /world')).toBeNull()
  })

  it('returns null when the first line is not a valid command', () => {
    expect(parseSlashInput('/Review')).toBeNull()
    expect(parseSlashInput('/-bad')).toBeNull()
  })
})

describe('shared/slash-command expandTemplate', () => {
  it('replaces $ARGUMENTS with the full args string', () => {
    expect(expandTemplate('Review this: $ARGUMENTS', 'src/foo.ts')).toBe('Review this: src/foo.ts')
  })

  it('replaces positional $1 $2 by whitespace split', () => {
    expect(expandTemplate('diff $1 against $2', 'main feature')).toBe('diff main against feature')
  })

  it('substitutes missing positionals with empty string', () => {
    expect(expandTemplate('only $1 and $2', 'solo')).toBe('only solo and ')
  })

  it('leaves template untouched when no placeholders present', () => {
    expect(expandTemplate('static prompt', 'ignored')).toBe('static prompt')
  })
})

describe('shared/slash-command availability', () => {
  const idle: SlashCommandDef = { name: 'compact', kind: 'action', source: 'builtin' }
  const always: SlashCommandDef = {
    name: 'goal',
    kind: 'action',
    source: 'builtin',
    availability: 'always'
  }

  it('defaults to idle when unspecified', () => {
    expect(slashCommandAvailability(idle)).toBe('idle')
    expect(slashCommandAvailability(always)).toBe('always')
  })

  it('idle commands are available only when not streaming', () => {
    expect(isSlashCommandAvailable(idle, false)).toBe(true)
    expect(isSlashCommandAvailable(idle, true)).toBe(false)
  })

  it('always commands stay available while streaming', () => {
    expect(isSlashCommandAvailable(always, true)).toBe(true)
    expect(isSlashCommandAvailable(always, false)).toBe(true)
  })
})
