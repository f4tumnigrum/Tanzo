import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ModelFamily,
  ProviderDefaultsState,
  ProviderId,
  ProviderModelSource
} from '@shared/provider'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type { SecretCodec } from '@main/provider/secret'
import type {
  ProviderStore,
  StoredConnection,
  StoredDefaults,
  StoredModel,
  StoredProviderKey
} from '@main/provider/store'
import { createProviderService } from '@main/provider/service'

const adapterMocks = vi.hoisted(() => {
  const openaiAdapter = {
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'ok',
      modelCount: 1,
      latency: 7
    })),
    validateCredentials: vi.fn((credentials: Record<string, string>) =>
      Boolean(credentials.apiKey?.trim())
    ),
    fetchModels: vi.fn(async (_credentials: Record<string, string>, family: string) =>
      family === 'language'
        ? [
            {
              id: 'gpt-5',
              name: 'GPT 5',
              contextWindow: 200_000,
              maxOutput: 16_000,
              capabilities: { vision: true }
            }
          ]
        : []
    ),
    createLanguageModel: vi.fn((modelId: string) => ({ modelId }))
  }
  return {
    openaiAdapter,
    getAdapter: vi.fn((providerId: string) => {
      if (providerId !== 'openai') throw new Error(`unsupported ${providerId}`)
      return openaiAdapter
    }),
    enrichLanguageModelsWithMetadata: vi.fn(
      async (_providerId: string, models: unknown[]) => models
    )
  }
})

vi.mock('@main/provider/adapter', () => ({ getAdapter: adapterMocks.getAdapter }))
vi.mock('@main/provider/model-metadata', () => ({
  enrichLanguageModelsWithMetadata: adapterMocks.enrichLanguageModelsWithMetadata
}))

function key(providerId: ProviderId, keyId: string): string {
  return `${providerId}:${keyId}`
}

function modelKey(providerId: ProviderId, family: ModelFamily, modelId: string): string {
  return `${providerId}:${family}:${modelId}`
}

function defaultsKey(providerId: ProviderId, family: ModelFamily): string {
  return `${providerId}:${family}`
}

function createMemoryStore(): ProviderStore & {
  connections: Map<ProviderId, StoredConnection>
  keys: Map<string, StoredProviderKey>
  models: Map<string, StoredModel>
  defaults: Map<string, StoredDefaults>
} {
  const connections = new Map<ProviderId, StoredConnection>()
  const keys = new Map<string, StoredProviderKey>()
  const models = new Map<string, StoredModel>()
  const defaults = new Map<string, StoredDefaults>()

  function setDefaultModel(providerId: ProviderId, family: ModelFamily, modelId: string): void {
    for (const entry of models.values()) {
      if (entry.family === family) {
        entry.isDefault = entry.providerId === providerId && entry.modelId === modelId
      }
    }
  }

  return {
    connections,
    keys,
    models,
    defaults,
    saveConnection: (input) => connections.set(input.providerId, { ...input }),
    loadConnection: (providerId) => connections.get(providerId),
    listConnections: () => [...connections.values()],
    deleteConnection: (providerId) => void connections.delete(providerId),
    saveKey: (input) => keys.set(key(input.providerId, input.keyId), { ...input }),
    loadKey: (providerId, keyId) => keys.get(key(providerId, keyId)),
    listKeys: (providerId) => [...keys.values()].filter((entry) => entry.providerId === providerId),
    deleteKey: (providerId, keyId) => void keys.delete(key(providerId, keyId)),
    deleteKeysForProvider: (providerId) => {
      for (const entry of [...keys.values()]) {
        if (entry.providerId === providerId) keys.delete(key(providerId, entry.keyId))
      }
    },
    saveModel: (model) => {
      models.set(modelKey(model.providerId, model.family, model.modelId), { ...model })
      if (model.enabled && model.isDefault)
        setDefaultModel(model.providerId, model.family, model.modelId)
    },
    deleteModel: (providerId, family, modelId) =>
      void models.delete(modelKey(providerId, family, modelId)),
    listModels: (providerId, family) =>
      [...models.values()].filter(
        (entry) => entry.providerId === providerId && (!family || entry.family === family)
      ),
    setDefaultModel,
    saveDefaults: (input) =>
      defaults.set(defaultsKey(input.providerId, input.family), { ...input }),
    saveDefaultsBatch: (inputs) => {
      for (const input of inputs) {
        defaults.set(defaultsKey(input.providerId, input.family), { ...input })
      }
    },
    getDefaults: (providerId, family) => defaults.get(defaultsKey(providerId, family)),
    reset: (providerId) => {
      connections.delete(providerId)
      for (const entry of [...keys.values()]) {
        if (entry.providerId === providerId) keys.delete(key(providerId, entry.keyId))
      }
      for (const entry of [...models.values()]) {
        if (entry.providerId === providerId) {
          models.delete(modelKey(providerId, entry.family, entry.modelId))
        }
      }
      for (const entry of [...defaults.values()]) {
        if (entry.providerId === providerId) defaults.delete(defaultsKey(providerId, entry.family))
      }
    }
  }
}

