import { describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@main/agent/agents/types'
import { createRunEngine } from '@main/agent/runtime/run-engine'
import { createTurnLoop } from '@main/agent/runtime/turn-loop'
import type { AgentStreamFinalState } from '@main/agent/runtime/stream-runner'
import type { TanzoUIMessage } from '@shared/agent-message'

const streamStates: AgentStreamFinalState[] = []

vi.mock('@main/agent/runtime/stream-runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('@main/agent/runtime/stream-runner')>()
  return {
    ...original,
    startAgentStream: vi.fn((_deps, opts) => {
      const state = streamStates.shift()
      if (!state) throw new Error('missing stream state')
      return {
        // eslint-disable-next-line require-yield -- mock stream only drives onFinally
        stream: (async function* () {
          await opts.onFinally(state)
        })()
      }
    })
  }
})

const agentDef: AgentDefinition = {
  id: 'main',
  name: 'Main',
  description: 'Main agent',
  kind: 'main',
  modelRef: 'openai:gpt-4.1',
  systemPrompt: 'Be useful.',
  allowedTools: null,
  maxSteps: 7
}

const textOnlyState = (overrides: Partial<AgentStreamFinalState> = {}): AgentStreamFinalState => ({
  producedToolCall: false,
  producedWorkToolCall: false,
  streamFailed: false,
  aborted: false,
  turnStartedAt: Date.now(),
  isGoalContinuation: false,
  exitPlanModeCalled: false,
  endedWithTextOnly: true,
  ...overrides
})

