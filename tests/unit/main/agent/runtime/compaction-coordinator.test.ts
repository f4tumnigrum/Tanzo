import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { createCompactionCoordinator } from '@main/agent/runtime/compaction-coordinator'

const mocks = vi.hoisted(() => ({
  runSummarizeFork: vi.fn(async () => ({
    text: 'fork summary',
    usage: { inputTokens: 1_000, outputTokens: 50 }
  }))
}))

vi.mock('@main/agent/context/compact/summarize', () => ({
  runSummarizeFork: mocks.runSummarizeFork
}))

function user(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function assistant(id: string, text: string): TanzoUIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

const DEF = {
  id: 'main',
  name: 'Main',
  description: '',
  kind: 'main',
  modelRef: 'openai:gpt-5',
  systemPrompt: 'ROLE',
  allowedTools: null
} as never

function makeDeps(stored: TanzoUIMessage[]) {
  const state = { messages: stored }
  const finalizeCompaction = vi.fn(
    (_chatId: string, _archived: string[], _summaryId: string, next: TanzoUIMessage[]) => {
      state.messages = next
    }
  )
  return {
    state,
    finalizeCompaction,
    deps: {
      providerService: {} as never,
      buildTools: vi.fn(async () => ({})),
      policy: {} as never,
      identity: {} as never,
      send: vi.fn(),
      store: {
        load: vi.fn(async () => state.messages),
        getConversation: vi.fn(() => ({ id: 'chat-1', cwd: '/tmp' })),
        resolveAgentDefinition: vi.fn(async () => DEF),
        finalizeCompaction
      } as never,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
      contextEngine: {
        compactionPolicy: vi.fn(() => ({
          compactionTriggerTokens: 100,
          retainBudgetTokens: 10,
          hardCeilingTokens: 200
        })),
        measure: vi.fn(() => ({ totalTokens: 50, source: 'reported' as const })),
        shouldCompact: vi.fn(() => false),
        snapshot: vi.fn(() => ({
          windowTokens: 1000,
          compactionTriggerTokens: 100,
          compactionTriggered: false,
          source: 'reported' as const,
          cacheKind: 'auto' as const,
          serverCompaction: false
        })),
        clear: vi.fn(),
        build: vi.fn(),
        renderInjection: vi.fn(),
        capabilitiesFor: vi.fn(),
        observeStep: vi.fn()
      } as never
    }
  }
}

describe('runtime/compaction-coordinator reconcileInline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never archives messages produced after the in-stream cut (domain coherence)', async () => {
    // Run started from [u1, a1, u2]; the in-stream compaction summarized that
    // base. The run then produced a2/u3 which the summary does NOT cover.
    const base = [
      user('u1', 'x'.repeat(400)),
      assistant('a1', 'y'.repeat(400)),
      user('u2', 'z'.repeat(40))
    ]
    const grownAfterRun = [assistant('a2', 'post-compaction work'), user('u3', 'follow-up')]
    const { deps, finalizeCompaction } = makeDeps([...base, ...grownAfterRun])
    const coordinator = createCompactionCoordinator(deps as never)

    const compacted = await coordinator.reconcileInline('chat-1', DEF, {
      summaryText: 'covers u1/a1 only',
      baseMessageIds: ['u1', 'a1']
    })

    expect(compacted).toBe(true)
    const [, archivedIds, , next] = finalizeCompaction.mock.calls[0] as unknown as [
      string,
      string[],
      string,
      TanzoUIMessage[]
    ]
    // Nothing from the post-run growth is archived.
    expect(archivedIds).not.toContain('a2')
    expect(archivedIds).not.toContain('u3')
    // The grown messages survive in the next transcript, after the summary.
    const nextIds = next.map((message) => message.id)
    expect(nextIds).toContain('a2')
    expect(nextIds).toContain('u3')
    expect(nextIds).toContain('u2')
    // Summary leads the next transcript.
    expect(next[0].parts.some((part) => part.type === 'data-compaction')).toBe(true)
    expect(finalizeCompaction).toHaveBeenCalledWith(
      'chat-1',
      ['u1', 'a1'],
      expect.any(String),
      expect.any(Array),
      [...base, ...grownAfterRun],
      base.slice(0, 2)
    )
  })

  it('reconciles nothing when inline compaction covered no complete UI message', async () => {
    const base = [user('u1', 'small')]
    const { deps, finalizeCompaction } = makeDeps([...base, assistant('a2', 'grown')])
    const coordinator = createCompactionCoordinator(deps as never)

    const compacted = await coordinator.reconcileInline('chat-1', DEF, {
      summaryText: 'sum',
      baseMessageIds: []
    })

    expect(compacted).toBe(false)
    expect(finalizeCompaction).not.toHaveBeenCalled()
  })

  it('rejects coverage ids that are not the exact persisted prefix', async () => {
    const base = [user('u1', 'old'), user('u2', 'recent'), assistant('a1', 'done')]
    const { deps, finalizeCompaction } = makeDeps(base)
    const coordinator = createCompactionCoordinator(deps as never)

    const compacted = await coordinator.reconcileInline('chat-1', DEF, {
      summaryText: 'sum',
      baseMessageIds: ['u2']
    })

    expect(compacted).toBe(false)
    expect(finalizeCompaction).not.toHaveBeenCalled()
  })

  it('measures the compacted transcript without stale pre-compaction usage anchors', async () => {
    const recent = {
      ...assistant('a1', 'recent'),
      metadata: {
        steps: [
          {
            stepNumber: 1,
            usage: { inputTokens: 10_000, outputTokens: 100 },
            finishReason: 'stop',
            providerMetadata: null
          }
        ]
      }
    } as TanzoUIMessage
    const { deps } = makeDeps([user('u1', 'old'), recent])
    const coordinator = createCompactionCoordinator(deps as never)

    await coordinator.reconcileInline('chat-1', DEF, {
      summaryText: 'sum',
      baseMessageIds: ['u1']
    })

    const measured = (deps.contextEngine.measure as ReturnType<typeof vi.fn>).mock.calls[0][2] as
      TanzoUIMessage[] | undefined
    expect(measured?.[1].metadata?.steps?.[0]?.usage).toBeNull()
    expect(recent.metadata?.steps?.[0]?.usage).toEqual({ inputTokens: 10_000, outputTokens: 100 })
  })
})
