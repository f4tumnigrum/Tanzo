import { describe, expect, it } from 'vitest'
import { en } from '@renderer/locales/en'
import { zhCN } from '@renderer/locales/zh-CN'

/**
 * Locale parity guard: the zh-CN and en trees must expose the exact same key
 * set. i18next falls back to English for missing zh-CN keys, which silently
 * ships mixed-language UI; extra zh-CN keys are dead weight that hides typos.
 *
 * If this test fails, add the missing keys to the locale named in the
 * assertion message (do not delete keys from the other side unless the code
 * no longer uses them).
 */

function flattenKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix]
  const out: string[] = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(...flattenKeys(value, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

describe('renderer/locales parity', () => {
  const enKeys = new Set(flattenKeys(en))
  const zhKeys = new Set(flattenKeys(zhCN))

  it('zh-CN defines every key that en defines', () => {
    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    expect(missingInZh, 'keys missing in zh-CN.ts (fall back to English at runtime)').toEqual([])
  })

  it('en defines every key that zh-CN defines', () => {
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort()
    expect(missingInEn, 'keys missing in en.ts (dead or mistyped zh-CN keys)').toEqual([])
  })
})
