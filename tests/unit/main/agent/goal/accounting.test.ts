import { describe, expect, it } from 'vitest'
import { effectiveTokens } from '@main/agent/goal/accounting'

describe('agent/goal/accounting', () => {
  it('counts only new compute when the cache breakdown is available', () => {
    // 100k prompt, 95k cache read, 4k no-cache, 1k cache write, 2k output.
    expect(
      effectiveTokens({
        inputTokens: 100_000,
        outputTokens: 2_000,
        totalTokens: 102_000,
        inputTokenDetails: {
          noCacheTokens: 4_000,
          cacheReadTokens: 95_000,
          cacheWriteTokens: 1_000
        }
      })
    ).toBe(7_000)
  })

  it('ignores cache reads entirely', () => {
    expect(
      effectiveTokens({
        inputTokens: 50_000,
        outputTokens: 0,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 50_000, cacheWriteTokens: 0 }
      })
    ).toBe(0)
  })

  it('falls back to full input + output when the breakdown is missing', () => {
    expect(effectiveTokens({ inputTokens: 1_000, outputTokens: 200 })).toBe(1_200)
    expect(
      effectiveTokens({
        inputTokens: 1_000,
        outputTokens: 200,
        inputTokenDetails: { cacheReadTokens: 800 }
      })
    ).toBe(1_200)
  })

  it('returns 0 for missing usage', () => {
    expect(effectiveTokens(undefined)).toBe(0)
    expect(effectiveTokens({})).toBe(0)
  })
})
