import { z } from 'zod'

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export function ensureUrlProtocol(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback.trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

export function formatModelName(id: string): string {
  return id
    .replace(/^models\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function buildHeaders(
  credentials: Record<string, string>,
  headers: Record<string, string> = {}
): Record<string, string> {
  const organization = credentials.organization?.trim()
  const project = credentials.project?.trim()
  return {
    ...headers,
    ...(organization ? { 'OpenAI-Organization': organization } : {}),
    ...(project ? { 'OpenAI-Project': project } : {})
  }
}

export async function readResponseText(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`HTTP response exceeds ${maxBytes} bytes.`)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error(`HTTP response exceeds ${maxBytes} bytes.`)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function fetchJson<T>(
  url: string,
  parse: (value: unknown) => T,
  options: { timeout?: number; headers?: Record<string, string> } = {}
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 30_000)
  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: controller.signal
    })
    const text = await readResponseText(response)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
    }
    return parse(text ? JSON.parse(text) : null)
  } finally {
    clearTimeout(timer)
  }
}

export const idOnlyModelListSchema = z.object({
  data: z.array(z.object({ id: z.string(), owned_by: z.string().optional() }))
})

export const anthropicModelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().optional()
    })
  ),
  has_more: z.boolean().optional(),
  last_id: z.string().nullable().optional()
})

export const googleModelListSchema = z.object({
  nextPageToken: z.string().optional(),
  models: z
    .array(
      z.object({
        name: z.string().optional(),
        baseModelId: z.string().optional(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        supportedGenerationMethods: z.array(z.string()).optional()
      })
    )
    .optional()
})
