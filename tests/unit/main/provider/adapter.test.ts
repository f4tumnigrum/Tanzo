import { afterEach, describe, expect, it, vi } from 'vitest'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type { ProviderId } from '@shared/provider'
import { getAdapter } from '@main/provider/adapter'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('main/provider/adapter', () => {
  it('returns typed adapters and rejects unknown providers', () => {
    expect(getAdapter('openai').providerId).toBe('openai')
    expect(() => getAdapter('missing' as ProviderId)).toThrow(TanzoNotFoundError)
  })

  it('validates required credentials before remote model fetches', async () => {
    await expect(getAdapter('openai').fetchModels({}, 'language')).rejects.toMatchObject({
      code: 'PROVIDER_CREDENTIALS_MISSING',
      details: { providerId: 'openai', missing: 'apiKey' }
    })
    await expect(getAdapter('openai-compatible').fetchModels({}, 'language')).rejects.toThrow(
      TanzoValidationError
    )
  })

  it('fetches and maps OpenAI models by family', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { id: 'gpt-5', owned_by: 'openai' },
            { id: 'text-embedding-3-large', owned_by: 'openai' },
            { id: 'whisper-1', owned_by: 'openai' }
          ]
        })
      )
    )

    await expect(
      getAdapter('openai').fetchModels({ apiKey: 'sk', baseUrl: 'api.openai.com' }, 'language')
    ).resolves.toEqual([
      {
        id: 'gpt-5',
        name: 'Gpt 5',
        description: 'Owned by openai'
      }
    ])
    await expect(getAdapter('openai').fetchModels({ apiKey: 'sk' }, 'embedding')).resolves.toEqual([
      expect.objectContaining({ id: 'text-embedding-3-large', dimensions: 3072 })
    ])
  })

  it('maps Google model discovery payloads by supported generation methods', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              displayName: 'Gemini Pro',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent']
            }
          ]
        })
      )
    )

    await expect(getAdapter('google').fetchModels({ apiKey: 'key' }, 'language')).resolves.toEqual([
      expect.objectContaining({ id: 'gemini-2.5-pro', name: 'Gemini Pro' })
    ])
    await expect(getAdapter('google').fetchModels({ apiKey: 'key' }, 'embedding')).resolves.toEqual(
      [expect.objectContaining({ id: 'text-embedding-004' })]
    )
  })

  it('paginates Google model discovery', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (!url.searchParams.has('pageToken')) {
        return Response.json({
          models: [
            {
              name: 'models/gemini-first',
              supportedGenerationMethods: ['generateContent']
            }
          ],
          nextPageToken: 'next-page'
        })
      }
      return Response.json({
        models: [
          {
            name: 'models/gemini-second',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAdapter('google').fetchModels({ apiKey: 'key' }, 'language')).resolves.toEqual([
      expect.objectContaining({ id: 'gemini-first' }),
      expect.objectContaining({ id: 'gemini-second' })
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses dedicated Zhipu and MiniMax adapters', () => {
    expect(getAdapter('zhipu').createLanguageModel('glm-5', { apiKey: 'key' })).toMatchObject({
      specificationVersion: 'v3'
    })
    expect(getAdapter('zhipu').createImageModel?.('cogview-4', { apiKey: 'key' })).toMatchObject({
      specificationVersion: 'v3'
    })
    expect(
      getAdapter('minimax').createLanguageModel('MiniMax-M2.1', { apiKey: 'key' })
    ).toMatchObject({
      specificationVersion: 'v3'
    })
  })

  it('preserves configured API prefixes and normalizes known bare official hosts', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await getAdapter('anthropic').fetchModels(
      { apiKey: 'key', baseUrl: 'https://api.anthropic.com' },
      'language'
    )
    expect(fetchMock.mock.calls[0]?.[0]).toContain('https://api.anthropic.com/v1/models')

    await getAdapter('grok').fetchModels({ apiKey: 'key', baseUrl: 'https://api.x.ai' }, 'language')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.x.ai/v1/models')

    await getAdapter('openai-compatible').fetchModels(
      { baseUrl: 'https://gateway.test/v1beta/openai' },
      'language'
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://gateway.test/v1beta/openai/models')

    await getAdapter('openai-compatible').fetchModels(
      { baseUrl: 'http://localhost:11434' },
      'language'
    )
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://localhost:11434/v1/models')
  })

  it('returns Anthropic connection result from model discovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }],
          has_more: false
        })
      )
    )

    await expect(getAdapter('anthropic').testConnection({ apiKey: '' })).resolves.toEqual({
      success: false,
      message: 'Missing required credentials.'
    })
    await expect(
      getAdapter('anthropic').testConnection({ apiKey: 'sk-ant' })
    ).resolves.toMatchObject({
      success: true,
      modelCount: 1
    })
  })
})
