import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import { buildPromptCacheDiagnostic } from '@main/agent/diagnostics/prompt-cache'
import { createCapabilities } from '@main/agent/context/capabilities'
import { compileSections } from '@main/agent/context/compile'
import { createContextEngine } from '@main/agent/context/index'
import {
  estimateTextTokens,
  estimateUIMessageTokens,
  measureTranscript
} from '@main/agent/context/ledger'
import { projectHistory } from '@main/agent/context/project'
import type { ContextSection } from '@main/agent/context/section'
import { strategyFor } from '@main/agent/context/providers'
import { computeCompactionPolicy } from '@main/agent/context/compact/policy'
import { createTanzoSection } from '@main/agent/context/sections/tanzo'

const CAP = { contextWindow: 200_000, maxOutputTokens: 8_192, supportsImages: true }

function section(
  id: string,
  stability: 'stable' | 'volatile',
  channel: 'system' | 'leading-user' | 'injection',
  order: number,
  text: string | null
): ContextSection {
  return {
    id,
    stability,
    channel,
    order,
    render: () => text
  }
}

const BUILD_INPUT = {
  def: { modelRef: 'anthropic:claude-opus-4-5', systemPrompt: 'role' } as never,
  chatId: 'chat-1',
  cwd: '/tmp',
  capabilities: CAP
}

function engineDeps(overrides: Record<string, unknown> = {}) {
  return {
    clock: { now: () => new Date('2026-06-01T00:00:00.000Z') },
    tanzoInstructions: { read: () => null },
    skillsIndex: { list: () => [] },
    pluginsIndex: { list: () => [] },
    pluginMention: { list: () => [], peek: () => [], take: () => {} },
    gitStatus: { read: () => 'branch: main\n M file.ts' },
    goal: { takeInjection: () => null, peekInjection: () => null, get: () => null },
    policyMode: { getMode: () => 'default' as const },
    resolveModelMetadata: () => ({ contextWindow: 200_000, maxOutput: 8_192 }),
    ...overrides
  }
}

const DEF = {
  id: 'general',
  name: 'General',
  description: '',
  kind: 'main',
  modelRef: 'openai:gpt-5.5',
  systemPrompt: 'ROLE',
  allowedTools: null
} as never

describe('main/agent/context tanzo section', () => {
  it('uses tanzo as the project instructions section id', () => {
    const section = createTanzoSection({ read: () => 'Use local rules.' })

    expect(section.id).toBe('tanzo')
    expect(section.stability).toBe('stable')
    expect(section.channel).toBe('system')
    expect(section.render(BUILD_INPUT)).toBe(
      [
        '<tanzo-instructions priority="binding">',
        'These are binding Tanzo workspace instructions loaded from instruction files.',
        'They apply to every step of this run.',
        'Follow them unless a higher-priority system or developer instruction conflicts.',
        'If the user request conflicts with these instructions, preserve these instructions and explain the conflict briefly.',
        '',
        'Use local rules.',
        '</tanzo-instructions>'
      ].join('\n')
    )
  })
})

describe('main/agent/context compileSections', () => {
  it('orders stable system sections before volatile system sections', async () => {
    const plan = await compileSections(
      [
        section('datetime', 'volatile', 'injection', 0, 'NOW'),
        section('role', 'stable', 'system', 0, 'ROLE'),
        section('tools', 'stable', 'system', 1, 'TOOLS'),
        section('vol-sys', 'volatile', 'system', 0, 'VOL'),
        section('git', 'volatile', 'injection', 1, 'GIT')
      ],
      BUILD_INPUT,
      []
    )

    expect(plan.system.map((message) => message.content)).toEqual(['ROLE', 'TOOLS', 'VOL'])
    expect(plan.stableBoundary).toBe(2)
    expect(plan.provenance.system).toEqual([
      { sectionId: 'role', stability: 'stable', channel: 'system' },
      { sectionId: 'tools', stability: 'stable', channel: 'system' },
      { sectionId: 'vol-sys', stability: 'volatile', channel: 'system' }
    ])
    // Injection-channel sections never reach the compiled plan.
    expect(plan.leadingUser).toHaveLength(0)
  })

  it('merges leading-user sections into one message before history', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'real user turn' }]
    const plan = await compileSections(
      [
        section('env', 'stable', 'leading-user', 0, 'ENV'),
        section('extra', 'volatile', 'leading-user', 1, 'EXTRA')
      ],
      BUILD_INPUT,
      history
    )

    expect([...plan.leadingUser, ...plan.history].map((message) => message.content)).toEqual([
      'ENV\n\nEXTRA',
      'real user turn'
    ])
  })

  it('drops sections that render null or empty text', async () => {
    const plan = await compileSections(
      [
        section('role', 'stable', 'system', 0, 'ROLE'),
        section('empty', 'stable', 'system', 1, ''),
        section('git', 'volatile', 'leading-user', 0, null)
      ],
      BUILD_INPUT,
      []
    )

    expect(plan.system).toEqual([{ role: 'system', content: 'ROLE' }])
    expect(plan.leadingUser).toEqual([])
  })
})

