import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildHeaders,
  ensureUrlProtocol,
  fetchJson,
  formatModelName,
  googleModelListSchema,
  idOnlyModelListSchema,
  readResponseText
} from '@main/provider/http'

describe('main/provider/http', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes provider URLs and model names for display', () => {
    expect(ensureUrlProtocol(' api.example.com ', 'fallback.example.com')).toBe(
      'https://api.example.com'
    )
    expect(ensureUrlProtocol('http://localhost:11434/v1', 'fallback.example.com')).toBe(
      'http://localhost:11434/v1'
    )
    expect(ensureUrlProtocol(undefined, 'fallback.example.com')).toBe(
      'https://fallback.example.com'
    )
    expect(formatModelName('models/gemini-2_5-pro')).toBe('Gemini 2 5 Pro')
  })

  it('builds OpenAI-compatible organization and project headers', () => {
    expect(
      buildHeaders({ organization: 'org-1', project: 'proj-1' }, { Authorization: 'Bearer token' })
    ).toEqual({
      Authorization: 'Bearer token',
      'OpenAI-Organization': 'org-1',
      'OpenAI-Project': 'proj-1'
    })
  })

  it('fetches and parses JSON responses', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('https://example.test', (value) => value)).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('throws status and response text for non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 }))
    )

    await expect(fetchJson('https://example.test', (value) => value)).rejects.toThrow(
      'HTTP 400: bad request'
    )
  })

  it('rejects responses larger than the configured limit', async () => {
    const response = new Response('12345', { headers: { 'content-length': '5' } })
    await expect(readResponseText(response, 4)).rejects.toThrow('exceeds 4 bytes')
  })

  it('validates common provider model list payloads', () => {
    expect(idOnlyModelListSchema.parse({ data: [{ id: 'gpt-5', owned_by: 'openai' }] })).toEqual({
      data: [{ id: 'gpt-5', owned_by: 'openai' }]
    })
    expect(
      googleModelListSchema.parse({
        nextPageToken: 'next',
        models: [{ name: 'models/gemini', supportedGenerationMethods: ['generateContent'] }]
      })
    ).toEqual({
      nextPageToken: 'next',
      models: [{ name: 'models/gemini', supportedGenerationMethods: ['generateContent'] }]
    })
  })
})
