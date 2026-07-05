import { createHash } from 'crypto'
import type { ModelMessage, ToolSet } from 'ai'
import { parseModelRef } from '@shared/provider'
import type { AgentDefinition } from '../agents/types'
import type {
  ContextMessageProvenance,
  ContextPromptProvenance,
  ContextSectionProvenance
} from '../context/section'

type Jsonish = null | string | number | boolean | Jsonish[] | { [key: string]: Jsonish | undefined }

type PromptDiagnosticOrigin =
  | 'agent-instructions'
  | 'context-section'
  | 'conversation-history'
  | 'model-response'
  | 'provider-options'
  | 'system-message'
  | 'tool-definition'
  | 'tool-result'

export interface PromptDiagnosticSegment {
  kind: 'agent-instructions' | 'system' | 'tool-definition' | 'message' | 'provider-options'
  label: string
  origin: PromptDiagnosticOrigin
  role?: string
  sectionId?: string
  stability?: string
  channel?: string
  sections?: ContextSectionProvenance[]
  hash: string
  chars: number
  facts?: Jsonish
}

type CompactPromptDiagnosticSegment = Omit<PromptDiagnosticSegment, 'facts' | 'origin'> & {
  origin?: PromptDiagnosticOrigin
}

export interface PromptDiagnosticDiff {
  previousId: string
  commonPrefixSegments: number
  previousSegmentCount: number
  currentSegmentCount: number
  firstDifference: {
    index: number
    previous?: CompactPromptDiagnosticSegment
    current?: CompactPromptDiagnosticSegment
  } | null
}

export interface PromptCacheDiagnosticRecord {
  id: string
  conversationId: string
  runId: string
  stepNumber: number
  createdAt: number
  modelRef: string
  provider: string
  promptCacheKey?: string
  promptCacheRetention?: string
  systemHash: string
  systemChars: number
  messagesHash: string
  messagesChars: number
  toolsHash: string
  toolsJson: string
  providerOptionsHash: string
  providerOptionsJson: string
  promptHash: string
  promptChars: number
  segmentsJson: string
  previousId?: string
  diffJson?: string
}

export interface PromptCacheDiagnosticFinish {
  conversationId: string
  runId: string
  stepNumber: number
  usageJson?: string
  finishReason?: string
  providerMetadataJson?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface PromptDiagnosticPrevious {
  id: string
  segmentsJson: string
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(normalize(value, seen))
}

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function hashValue(value: unknown): string {
  return hashString(stableStringify(value))
}

function normalize(value: unknown, seen: WeakSet<object>): Jsonish {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value as string | boolean
  if (type === 'number') return Number.isFinite(value as number) ? (value as number) : String(value)
  if (type === 'bigint') return String(value)
  if (type === 'undefined') return '[undefined]'
  if (type === 'symbol') return String(value)
  if (type === 'function') return `[Function:${(value as { name?: string }).name ?? 'anonymous'}]`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.toString()
  if (value instanceof Uint8Array) return `[Uint8Array:${value.byteLength}]`
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen))
  if (type !== 'object') return String(value)

  const obj = value as Record<string, unknown>
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  const out: Record<string, Jsonish | undefined> = {}
  for (const key of Object.keys(obj).sort()) {
    out[key] = normalize(obj[key], seen)
  }
  seen.delete(obj)
  return out
}

function textStats(value: unknown): { chars: number; contentTypes: string[]; toolNames: string[] } {
  let chars = 0
  const contentTypes = new Set<string>()
  const toolNames = new Set<string>()

  function visit(node: unknown): void {
    if (typeof node === 'string') {
      chars += node.length
      return
    }
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const obj = node as Record<string, unknown>
    if (typeof obj.type === 'string') contentTypes.add(obj.type)
    if (typeof obj.toolName === 'string') toolNames.add(obj.toolName)
    for (const value of Object.values(obj)) visit(value)
  }

  visit(value)
  return {
    chars,
    contentTypes: [...contentTypes].sort(),
    toolNames: [...toolNames].sort()
  }
}

