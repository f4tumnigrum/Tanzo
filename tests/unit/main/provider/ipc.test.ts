import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_CHANNELS } from '@shared/provider'
import { registerProviderIpc } from '@main/provider/ipc'

type Handler = (_event: unknown, ...args: unknown[]) => unknown

function ipcTarget() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    target: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
}

function providerService() {
  return {
    listCatalog: vi.fn(() => ['catalog']),
    listSetups: vi.fn(() => ['setup']),
    getWorkspace: vi.fn((providerId: string) => ({ providerId })),
    saveConnection: vi.fn((input: unknown) => ({ saved: input })),
    testConnection: vi.fn((providerId: string) => ({ providerId, success: true })),
    disconnect: vi.fn((providerId: string) => ({ disconnected: providerId })),
    reset: vi.fn((providerId: string) => ({ reset: providerId })),
    listKeys: vi.fn((providerId: string) => [{ providerId, keyId: 'key-1' }]),
    addKey: vi.fn((input: unknown) => ({ added: input })),
    updateKey: vi.fn((input: unknown) => ({ updated: input })),
    deleteKey: vi.fn((providerId: string, keyId: string) => ({ providerId, keyId })),
    setActiveKey: vi.fn((providerId: string, keyId: string) => ({ providerId, keyId })),
    listOptionSchemas: vi.fn((providerId?: string, family?: string) => [{ providerId, family }]),
    syncModels: vi.fn((providerId: string, family: string) => ({ providerId, family })),
    saveModelState: vi.fn((input: unknown) => ({ modelState: input })),
    saveDefaults: vi.fn((input: unknown) => ({ defaults: input }))
  }
}

describe('provider/ipc', () => {
  it('registers provider handlers that validate input and delegate to the service', async () => {
    const service = providerService()
    const { handlers, target } = ipcTarget()

    const unregister = registerProviderIpc(target as never, service as never)

    expect(target.handle).toHaveBeenCalledTimes(Object.keys(PROVIDER_CHANNELS).length)
    expect(await handlers.get(PROVIDER_CHANNELS.listCatalog)?.(null)).toEqual(['catalog'])
    expect(await handlers.get(PROVIDER_CHANNELS.listSetups)?.(null)).toEqual(['setup'])
    expect(await handlers.get(PROVIDER_CHANNELS.getWorkspace)?.(null, 'openai')).toEqual({
      providerId: 'openai'
    })

    const connection = { providerId: 'openai', credentials: { apiKey: 'sk-test' } }
    expect(await handlers.get(PROVIDER_CHANNELS.saveConnection)?.(null, connection)).toEqual({
      saved: connection
    })

    expect(await handlers.get(PROVIDER_CHANNELS.testConnection)?.(null, 'anthropic')).toEqual({
      providerId: 'anthropic',
      success: true
    })
    expect(await handlers.get(PROVIDER_CHANNELS.disconnect)?.(null, 'deepseek')).toEqual({
      disconnected: 'deepseek'
    })
    expect(await handlers.get(PROVIDER_CHANNELS.reset)?.(null, 'openai-compatible')).toEqual({
      reset: 'openai-compatible'
    })
    expect(await handlers.get(PROVIDER_CHANNELS.listKeys)?.(null, 'openai')).toEqual([
      { providerId: 'openai', keyId: 'key-1' }
    ])

    const addKey = { providerId: 'openai', label: 'Main', apiKey: 'sk', makeActive: true }
    const updateKey = { providerId: 'openai', keyId: 'key-1', label: 'Renamed', apiKey: 'sk2' }
    expect(await handlers.get(PROVIDER_CHANNELS.addKey)?.(null, addKey)).toEqual({
      added: addKey
    })
    expect(await handlers.get(PROVIDER_CHANNELS.updateKey)?.(null, updateKey)).toEqual({
      updated: updateKey
    })
    expect(await handlers.get(PROVIDER_CHANNELS.deleteKey)?.(null, 'openai', 'key-1')).toEqual({
      providerId: 'openai',
      keyId: 'key-1'
    })
    expect(await handlers.get(PROVIDER_CHANNELS.setActiveKey)?.(null, 'openai', 'key-1')).toEqual({
      providerId: 'openai',
      keyId: 'key-1'
    })
    expect(
      await handlers.get(PROVIDER_CHANNELS.listOptionSchemas)?.(null, 'openai', 'language')
    ).toEqual([{ providerId: 'openai', family: 'language' }])
    expect(await handlers.get(PROVIDER_CHANNELS.listOptionSchemas)?.(null)).toEqual([
      { providerId: undefined, family: undefined }
    ])
    expect(await handlers.get(PROVIDER_CHANNELS.syncModels)?.(null, 'openai', 'language')).toEqual({
      providerId: 'openai',
      family: 'language'
    })

    const modelState = {
      providerId: 'openai',
      family: 'language',
      modelId: 'gpt-4.1',
      enabled: true,
      isDefault: true,
      contextWindowOverride: null,
      model: {
        id: 'gpt-4.1',
        name: 'GPT 4.1',
        capabilities: { toolCall: true, reasoning: true }
      }
    }
    expect(await handlers.get(PROVIDER_CHANNELS.saveModelState)?.(null, modelState)).toEqual({
      modelState
    })

    const defaults = {
      providerId: 'openai',
      byFamily: { language: { callDefaults: { temperature: 0.2 } } }
    }
    expect(await handlers.get(PROVIDER_CHANNELS.saveDefaults)?.(null, defaults)).toEqual({
      defaults
    })

    expect(() => handlers.get(PROVIDER_CHANNELS.getWorkspace)?.(null, 'not-a-provider')).toThrow()
    expect(() =>
      handlers.get(PROVIDER_CHANNELS.saveModelState)?.(null, {
        ...modelState,
        contextWindowOverride: -1
      })
    ).toThrow()
    expect(() =>
      handlers.get(PROVIDER_CHANNELS.saveDefaults)?.(null, {
        providerId: 'openai',
        byFamily: { language: { callDefaults: { seed: 1n } } }
      })
    ).toThrow()

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(Object.keys(PROVIDER_CHANNELS).length * 2)
  })
})
