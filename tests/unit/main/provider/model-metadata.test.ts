import { afterEach, describe, expect, it, vi } from 'vitest'

describe('main/provider/model-metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('enriches language models from models.dev metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          openai: {
            id: 'openai',
            models: {
              'gpt-test': {
                id: 'gpt-test',
                limit: { context: 1000, output: 200 },
                reasoning: true,
                tool_call: true,
                modalities: { input: ['text', 'image'], output: ['text', 'json'] }
              },
              'gpt-basic': {
                id: 'gpt-basic',
                reasoning: false,
                modalities: { input: ['text'], output: ['text'] }
              }
            }
          }
        })
      )
    )
    const { enrichLanguageModelsWithMetadata } = await import('@main/provider/model-metadata')

    await expect(
      enrichLanguageModelsWithMetadata('openai', [
        { id: 'gpt-test', name: 'GPT Test' },
        { id: 'gpt-basic', name: 'GPT Basic' }
      ])
    ).resolves.toEqual([
      {
        id: 'gpt-test',
        name: 'GPT Test',
        contextWindow: 1000,
        maxOutput: 200,
        capabilities: { reasoning: true, toolCall: true, vision: true, json: true }
      },
      {
        id: 'gpt-basic',
        name: 'GPT Basic',
        capabilities: { reasoning: false }
      }
    ])
  })

  it('keeps explicit model metadata and returns originals for unsupported providers', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { enrichLanguageModelsWithMetadata } = await import('@main/provider/model-metadata')
    const models = [{ id: 'local', name: 'Local', contextWindow: 42 }]

    await expect(enrichLanguageModelsWithMetadata('openai-compatible', models)).resolves.toBe(
      models
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to original models when metadata fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )
    const { enrichLanguageModelsWithMetadata } = await import('@main/provider/model-metadata')
    const models = [{ id: 'gpt-test', name: 'GPT Test' }]

    await expect(enrichLanguageModelsWithMetadata('openai', models)).resolves.toBe(models)
  })
})
