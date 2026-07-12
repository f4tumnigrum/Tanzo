import { describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { createChatRunPersistenceRegistry } from '@main/agent/runtime/run-persistence-registry'

const baseMessages: TanzoUIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }]
  }
]

function startPersistence(input?: { canPersist?: () => boolean; canPersistFinal?: () => boolean }) {
  const storeUser: TanzoUIMessage = {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'from store' }]
  }
  let stored: TanzoUIMessage[] = [storeUser]
  const saved: TanzoUIMessage[][] = []
  const registry = createChatRunPersistenceRegistry()
  const send = vi.fn()
  const contextEngine = {
    observeStep: vi.fn(),
    snapshot: vi.fn(() => ({ usedTokens: 1 }))
  }

  registry.start('chat-1', 'run-1', baseMessages, {
    def: {} as never,
    broadcast: false,
    canPersist: input?.canPersist ?? (() => true),
    ...(input?.canPersistFinal ? { canPersistFinal: input.canPersistFinal } : {}),
    store: {
      loadUnvalidated: () => structuredClone(stored),
      save: (_chatId, messages) => {
        stored = structuredClone(messages)
        saved.push(structuredClone(messages))
      }
    },
    send,
    contextEngine
  })

  return { registry, storeUser, saved, send, contextEngine }
}

