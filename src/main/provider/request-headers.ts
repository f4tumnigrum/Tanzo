import type { ProviderId } from '@shared/provider'

/**
 * Per-request HTTP headers that steer provider-side behavior for a specific
 * conversation. Currently only xAI Grok uses this: the `x-grok-conv-id` header
 * routes requests for the same conversation to the same server, maximizing
 * automatic prompt-cache hits on the Chat Completions endpoint. It is a
 * best-effort optimization — requests succeed without it.
 *
 * Returns `undefined` when no provider-specific headers apply, so callers can
 * omit the `headers` option entirely.
 */
export function conversationRequestHeaders(
  providerId: ProviderId,
  chatId: string
): Record<string, string> | undefined {
  if (providerId === 'grok') {
    const conversationId = chatId.trim()
    if (!conversationId) return undefined
    return { 'x-grok-conv-id': conversationId }
  }
  return undefined
}
