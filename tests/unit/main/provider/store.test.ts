import { describe, expect, it } from 'vitest'
import type { SqlDatabase } from '@main/database/types'
import { createProviderStore } from '@main/provider/store'

type Row = Record<string, unknown>

function createDb(): SqlDatabase & {
  connections: Map<string, Row>
  keys: Map<string, Row>
  models: Map<string, Row>
  defaultModels: Map<string, Row>
  defaults: Map<string, Row>
} {
  const connections = new Map<string, Row>()
  const keys = new Map<string, Row>()
  const models = new Map<string, Row>()
  const defaultModels = new Map<string, Row>()
  const defaults = new Map<string, Row>()
  const keyId = (providerId: string, id: string) => `${providerId}:${id}`
  const modelId = (providerId: string, family: string, id: string) =>
    `${providerId}:${family}:${id}`
  const defaultId = (providerId: string, family: string) => `${providerId}:${family}`
  const defaultsId = (providerId: string, family: string) => `${providerId}:${family}`

  return {
    connections,
    keys,
    models,
    defaultModels,
    defaults,
    exec: () => undefined,
    pragma: () => undefined,
    transaction: (fn) => fn(),
    close: () => undefined,
    prepare(sql) {
      return {
        run(params?: unknown) {
          const input = params as Row | unknown[]
          if (sql.includes('INSERT INTO provider_connections')) {
            const row = input as Row
            connections.set(String(row.provider_id), { ...row })
          } else if (sql.startsWith('DELETE FROM provider_connections')) {
            const [providerId] = input as unknown[]
            connections.delete(String(providerId))
          } else if (sql.includes('INSERT INTO provider_keys')) {
            const row = input as Row
            keys.set(keyId(String(row.provider_id), String(row.key_id)), { ...row })
          } else if (
            sql.startsWith('DELETE FROM provider_keys WHERE provider_id = ? AND key_id = ?')
          ) {
            const [providerId, id] = input as unknown[]
            keys.delete(keyId(String(providerId), String(id)))
          } else if (sql.startsWith('DELETE FROM provider_keys WHERE provider_id = ?')) {
            const [providerId] = input as unknown[]
            for (const row of [...keys.values()]) {
              if (row.provider_id === providerId)
                keys.delete(keyId(String(providerId), String(row.key_id)))
            }
          } else if (sql.includes('INSERT INTO provider_models')) {
            const row = input as Row
            models.set(modelId(String(row.provider_id), String(row.family), String(row.model_id)), {
              ...row
            })
          } else if (
            sql.startsWith('DELETE FROM provider_models WHERE provider_id = ? AND family = ?')
          ) {
            const [providerId, family, id] = input as unknown[]
            models.delete(modelId(String(providerId), String(family), String(id)))
          } else if (sql.includes('INSERT INTO provider_default_models')) {
            const [providerId, family, id, updatedAt] = input as unknown[]
            defaultModels.set(defaultId(String(providerId), String(family)), {
              provider_id: providerId,
              family,
              model_id: id,
              updated_at: updatedAt
            })
          } else if (sql.includes('INSERT INTO provider_defaults')) {
            const row = input as Row
            defaults.set(defaultsId(String(row.provider_id), String(row.family)), { ...row })
          } else if (sql.startsWith('DELETE FROM provider_default_models WHERE family = ?')) {
            const [family] = input as unknown[]
            for (const [id, row] of [...defaultModels.entries()]) {
              if (row.family === family) defaultModels.delete(id)
            }
          } else if (
            sql.startsWith(
              'DELETE FROM provider_default_models WHERE provider_id = ? AND family = ? AND model_id = ?'
            )
          ) {
            const [providerId, family, id] = input as unknown[]
            const stored = defaultModels.get(defaultId(String(providerId), String(family)))
            if (stored?.model_id === id) {
              defaultModels.delete(defaultId(String(providerId), String(family)))
            }
          } else if (sql.startsWith('DELETE FROM provider_models WHERE provider_id = ?')) {
            const [providerId] = input as unknown[]
            for (const row of [...models.values()]) {
              if (row.provider_id === providerId) {
                models.delete(modelId(String(providerId), String(row.family), String(row.model_id)))
              }
            }
          } else if (sql.startsWith('DELETE FROM provider_default_models WHERE provider_id = ?')) {
            const [providerId] = input as unknown[]
            for (const row of [...defaultModels.values()]) {
              if (row.provider_id === providerId)
                defaultModels.delete(defaultId(String(providerId), String(row.family)))
            }
          } else if (sql.startsWith('DELETE FROM provider_defaults WHERE provider_id = ?')) {
            const [providerId] = input as unknown[]
            for (const row of [...defaults.values()]) {
              if (row.provider_id === providerId)
                defaults.delete(defaultsId(String(providerId), String(row.family)))
            }
          }
          return { changes: 1 }
        },
        get(params?: unknown) {
          const values = params as unknown[]
          if (sql.includes('FROM provider_connections')) return connections.get(String(values[0]))
          if (sql.includes('FROM provider_keys'))
            return keys.get(keyId(String(values[0]), String(values[1])))
          if (sql.includes('FROM provider_defaults')) {
            return defaults.get(defaultsId(String(values[0]), String(values[1])))
          }
          return undefined
        },
        all(params?: unknown) {
          const values = params as unknown[] | undefined
          if (sql.includes('FROM provider_connections')) return [...connections.values()]
          if (sql.includes('FROM provider_keys')) {
            return [...keys.values()].filter((row) => row.provider_id === values?.[0])
          }
          if (sql.includes('WHERE provider_id = ? AND family = ?')) {
            return [...models.values()]
              .filter((row) => row.provider_id === values?.[0] && row.family === values?.[1])
              .map((row) => {
                const defaultModel = defaultModels.get(
                  defaultId(String(values?.[0]), String(values?.[1]))
                )
                return {
                  ...row,
                  default_provider_id: defaultModel?.provider_id,
                  default_model_id: defaultModel?.model_id
                }
              })
          }
          if (sql.includes('FROM provider_models')) {
            return [...models.values()]
              .filter((row) => row.provider_id === values?.[0])
              .map((row) => {
                const defaultModel = defaultModels.get(
                  defaultId(String(row.provider_id), String(row.family))
                )
                return {
                  ...row,
                  default_provider_id: defaultModel?.provider_id,
                  default_model_id: defaultModel?.model_id
                }
              })
          }
          return []
        }
      }
    }
  }
}