describe('main/agent/context projectHistory', () => {
  it('drops incomplete tool calls before ai-sdk conversion', () => {
    const out = projectHistory(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking the file.' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'fileRead', input: {} }
          ]
        }
      ],
      CAP
    )

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Checking the file.' }]
    })
  })

  it('removes orphan tool results', () => {
    const out = projectHistory(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'orphan',
              toolName: 'x',
              output: { type: 'text', value: 'v' }
            }
          ]
        }
      ],
      CAP
    )

    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('canonicalizes result and approval order by tool-call order', () => {
    const out = projectHistory(
      [
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'glob', input: {} },
            {
              type: 'tool-approval-request',
              approvalId: 'a1',
              toolCallId: 'c1',
              isAutomatic: true
            },
            { type: 'tool-call', toolCallId: 'c2', toolName: 'fileRead', input: {} },
            {
              type: 'tool-approval-request',
              approvalId: 'a2',
              toolCallId: 'c2',
              isAutomatic: true
            }
          ]
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-approval-response', approvalId: 'a1', approved: true },
            { type: 'tool-approval-response', approvalId: 'a2', approved: true },
            {
              type: 'tool-result',
              toolCallId: 'c2',
              toolName: 'fileRead',
              output: { type: 'text', value: 'file' }
            },
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'glob',
              output: { type: 'text', value: 'glob' }
            }
          ]
        }
      ],
      CAP
    )

    expect(out[1].content).toMatchObject([
      { type: 'tool-result', toolCallId: 'c1' },
      { type: 'tool-approval-response', approvalId: 'a1' },
      { type: 'tool-result', toolCallId: 'c2' },
      { type: 'tool-approval-response', approvalId: 'a2' }
    ])
  })

  it('keeps approval responses without synthesizing placeholder tool-results', () => {
    const out = projectHistory(
      [
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'approved-call', toolName: 'shell', input: {} },
            {
              type: 'tool-approval-request',
              approvalId: 'approval-1',
              toolCallId: 'approved-call',
              isAutomatic: false
            },
            { type: 'tool-call', toolCallId: 'still-running', toolName: 'grep', input: {} }
          ]
        },
        {
          role: 'tool',
          content: [{ type: 'tool-approval-response', approvalId: 'approval-1', approved: true }]
        }
      ],
      CAP
    )

    expect(out[0].content).toMatchObject([
      { type: 'tool-call', toolCallId: 'approved-call' },
      { type: 'tool-approval-request', approvalId: 'approval-1' }
    ])
    expect(out[1].content).toEqual([
      { type: 'tool-approval-response', approvalId: 'approval-1', approved: true }
    ])
  })

  it('keeps image and file parts for the provider SDK to handle', () => {
    const imagePart = { type: 'image', image: 'data:...' } as never
    const out = projectHistory([{ role: 'user', content: [imagePart] }], {
      ...CAP,
      supportsImages: false
    })

    expect(out[0].content).toEqual([imagePart])
  })
})

