export interface PluginId {
  pluginName: string

  marketplaceName: string
}

export type PluginIdResult = { ok: true; id: PluginId } | { ok: false; error: string }

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/

export function validatePluginSegment(segment: string, kind: string): string | null {
  if (segment.length === 0) return `invalid ${kind}: must not be empty`
  if (!SEGMENT_RE.test(segment)) {
    return `invalid ${kind}: only ASCII letters, digits, \`_\`, and \`-\` are allowed`
  }
  return null
}

export function makePluginId(pluginName: string, marketplaceName: string): PluginIdResult {
  const pluginError = validatePluginSegment(pluginName, 'plugin name')
  if (pluginError) return { ok: false, error: pluginError }
  const marketplaceError = validatePluginSegment(marketplaceName, 'marketplace name')
  if (marketplaceError) return { ok: false, error: marketplaceError }
  return { ok: true, id: { pluginName, marketplaceName } }
}

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

export function pluginIdKey(id: PluginId): string {
  return `${id.pluginName}@${id.marketplaceName}`
}
