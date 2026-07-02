import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { buildPromptCacheDiagnostic } from '@main/agent/diagnostics/prompt-cache'
import { createBudget } from '@main/agent/context/budget'
import { createCapabilities } from '@main/agent/context/capabilities'
import { compileSections } from '@main/agent/context/compile'
import { createContextEngine } from '@main/agent/context/index'
import { projectHistory } from '@main/agent/context/project'
import type { ContextSection } from '@main/agent/context/section'
import { strategyFor } from '@main/agent/context/providers'
import { computeCompactionPolicy } from '@main/agent/context/compaction-policy'
import { createTanzoSection } from '@main/agent/context/sections/tanzo'

const CAP = { contextWindow: 200_000, maxOutputTokens: 8_192, supportsImages: true }

function section(
  id: string,
  stability: 'stable' | 'volatile',
  channel: 'system' | 'leading-user',
  order: number,
  text: string | null,
  prefixCacheScope?: 'conversation'
): ContextSection {
  return {
    id,
    stability,
    channel,
    order,
    ...(prefixCacheScope ? { prefixCacheScope } : {}),
    render: () => text
  }
}

const BUILD_INPUT = {
  def: { modelRef: 'anthropic:claude-opus-4-5', systemPrompt: 'role' } as never,
  cwd: '/tmp',
  capabilities: CAP
}

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
        section('datetime', 'volatile', 'leading-user', 0, 'NOW', 'conversation'),
        section('role', 'stable', 'system', 0, 'ROLE'),
        section('tools', 'stable', 'system', 1, 'TOOLS'),
        section('vol-sys', 'volatile', 'system', 0, 'VOL'),
        section('git', 'volatile', 'leading-user', 1, 'GIT', 'conversation')
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
    expect(plan.leadingUser).toHaveLength(0)
    expect(plan.volatilePrefixUser).toEqual([{ role: 'user', content: 'NOW\n\nGIT' }])
    expect(plan.provenance.volatilePrefixUser).toEqual([
      {
        sections: [
          { sectionId: 'datetime', stability: 'volatile', channel: 'leading-user' },
          { sectionId: 'git', stability: 'volatile', channel: 'leading-user' }
        ]
      }
    ])
    expect(plan.trailingUser).toEqual([])
  })

  it('keeps stable leading-user context before history and volatile context after history', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'real user turn' }]
    const plan = await compileSections(
      [
        section('env', 'stable', 'leading-user', 0, 'ENV'),
        section('datetime', 'volatile', 'leading-user', 0, 'NOW', 'conversation'),
        section('git', 'volatile', 'leading-user', 1, 'GIT', 'conversation')
      ],
      BUILD_INPUT,
      history
    )

    expect(
      [...plan.leadingUser, ...plan.history, ...plan.volatilePrefixUser, ...plan.trailingUser].map(
        (message) => message.content
      )
    ).toEqual(['ENV', 'real user turn', 'NOW\n\nGIT'])
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
    expect(plan.volatilePrefixUser).toEqual([])
    expect(plan.trailingUser).toEqual([])
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
  it('adds Anthropic cache control to stable system and latest history messages', () => {
    const out = strategyFor('anthropic:claude-opus-4-5', 'chat-1').applyCaching({
      system: [
        { role: 'system', content: 'STABLE' },
        { role: 'system', content: 'VOL' }
      ],
      stableBoundary: 1,
      leadingUser: [{ role: 'user', content: 'ENV' }],
      volatilePrefixUser: [],
      trailingUser: [],
      history: [
        { role: 'user', content: 'older' },
        { role: 'assistant', content: 'latest' }
      ]
    })

    expect(out.system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
    })
    expect(out.system[1].providerOptions).toBeUndefined()
    expect(out.leadingUser[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
    })
    expect(out.history[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } }
    })
    expect(out.history[1].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } }
    })
  })

  it('adds a global OpenAI prompt cache key without message breakpoints', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      volatilePrefixUser: [],
      trailingUser: [],
      history: []
    }
    const out = strategyFor('openai:gpt-5', 'chat-9').applyCaching(plan)
    const otherChat = strategyFor('openai:gpt-5', 'chat-10').applyCaching(plan)

    expect(out.providerOptions).toEqual({
      openai: { promptCacheKey: 'tanzo:global:openai:gpt-5', promptCacheRetention: '24h' }
    })
    expect(otherChat.providerOptions).toEqual(out.providerOptions)
  })

  it('adds OpenAI-compatible prompt cache options under the SDK camelCase key', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      volatilePrefixUser: [],
      trailingUser: [],
      history: []
    }
    const out = strategyFor('openai-compatible:mimo-v2.5-pro', 'chat-9').applyCaching(plan)

    expect(out.providerOptions).toEqual({
      openaiCompatible: {
        promptCacheKey: 'tanzo:global:openai-compatible:mimo-v2.5-pro',
        promptCacheRetention: '24h'
      }
    })
  })

  it('leaves DeepSeek provider options unchanged because caching is automatic', () => {
    const plan = {
      system: [],
      stableBoundary: 0,
      leadingUser: [],
      volatilePrefixUser: [],
      trailingUser: [],
      history: []
    }
    expect(strategyFor('deepseek:deepseek-chat', 'chat-1').applyCaching(plan)).toEqual(plan)
  })
})

