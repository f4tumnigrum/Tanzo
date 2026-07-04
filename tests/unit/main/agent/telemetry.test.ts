import { APICallError, LoadAPIKeyError, TypeValidationError } from '@ai-sdk/provider'
import { RetryError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { createAgentTelemetry, normalizeTelemetryError } from '@main/agent/telemetry'
import { createMemoryTelemetrySink, createDbTelemetrySink } from '@main/agent/telemetry/sinks'
import type { AgentTelemetrySinkRecord } from '@main/agent/telemetry/events'

describe('agent/telemetry', () => {
  it('emits ai-sdk lifecycle events, retry attempts, and chunk summaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const records: AgentTelemetrySinkRecord[] = []
    const telemetry = createAgentTelemetry({
      runId: 'run-1',
      chatId: 'chat-1',
      scope: 'chat',
      sinks: [createMemoryTelemetrySink(records)],
      broadcast: false
    })
    const integration = telemetry.options.integrations?.[0]

    integration?.onStart?.({
      operationId: 'ai.streamText',
      callId: 'call-1',
      provider: 'openai',
      modelId: 'gpt',
      maxRetries: 2
    } as never)
    integration?.onStepStart?.({
      callId: 'call-1',
      stepNumber: 0,
      provider: 'openai',
      modelId: 'gpt'
    } as never)
    integration?.onLanguageModelCallStart?.({
      callId: 'call-1',
      provider: 'openai',
      modelId: 'gpt'
    } as never)
    integration?.onLanguageModelCallStart?.({
      callId: 'call-1',
      provider: 'openai',
      modelId: 'gpt'
    } as never)
    integration?.onToolExecutionStart?.({
      callId: 'call-1',
      toolCall: { toolName: 'shell', toolCallId: 'tool-1' }
    } as never)
    integration?.onToolExecutionEnd?.({
      callId: 'call-1',
      durationMs: 3,
      toolCall: { toolName: 'shell', toolCallId: 'tool-1' },
      toolOutput: { type: 'tool-result', output: { ok: true } }
    } as never)
    integration?.onStepEnd?.({
      stepNumber: 0,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    } as never)
    integration?.onEnd?.({
      operationId: 'ai.streamText',
      callId: 'call-1',
      provider: 'openai',
      modelId: 'gpt',
      totalUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    } as never)

    const events = records.flatMap((record) => (record.data ? [record.data] : []))
    expect(events.map((event) => event.event)).toEqual([
      'operation-start',
      'step-start',
      'model-call-start',
      'retry-attempt',
      'model-call-start',
      'tool-start',
      'tool-finish',
      'step-finish',
      'operation-finish'
    ])
    expect(events.find((event) => event.event === 'retry-attempt')).toMatchObject({
      retry: { attempt: 2, maxRetries: 2 }
    })
    expect(telemetry.flushChunkSummary()).toBeUndefined()

    vi.useRealTimers()
  })

  it('persists tool-finish events through the db sink without breaking on failures', () => {
    const recordToolExecution = vi.fn()
    const telemetry = createAgentTelemetry({
      runId: 'run-1',
      chatId: 'chat-1',
      scope: 'chat',
      sinks: [createDbTelemetrySink({ store: { recordToolExecution } })],
      broadcast: false
    })
    const integration = telemetry.options.integrations?.[0]

    integration?.onToolExecutionStart?.({
      callId: 'call-1',
      toolCall: { toolName: 'shell', toolCallId: 'tool-1' }
    } as never)
    integration?.onToolExecutionEnd?.({
      callId: 'call-1',
      durationMs: 12,
      toolCall: { toolName: 'shell', toolCallId: 'tool-1' },
      toolOutput: { type: 'tool-result', output: { ok: true } }
    } as never)

    integration?.onToolExecutionEnd?.({
      callId: 'call-2',
      durationMs: 4,
      toolCall: { toolName: 'grep', toolCallId: 'tool-2' },
      toolOutput: { type: 'tool-error', error: new Error('boom') }
    } as never)

    integration?.onStepEnd?.({ stepNumber: 0 } as never)

    expect(recordToolExecution).toHaveBeenCalledTimes(2)
    expect(recordToolExecution.mock.calls[0][0]).toMatchObject({
      runId: 'chat-1:run-1',
      conversationId: 'chat-1',
      toolName: 'shell',
      toolCallId: 'tool-1',
      success: true,
      durationMs: 12
    })
    expect(recordToolExecution.mock.calls[1][0]).toMatchObject({ toolName: 'grep', success: false })

    const throwingTelemetry = createAgentTelemetry({
      runId: 'run-2',
      chatId: 'chat-2',
      scope: 'chat',
      sinks: [
        createDbTelemetrySink({
          store: {
            recordToolExecution: () => {
              throw new Error('db down')
            }
          }
        })
      ],
      broadcast: false
    })
    const throwingIntegration = throwingTelemetry.options.integrations?.[0]
    expect(() =>
      throwingIntegration?.onToolExecutionEnd?.({
        callId: 'call-3',
        durationMs: 1,
        toolCall: { toolName: 'read', toolCallId: 'tool-3' },
        toolOutput: { type: 'tool-result', output: {} }
      } as never)
    ).not.toThrow()
  })

  it('normalizes provider, configuration, validation, and retry errors', () => {
    const api = new APICallError({
      message: 'Rate limited',
      url: 'https://api.test',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: 'too many requests'
    })
    const retry = new RetryError({
      message: 'Failed after retries',
      reason: 'maxRetriesExceeded',
      errors: [api, api, api]
    })

    expect(normalizeTelemetryError(api)).toMatchObject({
      kind: 'api',
      message: expect.stringContaining('Rate limited'),
      statusCode: 429,
      retryable: true
    })
    expect(normalizeTelemetryError(new LoadAPIKeyError({ message: 'missing key' }))).toMatchObject({
      kind: 'configuration',
      message: expect.stringContaining('missing key')
    })
    const validation = normalizeTelemetryError(
      TypeValidationError.wrap({ value: { payload: 'x'.repeat(5_000) }, cause: new Error('bad') })
    )
    expect(validation).toMatchObject({ kind: 'validation' })
    expect(validation.message.length).toBeLessThan(1_100)
    expect(validation.message).toContain('[truncated')
    expect(validation.message).not.toContain('x'.repeat(2_000))
    expect(normalizeTelemetryError(retry)).toMatchObject({
      kind: 'retry',
      reason: 'maxRetriesExceeded',
      attempts: 3,
      statusCode: 429
    })
  })

  it('classifies an abort-reason RetryError as a cancellation, not a retry failure', () => {
    const abortRetry = new RetryError({
      message: 'Aborted during retry',
      reason: 'abort',
      errors: [new Error('aborted')]
    })
    expect(normalizeTelemetryError(abortRetry)).toMatchObject({
      kind: 'abort',
      reason: 'abort',
      attempts: 1
    })
  })

  it('classifies @ai-sdk/mcp client errors by their AISDKError marker', () => {
    const mcpError = Object.assign(new Error('MCP server request failed'), {
      [Symbol.for('vercel.ai.error.AI_MCPClientError')]: true
    })
    const oauthError = Object.assign(new Error('MCP OAuth flow failed'), {
      [Symbol.for('vercel.ai.error.AI_MCPClientOAuthError')]: true
    })
    expect(normalizeTelemetryError(mcpError)).toMatchObject({ kind: 'tool' })
    expect(normalizeTelemetryError(oauthError)).toMatchObject({ kind: 'tool' })
  })

  it('emits retry-exhausted and operation-error for terminal RetryError', () => {
    const records: AgentTelemetrySinkRecord[] = []
    const telemetry = createAgentTelemetry({
      runId: 'run-1',
      chatId: 'chat-1',
      scope: 'chat',
      sinks: [createMemoryTelemetrySink(records)],
      broadcast: false
    })
    const api = new APICallError({
      message: 'Rate limited',
      url: 'https://api.test',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: 'too many requests'
    })
    telemetry.emitError(
      new RetryError({
        message: 'Failed after retries',
        reason: 'maxRetriesExceeded',
        errors: [api, api]
      })
    )

    const events = records.flatMap((record) => (record.data ? [record.data] : []))
    expect(events).toEqual([
      expect.objectContaining({
        event: 'retry-exhausted',
        retry: expect.objectContaining({ attempt: 2, attempts: 2, reason: 'maxRetriesExceeded' })
      }),
      expect.objectContaining({
        event: 'operation-error',
        error: expect.objectContaining({ kind: 'retry', attempts: 2 })
      })
    ])
  })

  it('normalizes the error from the SDK onError `{ callId, error }` wrapper', () => {
    const records: AgentTelemetrySinkRecord[] = []
    const telemetry = createAgentTelemetry({
      runId: 'run-1',
      chatId: 'chat-1',
      scope: 'chat',
      sinks: [createMemoryTelemetrySink(records)],
      broadcast: false
    })
    const api = new APICallError({
      message: 'Unauthorized',
      url: 'https://api.test',
      requestBodyValues: { model: 'gpt' },
      statusCode: 401,
      responseHeaders: {},
      responseBody: '{"code":"INVALID_API_KEY","message":"Invalid API key"}',
      isRetryable: false
    })

    telemetry.options.integrations?.[0]?.onError?.({ callId: 'call-1', error: api } as never)

    const operationError = records
      .flatMap((record) => (record.data ? [record.data] : []))
      .find((event) => event.event === 'operation-error')
    expect(operationError?.error).toMatchObject({
      kind: 'api',
      statusCode: 401,

      message: 'Invalid API key'
    })

    expect(operationError?.error?.message).not.toContain('callId')
    expect(operationError?.error?.message).not.toContain('requestBodyValues')
  })

  it('normalizes every public AI SDK error export to a Tanzo error kind', async () => {
    const [ai, provider, providerUtils] = await Promise.all([
      import('ai'),
      import('@ai-sdk/provider'),
      import('@ai-sdk/provider-utils')
    ])
    const publicErrorNames = [ai, provider, providerUtils]
      .flatMap((mod) => Object.keys(mod))
      .filter((name) => /^[A-Z].*Error$/.test(name))
    const api = new provider.APICallError({
      message: 'Rate limited',
      url: 'https://api.test',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: 'too many requests'
    })
    const invalidToolInput = new ai.InvalidToolInputError({
      toolInput: '{}',
      toolName: 'demo',
      cause: new Error('bad input')
    })
    const response = { id: 'response-1', modelId: 'model-1', timestamp: new Date(0) } as never
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never
    const cases: Array<{
      exportName: string
      error: unknown
      kind: ReturnType<typeof normalizeTelemetryError>['kind']
    }> = [
      {
        exportName: 'AISDKError',
        error: new provider.AISDKError({ name: 'AI_TestError', message: 'generic' }),
        kind: 'unknown'
      },
      { exportName: 'APICallError', error: api, kind: 'api' },
      {
        exportName: 'DownloadError',
        error: new providerUtils.DownloadError({ url: 'https://x.test' }),
        kind: 'download'
      },
      {
        exportName: 'EmptyResponseBodyError',
        error: new provider.EmptyResponseBodyError(),
        kind: 'content'
      },
      {
        exportName: 'InvalidArgumentError',
        error: new ai.InvalidArgumentError({ parameter: 'maxRetries', value: -1, message: 'bad' }),
        kind: 'configuration'
      },
      {
        exportName: 'InvalidArgumentError',
        error: new provider.InvalidArgumentError({ argument: 'maxRetries', message: 'bad' }),
        kind: 'configuration'
      },
      {
        exportName: 'InvalidDataContentError',
        error: new ai.InvalidDataContentError({ content: {} }),
        kind: 'validation'
      },
      {
        exportName: 'InvalidMessageRoleError',
        error: new ai.InvalidMessageRoleError({ role: 'bad' }),
        kind: 'validation'
      },
      {
        exportName: 'InvalidPromptError',
        error: new provider.InvalidPromptError({ prompt: {}, message: 'bad prompt' }),
        kind: 'validation'
      },
      {
        exportName: 'InvalidResponseDataError',
        error: new provider.InvalidResponseDataError({ data: {} }),
        kind: 'validation'
      },
      {
        exportName: 'InvalidStreamPartError',
        error: new ai.InvalidStreamPartError({
          chunk: { type: 'text-delta' } as never,
          message: 'bad'
        }),
        kind: 'stream'
      },
      {
        exportName: 'InvalidToolApprovalError',
        error: new ai.InvalidToolApprovalError({ approvalId: 'approval-1' }),
        kind: 'tool'
      },
      {
        exportName: 'InvalidToolApprovalSignatureError',
        error: new ai.InvalidToolApprovalSignatureError({
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
          reason: 'bad signature'
        }),
        kind: 'tool'
      },
      { exportName: 'InvalidToolInputError', error: invalidToolInput, kind: 'tool' },
      {
        exportName: 'JSONParseError',
        error: new provider.JSONParseError({ text: '{', cause: new Error('bad json') }),
        kind: 'validation'
      },
      {
        exportName: 'LoadAPIKeyError',
        error: new provider.LoadAPIKeyError({ message: 'missing key' }),
        kind: 'configuration'
      },
      {
        exportName: 'LoadSettingError',
        error: new provider.LoadSettingError({ message: 'missing setting' }),
        kind: 'configuration'
      },
      {
        exportName: 'MessageConversionError',
        error: new ai.MessageConversionError({
          originalMessage: { role: 'user', parts: [] } as never,
          message: 'bad message'
        }),
        kind: 'validation'
      },
      {
        exportName: 'MissingToolResultsError',
        error: new ai.MissingToolResultsError({ toolCallIds: ['tool-1'] }),
        kind: 'tool'
      },
      {
        exportName: 'NoContentGeneratedError',
        error: new provider.NoContentGeneratedError(),
        kind: 'content'
      },
      {
        exportName: 'NoImageGeneratedError',
        error: new ai.NoImageGeneratedError({}),
        kind: 'content'
      },
      {
        exportName: 'NoObjectGeneratedError',
        error: new ai.NoObjectGeneratedError({ response, usage, finishReason: 'stop' }),
        kind: 'content'
      },
      {
        exportName: 'NoOutputGeneratedError',
        error: new ai.NoOutputGeneratedError(),
        kind: 'content'
      },
      {
        exportName: 'NoSpeechGeneratedError',
        error: new ai.NoSpeechGeneratedError({ responses: [] }),
        kind: 'content'
      },
      {
        exportName: 'NoSuchModelError',
        error: new provider.NoSuchModelError({ modelId: 'missing', modelType: 'languageModel' }),
        kind: 'model'
      },
      {
        exportName: 'NoSuchProviderError',
        error: new ai.NoSuchProviderError({
          modelId: 'missing:model',
          modelType: 'languageModel',
          providerId: 'missing',
          availableProviders: ['openai']
        }),
        kind: 'provider'
      },
      {
        exportName: 'NoSuchProviderReferenceError',
        error: new provider.NoSuchProviderReferenceError({
          provider: 'missing',
          reference: { openai: {} } as never
        }),
        kind: 'provider'
      },
      {
        exportName: 'NoSuchToolError',
        error: new ai.NoSuchToolError({ toolName: 'missing', availableTools: ['read'] }),
        kind: 'tool'
      },
      {
        exportName: 'NoTranscriptGeneratedError',
        error: new ai.NoTranscriptGeneratedError({ responses: [] }),
        kind: 'content'
      },
      {
        exportName: 'NoVideoGeneratedError',
        error: new ai.NoVideoGeneratedError({ responses: [] }),
        kind: 'content'
      },
      {
        exportName: 'RetryError',
        error: new ai.RetryError({
          message: 'Failed after retries',
          reason: 'maxRetriesExceeded',
          errors: [api]
        }),
        kind: 'retry'
      },
      {
        exportName: 'TooManyEmbeddingValuesForCallError',
        error: new provider.TooManyEmbeddingValuesForCallError({
          provider: 'openai',
          modelId: 'embed',
          maxEmbeddingsPerCall: 1,
          values: [1, 2]
        }),
        kind: 'model'
      },
      {
        exportName: 'ToolCallNotFoundForApprovalError',
        error: new ai.ToolCallNotFoundForApprovalError({
          toolCallId: 'tool-1',
          approvalId: 'approval-1'
        }),
        kind: 'tool'
      },
      {
        exportName: 'ToolCallRepairError',
        error: new ai.ToolCallRepairError({
          cause: new Error('repair failed'),
          originalError: invalidToolInput
        }),
        kind: 'tool'
      },
      {
        exportName: 'TypeValidationError',
        error: provider.TypeValidationError.wrap({ value: {}, cause: new Error('invalid') }),
        kind: 'validation'
      },
      {
        exportName: 'UIMessageStreamError',
        error: new ai.UIMessageStreamError({
          chunkType: 'text-delta',
          chunkId: 'part-1',
          message: 'bad stream'
        }),
        kind: 'stream'
      },
      {
        exportName: 'UnsupportedFunctionalityError',
        error: new provider.UnsupportedFunctionalityError({ functionality: 'demo' }),
        kind: 'unsupported'
      },
      {
        exportName: 'UnsupportedModelVersionError',
        error: new ai.UnsupportedModelVersionError({
          version: 'v1',
          provider: 'openai',
          modelId: 'legacy'
        }),
        kind: 'model'
      }
    ]

    expect([...new Set(cases.map((item) => item.exportName))].sort()).toEqual(
      [...new Set(publicErrorNames)].sort()
    )
    for (const item of cases) {
      expect(normalizeTelemetryError(item.error), item.exportName).toMatchObject({
        kind: item.kind
      })
    }
  })
})
