import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'

export interface TranscriptMeasure {
  totalTokens: number
  source: 'reported' | 'estimated'
}

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/g
const INLINE_MEDIA_TOKEN_ESTIMATE = 2_048

export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  const latin = text.length - cjk
  return Math.ceil(latin / 4 + cjk / 1.5)
}

function estimatePartTokens(part: unknown): number {
  if (typeof part !== 'object' || part === null) return 0
  const record = part as {
    type?: string
    text?: unknown
    image?: unknown
    url?: unknown
    data?: unknown
  }
  const isDataUrl = (value: unknown): boolean =>
    typeof value === 'string' && value.startsWith('data:')
  if (
    (record.type === 'image' && isDataUrl(record.image)) ||
    (record.type === 'file' && (isDataUrl(record.url) || isDataUrl(record.data)))
  ) {
    return INLINE_MEDIA_TOKEN_ESTIMATE
  }
  if (typeof record.text === 'string') return estimateTextTokens(record.text)
  return estimateValueTokens(part)
}

function estimateValueTokens(value: unknown): number {
  if (typeof value === 'string') return estimateTextTokens(value)
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? estimateTextTokens(serialized) : 0
  } catch {
    return 16
  }
}

export function estimateUIMessageTokens(message: TanzoUIMessage): number {
  let tokens = 0
  for (const part of message.parts) {
    const type = (part as { type?: string }).type

    if (type === 'step-start' || type?.startsWith('data-')) continue
    tokens += estimatePartTokens(part)
  }
  return tokens
}

export function estimateModelMessageTokens(message: ModelMessage): number {
  const content = message.content
  if (typeof content === 'string') return estimateTextTokens(content)
  if (!Array.isArray(content)) return 0
  let tokens = 0
  for (const part of content) tokens += estimatePartTokens(part)
  return tokens
}

export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  let total = 0
  for (const message of messages) total += estimateModelMessageTokens(message)
  return total
}

export function isSummaryUIMessage(message: TanzoUIMessage): boolean {
  return message.parts.some((part) => part.type === 'data-compaction')
}

interface AnchorInfo {
  index: number
  inputTokens: number
  outputTokens: number
}

function reportedAnchor(messages: TanzoUIMessage[], afterIndex: number): AnchorInfo | null {
  for (let i = messages.length - 1; i > afterIndex; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    const steps = message.metadata?.steps
    if (!steps || steps.length === 0) continue
    const last = steps[steps.length - 1]
    const inputTokens = last?.usage?.inputTokens
    if (typeof inputTokens !== 'number' || inputTokens <= 0) continue

    const outputTokens = last?.usage?.outputTokens ?? 0
    return { index: i, inputTokens, outputTokens }
  }
  return null
}

function latestSummaryIndex(messages: TanzoUIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isSummaryUIMessage(messages[i])) return i
  }
  return -1
}

function estimatePostAnchorTokens(message: TanzoUIMessage): number {
  let start = 0
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    if (message.parts[i].type === 'step-start') {
      start = i + 1
      break
    }
  }

  let total = 0
  for (let i = start; i < message.parts.length; i += 1) {
    const part = message.parts[i] as {
      type?: string
      state?: string
      output?: unknown
      errorText?: unknown
      approval?: unknown
    }
    if (part.type !== 'dynamic-tool' && !part.type?.startsWith('tool-')) continue

    const approval = part.approval as { approved?: unknown } | undefined
    if (typeof approval?.approved === 'boolean') total += estimateValueTokens(part.approval)
    if (part.state === 'output-available') total += estimateValueTokens(part.output)
    if (
      (part.state === 'output-error' || part.state === 'output-denied') &&
      typeof part.errorText === 'string'
    ) {
      total += estimateTextTokens(part.errorText)
    }
  }
  return total
}

export function measureTranscript(messages: TanzoUIMessage[]): TranscriptMeasure {
  const summaryIdx = latestSummaryIndex(messages)
  const anchor = reportedAnchor(messages, summaryIdx)

  if (!anchor) {
    let total = 0
    for (const message of messages) total += estimateUIMessageTokens(message)
    return { totalTokens: total, source: 'estimated' }
  }

  let total =
    anchor.inputTokens + anchor.outputTokens + estimatePostAnchorTokens(messages[anchor.index])
  for (let i = anchor.index + 1; i < messages.length; i += 1) {
    total += estimateUIMessageTokens(messages[i])
  }
  return { totalTokens: total, source: 'reported' }
}