describe('agent/runtime/run-persistence-registry', () => {
  it('persists generated messages against the store state instead of the base snapshot', async () => {
    const { registry, storeUser, saved } = startPersistence()
    const assistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }]
    }

    await registry.persistStepMessages('chat-1', 'run-1', [baseMessages[0], assistant])

    expect(saved.at(-1)).toEqual([storeUser, assistant])
  })

  it('publishes snapshots from the active view instead of archived store history', async () => {
    const archived: TanzoUIMessage = {
      id: 'archived-1',
      role: 'user',
      parts: [{ type: 'text', text: 'archived detail' }]
    }
    const summary: TanzoUIMessage = {
      id: 'summary-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'compact summary' }]
    }
    const tail: TanzoUIMessage = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'active request' }]
    }
    const assistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }]
    }
    let stored = [archived, tail]
    const contextEngine = {
      snapshot: vi.fn(() => ({ usedTokens: 1 }))
    }
    const registry = createChatRunPersistenceRegistry()

    registry.start('chat-1', 'run-1', [summary, tail], {
      def: {} as never,
      broadcast: true,
      canPersist: () => true,
      store: {
        loadUnvalidated: () => structuredClone(stored),
        save: (_chatId, messages) => {
          stored = structuredClone(messages)
        }
      },
      send: vi.fn(),
      contextEngine
    })

    await registry.persistStepMessages('chat-1', 'run-1', [summary, tail, assistant])

    expect(contextEngine.snapshot).toHaveBeenCalledWith(expect.anything(), 'chat-1', [
      summary,
      tail,
      assistant
    ])
    expect(contextEngine.snapshot.mock.calls[0]?.[2]).not.toContainEqual(archived)
  })

  it('persists continuation updates to the trailing assistant message after approval', async () => {
    const approvedAssistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'c1',
          state: 'approval-responded',
          input: { command: 'ls' },
          approval: { id: 'ap1', approved: true }
        }
      ]
    } as never
    const continuationBase: TanzoUIMessage[] = [baseMessages[0], approvedAssistant]

    let stored: TanzoUIMessage[] = structuredClone(continuationBase)
    const saved: TanzoUIMessage[][] = []
    const registry = createChatRunPersistenceRegistry()
    registry.start('chat-1', 'run-1', continuationBase, {
      def: {} as never,
      broadcast: false,
      canPersist: () => true,
      store: {
        loadUnvalidated: () => structuredClone(stored),
        save: (_chatId, messages) => {
          stored = structuredClone(messages)
          saved.push(structuredClone(messages))
        }
      },
      send: vi.fn()
    })

    const continuedAssistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'c1',
          state: 'output-available',
          input: { command: 'ls' },
          approval: { id: 'ap1', approved: true },
          output: { stdout: 'a\nb', stderr: '', code: 0 }
        },
        { type: 'text', text: 'Done.' }
      ]
    } as never

    await registry.persistFinalMessages('chat-1', 'run-1', [baseMessages[0], continuedAssistant], {
      streamFailed: false
    })

    expect(saved.at(-1)).toEqual([baseMessages[0], continuedAssistant])
  })

  it('records consumed steering at the first generated-message boundary', async () => {
    const { registry, storeUser, saved } = startPersistence()
    const steer: TanzoUIMessage = {
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'steer' }]
    }
    const assistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }]
    }

    registry.addConsumedSteering('chat-1', 'run-1', [steer])
    await registry.persistFinalMessages('chat-1', 'run-1', [baseMessages[0], assistant], {
      streamFailed: false
    })

    expect(saved.at(-1)).toEqual([storeUser, steer, assistant])
  })

  it('places pre-run steering before the reply and mid-run steering after it (D6-2)', async () => {
    const { registry, storeUser, saved } = startPersistence()
    // One aggregated row per reply: the whole pass is a single assistant
    // message whose metadata lists every step.
    const reply: TanzoUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 's1' },
        { type: 'step-start' },
        { type: 'text', text: 's2' }
      ],
      metadata: { steps: [{ stepNumber: 1 }, { stepNumber: 2 }] }
    } as TanzoUIMessage
    const preRun: TanzoUIMessage = {
      id: 'steer-0',
      role: 'user',
      parts: [{ type: 'text', text: 'before the run' }]
    }
    const midRun: TanzoUIMessage = {
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'also check lint' }]
    }

    registry.addConsumedSteering('chat-1', 'run-1', [preRun], 0)
    registry.addConsumedSteering('chat-1', 'run-1', [midRun], 1)
    await registry.persistFinalMessages('chat-1', 'run-1', [baseMessages[0], reply], {
      streamFailed: false
    })

    expect(saved.at(-1)).toEqual([storeUser, preRun, reply, midRun])
  })

  it('orders steering before the continued assistant message after approval', async () => {
    const approvedAssistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'c1',
          state: 'approval-responded',
          input: { command: 'ls' },
          approval: { id: 'ap1', approved: true }
        }
      ]
    } as never
    const continuationBase: TanzoUIMessage[] = [baseMessages[0], approvedAssistant]

    let stored: TanzoUIMessage[] = structuredClone(continuationBase)
    const saved: TanzoUIMessage[][] = []
    const registry = createChatRunPersistenceRegistry()
    registry.start('chat-1', 'run-1', continuationBase, {
      def: {} as never,
      broadcast: false,
      canPersist: () => true,
      store: {
        loadUnvalidated: () => structuredClone(stored),
        save: (_chatId, messages) => {
          stored = structuredClone(messages)
          saved.push(structuredClone(messages))
        }
      },
      send: vi.fn()
    })

    const steer: TanzoUIMessage = {
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'also pwd' }]
    }
    const continued: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'c1',
          state: 'output-available',
          input: { command: 'ls' },
          approval: { id: 'ap1', approved: true },
          output: { stdout: 'a', stderr: '', code: 0 }
        },
        { type: 'text', text: 'Done.' }
      ]
    } as never

    registry.addConsumedSteering('chat-1', 'run-1', [steer])
    await registry.persistFinalMessages('chat-1', 'run-1', [baseMessages[0], continued], {
      streamFailed: false
    })

    expect(saved.at(-1)).toEqual([baseMessages[0], steer, continued])
  })

  it('does not persist after the owner is no longer current', async () => {
    const { registry, saved } = startPersistence({ canPersist: () => false })

    await registry.persistStepMessages('chat-1', 'run-1', [
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }
    ])

    expect(saved).toEqual([])
  })

  it('persists final messages after a manual stop via the looser guard', async () => {
    const { registry, storeUser, saved } = startPersistence({
      canPersist: () => false,
      canPersistFinal: () => true
    })
    const assistant: TanzoUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'partial answer' }]
    }

    const stepPersisted = await registry.persistStepMessages('chat-1', 'run-1', [
      baseMessages[0],
      assistant
    ])
    expect(stepPersisted).toBe(false)
    expect(saved).toEqual([])

    const finalPersisted = await registry.persistFinalMessages(
      'chat-1',
      'run-1',
      [baseMessages[0], assistant],
      { streamFailed: false }
    )
    expect(finalPersisted).toBe(true)
    expect(saved.at(-1)).toEqual([storeUser, assistant])
  })

  it('does not persist final messages when even the looser guard rejects', async () => {
    const { registry, saved } = startPersistence({
      canPersist: () => false,
      canPersistFinal: () => false
    })

    const persisted = await registry.persistFinalMessages(
      'chat-1',
      'run-1',
      [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }],
      { streamFailed: false }
    )

    expect(persisted).toBe(false)
    expect(saved).toEqual([])
  })

  it('drops stale run persistence after finish', async () => {
    const { registry, saved } = startPersistence()

    registry.finish('chat-1', 'run-1')
    await registry.persistFinalMessages(
      'chat-1',
      'run-1',
      [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }],
      { streamFailed: false }
    )

    expect(saved).toEqual([])
  })
})