describe('agent/runtime/turn-loop', () => {
  it('re-prepares with a nudge when retrying a plan-mode text-only answer', async () => {
    const messages: TanzoUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'make a plan' }] }
    ]
    let savedMessages = messages
    const prepareMessages = vi.fn(async (_chatId, _def, incoming) => incoming)

    streamStates.push(
      textOnlyState(),
      textOnlyState({ exitPlanModeCalled: true, endedWithTextOnly: false })
    )

    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: {
          getMode: vi.fn(() => 'plan'),
          decide: vi.fn()
        } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'chat-1', cwd: null })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn((_chatId, nextMessages) => {
            savedMessages = nextMessages
          }),
          load: vi.fn(async () => savedMessages),
          depthOf: vi.fn(() => 0),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages,
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: {
          reconcile: vi.fn(),
          dispatch: vi.fn()
        },
        steerQueue: {
          consume: vi.fn(() => [])
        } as never
      }
    )

    await loop.run('chat-1', messages)

    expect(prepareMessages).toHaveBeenCalledTimes(2)
  })

  it('defers the change preview while the turn waits for tool approval', async () => {
    const messages: TanzoUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'edit and run' }] }
    ]
    // History persisted at the approval pause still carries an unresolved
    // approval-requested part, so the change preview must not be finalized yet.
    const pausedHistory: TanzoUIMessage[] = [
      ...messages,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-shell',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { command: 'ls' },
            approval: { id: 'approval-1' }
          }
        ]
      } as TanzoUIMessage
    ]

    streamStates.push(textOnlyState({ endedWithTextOnly: false, producedToolCall: true }))

    const captureBeforeRun = vi.fn(async () => {})
    const captureAfterRun = vi.fn(async () => null)
    const discard = vi.fn()

    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: { getMode: vi.fn(() => 'default'), decide: vi.fn() } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'chat-1', cwd: '/repo' })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn(),
          load: vi.fn(async () => pausedHistory),
          depthOf: vi.fn(() => 0),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never,
        changeSet: { captureBeforeRun, captureAfterRun, discard } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages: vi.fn(async (_chatId, _def, incoming) => incoming),
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: { reconcile: vi.fn(), dispatch: vi.fn() },
        steerQueue: { consume: vi.fn(() => []) } as never
      }
    )

    await loop.run('chat-1', messages)

    expect(captureBeforeRun).toHaveBeenCalledTimes(1)
    // Turn paused for approval: no preview finalized, capture not discarded.
    expect(captureAfterRun).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('finalizes the carried change preview once when the turn resumes after approval', async () => {
    const messages: TanzoUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'edit and run' }] }
    ]
    let loadCount = 0
    const pausedHistory: TanzoUIMessage[] = [
      ...messages,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-shell',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { command: 'ls' },
            approval: { id: 'approval-1' }
          }
        ]
      } as TanzoUIMessage
    ]
    const resolvedHistory: TanzoUIMessage[] = [
      ...messages,
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] } as TanzoUIMessage
    ]

    // First run pauses for approval, second run (the resume) completes.
    streamStates.push(
      textOnlyState({ endedWithTextOnly: false, producedToolCall: true }),
      textOnlyState({ endedWithTextOnly: false, producedToolCall: true })
    )

    const captureBeforeRun = vi.fn(async () => {})
    const captureAfterRun = vi.fn(async () => null)
    const discard = vi.fn()

    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: { getMode: vi.fn(() => 'default'), decide: vi.fn() } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'chat-1', cwd: '/repo' })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn(),
          // First inspection sees the pending approval; afterwards it is resolved.
          load: vi.fn(async () => (loadCount++ === 0 ? pausedHistory : resolvedHistory)),
          depthOf: vi.fn(() => 0),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never,
        changeSet: { captureBeforeRun, captureAfterRun, discard } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages: vi.fn(async (_chatId, _def, incoming) => incoming),
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: { reconcile: vi.fn(), dispatch: vi.fn() },
        steerQueue: { consume: vi.fn(() => []) } as never
      }
    )

    await loop.run('chat-1', messages)
    await loop.run('chat-1', resolvedHistory)

    // before-checkpoint captured once for the whole logical turn (not re-captured
    // on resume), and the preview finalized exactly once at the true end.
    expect(captureBeforeRun).toHaveBeenCalledTimes(1)
    expect(captureAfterRun).toHaveBeenCalledTimes(1)
    expect(discard).not.toHaveBeenCalled()
  })

  it('discards a capture left pending by an approval pause when the turn is cancelled', async () => {
    const messages: TanzoUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'edit and run' }] }
    ]
    const pausedHistory: TanzoUIMessage[] = [
      ...messages,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-shell',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { command: 'ls' },
            approval: { id: 'approval-1' }
          }
        ]
      } as TanzoUIMessage
    ]

    streamStates.push(textOnlyState({ endedWithTextOnly: false, producedToolCall: true }))

    const captureBeforeRun = vi.fn(async () => {})
    const captureAfterRun = vi.fn(async () => null)
    const discard = vi.fn()

    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: { getMode: vi.fn(() => 'default'), decide: vi.fn() } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'chat-1', cwd: '/repo' })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn(),
          load: vi.fn(async () => pausedHistory),
          depthOf: vi.fn(() => 0),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never,
        changeSet: { captureBeforeRun, captureAfterRun, discard } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages: vi.fn(async (_chatId, _def, incoming) => incoming),
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: { reconcile: vi.fn(), dispatch: vi.fn() },
        steerQueue: { consume: vi.fn(() => []) } as never
      }
    )

    await loop.run('chat-1', messages)
    // Capture is deferred (not yet discarded) while the approval is pending.
    expect(discard).not.toHaveBeenCalled()

    // Cancelling the conversation must abandon the carried capture exactly once.
    loop.discardPendingChangeCapture('chat-1')
    expect(discard).toHaveBeenCalledTimes(1)
    // Idempotent: a second cancel/delete is a no-op.
    loop.discardPendingChangeCapture('chat-1')
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('reconciles each stream end but dispatches the terminal turn exactly once', async () => {
    const messages: TanzoUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'do work' }] }
    ]
    // The loop reconciles the stream once, then dispatches once — never a
    // doubled call.
    streamStates.push(
      textOnlyState({
        endedWithTextOnly: false,
        producedToolCall: true
      })
    )
    const reconcile = vi.fn()
    const dispatch = vi.fn()
    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: { getMode: vi.fn(() => 'default'), decide: vi.fn() } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'chat-1', cwd: null })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn(),
          // Empty reload prevents a compaction retry, forcing the loop to
          // finalize and dispatch.
          load: vi.fn(async () => []),
          depthOf: vi.fn(() => 0),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages: vi.fn(async (_c, _d, incoming) => incoming),
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: { reconcile, dispatch },
        steerQueue: { consume: vi.fn(() => []) } as never
      }
    )

    await loop.run('chat-1', messages)

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', broadcast: true })
    )
  })

  it('dispatches per-run for a non-deferred (sub-agent) run', async () => {
    // Sub-agent task runs go through startChatRun without deferTerminal and have
    // no run() loop to drive terminal dispatch, so onFinally must dispatch.
    streamStates.push(textOnlyState({ endedWithTextOnly: false, producedToolCall: true }))
    const reconcile = vi.fn()
    const dispatch = vi.fn()
    const loop = createTurnLoop(
      {
        providerService: {} as never,
        buildTools: vi.fn(async () => ({})),
        identity: {} as never,
        send: vi.fn(),
        policy: { getMode: vi.fn(() => 'default'), decide: vi.fn() } as never,
        store: {
          getConversation: vi.fn(() => ({ id: 'sub-1', cwd: null })),
          resolveAgentDefinition: vi.fn(async () => agentDef),
          save: vi.fn(),
          load: vi.fn(async () => []),
          depthOf: vi.fn(() => 1),
          rootOf: vi.fn(() => 'chat-1'),
          markRunOutcome: vi.fn()
        } as never
      },
      {
        engine: createRunEngine(),
        runPersistence: {
          start: vi.fn(),
          finish: vi.fn(),
          addConsumedSteering: vi.fn(),
          persistStepMessages: vi.fn(),
          persistFinalMessages: vi.fn()
        } as never,
        compaction: {
          prepareMessages: vi.fn(async (_c, _d, incoming) => incoming),
          reconcileInline: vi.fn(),
          compact: vi.fn()
        },
        turnFinalizer: { reconcile, dispatch },
        steerQueue: { consume: vi.fn(() => []) } as never
      }
    )

    await loop.startChatRun({
      chatId: 'sub-1',
      def: agentDef,
      messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      depth: 1,
      broadcast: true,
      runId: 'run-sub-1'
    })

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'sub-1' }))
  })
})
