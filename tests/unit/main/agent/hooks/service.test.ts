import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHookExecutor } from '@main/agent/hooks/executor'
import { createHookService } from '@main/agent/hooks/service'
import type { HooksStore } from '@main/agent/hooks/store'
import type { HookState } from '@main/agent/hooks/types'

const roots: string[] = []
const isWindows = process.platform === 'win32'

function projectWithHooks(config: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'tanzo-hooks-svc-'))
  roots.push(root)
  mkdirSync(join(root, '.tanzo'), { recursive: true })
  writeFileSync(join(root, '.tanzo', 'hooks.json'), JSON.stringify(config), 'utf8')
  return root
}

function trustingStore(entries: () => { key: string; contentHash: string }[]): HooksStore {
  const states = new Map<string, HookState>()
  return {
    getState(key) {
      if (states.has(key)) return states.get(key)
      const entry = entries().find((candidate) => candidate.key === key)
      return entry ? { enabled: true, trustedHash: entry.contentHash } : undefined
    },
    setState(key, state) {
      states.set(key, state)
    },
    listStates() {
      return new Map(states)
    }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(isWindows)('main/agent/hooks/service (e2e via real subprocess)', () => {
  function makeService(cwd: string) {
    const captured: { entries: { key: string; contentHash: string }[] } = { entries: [] }
    const service = createHookService({
      executor: createHookExecutor(),
      store: trustingStore(() => captured.entries),
      sessionMeta: () => ({ cwd, model: 'test-model', mode: 'default' })
    })
    captured.entries = service.reload(cwd).map((entry) => ({
      key: entry.key,
      contentHash: entry.contentHash
    }))
    return service
  }

  it('blocks a tool call when a PreToolUse hook denies via exit code 2', async () => {
    const cwd = projectWithHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: '^Bash$',
            hooks: [{ type: 'command', command: 'echo "blocked by policy" 1>&2; exit 2' }]
          }
        ]
      }
    })
    const service = makeService(cwd)
    const outcome = await service.runPreToolUse({
      chatId: 'chat-1',
      toolName: 'shell',
      toolInput: { command: 'rm -rf /' },
      toolUseId: 'u1'
    })
    expect(outcome.denied).toBe(true)
    expect(outcome.denyReason).toBe('blocked by policy')
  })

  it('allows a tool call when the matcher does not match', async () => {
    const cwd = projectWithHooks({
      hooks: {
        PreToolUse: [{ matcher: '^Edit$', hooks: [{ type: 'command', command: 'exit 2' }] }]
      }
    })
    const service = makeService(cwd)
    const outcome = await service.runPreToolUse({
      chatId: 'chat-1',
      toolName: 'shell',
      toolInput: {},
      toolUseId: 'u1'
    })
    expect(outcome.denied).toBe(false)
  })

  it('parks SessionStart additionalContext into the pending buffer', async () => {
    const cwd = projectWithHooks({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo "remember: be careful"' }] }]
      }
    })
    const service = makeService(cwd)
    await service.runSessionStart({ chatId: 'chat-1', source: 'startup' })
    expect(service.takePendingContext('chat-1')).toEqual(['remember: be careful'])
  })

  it('clears pending hook context when transient chat state is discarded', () => {
    const service = makeService(projectWithHooks({ hooks: {} }))
    service.pendingContext.push('chat-1', 'stale hook output')

    service.clearPendingContext('chat-1')

    expect(service.takePendingContext('chat-1')).toEqual([])
  })

  it('does not run an untrusted hook', async () => {
    const cwd = projectWithHooks({
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit 2' }] }]
      }
    })
    const service = createHookService({
      executor: createHookExecutor(),
      store: {
        getState: () => undefined,
        setState: () => {},
        listStates: () => new Map()
      },
      sessionMeta: () => ({ cwd, model: 'm', mode: 'default' })
    })
    service.reload(cwd)
    const outcome = await service.runPreToolUse({
      chatId: 'chat-1',
      toolName: 'shell',
      toolInput: {},
      toolUseId: 'u1'
    })
    expect(outcome.denied).toBe(false)
  })
})

describe('main/agent/hooks/service preview trust gate', () => {
  it('does not preview an untrusted hook', async () => {
    const cwd = projectWithHooks({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo preview' }] }]
      }
    })
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false
    }))
    const service = createHookService({
      executor: { run },
      store: {
        getState: () => undefined,
        setState: () => {},
        listStates: () => new Map()
      },
      sessionMeta: () => ({ cwd, model: 'm', mode: 'default' })
    })
    const [entry] = service.reload(cwd)

    const preview = await service.preview(entry.key)

    expect(preview.error).toBe('hook must be enabled and trusted before preview')
    expect(run).not.toHaveBeenCalled()
  })
})
