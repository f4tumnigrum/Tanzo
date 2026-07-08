import { randomUUID } from 'crypto'
import type { ChunkSink, Logger } from '../runtime/types'
import type { AgentStore } from '../store-types'
import type { AgentTelemetrySink, AgentTelemetrySinkRecord } from './events'

export function createUiTelemetrySink(input: {
  chatId: string
  send: ChunkSink
  enabled: boolean
}): AgentTelemetrySink {
  return {
    emit(record) {
      if (!input.enabled || !record.data) return
      input.send(
        input.chatId,
        {
          type: 'data-telemetry',
          id: randomUUID(),
          data: record.data,
          transient: true
        } as never,
        { runId: record.data.runId }
      )
    }
  }
}

const INFO_LEVEL_EVENTS = new Set<string>([
  'operation-start',
  'operation-finish',
  'operation-error',
  'retry-attempt'
])

export function createLoggerTelemetrySink(logger: Logger | undefined): AgentTelemetrySink {
  return {
    emit(record) {
      if (!logger || !record.data) return
      const data = record.data
      const payload = {
        event: data.event,
        runId: data.runId,
        chatId: data.chatId,
        scope: data.scope,
        sequence: data.sequence,
        provider: data.provider,
        modelId: data.modelId,
        callId: data.callId,
        stepNumber: data.stepNumber,
        durationMs: data.durationMs,
        retry: data.retry,
        error: data.error,
        ...(data.event === 'operation-finish'
          ? {
              usage: data.usage,
              ttftMs: data.chunks?.firstChunkMs,
              chunkCount: data.chunks?.count
            }
          : {})
      }
      // High-frequency per-step/model/tool events go to debug so they stay out of
      // the on-disk log (file transport level is info) but remain visible in dev.
      if (data.error || data.event === 'retry-exhausted')
        logger.warn('agent telemetry event', payload)
      else if (INFO_LEVEL_EVENTS.has(data.event)) logger.info('agent telemetry event', payload)
      else logger.debug('agent telemetry event', payload)
    }
  }
}

export function createMemoryTelemetrySink(target: AgentTelemetrySinkRecord[]): AgentTelemetrySink {
  return {
    wantsRaw: true,
    emit(record) {
      target.push(record)
    }
  }
}

export function createDbTelemetrySink(input: {
  store: Pick<AgentStore, 'recordToolExecution' | 'recordModelCall'>
  logger?: Logger
}): AgentTelemetrySink {
  return {
    emit(record) {
      const data = record.data
      if (!data) return
      if (data.event === 'tool-finish') {
        if (data.scope !== 'chat' || !data.chatId) return
        try {
          input.store.recordToolExecution({
            id: randomUUID(),
            runId: `${data.chatId}:${data.runId}`,
            conversationId: data.chatId,
            toolName: data.tool?.name ?? 'unknown',
            ...(data.tool?.callId ? { toolCallId: data.tool.callId } : {}),
            success: data.tool?.success !== false,
            ...(typeof (data.tool?.durationMs ?? data.durationMs) === 'number'
              ? { durationMs: data.tool?.durationMs ?? data.durationMs }
              : {}),
            ...(data.error?.kind ? { errorKind: data.error.kind } : {}),
            ...(data.error?.message ? { errorMessage: data.error.message } : {}),
            createdAt: data.timestamp
          })
        } catch (error) {
          input.logger?.warn('tool execution telemetry persist failed', {
            chatId: data.chatId,
            runId: data.runId,
            tool: data.tool?.name,
            error
          })
        }
        return
      }
      if (data.event === 'model-call-finish') {
        // chat runs and compaction forks both carry a chatId; embed/rerank do not.
        if ((data.scope !== 'chat' && data.scope !== 'compaction') || !data.chatId) return
        try {
          input.store.recordModelCall({
            id: randomUUID(),
            runId: `${data.chatId}:${data.runId}`,
            conversationId: data.chatId,
            scope: data.scope,
            ...(data.provider ? { provider: data.provider } : {}),
            ...(data.modelId ? { modelId: data.modelId } : {}),
            ...(typeof data.stepNumber === 'number' ? { stepNumber: data.stepNumber } : {}),
            attempt: data.retry?.attempt ?? 1,
            success: !data.error,
            ...(typeof data.durationMs === 'number' ? { durationMs: data.durationMs } : {}),
            ...(data.error?.kind ? { errorKind: data.error.kind } : {}),
            ...(typeof data.error?.statusCode === 'number'
              ? { statusCode: data.error.statusCode }
              : {}),
            ...(typeof data.usage?.inputTokens === 'number'
              ? { inputTokens: data.usage.inputTokens }
              : {}),
            ...(typeof data.usage?.outputTokens === 'number'
              ? { outputTokens: data.usage.outputTokens }
              : {}),
            ...(typeof data.usage?.cacheReadTokens === 'number'
              ? { cacheReadTokens: data.usage.cacheReadTokens }
              : {}),
            createdAt: data.timestamp
          })
        } catch (error) {
          input.logger?.warn('model call telemetry persist failed', {
            chatId: data.chatId,
            runId: data.runId,
            provider: data.provider,
            error
          })
        }
      }
    }
  }
}

export function emitToSinks(
  sinks: AgentTelemetrySink[],
  record: AgentTelemetrySinkRecord,
  logger?: Logger
): void {
  for (const sink of sinks) {
    try {
      const result = sink.emit(record)
      if (result && typeof (result as Promise<void>).then === 'function') {
        void Promise.resolve(result).catch((error) => {
          logger?.warn('agent telemetry sink failed', { error })
        })
      }
    } catch (error) {
      logger?.warn('agent telemetry sink failed', { error })
    }
  }
}
