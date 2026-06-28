/**
 * Stable plugin identifier parsing and validation.
 *
 * Wire-compatible with Codex's `PluginId` (`codex-rs/plugin/src/plugin_id.rs`):
 * a plugin is identified by the key `<plugin>@<marketplace>`, where both
 * segments allow only ASCII letters, digits, `_`, and `-`. This identity is
 * reused as the on-disk cache layout (`<marketplace>/<plugin>/<version>`), so
 * the character set is deliberately strict.
 */

export interface PluginId {
  /** The plugin's own name, matching its `plugin.json` `name`. */
  pluginName: string
  /** The marketplace the plugin was installed from. */
  marketplaceName: string
}

export type PluginIdResult = { ok: true; id: PluginId } | { ok: false; error: string }

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/

/**
 * Validate a single plugin-id segment (plugin name or marketplace name). Codex
 * uses the same rule for both, and for the cache directory layout.
 */
export function validatePluginSegment(segment: string, kind: string): string | null {
  if (segment.length === 0) return `invalid ${kind}: must not be empty`
  if (!SEGMENT_RE.test(segment)) {
    return `invalid ${kind}: only ASCII letters, digits, \`_\`, and \`-\` are allowed`
  }
  return null
}

/** Build a validated PluginId from its two segments. */
export function makePluginId(pluginName: string, marketplaceName: string): PluginIdResult {
  const pluginError = validatePluginSegment(pluginName, 'plugin name')
  if (pluginError) return { ok: false, error: pluginError }
  const marketplaceError = validatePluginSegment(marketplaceName, 'marketplace name')
  if (marketplaceError) return { ok: false, error: marketplaceError }
  return { ok: true, id: { pluginName, marketplaceName } }
}

/**
 * Parse a `<plugin>@<marketplace>` key. Splits on the *last* `@` so plugin
 * names can themselves be unambiguous (mirrors Codex `rsplit_once('@')`).
 */
export function parsePluginId(key: string): PluginIdResult {
  const at = key.lastIndexOf('@')
  if (at <= 0 || at === key.length - 1) {
    return { ok: false, error: `invalid plugin key \`${key}\`; expected <plugin>@<marketplace>` }
  }
  const pluginName = key.slice(0, at)
  const marketplaceName = key.slice(at + 1)
  const result = makePluginId(pluginName, marketplaceName)
  if (!result.ok) return { ok: false, error: `${result.error} in \`${key}\`` }
  return result
}

/** Render a PluginId back to its `<plugin>@<marketplace>` key form. */
export function pluginIdKey(id: PluginId): string {
  return `${id.pluginName}@${id.marketplaceName}`
}