function toolSegments(tools: ToolSet): {
  segments: PromptDiagnosticSegment[]
  toolsJson: string
  toolsHash: string
} {
  const summaries = Object.keys(tools).map((name, index) => {
    const serialized = stableStringify(tools[name])
    return {
      index,
      name,
      hash: hashString(serialized),
      chars: serialized.length
    }
  })
  const toolsJson = stableStringify(summaries)
  return {
    toolsJson,
    toolsHash: hashString(toolsJson),
    segments: summaries.map((tool) => ({
      kind: 'tool-definition',
      label: `tool[${tool.index}]:${tool.name}`,
      origin: 'tool-definition',
      hash: tool.hash,
      chars: tool.chars,
      facts: { name: tool.name, index: tool.index }
    }))
  }
}

function provenanceFields(
  provenance: ContextSectionProvenance | ContextMessageProvenance | undefined
): Partial<PromptDiagnosticSegment> {
  if (!provenance) return {}
  const sections = 'sections' in provenance ? provenance.sections : [provenance]
  if (sections.length === 1) {
    const [section] = sections
    return {
      sectionId: section.sectionId,
      stability: section.stability,
      channel: section.channel
    }
  }
  return { sections }
}

function messageOrigin(
  message: ModelMessage,
  provenance: ContextMessageProvenance | undefined
): PromptDiagnosticOrigin {
  if (provenance) return 'context-section'
  if (message.role === 'assistant') return 'model-response'
  if (message.role === 'tool') return 'tool-result'
  if (message.role === 'system') return 'system-message'
  return 'conversation-history'
}

function messageSegment(
  index: number,
  message: ModelMessage,
  provenance?: ContextMessageProvenance
): PromptDiagnosticSegment {
  const serialized = stableStringify(message)
  const stats = textStats(message.content)
  return {
    kind: 'message',
    label: `message[${index}]:${message.role}`,
    origin: messageOrigin(message, provenance),
    role: message.role,
    ...provenanceFields(provenance),
    hash: hashString(serialized),
    chars: serialized.length,
    facts: {
      contentChars: stats.chars,
      contentTypes: stats.contentTypes,
      toolNames: stats.toolNames
    }
  }
}

function systemSegment(
  index: number,
  message: ModelMessage,
  provenance?: ContextSectionProvenance
): PromptDiagnosticSegment {
  const serialized = stableStringify(message)
  const stats = textStats(message.content)
  return {
    kind: 'system',
    label: `system[${index}]`,
    origin: provenance ? 'context-section' : 'system-message',
    role: message.role,
    ...provenanceFields(provenance),
    hash: hashString(serialized),
    chars: serialized.length,
    facts: {
      contentChars: stats.chars,
      contentTypes: stats.contentTypes
    }
  }
}

function compactSegment(segment: PromptDiagnosticSegment): CompactPromptDiagnosticSegment {
  return {
    kind: segment.kind,
    label: segment.label,
    ...(segment.origin ? { origin: segment.origin } : {}),
    ...(segment.role ? { role: segment.role } : {}),
    ...(segment.sectionId ? { sectionId: segment.sectionId } : {}),
    ...(segment.stability ? { stability: segment.stability } : {}),
    ...(segment.channel ? { channel: segment.channel } : {}),
    ...(segment.sections ? { sections: segment.sections } : {}),
    hash: segment.hash,
    chars: segment.chars
  }
}

function isPromptDiagnosticSegment(value: unknown): value is PromptDiagnosticSegment {
  if (typeof value !== 'object' || value === null) return false
  const segment = value as Partial<PromptDiagnosticSegment>
  const kind = segment.kind
  return (
    (kind === 'agent-instructions' ||
      kind === 'system' ||
      kind === 'tool-definition' ||
      kind === 'message' ||
      kind === 'provider-options') &&
    typeof segment.label === 'string' &&
    (typeof segment.origin === 'string' || segment.origin === undefined) &&
    typeof segment.hash === 'string' &&
    typeof segment.chars === 'number'
  )
}

function parsePreviousSegments(segmentsJson: string): PromptDiagnosticSegment[] | null {
  try {
    const parsed = JSON.parse(segmentsJson) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.every(isPromptDiagnosticSegment) ? parsed : null
  } catch {
    return null
  }
}