describe('main/agent/context provider strategies', () => {
  const basePlan = {
    system: [
      { role: 'system' as const, content: 'STABLE' },
      { role: 'system' as const, content: 'VOL' }
    ],
    stableBoundary: 1,
    leadingUser: [{ role: 'user' as const, content: 'ENV' }],
    history: [
      { role: 'user' as const, content: 'older' },
      { role: 'assistant' as const, content: 'latest' }
    ],
    provenance: { system: [], leadingUser: [], history: [] }
  }

  it('adds Anthropic cache control to stable system, leading-user, and history tail', () => {
    const out = strategyFor('anthropic:claude-opus-4-5', 'chat-1').applyCaching({
      plan: basePlan,
      summaryIndex: -1
    })

    expect(out.system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
    })
    expect(out.system[1].providerOptions).toBeUndefined()
    expect(out.leadingUser[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
    })
    // Only the last history message gets the 5m moving frontier.
    expect(out.history[0].providerOptions).toBeUndefined()
    expect(out.history[1].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } }
    })
  })

  it('marks the compaction summary as a 1h cache anchor', () => {
    const plan = {
      ...basePlan,
      history: [
        { role: 'assistant' as const, content: 'summary of earlier work' },
        { role: 'user' as const, content: 'next' },
        { role: 'assistant' as const, content: 'latest' }
      ]
    }
    const out = strategyFor('anthropic:claude-opus-4-5', 'chat-1').applyCaching({
      plan,
      summaryIndex: 0
    })

    expect(out.history[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
    })
    expect(out.history[2].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } }
    })
  })

  it('routes OpenAI prompt caching per conversation, not globally', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      history: [],
      provenance: { system: [], leadingUser: [], history: [] }
    }
    const out = strategyFor('openai:gpt-5', 'chat-9').applyCaching({ plan, summaryIndex: -1 })
    const otherChat = strategyFor('openai:gpt-5', 'chat-10').applyCaching({
      plan,
      summaryIndex: -1
    })

    expect(out.providerOptions).toEqual({
      openai: { promptCacheKey: 'tanzo:chat:chat-9', promptCacheRetention: '24h' }
    })
    expect(otherChat.providerOptions).toEqual({
      openai: { promptCacheKey: 'tanzo:chat:chat-10', promptCacheRetention: '24h' }
    })
  })

  it('adds the OpenAI-compatible prompt cache key in wire format (snake_case passthrough)', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      history: [],
      provenance: { system: [], leadingUser: [], history: [] }
    }
    const out = strategyFor('openai-compatible:mimo-v2.5-pro', 'chat-9').applyCaching({
      plan,
      summaryIndex: -1
    })

    expect(out.providerOptions).toEqual({
      openaiCompatible: {
        prompt_cache_key: 'tanzo:chat:chat-9'
      }
    })
  })

  it('leaves DeepSeek provider options unchanged because caching is automatic', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      history: [],
      provenance: { system: [], leadingUser: [], history: [] }
    }
    expect(
      strategyFor('deepseek:deepseek-chat', 'chat-1').applyCaching({ plan, summaryIndex: -1 })
    ).toEqual(plan)
  })
})

describe('main/agent/context ledger', () => {
  function assistantWithUsage(id: string, inputTokens: number, outputTokens: number) {
    return {
      id,
      role: 'assistant',
      parts: [{ type: 'text', text: 'reply' }],
      metadata: {
        usage: { outputTokens },
        steps: [{ stepNumber: 1, usage: { inputTokens, outputTokens } }]
      }
    } as TanzoUIMessage
  }

  it('counts CJK text at a denser chars-per-token rate', () => {
    const latin = estimateTextTokens('a'.repeat(100))
    const cjk = estimateTextTokens('文'.repeat(100))
    expect(latin).toBe(25)
    expect(cjk).toBeGreaterThan(60)
  })

  it('excludes data parts and step markers from message estimates', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'abcd'.repeat(10) },
        { type: 'data-compaction', data: { stage: 'complete', summary: 'x'.repeat(4000) } }
      ]
    } as TanzoUIMessage
    expect(estimateUIMessageTokens(message)).toBe(10)
  })

  it('anchors on the newest reported step usage and estimates only the increment', () => {
    const messages: TanzoUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(40_000) }] },
      assistantWithUsage('a1', 50_000, 1_000),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'y'.repeat(400) }] }
    ]
    const measure = measureTranscript(messages)
    expect(measure.source).toBe('reported')
    // anchor input (50k) + anchor output (1k) + increment estimate (100)
    expect(measure.totalTokens).toBe(51_100)
  })

  it('ignores anchors that predate the latest compaction summary', () => {
    const messages: TanzoUIMessage[] = [
      assistantWithUsage('a1', 190_000, 1_000),
      {
        id: 's1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 's1' } }
        ]
      } as TanzoUIMessage,
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'next'.repeat(10) }] }
    ]
    const measure = measureTranscript(messages)
    expect(measure.source).toBe('estimated')
    expect(measure.totalTokens).toBeLessThan(1_000)
  })

  it('falls back to a full estimate when no usage was ever reported', () => {
    const messages: TanzoUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello world' }] }
    ]
    const measure = measureTranscript(messages)
    expect(measure.source).toBe('estimated')
    expect(measure.totalTokens).toBe(3)
  })
})

describe('main/agent/context compaction policy', () => {
  it('derives trigger, retain budget, and hard ceiling from capabilities', () => {
    const policy = computeCompactionPolicy(CAP)

    expect(policy).toEqual({
      compactionTriggerTokens: 153_446, // (200_000 - 8_192) * 0.8
      retainBudgetTokens: 30_000,
      hardCeilingTokens: 191_808
    })
  })

  it('fills model capabilities from metadata or defaults', () => {
    const capabilitiesFor = createCapabilities((modelRef) =>
      modelRef === 'known' ? { contextWindow: 123, maxOutput: 45, vision: true } : undefined
    )

    expect(capabilitiesFor('known')).toEqual({
      contextWindow: 123,
      maxOutputTokens: 45,
      supportsImages: true
    })
    expect(capabilitiesFor('unknown').supportsImages).toBe(false)
  })
})

