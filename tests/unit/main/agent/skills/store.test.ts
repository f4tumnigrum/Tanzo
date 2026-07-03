import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSkillsStore } from '@main/agent/skills/store'

let roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tanzo-skills-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

describe('main/agent/skills/store', () => {
  it('loads skills from user and workspace roots, replacing by name', async () => {
    const workspaceRoot = await tempRoot()
    const userDir = await tempRoot()
    const userSkill = join(userDir, 'skills', 'unit-test-skill')
    const workspaceSkill = join(workspaceRoot, '.claude', 'skills', 'unit-test-skill')
    await mkdir(userSkill, { recursive: true })
    await mkdir(workspaceSkill, { recursive: true })
    await writeFile(
      join(userSkill, 'SKILL.md'),
      `---
name: unit-test-skill
description: User skill
allowed-tools: fileRead grep
metadata:
  owner: user
---
User body
`
    )
    await writeFile(
      join(workspaceSkill, 'SKILL.md'),
      `---
name: unit-test-skill
description: Workspace skill
model: openai:gpt-5
license: MIT
compatibility: Tanzo
allowed-tools:
  - shell
---
Workspace body
`
    )
    const logger = { warn: vi.fn() }

    const store = createSkillsStore({ workspaceRoot, userDir, logger: logger as never })
    expect(store.get('unit-test-skill')).toMatchObject({
      name: 'unit-test-skill',
      description: 'Workspace skill',
      body: 'Workspace body',
      allowedTools: ['shell'],
      modelRef: 'openai:gpt-5',
      license: 'MIT',
      compatibility: 'Tanzo'
    })
  })

  it('skips invalid skills and logs load warnings', async () => {
    const workspaceRoot = await tempRoot()
    const userDir = await tempRoot()
    const missingDescription = join(workspaceRoot, '.claude', 'skills', 'bad-skill')
    const mismatchedName = join(workspaceRoot, '.claude', 'skills', 'dir-name')
    await mkdir(missingDescription, { recursive: true })
    await mkdir(mismatchedName, { recursive: true })
    await writeFile(join(missingDescription, 'SKILL.md'), '---\nname: bad-skill\n---\nBody')
    await writeFile(
      join(mismatchedName, 'SKILL.md'),
      '---\nname: other-name\ndescription: Desc\n---\nBody'
    )
    const logger = { warn: vi.fn() }

    const store = createSkillsStore({ workspaceRoot, userDir, logger: logger as never })

    expect(store.get('bad-skill')).toBeUndefined()
    expect(store.get('other-name')).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing name or description'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match directory'))
  })

  it('hides the built-in browser skill when browser automation is disabled', async () => {
    const workspaceRoot = await tempRoot()
    const userDir = await tempRoot()
    const logger = { warn: vi.fn() }
    let enabled = true

    const store = createSkillsStore({
      workspaceRoot,
      userDir,
      logger: logger as never,
      browserAutomationEnabled: () => enabled
    })

    expect(store.listEnabled().map((skill) => skill.name)).toContain('browser')
    enabled = false
    expect(store.listEnabled().map((skill) => skill.name)).not.toContain('browser')
    // The skill still exists (settings can list it); only availability changes.
    expect(store.get('browser')).toBeDefined()
  })
})
