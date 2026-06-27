import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  git: vi.fn()
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path: string) => {
    const content = io.files.get(path)
    if (content === undefined) throw new Error('missing')
    return content
  })
}))

vi.mock('node:os', () => ({
  homedir: () => '/home/user'
}))

vi.mock('node:child_process', () => ({
  execFileSync: io.git
}))

describe('agent/context/deps', () => {
  it('reads global and project Tanzo instructions, skills, git status, and model metadata', async () => {
    const { createContextEngineDeps } = await import('@main/agent/context/deps')
    io.files.clear()
    io.files.set(join('/app/agent', 'TANZO.md'), '  Use global rules.  ')
    io.files.set(join('/workspace', '.claude/CLAUDE.md'), '  Use local rules.  ')
    io.git.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('origin/HEAD')) return 'origin/main\n'
      if (args[0] === 'rev-parse') return 'feature/test\n'
      if (args[0] === 'config') return 'Ada Lovelace\n'
      if (args[0] === 'log') return 'abc1234 latest commit\n'
      return Array.from({ length: 42 }, (_value, index) => ` M file-${index}.ts`).join('\n')
    })
    const deps = createContextEngineDeps({
      userDir: '/app/agent',
      skills: {
        listEnabled: () => [
          {
            name: 'review',
            description: 'Review code',
            body: '',
            skillDir: '/skills/review',
            allowedTools: null,
            scope: 'user'
          }
        ],
        list: () => [],
        get: () => undefined
      },
      providerService: {
        getModelMetadata: vi.fn(() => ({
          contextWindow: 128000,
          maxOutput: 4096,
          vision: true
        }))
      } as never
    })

    expect(deps.clock.now()).toBeInstanceOf(Date)
    expect(deps.tanzoInstructions.read('/workspace')).toBe(
      '<global-instructions>\nUse global rules.\n</global-instructions>\n\n<project-instructions>\nUse local rules.\n</project-instructions>'
    )
    expect(deps.skillsIndex.list()).toEqual([{ name: 'review', description: 'Review code' }])
    expect(deps.gitStatus.read('/workspace')).toContain('branch: feature/test')
    expect(deps.gitStatus.read('/workspace')).toContain('main branch (usually used for PRs): main')
    expect(deps.gitStatus.read('/workspace')).toContain('git user: Ada Lovelace')
    expect(deps.gitStatus.read('/workspace')).toContain('… 2 more')
    expect(deps.gitStatus.read('/workspace')).toContain('recent commits:\nabc1234 latest commit')
    expect(deps.resolveModelMetadata('openai:gpt')).toEqual({
      contextWindow: 128000,
      maxOutput: 4096,
      vision: true
    })
  })

  it('returns null or undefined when optional context sources are unavailable', async () => {
    const { createContextEngineDeps } = await import('@main/agent/context/deps')
    io.files.clear()
    io.git.mockImplementation(() => {
      throw new Error('not git')
    })
    const deps = createContextEngineDeps({
      skills: { listEnabled: () => [], list: () => [], get: () => undefined },
      providerService: { getModelMetadata: vi.fn(() => undefined) } as never
    })

    expect(deps.tanzoInstructions.read('/missing')).toBeNull()
    expect(deps.gitStatus.read('/missing')).toBeNull()
    expect(deps.resolveModelMetadata('missing:model')).toBeUndefined()
  })
})