describe('main/agent/context budget and compaction policy', () => {
  it('uses reported input tokens without estimating message deltas', () => {
    const budget = createBudget()
    const base: ModelMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ]

    budget.anchor('c', base.length, 10_000)
    const grown = [...base, { role: 'user' as const, content: 'x'.repeat(400) }]
    const usage = budget.measureUsage('c', grown)

    expect(usage).toMatchObject({ source: 'reported', inputTokens: 10_000 })
    expect(usage.exceeds(9_999)).toBe(true)
  })

  it('uses char-based estimate when no reported usage anchor is available', () => {
    const budget = createBudget()
    // "hello world" = 11 chars → ceil(11/4) = 3 tokens estimated
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello world' }]

    const usage = budget.measureUsage('c', messages)
    expect(usage.source).toBe('estimated')
    expect(usage.inputTokens).toBe(3)
    // Does not exceed a threshold larger than the estimate.
    expect(usage.exceeds(3)).toBe(false)
    expect(usage.exceeds(2)).toBe(true)
  })

  it('uses reported budget anchors for automatic compaction decisions', () => {
    const engine = createContextEngine({
      clock: { now: () => new Date('2026-06-01T00:00:00.000Z') },
      tanzoInstructions: { read: () => null },
      skillsIndex: { list: () => [] },
      pluginsIndex: { list: () => [] },
      pluginMention: { list: () => [], peek: () => [], take: () => {} },
      gitStatus: { read: () => '' },
      goal: { takeInjection: () => null, peekInjection: () => null, get: () => null },
      policyMode: { getMode: () => 'default' },
      resolveModelMetadata: () => ({ contextWindow: 200_000, maxOutput: 8_192 })
    })
    const def = {
      id: 'general',
      name: 'General',
      description: '',
      kind: 'main',
      modelRef: 'openai:gpt-5.5',
      systemPrompt: 'ROLE',
      allowedTools: null
    } as never
    const messages: ModelMessage[] = [{ role: 'user', content: 'short' }]

    engine.observeStep('chat-anchor', messages.length, { inputTokens: 190_000 } as never)

    expect(engine.snapshot(def, 'chat-anchor', messages).compactionTriggered).toBe(true)
    expect(engine.shouldCompact(def, 'chat-anchor', messages)).toBe(true)
  })
  it('derives the compaction trigger and retained recent budget', () => {
    const policy = computeCompactionPolicy(CAP)

    expect(policy).toEqual({
      compactionTriggerTokens: 172_627,
      retainedRecentSteps: 6
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

describe('main/agent/context engine integration', () => {
  it('injects volatile context only for the first prepared step', async () => {
    const engine = createContextEngine({
      clock: { now: () => new Date('2026-06-01T00:00:00.000Z') },
      tanzoInstructions: { read: () => null },
      skillsIndex: { list: () => [] },
      pluginsIndex: { list: () => [] },
      pluginMention: { list: () => [], peek: () => [], take: () => {} },
      gitStatus: { read: () => 'branch: main\n M file.ts' },
      goal: { takeInjection: () => null, peekInjection: () => null, get: () => null },
      policyMode: { getMode: () => 'default' },
      resolveModelMetadata: () => ({ contextWindow: 200_000, maxOutput: 8_192 })
    })
    const def = {
      id: 'general',
      name: 'General',
      description: '',
      kind: 'main' as const,
      modelRef: 'openai:gpt-5.5',
      systemPrompt: 'ROLE',
      allowedTools: null
    }
    const transcript = [{ role: 'user' as const, content: 'hi' }]

    const first = await engine.build(def, 'chat-9', '/tmp', transcript, 0)
    expect(first?.messages?.map((message) => message.role)).toEqual(['user', 'user', 'user'])
    expect(first?.messages?.[0].content).toContain('<environment>')
    expect(first?.messages?.[1].content).toBe('hi')
    expect(first?.messages?.[2].content).toContain('<datetime>')
    expect(first?.messages?.[2].content).toContain('timezone:')

    const second = await engine.build(def, 'chat-9', '/tmp', transcript, 1)
    expect(second?.messages?.map((message) => message.role)).toEqual(['user', 'user'])
    expect(JSON.stringify(second?.messages)).not.toContain('<datetime>')
  })

  it('keeps DeepSeek conversation snapshots frozen before history for prefix cache reuse', async () => {
    let date = new Date('2026-06-01T00:00:00.000Z')
    let git = 'branch: main\n M first.ts'
    const engine = createContextEngine({
      clock: { now: () => date },
      tanzoInstructions: { read: () => null },
      skillsIndex: { list: () => [] },
      pluginsIndex: { list: () => [] },
      pluginMention: { list: () => [], peek: () => [], take: () => {} },
      gitStatus: { read: () => git },
      goal: { takeInjection: () => null, peekInjection: () => null, get: () => null },
      policyMode: { getMode: () => 'default' },
      resolveModelMetadata: () => ({ contextWindow: 200_000, maxOutput: 8_192 })
    })
    const def = {
      id: 'general',
      name: 'General',
      description: '',
      kind: 'main' as const,
      modelRef: 'deepseek:deepseek-chat',
      systemPrompt: 'ROLE',
      allowedTools: null
    }
    const first = await engine.build(
      def,
      'chat-deepseek',
      '/tmp',
      [{ role: 'user' as const, content: 'hi' }],
      0
    )

    date = new Date('2026-06-02T00:00:00.000Z')
    git = 'branch: main\n M second.ts'
    const second = await engine.build(
      def,
      'chat-deepseek',
      '/tmp',
      [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'working' }
      ],
      1
    )

    expect(first?.messages?.map((message) => message.role)).toEqual(['user', 'user', 'user'])
    expect(second?.messages?.slice(0, first?.messages?.length)).toEqual(first?.messages)
    expect(JSON.stringify(second?.messages)).toContain('2026-06-01')
    expect(JSON.stringify(second?.messages)).toContain('first.ts')
    expect(JSON.stringify(second?.messages)).not.toContain('2026-06-02')
    expect(JSON.stringify(second?.messages)).not.toContain('second.ts')
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
          openai: { promptCacheKey: 'tanzo:global:openai:gpt-5.5', promptCacheRetention: '24h' }
        },
        system: [{ role: 'system', content: 'stable role' }],
        messages: [{ role: 'user', content: 'secret user text' }],
        provenance: {
          system: [{ sectionId: 'role', stability: 'stable', channel: 'system' }],
          leadingUser: [],
          volatilePrefixUser: [],
          history: [undefined],
          trailingUser: [],
          messages: [undefined]
        }
      }
    })

    const segments = JSON.parse(record.segmentsJson)
    expect(record.promptCacheKey).toBe('tanzo:global:openai:gpt-5.5')
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
