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

  it('interleaves mid-run steering at the exact step position the model saw (D6-2)', async () => {
    const { registry, storeUser, saved } = startPersistence()
    const step = (id: string, stepNumber: number): TanzoUIMessage =>
      ({
        id,
        role: 'assistant',
        parts: [{ type: 'step-start' }, { type: 'text', text: `s${stepNumber}` }],
        metadata: { steps: [{ stepNumber }] }
      }) as TanzoUIMessage
    const steer: TanzoUIMessage = {
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'also check lint' }]
    }

    // Steer drained in prepareStep of run-step 2 (0-based) → the model saw it
    // after the step-2 fragment (stepNumber 2) and before step 3.
    registry.addConsumedSteering('chat-1', 'run-1', [steer], 2)
    await registry.persistFinalMessages(
      'chat-1',
      'run-1',
      [baseMessages[0], step('a1', 1), step('a1::step-1', 2), step('a1::step-2', 3)],
      { streamFailed: false }
    )

    expect(saved.at(-1)).toEqual([
      storeUser,
      step('a1', 1),
      step('a1::step-1', 2),
      steer,
      step('a1::step-2', 3)
    ])
  })

  it('persists multiple new per-step rows in stream order', async () => {
    const { registry, storeUser, saved } = startPersistence()
    const rows: TanzoUIMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'one' }] },
      { id: 'a1::step-1', role: 'assistant', parts: [{ type: 'text', text: 'two' }] },
      { id: 'a1::step-2', role: 'assistant', parts: [{ type: 'text', text: 'three' }] }
    ]

    // Step persist mid-run (two rows), then final persist (three rows).
    await registry.persistStepMessages('chat-1', 'run-1', [baseMessages[0], ...rows.slice(0, 2)])
    await registry.persistFinalMessages('chat-1', 'run-1', [baseMessages[0], ...rows], {
      streamFailed: false
    })

    expect(saved.at(-1)).toEqual([storeUser, ...rows])
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
