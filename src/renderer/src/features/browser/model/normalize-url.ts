const SEARCH_PREFIX = 'https://www.google.com/search?q='

/**
 * Turn whatever the user typed in the address bar into a navigable http(s) URL.
 *
 * - Full URLs are kept as-is.
 * - Bare hostnames like `example.com` get `https://` prepended.
 * - Anything that does not look like a host (has spaces, no dot) becomes a
 *   web search.
 */
export function normalizeAddressInput(raw: string): string | null {
  const input = raw.trim()
  if (input.length === 0) return null

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      if (url.hostname.length === 0) return null
      return url.toString()
    } catch {
      return SEARCH_PREFIX + encodeURIComponent(input)
    }
  }

  // Looks like a host: no spaces and contains a dot (or is localhost).
  const looksLikeHost = !/\s/.test(input) && (input.includes('.') || input.startsWith('localhost'))
  if (looksLikeHost) {
    try {
      const url = new URL(`https://${input}`)
      if (url.hostname.length === 0) return null
      return url.toString()
    } catch {
      // fall through to search
    }
  }

  return SEARCH_PREFIX + encodeURIComponent(input)
}
