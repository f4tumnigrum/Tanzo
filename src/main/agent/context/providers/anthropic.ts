import type { ModelMessage, SystemModelMessage } from 'ai'
import type { CompiledContext } from '../section'
import type { CachingInput, ProviderContextStrategy } from './strategy'

type Ttl = '5m' | '1h'

function withCacheControl<T extends { providerOptions?: Record<string, unknown> }>(
  message: T,
  ttl: Ttl
): T {
  const prev = message.providerOptions ?? {}
  const prevAnthropic = (prev.anthropic as Record<string, unknown> | undefined) ?? {}
  return {
    ...message,
    providerOptions: {
      ...prev,
      anthropic: { ...prevAnthropic, cacheControl: { type: 'ephemeral', ttl } }
    }
  }
}

function markStableBoundary(system: SystemModelMessage[], boundary: number): SystemModelMessage[] {
  if (boundary <= 0 || boundary > system.length) return system
  const index = boundary - 1
  return system.map((message, i) => (i === index ? withCacheControl(message, '1h') : message))
}

function markLast(messages: ModelMessage[], ttl: Ttl): ModelMessage[] {
  if (messages.length === 0) return messages
  const index = messages.length - 1
  return messages.map((message, i) => (i === index ? withCacheControl(message, ttl) : message))
}

export function createAnthropicStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'ephemeral',
    applyCaching({ plan, summaryIndex }: CachingInput): CompiledContext {
      let history = plan.history
      if (summaryIndex >= 0 && summaryIndex < history.length - 1) {
        history = history.map((message, i) =>
          i === summaryIndex ? withCacheControl(message, '1h') : message
        )
      }
      history = markLast(history, '5m')
      return {
        ...plan,
        system: markStableBoundary(plan.system, plan.stableBoundary),
        leadingUser: markLast(plan.leadingUser, '1h'),
        history
      }
    }
  }
}
