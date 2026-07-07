import type { TanzoDataParts } from '@shared/agent-message'
import { ERROR_CODES } from '@shared/errors'

export type RunNoticeError = NonNullable<TanzoDataParts['telemetry']['error']>

export type RunNotice =
  | { kind: 'retry'; retryNumber: number; maxRetries?: number }
  | { kind: 'error'; error: RunNoticeError; stale?: boolean }
  | { kind: 'aborted' }

function clearRetry(previous: RunNotice | null): RunNotice | null {
  return previous?.kind === 'retry' ? null : previous
}

export function errorKindFromCode(code: string | undefined): RunNoticeError['kind'] {
  switch (code) {
    case ERROR_CODES.AISDK_API_CALL_ERROR:
      return 'api'
    case ERROR_CODES.AISDK_INVALID_RESPONSE:
      return 'validation'
    case ERROR_CODES.AISDK_NO_SUCH_MODEL:
      return 'model'
    default:
      return 'unknown'
  }
}

export function reduceRunNotice(
  previous: RunNotice | null,
  event: TanzoDataParts['telemetry']
): RunNotice | null {
  switch (event.event) {
    case 'operation-start':
    case 'operation-finish':
    case 'model-call-finish':
    case 'step-finish':
    case 'tool-start':
    case 'tool-finish':
    case 'chunk-summary':
      return clearRetry(previous)
    case 'retry-attempt':
      if (!event.retry) return previous
      return {
        kind: 'retry',
        retryNumber: Math.max(event.retry.attempt - 1, 1),
        ...(event.retry.maxRetries !== undefined ? { maxRetries: event.retry.maxRetries } : {})
      }
    case 'retry-exhausted':
    case 'operation-error':
      if (!event.error) return clearRetry(previous)

      if (event.error.kind === 'abort') return { kind: 'aborted' }
      return { kind: 'error', error: event.error }
    default:
      return previous
  }
}