describe('main/provider/store', () => {
  it('persists provider connections and validation metadata', () => {
    const store = createProviderStore(createDb())

    store.saveConnection({
      providerId: 'openai',
      publicFields: { baseUrl: 'https://api.test' },
      secretFieldsEncrypted: { organizationSecret: 'enc:org' },
      activeKeyId: 'primary',
      connectedAt: '2026-01-01',
      lastValidationSucceeded: false,
      lastValidationMessage: 'expired',
      lastValidationLatency: 10
    })

    expect(store.loadConnection('openai')).toEqual({
      providerId: 'openai',
      publicFields: { baseUrl: 'https://api.test' },
      secretFieldsEncrypted: { organizationSecret: 'enc:org' },
      activeKeyId: 'primary',
      connectedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: expect.any(String),
      lastValidationSucceeded: false,
      lastValidationMessage: 'expired',
      lastValidationLatency: 10
    })
    expect(store.listConnections()).toHaveLength(1)
    store.deleteConnection('openai')
    expect(store.loadConnection('openai')).toBeUndefined()
  })

  it('persists provider keys and key validation status', () => {
    const store = createProviderStore(createDb())

    store.saveKey({
      providerId: 'openai',
      keyId: 'primary',
      label: 'Primary',
      encryptedValue: 'enc:key',
      status: 'valid',
      createdAt: '2026-01-01',
      lastValidationSucceeded: true,
      lastValidationMessage: 'ok',
      lastValidationLatency: 3
    })

    expect(store.loadKey('openai', 'primary')).toEqual({
      providerId: 'openai',
      keyId: 'primary',
      label: 'Primary',
      encryptedValue: 'enc:key',
      status: 'valid',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: expect.any(String),
      lastValidationSucceeded: true,
      lastValidationMessage: 'ok',
      lastValidationLatency: 3
    })
    expect(store.listKeys('openai')).toHaveLength(1)
    store.deleteKey('openai', 'primary')
    expect(store.listKeys('openai')).toEqual([])
  })

  it('persists models, default selection, and defaults state', () => {
    const db = createDb()
    const store = createProviderStore(db)

    store.saveModel({
      providerId: 'openai',
      family: 'language',
      modelId: 'gpt-5',
      enabled: true,
      isDefault: false,
      isCustom: false,
      source: 'api',
      model: {
        id: 'gpt-5',
        name: 'GPT 5',
        contextWindow: 200_000,
        capabilities: { vision: true }
      },
      contextWindowOverride: 150_000
    })
    store.saveModel({
      providerId: 'openai',
      family: 'language',
      modelId: 'gpt-4',
      enabled: false,
      isDefault: true,
      isCustom: true,
      source: 'custom',
      model: { id: 'gpt-4', name: 'GPT 4' }
    })
    store.setDefaultModel('openai', 'language', 'gpt-5')

    expect(store.listModels('openai', 'language')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'gpt-5',
          enabled: true,
          isDefault: true,
          contextWindowOverride: 150_000,
          model: expect.objectContaining({ capabilities: { vision: true } })
        }),
        expect.objectContaining({ modelId: 'gpt-4', enabled: false, isDefault: false })
      ])
    )

    store.saveModel({
      providerId: 'anthropic',
      family: 'language',
      modelId: 'claude-4',
      enabled: true,
      isDefault: false,
      isCustom: false,
      source: 'api',
      model: { id: 'claude-4', name: 'Claude 4' }
    })
    store.setDefaultModel('anthropic', 'language', 'claude-4')

    expect(store.listModels('openai', 'language')).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelId: 'gpt-5', isDefault: false })])
    )
    expect(store.listModels('anthropic', 'language')).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelId: 'claude-4', isDefault: true })])
    )

    store.saveModel({
      providerId: 'anthropic',
      family: 'language',
      modelId: 'claude-4',
      enabled: false,
      isDefault: false,
      isCustom: false,
      source: 'api',
      model: { id: 'claude-4', name: 'Claude 4' }
    })
    store.saveModel({
      providerId: 'anthropic',
      family: 'language',
      modelId: 'claude-4',
      enabled: true,
      isDefault: false,
      isCustom: false,
      source: 'api',
      model: { id: 'claude-4', name: 'Claude 4' }
    })
    expect(store.listModels('anthropic', 'language')).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelId: 'claude-4', isDefault: false })])
    )

    store.saveDefaults({
      providerId: 'openai',
      family: 'language',
      defaults: {
        callDefaults: { temperature: 0.2 },
        providerOptions: {},
        rawProviderOptions: {}
      }
    })
    expect(store.getDefaults('openai', 'language')).toEqual({
      providerId: 'openai',
      family: 'language',
      defaults: {
        callDefaults: { temperature: 0.2 },
        providerOptions: {},
        rawProviderOptions: {}
      },
      updatedAt: expect.any(String)
    })

    store.deleteModel('openai', 'language', 'gpt-4')
    expect(store.listModels('openai', 'language').map((model) => model.modelId)).toEqual(['gpt-5'])
    store.reset('openai')
    expect(store.listModels('openai')).toEqual([])
    expect(store.getDefaults('openai', 'language')).toBeUndefined()
  })

  it('normalizes partial defaults persisted by older migrations', () => {
    const db = createDb()
    const store = createProviderStore(db)
    db.defaults.set('openai:language', {
      provider_id: 'openai',
      family: 'language',
      defaults_json: '{"callDefaults":{"temperature":0.2}}',
      updated_at: 1
    })

    expect(store.getDefaults('openai', 'language')?.defaults).toEqual({
      callDefaults: { temperature: 0.2 },
      providerOptions: {},
      rawProviderOptions: {}
    })
  })
})
