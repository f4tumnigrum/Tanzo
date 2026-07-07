const SEARCH_PREFIX = 'https://www.google.com/search?q='

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
