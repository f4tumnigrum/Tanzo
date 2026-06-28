import { describe, expect, it } from 'vitest'
import {
  makePluginId,
  parsePluginId,
  pluginIdKey,
  validatePluginSegment
} from '@main/agent/plugins/plugin-id'

describe('main/agent/plugins/plugin-id', () => {
  describe('validatePluginSegment', () => {
    it('accepts ASCII letters, digits, underscore, and hyphen', () => {
      expect(validatePluginSegment('linear', 'plugin name')).toBeNull()
      expect(validatePluginSegment('My_Plugin-2', 'plugin name')).toBeNull()
    })

    it('rejects empty segments', () => {
      expect(validatePluginSegment('', 'plugin name')).toMatch(/must not be empty/)
    })

    it('rejects characters outside the allowed set', () => {
      expect(validatePluginSegment('has space', 'plugin name')).toMatch(/only ASCII/)
      expect(validatePluginSegment('dot.name', 'plugin name')).toMatch(/only ASCII/)
      expect(validatePluginSegment('emoji😀', 'marketplace name')).toMatch(/only ASCII/)
      expect(validatePluginSegment('a@b', 'plugin name')).toMatch(/only ASCII/)
    })
  })

  describe('makePluginId', () => {
    it('builds a validated id', () => {
      const result = makePluginId('linear', 'openai-curated')
      expect(result).toEqual({
        ok: true,
        id: { pluginName: 'linear', marketplaceName: 'openai-curated' }
      })
    })

    it('reports an invalid plugin name', () => {
      const result = makePluginId('bad name', 'mp')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/plugin name/)
    })

    it('reports an invalid marketplace name', () => {
      const result = makePluginId('plugin', 'bad mp')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/marketplace name/)
    })
  })

  describe('parsePluginId', () => {
    it('parses <plugin>@<marketplace>', () => {
      const result = parsePluginId('linear@openai-curated')
      expect(result).toEqual({
        ok: true,
        id: { pluginName: 'linear', marketplaceName: 'openai-curated' }
      })
    })

    it('splits on the last @ so the marketplace is the final segment', () => {
      const result = parsePluginId('a-b@c@personal')
      expect(result.ok).toBe(false)
      // `a-b@c` contains `@`, which is not an allowed plugin-name character.
      if (!result.ok) expect(result.error).toMatch(/only ASCII/)
    })

    it('rejects keys with no @', () => {
      const result = parsePluginId('linear')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/expected <plugin>@<marketplace>/)
    })

    it('rejects an empty plugin segment', () => {
      const result = parsePluginId('@personal')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/expected <plugin>@<marketplace>/)
    })

    it('rejects an empty marketplace segment', () => {
      const result = parsePluginId('linear@')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/expected <plugin>@<marketplace>/)
    })

    it('includes the offending key in segment errors', () => {
      const result = parsePluginId('bad.name@personal')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/in `bad\.name@personal`/)
    })
  })

  describe('pluginIdKey', () => {
    it('round-trips with parsePluginId', () => {
      const key = 'linear@openai-curated'
      const parsed = parsePluginId(key)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(pluginIdKey(parsed.id)).toBe(key)
    })
  })
})