describe('main/agent/context engine', () => {
  it('measures persisted transcripts through the ledger for compaction decisions', () => {
    const engine = createContextEngine(engineDeps())
    const messages: TanzoUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'short' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'reply' }],
        metadata: { steps: [{ stepNumber: 1, usage: { inputTokens: 190_000 } }] }
      } as TanzoUIMessage
    ]

    expect(engine.snapshot(DEF, 'chat-anchor', messages).compactionTriggered).toBe(true)
    expect(engine.shouldCompact(DEF, 'chat-anchor', messages)).toBe(true)
    expect(engine.shouldCompact(DEF, 'chat-anchor', messages.slice(0, 1))).toBe(false)
  })

  it('builds an identical prompt for every step of a run (append-only prefix)', async () => {
    const engine = createContextEngine(engineDeps())
    const transcript = [{ role: 'user' as const, content: 'hi' }]

    const first = await engine.build(DEF, 'chat-9', '/tmp', transcript, 0)
    const second = await engine.build(DEF, 'chat-9', '/tmp', transcript, 1)

    expect(second.messages).toEqual(first.messages)
    expect(second.instructions).toEqual(first.instructions)
    // No per-step volatile content in the prompt itself.
    expect(JSON.stringify(first.messages)).not.toContain('<datetime>')
  })

  it('renders the volatile injection as a persistable synthetic user message', async () => {
    const engine = createContextEngine(engineDeps())

    const injection = await engine.renderInjection(DEF, 'chat-9', '/tmp', { isFirstTurn: true })
    expect(injection).not.toBeNull()
    expect(injection?.role).toBe('user')
    const text = injection?.parts.find((part) => part.type === 'text')
    expect((text as { text: string }).text).toContain('<datetime>')
    expect((text as { text: string }).text).toContain('<git-status>')
    const marker = injection?.parts.find((part) => part.type === 'data-contextInjection')
    expect(marker).toMatchObject({ data: { sections: ['datetime', 'git-status'] } })
  })

  it('omits the git snapshot from later-turn injections', async () => {
    const engine = createContextEngine(engineDeps())

    const injection = await engine.renderInjection(DEF, 'chat-9', '/tmp', { isFirstTurn: false })
    const text = injection?.parts.find((part) => part.type === 'text')
    expect((text as { text: string }).text).toContain('<datetime>')
    expect((text as { text: string }).text).not.toContain('<git-status>')
  })

  it('consumes one-shot goal injections only when the injection renders', async () => {
    let taken = 0
    const engine = createContextEngine(
      engineDeps({
        goal: {
          get: () => ({ objective: 'obj' }) as never,
          peekInjection: () => 'continuation' as never,
          takeInjection: () => {
            taken += 1
            return null
          }
        }
      })
    )

    await engine.renderInjection(DEF, 'chat-9', '/tmp', { isFirstTurn: true })
    expect(taken).toBe(1)
  })
})

describe('main/agent/context prompt cache diagnostics', () => {
  const def = {
    id: 'general',
    name: 'General',
    description: '',
    kind: 'main',
    modelRef: 'openai:gpt-5.5',
    systemPrompt: 'stable role',
    allowedTools: null
  } as const

  it('hashes prompt segments without storing raw message text', () => {
    const record = buildPromptCacheDiagnostic({
      id: 'd1',
      conversationId: 'chat-1',
      runId: 'run-1',
      stepNumber: 1,
      createdAt: 1,
      def,
      tools: {},
      prepared: {
        providerOptions: {
          openai: { promptCacheKey: 'tanzo:chat:chat-1', promptCacheRetention: '24h' }
        },
        system: [{ role: 'system', content: 'stable role' }],
        messages: [{ role: 'user', content: 'secret user text' }],
        provenance: {
          system: [{ sectionId: 'role', stability: 'stable', channel: 'system' }],
          leadingUser: [],
          history: [undefined],
          messages: [undefined]
        }
      }
    })

    const segments = JSON.parse(record.segmentsJson)
    expect(record.promptCacheKey).toBe('tanzo:chat:chat-1')
    expect(record.promptCacheRetention).toBe('24h')
    expect(record.segmentsJson).not.toContain('secret user text')
    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'provider-options',
          origin: 'provider-options',
          hash: expect.any(String)
        }),
        expect.objectContaining({
          kind: 'system',
          origin: 'context-section',
          role: 'system',
          sectionId: 'role',
          stability: 'stable',
          channel: 'system',
          hash: expect.any(String)
        }),
        expect.objectContaining({
          kind: 'message',
          origin: 'conversation-history',
          role: 'user',
          hash: expect.any(String)
        })
      ])
    )
    expect(segments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'agent-instructions' })])
    )
  })
})
