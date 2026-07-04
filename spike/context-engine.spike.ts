/**
 * Spike: v2 context engine — Section × Provider assembly, token ledger, and
 * the model-domain compaction cut. Mirrors (a slim subset of) the unit tests
 * in tests/unit/main/agent/context; run with vitest when experimenting.
 */
import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '../src/shared/agent-message'
import { compileSections } from '../src/main/agent/context/compile'
import { createContextEngine } from '../src/main/agent/context'
import type { ContextSection } from '../src/main/agent/context/section'
import { strategyFor } from '../src/main/agent/context/providers'
import { measureTranscript, estimateTextTokens } from '../src/main/agent/context/ledger'
import { computeCompactionPolicy } from '../src/main/agent/context/compact/policy'
import { splitModelTranscript } from '../src/main/agent/context/compact/cut'
import { degradeTranscript } from '../src/main/agent/context/compact/degrade'

const CAP = { contextWindow: 200_000, maxOutputTokens: 8_192, supportsImages: true }

function section(
  id: string,
  stability: 'stable' | 'volatile',
  channel: 'system' | 'leading-user' | 'injection',
  order: number,
  text: string | null
): ContextSection {
  return { id, stability, channel, order, render: () => text }
}

const BUILD_INPUT = {
  def: { modelRef: 'anthropic:claude-opus-4-5', systemPrompt: 'role' } as never,
  chatId: 'chat-1',
  cwd: '/tmp',
  capabilities: CAP
}

describe('compileSections — v2 行编译', () => {
  it('stable system 段在前、volatile 在后，injection 段不进入 plan', async () => {
    const registry = [
      section('datetime', 'volatile', 'injection', 0, 'NOW'),
      section('role', 'stable', 'system', 0, 'ROLE'),
      section('tools', 'stable', 'system', 1, 'TOOLS'),
      section('vol-sys', 'volatile', 'system', 0, 'VOL'),
      section('env', 'stable', 'leading-user', 0, 'ENV')
    ]
    const plan = await compileSections(registry, BUILD_INPUT, [])
    expect(plan.system.map((m) => m.content)).toEqual(['ROLE', 'TOOLS', 'VOL'])
    expect(plan.stableBoundary).toBe(2)
    expect(plan.leadingUser.map((m) => m.content)).toEqual(['ENV'])
  })
})

describe('provider strategies — KV cache 断点', () => {
  const plan = {
    system: [{ role: 'system' as const, content: 'S' }],
    stableBoundary: 1,
    leadingUser: [{ role: 'user' as const, content: 'ENV' }],
    history: [
      { role: 'assistant' as const, content: 'summary' },
      { role: 'user' as const, content: 'next' }
    ],
    provenance: { system: [], leadingUser: [], history: [] }
  }

  it('anthropic: summary 拿 1h 断点，history 尾拿 5m', () => {
    const out = strategyFor('anthropic:claude-opus-4-5', 'c1').applyCaching({
      plan,
      summaryIndex: 0
    })
    expect(out.history[0].providerOptions).toMatchObject({
      anthropic: { cacheControl: { ttl: '1h' } }
    })
    expect(out.history[1].providerOptions).toMatchObject({
      anthropic: { cacheControl: { ttl: '5m' } }
    })
  })

  it('openai: per-conversation cache key', () => {
    const out = strategyFor('openai:gpt-5', 'chat-42').applyCaching({ plan, summaryIndex: -1 })
    expect(out.providerOptions).toMatchObject({
      openai: { promptCacheKey: 'tanzo:chat:chat-42' }
    })
  })
})

describe('token ledger — 报告锚点 + 增量估算', () => {
  it('CJK 文本按更密的 chars/token 估算', () => {
    expect(estimateTextTokens('文'.repeat(90))).toBeGreaterThan(estimateTextTokens('a'.repeat(90)))
  })

  it('锚点覆盖之前的内容，之后只估增量', () => {
    const messages: TanzoUIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(40_000) }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'ok' }],
        metadata: {
          usage: { outputTokens: 100 },
          steps: [{ stepNumber: 1, usage: { inputTokens: 12_000, outputTokens: 100 } }]
        }
      } as TanzoUIMessage
    ]
    const m = measureTranscript(messages)
    expect(m.source).toBe('reported')
    expect(m.totalTokens).toBe(12_100)
  })
})

describe('compaction policy + model-domain cut', () => {
  it('trigger/retain/ceiling 由 capabilities 推导', () => {
    expect(computeCompactionPolicy(CAP)).toEqual({
      compactionTriggerTokens: 153_446,
      retainBudgetTokens: 30_000,
      hardCeilingTokens: 191_808
    })
  })

  it('长回合可以在 step 组边界内部切开（v1 的 no-op 缺陷已修复）', () => {
    const transcript: ModelMessage[] = [{ role: 'user', content: 'go' }]
    for (let i = 0; i < 30; i += 1) {
      transcript.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'shell', input: {} }]
      } as ModelMessage)
      transcript.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `c${i}`,
            toolName: 'shell',
            output: { type: 'text', value: 'y'.repeat(4_000) }
          }
        ]
      } as ModelMessage)
    }
    const split = splitModelTranscript(transcript, 5_000)
    expect(split).not.toBeNull()
    expect(split!.head.length).toBeGreaterThan(0)
    // step 组边界：tail 不会以孤儿 tool 消息开头
    expect(split!.tail[0].role).not.toBe('tool')
  })

  it('机械降级永远产出可发送 transcript', () => {
    const huge: ModelMessage[] = [
      { role: 'user', content: 'q'.repeat(400_000) },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'recent' }
    ]
    const out = degradeTranscript(huge, 10_000)
    expect(out).not.toBeNull()
    expect(out!.level).toBe('drop-oldest')
  })
})

describe('context engine — append-only prefix', () => {
  it('同一 transcript 每个 step 构建出的 prompt 完全一致', async () => {
    const engine = createContextEngine({
      clock: { now: () => new Date('2026-06-01T00:00:00.000Z') },
      tanzoInstructions: { read: () => null },
      skillsIndex: { list: () => [] },
      pluginsIndex: { list: () => [] },
      pluginMention: { list: () => [], peek: () => [], take: () => {} },
      gitStatus: { read: () => 'branch: main' },
      goal: { takeInjection: () => null, peekInjection: () => null, get: () => null },
      policyMode: { getMode: () => 'default' },
      resolveModelMetadata: () => ({ contextWindow: 200_000, maxOutput: 8_192 })
    })
    const def = {
      id: 'general',
      name: 'General',
      description: '',
      kind: 'main',
      modelRef: 'deepseek:deepseek-chat',
      systemPrompt: 'ROLE',
      allowedTools: null
    } as never
    const transcript = [{ role: 'user' as const, content: 'hi' }]
    const a = await engine.build(def, 'c1', '/tmp', transcript, 0)
    const b = await engine.build(def, 'c1', '/tmp', transcript, 5)
    expect(b.messages).toEqual(a.messages)
  })
})
