/**
 * BETA-FRAGILITY GUARDRAIL — OpenAI Responses API compatibility shim.
 *
 * This module is a custom `fetch` wrapper wired into the OpenAI and
 * OpenAI-compatible adapters (adapters/openai.ts, adapters/openai-compatible.ts).
 * It compensates for shape mismatches between the pinned `@ai-sdk/openai` beta's
 * Zod schemas and what the live `/responses` endpoint actually returns:
 *
 *   - JSON responses: injects missing `output[].id`, `output_text.annotations`,
 *     and `reasoning.summary` fields the SDK schema rejects (normalizeResponsesApiJson).
 *   - SSE streams: drops frames whose `type` is not `response.*`/`error`, which
 *     the SDK would otherwise fail to parse (shouldKeepResponsesSseFrame).
 *
 * WHY THIS IS FRAGILE: it is tightly coupled to both the current OpenAI wire
 * format AND the current SDK beta's schema strictness. A beta bump on either
 * side can (a) make this redundant, or worse (b) silently mis-normalize if the
 * shape changes. It is intentionally SCOPED to `/responses` requests only
 * (shouldFilterResponsesApiSse) so non-Responses traffic is never touched.
 *
 * WHEN UPGRADING @ai-sdk/openai: re-check whether this shim is still needed. If
 * the SDK schema accepts the raw response, delete it; if the shape drifted,
 * update normalizeResponsesApiJson accordingly. The unit tests in
 * tests/unit/main/provider/sse-filter.test.ts pin the current behavior.
 */
function isResponsesApiEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown }
  return (
    typeof record.type === 'string' &&
    (record.type.startsWith('response.') || record.type === 'error')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeResponsesApiJson(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.output)) return value

  let changed = false
  const output = value.output.map((item, index) => {
    if (!isRecord(item)) return item
    let next = item

    if (typeof next.id !== 'string' || next.id.length === 0) {
      changed = true
      next = { ...next, id: `response-output-${index}` }
    }

    if (next.type === 'message' && Array.isArray(next.content)) {
      let contentChanged = false
      const content = next.content.map((part) => {
        if (!isRecord(part) || part.type !== 'output_text' || Array.isArray(part.annotations)) {
          return part
        }
        contentChanged = true
        return { ...part, annotations: [] }
      })
      if (contentChanged) {
        changed = true
        next = { ...next, content }
      }
    }

    if (next.type === 'reasoning' && !Array.isArray(next.summary)) {
      changed = true
      next = { ...next, summary: [] }
    }

    return next
  })

  return changed ? { ...value, output } : value
}

async function normalizeResponsesApiJsonResponse(response: Response): Promise<Response> {
  try {
    const text = await response.clone().text()
    const normalized = normalizeResponsesApiJson(JSON.parse(text))
    const normalizedText = JSON.stringify(normalized)
    if (normalizedText === text) return response
    return new Response(normalizedText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  } catch {
    return response
  }
}

function sseFrameData(frame: string): string | undefined {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('data:'))
    .map((line) => line.trimStart().slice(5).trimStart())

  if (dataLines.length === 0) return undefined
  return dataLines.join('\n').trim()
}

function shouldKeepResponsesSseFrame(frame: string): boolean {
  const data = sseFrameData(frame)
  if (data === undefined) return true
  if (!data || data === '[DONE]') return true

  try {
    return isResponsesApiEvent(JSON.parse(data))
  } catch {
    return false
  }
}

function nextSseFrameSeparator(buffer: string): RegExpMatchArray | null {
  return /\r?\n\r?\n/.exec(buffer)
}

function requestPath(input: RequestInfo | URL): string | undefined {
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : undefined
  if (!url) return undefined

  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

function shouldFilterResponsesApiSse(input: RequestInfo | URL): boolean {
  return requestPath(input)?.replace(/\/+$/, '').endsWith('/responses') ?? false
}

export function filterResponsesApiSseFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    const contentType = response.headers.get('content-type') ?? ''
    const isResponsesPath = shouldFilterResponsesApiSse(input)
    if (isResponsesPath && contentType.toLowerCase().includes('application/json')) {
      return normalizeResponsesApiJsonResponse(response)
    }
    if (
      !response.body ||
      !contentType.toLowerCase().includes('text/event-stream') ||
      !isResponsesPath
    ) {
      return response
    }

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffered = ''

    const filtered = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffered += decoder.decode(chunk, { stream: true })
          let separator = nextSseFrameSeparator(buffered)
          while (separator?.index !== undefined) {
            const separatorEnd = separator.index + separator[0].length
            const frame = buffered.slice(0, separator.index)
            if (shouldKeepResponsesSseFrame(frame)) {
              controller.enqueue(encoder.encode(buffered.slice(0, separatorEnd)))
            }
            buffered = buffered.slice(separatorEnd)
            separator = nextSseFrameSeparator(buffered)
          }
        },
        flush(controller) {
          buffered += decoder.decode()
          if (buffered && shouldKeepResponsesSseFrame(buffered)) {
            controller.enqueue(encoder.encode(buffered))
          }
        }
      })
    )

    return new Response(filtered, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}
