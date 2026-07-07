import {
  AISDKError,
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError as ProviderInvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError as ProviderJSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoContentGeneratedError,
  NoSuchModelError,
  NoSuchProviderReferenceError,
  TooManyEmbeddingValuesForCallError,
  TypeValidationError,
  UnsupportedFunctionalityError,
  getErrorMessage
} from '@ai-sdk/provider'
import {
  DownloadError,
  InvalidArgumentError,
  InvalidDataContentError,
  InvalidMessageRoleError,
  InvalidStreamPartError,
  InvalidToolApprovalError,
  InvalidToolApprovalSignatureError,
  InvalidToolInputError,
  MessageConversionError,
  MissingToolResultsError,
  NoImageGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  NoSpeechGeneratedError,
  NoSuchProviderError,
  NoSuchToolError,
  NoTranscriptGeneratedError,
  NoVideoGeneratedError,
  RetryError,
  ToolCallNotFoundForApprovalError,
  ToolCallRepairError,
  UIMessageStreamError,
  UnsupportedModelVersionError
} from 'ai'
import type { AgentTelemetryError, AgentTelemetryRetry } from './events'

const MAX_ERROR_MESSAGE_LENGTH = 1_000

function truncateErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}… [truncated ${message.length - MAX_ERROR_MESSAGE_LENGTH} chars]`
}

type RetryReason = NonNullable<AgentTelemetryError['reason']>

type ErrorClass<T> = {
  isInstance?: (error: unknown) => error is T
}

function isSdkInstance<T>(klass: ErrorClass<T>, error: unknown): error is T {
  try {
    return klass.isInstance?.(error) === true
  } catch {
    return false
  }
}

function isConstructorInstance<T>(
  klass: abstract new (...args: never[]) => T,
  error: unknown
): error is T {
  return error instanceof klass
}

function hasAiSdkErrorMarker(error: unknown, name: string): boolean {
  const markerSymbol = Symbol.for(`vercel.ai.error.${name}`)
  return (
    error != null &&
    typeof error === 'object' &&
    markerSymbol in error &&
    (error as Record<symbol, unknown>)[markerSymbol] === true
  )
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error && error.name ? error.name : undefined
}

function stringProperty(error: unknown, key: string): string | undefined {
  const value = (error as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberProperty(error: unknown, key: string): number | undefined {
  const value = (error as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanProperty(error: unknown, key: string): boolean | undefined {
  const value = (error as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function errorMessage(error: unknown): string {
  return truncateErrorMessage(getErrorMessage(error))
}

function responseBodyMessage(error: unknown): string | undefined {
  const body = (error as { responseBody?: unknown } | undefined)?.responseBody
  if (typeof body !== 'string' || body.length === 0) return undefined
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } }
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : undefined
    return message && message.length > 0 ? message : undefined
  } catch {
    return undefined
  }
}

function bestErrorMessage(error: unknown): string {
  return truncateErrorMessage(responseBodyMessage(error) ?? getErrorMessage(error))
}

function causeSummary(error: unknown): AgentTelemetryError['cause'] | undefined {
  const cause = (error as { cause?: unknown } | undefined)?.cause
  if (!cause) return undefined
  return {
    ...(errorName(cause) ? { name: errorName(cause) } : {}),
    message: errorMessage(cause)
  }
}

function baseError(error: unknown, kind: AgentTelemetryError['kind']): AgentTelemetryError {
  return {
    kind,
    ...(errorName(error) ? { name: errorName(error) } : {}),
    message: bestErrorMessage(error),
    ...(numberProperty(error, 'statusCode') !== undefined
      ? { statusCode: numberProperty(error, 'statusCode') }
      : {}),
    ...(booleanProperty(error, 'isRetryable') !== undefined
      ? { retryable: booleanProperty(error, 'isRetryable') }
      : {}),
    ...(stringProperty(error, 'provider') ? { provider: stringProperty(error, 'provider') } : {}),
    ...(stringProperty(error, 'modelId') ? { modelId: stringProperty(error, 'modelId') } : {}),
    ...(stringProperty(error, 'toolName') ? { toolName: stringProperty(error, 'toolName') } : {}),
    ...(stringProperty(error, 'toolCallId')
      ? { toolCallId: stringProperty(error, 'toolCallId') }
      : {}),
    ...(causeSummary(error) ? { cause: causeSummary(error) } : {})
  }
}

function retryReason(value: unknown): RetryReason | undefined {
  return value === 'maxRetriesExceeded' || value === 'errorNotRetryable' || value === 'abort'
    ? value
    : undefined
}

export function retryTelemetryFromError(error: unknown): AgentTelemetryRetry | undefined {
  if (!isSdkInstance(RetryError, error)) return undefined
  const attempts = error.errors.length
  const lastError = error.lastError
  return {
    attempt: Math.max(attempts, 1),
    attempts,
    reason: error.reason,
    lastMessage: errorMessage(lastError),
    ...(booleanProperty(lastError, 'isRetryable') !== undefined
      ? { retryable: booleanProperty(lastError, 'isRetryable') }
      : {})
  }
}

export function normalizeTelemetryError(error: unknown): AgentTelemetryError {
  if (isSdkInstance(RetryError, error)) {
    const lastError = error.lastError

    if (error.reason === 'abort') {
      return {
        ...baseError(lastError, 'abort'),
        ...(errorName(error) ? { name: errorName(error) } : {}),
        message: bestErrorMessage(lastError) || errorMessage(error),
        reason: error.reason,
        attempts: error.errors.length
      }
    }
    return {
      ...baseError(lastError, 'retry'),
      ...(errorName(error) ? { name: errorName(error) } : {}),

      message: bestErrorMessage(lastError) || errorMessage(error),
      reason: error.reason,
      attempts: error.errors.length,
      ...(causeSummary(lastError) ? { cause: causeSummary(lastError) } : {})
    }
  }

  if (isSdkInstance(APICallError, error)) return baseError(error, 'api')

  if (
    errorName(error) === 'AbortError' ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  ) {
    return baseError(error, 'abort')
  }

  if (
    isSdkInstance(LoadAPIKeyError, error) ||
    isSdkInstance(LoadSettingError, error) ||
    isSdkInstance(ProviderInvalidArgumentError, error) ||
    isSdkInstance(InvalidArgumentError, error)
  ) {
    return baseError(error, 'configuration')
  }

  if (
    isSdkInstance(TypeValidationError, error) ||
    isSdkInstance(InvalidPromptError, error) ||
    isSdkInstance(InvalidResponseDataError, error) ||
    isSdkInstance(ProviderJSONParseError, error) ||
    isSdkInstance(InvalidDataContentError, error) ||
    isSdkInstance(InvalidMessageRoleError, error) ||
    isSdkInstance(MessageConversionError, error)
  ) {
    return baseError(error, 'validation')
  }

  if (
    isSdkInstance(NoSuchProviderError, error) ||
    isSdkInstance(NoSuchProviderReferenceError, error)
  ) {
    return baseError(error, 'provider')
  }

  if (
    isSdkInstance(NoSuchModelError, error) ||
    isSdkInstance(TooManyEmbeddingValuesForCallError, error) ||
    isConstructorInstance(UnsupportedModelVersionError, error)
  ) {
    return baseError(error, 'model')
  }

  if (
    isSdkInstance(InvalidToolInputError, error) ||
    isSdkInstance(NoSuchToolError, error) ||
    isSdkInstance(InvalidToolApprovalError, error) ||
    isSdkInstance(InvalidToolApprovalSignatureError, error) ||
    isSdkInstance(ToolCallNotFoundForApprovalError, error) ||
    isSdkInstance(MissingToolResultsError, error) ||
    isSdkInstance(ToolCallRepairError, error)
  ) {
    return baseError(error, 'tool')
  }

  if (isSdkInstance(UIMessageStreamError, error) || isSdkInstance(InvalidStreamPartError, error)) {
    return baseError(error, 'stream')
  }

  if (
    hasAiSdkErrorMarker(error, 'AI_MCPClientError') ||
    hasAiSdkErrorMarker(error, 'AI_MCPClientOAuthError')
  ) {
    return baseError(error, 'tool')
  }

  if (
    isSdkInstance(EmptyResponseBodyError, error) ||
    isSdkInstance(NoContentGeneratedError, error) ||
    isSdkInstance(NoOutputGeneratedError, error) ||
    isSdkInstance(NoObjectGeneratedError, error) ||
    isSdkInstance(NoImageGeneratedError, error) ||
    isSdkInstance(NoSpeechGeneratedError, error) ||
    isSdkInstance(NoTranscriptGeneratedError, error) ||
    isSdkInstance(NoVideoGeneratedError, error)
  ) {
    return baseError(error, 'content')
  }

  if (isSdkInstance(DownloadError, error)) return baseError(error, 'download')

  if (isSdkInstance(UnsupportedFunctionalityError, error)) return baseError(error, 'unsupported')

  if (isSdkInstance(AISDKError, error)) return baseError(error, 'unknown')

  const reason = retryReason((error as { reason?: unknown } | undefined)?.reason)
  return {
    ...baseError(error, 'unknown'),
    ...(reason ? { reason } : {})
  }
}