export function diffPromptSegments(
  previous: PromptDiagnosticPrevious | undefined,
  current: PromptDiagnosticSegment[]
): { previousId?: string; diffJson?: string } {
  if (!previous) return {}
  const previousSegments = parsePreviousSegments(previous.segmentsJson)
  if (!previousSegments) return { previousId: previous.id }

  let commonPrefixSegments = 0
  const limit = Math.min(previousSegments.length, current.length)
  while (
    commonPrefixSegments < limit &&
    previousSegments[commonPrefixSegments].kind === current[commonPrefixSegments].kind &&
    previousSegments[commonPrefixSegments].label === current[commonPrefixSegments].label &&
    previousSegments[commonPrefixSegments].hash === current[commonPrefixSegments].hash
  ) {
    commonPrefixSegments += 1
  }

  const diff: PromptDiagnosticDiff = {
    previousId: previous.id,
    commonPrefixSegments,
    previousSegmentCount: previousSegments.length,
    currentSegmentCount: current.length,
    firstDifference:
      commonPrefixSegments === previousSegments.length && commonPrefixSegments === current.length
        ? null
        : {
            index: commonPrefixSegments,
            ...(previousSegments[commonPrefixSegments]
              ? { previous: compactSegment(previousSegments[commonPrefixSegments]) }
              : {}),
            ...(current[commonPrefixSegments]
              ? { current: compactSegment(current[commonPrefixSegments]) }
              : {})
          }
  }
  return { previousId: previous.id, diffJson: stableStringify(diff) }
}

export function buildPromptCacheDiagnostic(input: {
  id: string
  conversationId: string
  runId: string
  stepNumber: number
  createdAt: number
  def: AgentDefinition
  tools: ToolSet
  prepared: {
    system?: ModelMessage[]
    messages?: ModelMessage[]
    providerOptions?: Record<string, unknown>
    provenance?: ContextPromptProvenance
  }
  previous?: PromptDiagnosticPrevious
}): PromptCacheDiagnosticRecord {
  const provider = parseModelRef(input.def.modelRef)?.providerId ?? ''
  const system = input.prepared.system ?? []
  const messages = input.prepared.messages ?? []
  const providerOptions = input.prepared.providerOptions ?? {}
  const providerOptionsJson = stableStringify(providerOptions)
  const providerOptionsSegment: PromptDiagnosticSegment = {
    kind: 'provider-options',
    label: 'provider-options',
    origin: 'provider-options',
    hash: hashString(providerOptionsJson),
    chars: providerOptionsJson.length
  }
  const tools = toolSegments(input.tools)
  const segments = [
    providerOptionsSegment,
    ...tools.segments,
    ...system.map((message, index) =>
      systemSegment(index, message, input.prepared.provenance?.system[index])
    ),
    ...messages.map((message, index) =>
      messageSegment(index, message, input.prepared.provenance?.messages[index])
    )
  ]

  const systemJson = stableStringify(system)
  const messagesJson = stableStringify(messages)
  const promptJson = stableStringify({
    system,
    tools: JSON.parse(tools.toolsJson) as unknown,
    providerOptions,
    messages
  })
  const openaiOptions = (providerOptions.openai ?? {}) as Record<string, unknown>
  const diff = diffPromptSegments(input.previous, segments)

  return {
    id: input.id,
    conversationId: input.conversationId,
    runId: input.runId,
    stepNumber: input.stepNumber,
    createdAt: input.createdAt,
    modelRef: input.def.modelRef,
    provider,
    ...(typeof openaiOptions.promptCacheKey === 'string'
      ? { promptCacheKey: openaiOptions.promptCacheKey }
      : {}),
    ...(typeof openaiOptions.promptCacheRetention === 'string'
      ? { promptCacheRetention: openaiOptions.promptCacheRetention }
      : {}),
    systemHash: hashString(systemJson),
    systemChars: systemJson.length,
    messagesHash: hashString(messagesJson),
    messagesChars: messagesJson.length,
    toolsHash: tools.toolsHash,
    toolsJson: tools.toolsJson,
    providerOptionsHash: hashString(providerOptionsJson),
    providerOptionsJson,
    promptHash: hashString(promptJson),
    promptChars: promptJson.length,
    segmentsJson: stableStringify(segments),
    ...diff
  }
}
