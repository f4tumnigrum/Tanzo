import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SLASH_COMMANDS,
  expandTemplate,
  isSlashCommandAvailable,
  isSlashCommandOnSurface,
  parseSlashInput,
  resolveSlashInvocation,
  slashCommandAvailability,
  slashCommandSurfaces,
  surfaceSlashCommands,
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

describe('shared/slash-command surfaces', () => {
  it('builtin/agent commands default to desktop-only', () => {
    const agent: SlashCommandDef = { name: 'agent', kind: 'action', source: 'agent' }
    expect(slashCommandSurfaces(agent)).toEqual(['desktop'])
    expect(isSlashCommandOnSurface(agent, 'desktop')).toBe(true)
    expect(isSlashCommandOnSurface(agent, 'channel')).toBe(false)
  })

  it('file commands and skills are available on all surfaces', () => {
    const fileCmd: SlashCommandDef = {
      name: 'plan',
      kind: 'prompt',
      source: 'command',
      template: 'x'
    }
    const skill: SlashCommandDef = { name: 'x', kind: 'skill', source: 'skill', skillName: 'x' }
    expect(slashCommandSurfaces(fileCmd)).toEqual(['desktop', 'channel'])
    expect(isSlashCommandOnSurface(skill, 'channel')).toBe(true)
  })

  it('explicit surfaces override the defaults', () => {
    const goal = BUILTIN_SLASH_COMMANDS.find((c) => c.name === 'goal')!
    expect(slashCommandSurfaces(goal)).toEqual(['desktop', 'channel'])
    const agent = BUILTIN_SLASH_COMMANDS.find((c) => c.name === 'agent')!
    expect(isSlashCommandOnSurface(agent, 'channel')).toBe(false)
    const status = BUILTIN_SLASH_COMMANDS.find((c) => c.name === 'status')!
    expect(slashCommandSurfaces(status)).toEqual(['channel'])
    expect(isSlashCommandOnSurface(status, 'desktop')).toBe(false)
  })
})

describe('shared/slash-command surfaceSlashCommands', () => {
  const fileCmd: SlashCommandDef = {
    name: 'plan',
    kind: 'prompt',
    source: 'command',
    template: 'x'
  }

  it('includes channel-enabled builtins plus dynamic commands on the channel surface', () => {
    const names = surfaceSlashCommands('channel', [fileCmd]).map((c) => c.name)
    expect(names).toContain('compact') // builtin opted into channel
    expect(names).toContain('goal') // builtin opted into channel
    expect(names).toContain('status') // channel-only builtin
    expect(names).toContain('clear') // channel-only builtin
    expect(names).toContain('rename') // channel-only builtin
    expect(names).toContain('workspace') // channel-only builtin
    expect(names).toContain('plan') // dynamic file command
    expect(names).not.toContain('agent') // desktop-only builtin
  })

  it('excludes channel-only builtins from the desktop surface', () => {
    const names = surfaceSlashCommands('desktop', []).map((c) => c.name)
    expect(names).toContain('compact')
    expect(names).toContain('goal')
    expect(names).toContain('agent')
    expect(names).not.toContain('status')
    expect(names).not.toContain('approve')
    expect(names).not.toContain('clear')
    expect(names).not.toContain('rename')
    expect(names).not.toContain('workspace')
    expect(names).not.toContain('help')
  })

  it('lets dynamic commands override a builtin of the same name', () => {
    const override: SlashCommandDef = {
      name: 'compact',
      kind: 'prompt',
      source: 'command',
      template: 'custom'
    }
    const compacts = surfaceSlashCommands('channel', [override]).filter((c) => c.name === 'compact')
    expect(compacts).toHaveLength(1)
    expect(compacts[0].source).toBe('command')
  })
})

describe('shared/slash-command resolveSlashInvocation', () => {
  const commands: SlashCommandDef[] = [
    { name: 'compact', kind: 'action', source: 'builtin' },
    { name: 'plan', kind: 'prompt', source: 'command', template: 'Plan: $ARGUMENTS' },
    { name: 'brainstorm', kind: 'skill', source: 'skill', skillName: 'brainstorm' }
  ]

  it('passes through non-slash text', () => {
    expect(resolveSlashInvocation('hello world', commands)).toEqual({
      type: 'passthrough',
      text: 'hello world'
    })
  })

  it('reports unknown slash commands', () => {
    expect(resolveSlashInvocation('/nope arg', commands)).toEqual({ type: 'unknown', name: 'nope' })
  })

  it('resolves actions with their args', () => {
    const result = resolveSlashInvocation('/compact', commands)
    expect(result).toEqual({ type: 'action', command: commands[0], args: '' })
  })

  it('expands prompt templates', () => {
    const result = resolveSlashInvocation('/plan ship it', commands)
    expect(result).toEqual({ type: 'prompt', command: commands[1], text: 'Plan: ship it' })
  })

  it('builds skill instruction text', () => {
    const result = resolveSlashInvocation('/brainstorm ideas', commands)
    expect(result).toEqual({
      type: 'skill',
      command: commands[2],
      text: 'Use the brainstorm skill. ideas'
    })
  })
})