const codec: SecretCodec = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^enc:/, ''),
  isEncryptionAvailable: () => true
}

describe('main/provider/service', () => {
  beforeEach(() => {
    adapterMocks.openaiAdapter.testConnection.mockClear()
    adapterMocks.openaiAdapter.validateCredentials.mockClear()
    adapterMocks.openaiAdapter.fetchModels.mockClear()
    adapterMocks.openaiAdapter.createLanguageModel.mockClear()
    adapterMocks.getAdapter.mockClear()
    adapterMocks.enrichLanguageModelsWithMetadata.mockClear()
  })

  it('saves provider credentials, separates secrets, and builds setup state', () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)

    const workspace = service.saveConnection({
      providerId: 'openai',
      credentials: {
        apiKey: 'sk-test-secret-key',
        baseUrl: 'https://api.example.test',
        organization: 'org-1'
      }
    })

    expect(store.loadConnection('openai')).toMatchObject({
      providerId: 'openai',
      publicFields: { baseUrl: 'https://api.example.test', organization: 'org-1' },
      activeKeyId: 'primary'
    })
    expect(store.loadKey('openai', 'primary')).toMatchObject({
      encryptedValue: 'enc:sk-test-secret-key',
      label: 'Primary',
      status: 'untested'
    })
    expect(workspace.connection).toMatchObject({
      providerId: 'openai',
      status: 'connected',
      activeKeyId: 'primary',
      keyCount: 1
    })
    expect(workspace.connection.formValues.apiKey).toMatch(/^sk-t/)
  })

  it('tests and records provider validation using decrypted active credentials', async () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)
    service.saveConnection({ providerId: 'openai', credentials: { apiKey: 'sk-live' } })

    await expect(service.testConnection('openai')).resolves.toEqual({
      success: true,
      message: 'ok',
      modelCount: 1,
      latency: 7
    })
    expect(adapterMocks.openaiAdapter.testConnection).toHaveBeenCalledWith({ apiKey: 'sk-live' })

    expect(service.getWorkspace('openai').connection.status).toBe('connected')
  })

  it('manages provider keys and active key selection', () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)

    expect(() => service.addKey({ providerId: 'openai', apiKey: '' })).toThrow(TanzoValidationError)
    const [first] = service.addKey({
      providerId: 'openai',
      label: 'First',
      apiKey: 'sk-first'
    })
    const [updated] = service.updateKey({
      providerId: 'openai',
      keyId: first.keyId,
      label: 'Renamed',
      apiKey: 'sk-updated'
    })

    expect(updated).toMatchObject({ label: 'Renamed', status: 'untested', active: true })
    expect(store.loadKey('openai', first.keyId)?.encryptedValue).toBe('enc:sk-updated')
    expect(() => service.setActiveKey('openai', 'missing')).toThrow(TanzoNotFoundError)

    expect(service.deleteKey('openai', first.keyId)).toEqual([])
    expect(store.loadConnection('openai')?.activeKeyId).toBeUndefined()
  })

  it('syncs remote models, saves local model state, and exposes metadata/defaults', async () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)
    service.saveConnection({ providerId: 'openai', credentials: { apiKey: 'sk-live' } })

    await expect(service.syncModels('openai', 'language')).resolves.toEqual({
      success: true,
      count: 1
    })
    expect(store.listModels('openai', 'language')).toEqual([
      expect.objectContaining({
        modelId: 'gpt-5',
        enabled: true,
        source: 'api' satisfies ProviderModelSource
      })
    ])

    const workspace = await service.saveModelState({
      providerId: 'openai',
      family: 'language',
      modelId: 'custom-model',
      enabled: true,
      isDefault: true,
      isCustom: true,
      contextWindowOverride: 123_000,
      model: {
        id: 'custom-model',
        name: 'Custom Model',
        contextWindow: 100_000,
        maxOutput: 8_000,
        capabilities: { vision: false }
      }
    })
    expect(workspace.modalities.language?.defaultModelId).toBe('custom-model')

    const anthropicWorkspace = await service.saveModelState({
      providerId: 'anthropic',
      family: 'language',
      modelId: 'claude-4',
      enabled: true,
      isDefault: true,
      isCustom: true,
      model: { id: 'claude-4', name: 'Claude 4' }
    })
    expect(anthropicWorkspace.modalities.language?.defaultModelId).toBe('claude-4')
    expect(service.getWorkspace('openai').modalities.language?.defaultModelId).toBeNull()
    expect(service.getModelMetadata('openai:custom-model')).toEqual({
      contextWindow: 123_000,
      maxOutput: 8_000,
      vision: false
    })

    const defaults: ProviderDefaultsState = {
      callDefaults: { temperature: 0.2 },
      providerOptions: { reasoningEffort: 'high' },
      rawProviderOptions: {}
    }
    service.saveDefaults({ providerId: 'openai', byFamily: { language: defaults } })
    expect(service.getCallSettings('openai', 'language')).toEqual({ temperature: 0.2 })
    expect(service.getProviderOptions('openai', 'language')).toEqual({
      openai: { reasoningEffort: 'high' }
    })

    // Strict on write: unknown keys and mistyped values reject the save.
    expect(() =>
      service.saveDefaults({
        providerId: 'openai',
        byFamily: { language: { callDefaults: { temperatuer: 0.4 } } }
      })
    ).toThrowError(/temperatuer/)
    expect(() =>
      service.saveDefaults({
        providerId: 'openai',
        byFamily: { language: { callDefaults: { temperature: 'warm' } } }
      })
    ).toThrowError(/temperature/)
    expect(service.getCallSettings('openai', 'language')).toEqual({ temperature: 0.2 })

    // Lenient on read: pre-validation rows with junk are dropped field by field.
    store.saveDefaults({
      providerId: 'openai',
      family: 'language',
      defaults: {
        callDefaults: { temperature: 0.3, unknown: true, maxOutputTokens: 'lots' },
        providerOptions: {},
        rawProviderOptions: {}
      },
      updatedAt: new Date().toISOString()
    })
    expect(service.getCallSettings('openai', 'language')).toEqual({ temperature: 0.3 })

    expect(() =>
      service.saveDefaults({
        providerId: 'anthropic',
        byFamily: { embedding: { callDefaults: {} } }
      })
    ).toThrowError(/does not support embedding/)

    expect(() =>
      service.saveDefaults({
        providerId: 'openai',
        byFamily: {
          language: { callDefaults: { temperature: 0.7 } },
          embedding: { callDefaults: { temperature: 'warm' } }
        }
      })
    ).toThrowError(/temperature/)
    expect(service.getCallSettings('openai', 'language')).toEqual({ temperature: 0.3 })
  })

  it('reports ready only when an executable language model is enabled', async () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)
    service.saveConnection({ providerId: 'openai', credentials: { apiKey: 'sk-live' } })

    await service.saveModelState({
      providerId: 'openai',
      family: 'embedding',
      modelId: 'text-embedding-3-small',
      enabled: true,
      isCustom: true,
      model: { id: 'text-embedding-3-small', name: 'Embedding' }
    })
    expect(service.getWorkspace('openai').setup.configurationStatus).toBe('connected_no_models')

    await service.saveModelState({
      providerId: 'openai',
      family: 'language',
      modelId: 'gpt-test',
      enabled: true,
      isCustom: true,
      model: { id: 'gpt-test', name: 'GPT Test' }
    })
    expect(service.getWorkspace('openai').setup.configurationStatus).toBe('ready')
  })

  it('rejects model state for unsupported provider families', async () => {
    const service = createProviderService(createMemoryStore(), codec)

    await expect(
      service.saveModelState({
        providerId: 'anthropic',
        family: 'embedding',
        modelId: 'unsupported',
        enabled: true,
        isCustom: true,
        model: { id: 'unsupported', name: 'Unsupported' }
      })
    ).rejects.toThrow(/does not support embedding/)
  })

  it('handles disconnected and reset flows', async () => {
    const store = createMemoryStore()
    const service = createProviderService(store, codec)

    await expect(service.testConnection('openai')).resolves.toMatchObject({ success: false })
    service.saveConnection({ providerId: 'openai', credentials: { apiKey: 'sk-live' } })
    service.disconnect('openai')
    expect(service.getWorkspace('openai').connection.status).toBe('disconnected')

    service.saveConnection({ providerId: 'openai', credentials: { apiKey: 'sk-live' } })
    service.reset('openai')
    expect(store.listKeys('openai')).toEqual([])
    expect(store.loadConnection('openai')).toBeUndefined()
  })
})
