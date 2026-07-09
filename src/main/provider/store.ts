import { z } from 'zod'
import {
  PROVIDER_IDS,
  type ModelCapabilityFlags,
  type ModelFamily,
  type ProviderDefaultsState,
  type ProviderId,
  type ProviderKeyStatus,
  type ProviderModelSource
} from '@shared/provider'
import type { SqlDatabase } from '../database/types'
import { createLogger } from '../logger'

const log = createLogger('provider-store')

const MODEL_FAMILIES = ['language', 'embedding', 'image', 'transcription', 'speech'] as const
const KEY_STATUSES = ['untested', 'valid', 'invalid'] as const
const MODEL_SOURCES = ['api', 'curated', 'custom'] as const

const stringRecordSchema = z.record(z.string(), z.string())
const unknownRecordSchema = z.record(z.string(), z.unknown())
const defaultsSchema = z
  .object({
    callDefaults: unknownRecordSchema.optional(),
    providerOptions: unknownRecordSchema.optional(),
    rawProviderOptions: unknownRecordSchema.optional()
  })
  .partial()
const modelPayloadSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    maxOutput: z.number().optional(),
    capabilities: z
      .object({
        reasoning: z.boolean().optional(),
        toolCall: z.boolean().optional(),
        vision: z.boolean().optional(),
        json: z.boolean().optional(),
        audioInput: z.boolean().optional(),
        audioOutput: z.boolean().optional(),
        imageGeneration: z.boolean().optional(),
        transcription: z.boolean().optional()
      })
      .optional(),
    dimensions: z.number().optional(),
    maxContextLength: z.number().optional(),
    maxBatchSize: z.number().optional(),
    maxImagesPerCall: z.number().optional(),
    supportedSizes: z.array(z.string()).optional(),
    supportedAspectRatios: z.array(z.string()).optional(),
    supportsTimestamps: z.boolean().optional(),
    supportedTimestampGranularities: z.array(z.enum(['word', 'segment'])).optional(),
    defaultVoice: z.string().optional(),
    supportedVoices: z.array(z.string()).optional(),
    supportedFormats: z.array(z.string()).optional()
  })
  .loose()

export interface StoredConnection {
  providerId: ProviderId
  publicFields: Record<string, string>
  secretFieldsEncrypted: Record<string, string>
  activeKeyId?: string
  connectedAt?: string
  updatedAt?: string
  lastValidatedAt?: string
  lastValidationSucceeded?: boolean
  lastValidationMessage?: string
  lastValidationLatency?: number
}

export interface StoredProviderKey {
  providerId: ProviderId
  keyId: string
  label: string
  encryptedValue: string
  status: ProviderKeyStatus
  createdAt?: string
  updatedAt?: string
  lastUsedAt?: string
  lastValidatedAt?: string
  lastValidationSucceeded?: boolean
  lastValidationMessage?: string
  lastValidationLatency?: number
}

export interface StoredModel {
  providerId: ProviderId
  family: ModelFamily
  modelId: string
  enabled: boolean
  isDefault: boolean
  isCustom: boolean
  source: ProviderModelSource
  model: {
    id: string
    name: string
    description?: string
    contextWindow?: number
    maxOutput?: number
    capabilities?: ModelCapabilityFlags
    dimensions?: number
    maxContextLength?: number
    maxBatchSize?: number
    maxImagesPerCall?: number
    supportedSizes?: string[]
    supportedAspectRatios?: string[]
    supportsTimestamps?: boolean
    supportedTimestampGranularities?: ('word' | 'segment')[]
    defaultVoice?: string
    supportedVoices?: string[]
    supportedFormats?: string[]
  }
  contextWindowOverride?: number
  updatedAt?: string
}

export interface StoredDefaults {
  providerId: ProviderId
  family: ModelFamily
  defaults: ProviderDefaultsState
  updatedAt?: string
}

export interface ProviderStore {
  saveConnection(input: StoredConnection): void
  loadConnection(providerId: ProviderId): StoredConnection | undefined
  listConnections(): StoredConnection[]
  deleteConnection(providerId: ProviderId): void
  saveKey(input: StoredProviderKey): void
  loadKey(providerId: ProviderId, keyId: string): StoredProviderKey | undefined
  listKeys(providerId: ProviderId): StoredProviderKey[]
  deleteKey(providerId: ProviderId, keyId: string): void
  deleteKeysForProvider(providerId: ProviderId): void
  saveModel(model: StoredModel): void
  deleteModel(providerId: ProviderId, family: ModelFamily, modelId: string): void
  listModels(providerId: ProviderId, family?: ModelFamily): StoredModel[]
  setDefaultModel(providerId: ProviderId, family: ModelFamily, modelId: string): void
  saveDefaults(input: StoredDefaults): void
  saveDefaultsBatch(inputs: StoredDefaults[]): void
  getDefaults(providerId: ProviderId, family: ModelFamily): StoredDefaults | undefined
  reset(providerId: ProviderId): void
}

interface ConnectionRow {
  provider_id: string
  public_fields_json: string
  secret_fields_encrypted_json: string
  active_key_id: string | null
  connected_at: number | null
  updated_at: number
  last_validated_at: number | null
  last_validation_succeeded: number | null
  last_validation_message: string | null
  last_validation_latency: number | null
}

interface ProviderKeyRow {
  provider_id: string
  key_id: string
  label: string
  encrypted_value: string
  status: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  last_validated_at: number | null
  last_validation_succeeded: number | null
  last_validation_message: string | null
  last_validation_latency: number | null
}

interface ModelRow {
  provider_id: string
  family: string
  model_id: string
  enabled: number
  is_custom: number
  source: string
  model_json: string
  context_window_override: number | null
  updated_at: number
  default_provider_id: string | null
  default_model_id: string | null
}

interface DefaultsRow {
  provider_id: string
  family: string
  defaults_json: string
  updated_at: number
}

function parseJson<T>(value: string, schema: z.ZodType<T>, field: string): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(value))
    if (parsed.success) return parsed.data
    log.warn(`invalid ${field} payload`, parsed.error)
    return undefined
  } catch (error) {
    log.warn(`failed to parse ${field} payload`, error)
    return undefined
  }
}

function oneOf<const T extends readonly string[]>(values: T, value: string): T[number] | undefined {
  return values.includes(value) ? value : undefined
}

function asProviderId(value: string): ProviderId | undefined {
  return PROVIDER_IDS.includes(value as ProviderId) ? (value as ProviderId) : undefined
}

function asFamily(value: string): ModelFamily | undefined {
  return oneOf(MODEL_FAMILIES, value) as ModelFamily | undefined
}

function asKeyStatus(value: string): ProviderKeyStatus {
  return (oneOf(KEY_STATUSES, value) as ProviderKeyStatus | undefined) ?? 'untested'
}

function asModelSource(value: string): ProviderModelSource | undefined {
  return oneOf(MODEL_SOURCES, value) as ProviderModelSource | undefined
}

function nonEmptyString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function toTimestamp(value: string | undefined, fallback = Date.now()): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function fromTimestamp(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString()
}

function providerKeyRowId(providerId: ProviderId, keyId: string): string {
  return `${providerId}:${keyId}`
}

function rowToConnection(row: ConnectionRow): StoredConnection | undefined {
  const providerId = asProviderId(row.provider_id)
  if (!providerId) return undefined
  return {
    providerId,
    publicFields:
      parseJson(row.public_fields_json, stringRecordSchema, 'provider public fields') ?? {},
    secretFieldsEncrypted:
      parseJson(
        row.secret_fields_encrypted_json,
        stringRecordSchema,
        'provider encrypted secret fields'
      ) ?? {},
    ...(row.active_key_id ? { activeKeyId: row.active_key_id } : {}),
    ...(fromTimestamp(row.connected_at) ? { connectedAt: fromTimestamp(row.connected_at) } : {}),
    ...(fromTimestamp(row.updated_at) ? { updatedAt: fromTimestamp(row.updated_at) } : {}),
    ...(fromTimestamp(row.last_validated_at)
      ? { lastValidatedAt: fromTimestamp(row.last_validated_at) }
      : {}),
    ...(row.last_validation_succeeded != null
      ? { lastValidationSucceeded: row.last_validation_succeeded === 1 }
      : {}),
    ...(row.last_validation_message ? { lastValidationMessage: row.last_validation_message } : {}),
    ...(row.last_validation_latency != null
      ? { lastValidationLatency: row.last_validation_latency }
      : {})
  }
}

function rowToKey(row: ProviderKeyRow): StoredProviderKey | undefined {
  const providerId = asProviderId(row.provider_id)
  const keyId = nonEmptyString(row.key_id)
  const encryptedValue = nonEmptyString(row.encrypted_value)
  if (!providerId || !keyId || !encryptedValue) return undefined
  return {
    providerId,
    keyId,
    label: nonEmptyString(row.label) ?? keyId,
    encryptedValue,
    status: asKeyStatus(row.status),
    ...(fromTimestamp(row.created_at) ? { createdAt: fromTimestamp(row.created_at) } : {}),
    ...(fromTimestamp(row.updated_at) ? { updatedAt: fromTimestamp(row.updated_at) } : {}),
    ...(fromTimestamp(row.last_used_at) ? { lastUsedAt: fromTimestamp(row.last_used_at) } : {}),
    ...(fromTimestamp(row.last_validated_at)
      ? { lastValidatedAt: fromTimestamp(row.last_validated_at) }
      : {}),
    ...(row.last_validation_succeeded != null
      ? { lastValidationSucceeded: row.last_validation_succeeded === 1 }
      : {}),
    ...(row.last_validation_message ? { lastValidationMessage: row.last_validation_message } : {}),
    ...(row.last_validation_latency != null
      ? { lastValidationLatency: row.last_validation_latency }
      : {})
  }
}

function rowToModel(row: ModelRow): StoredModel | undefined {
  const providerId = asProviderId(row.provider_id)
  const family = asFamily(row.family)
  const source = asModelSource(row.source)
  const modelId = nonEmptyString(row.model_id)
  const model = parseJson<StoredModel['model']>(
    row.model_json,
    modelPayloadSchema as z.ZodType<StoredModel['model']>,
    'provider model'
  )
  if (!providerId || !family || !source || !modelId || !model) return undefined
  return {
    providerId,
    family,
    modelId,
    enabled: row.enabled === 1,
    isDefault: row.default_provider_id === row.provider_id && row.default_model_id === row.model_id,
    isCustom: row.is_custom === 1,
    source,
    model: {
      ...model,
      id: modelId,
      name: nonEmptyString(model.name) ?? modelId
    },
    ...(row.context_window_override != null
      ? { contextWindowOverride: row.context_window_override }
      : {}),
    ...(fromTimestamp(row.updated_at) ? { updatedAt: fromTimestamp(row.updated_at) } : {})
  }
}

export function createProviderStore(db: SqlDatabase): ProviderStore {
  const upsertConnection = db.prepare(`
    INSERT INTO provider_connections (
      provider_id, public_fields_json, secret_fields_encrypted_json, active_key_id, connected_at, updated_at,
      last_validated_at, last_validation_succeeded, last_validation_message, last_validation_latency
    ) VALUES (
      @provider_id, @public_fields_json, @secret_fields_encrypted_json, @active_key_id, @connected_at, @updated_at,
      @last_validated_at, @last_validation_succeeded, @last_validation_message, @last_validation_latency
    )
    ON CONFLICT(provider_id) DO UPDATE SET
      public_fields_json = excluded.public_fields_json,
      secret_fields_encrypted_json = excluded.secret_fields_encrypted_json,
      active_key_id = excluded.active_key_id,
      connected_at = COALESCE(excluded.connected_at, provider_connections.connected_at),
      updated_at = excluded.updated_at,
      last_validated_at = excluded.last_validated_at,
      last_validation_succeeded = excluded.last_validation_succeeded,
      last_validation_message = excluded.last_validation_message,
      last_validation_latency = excluded.last_validation_latency
  `)
  const selectConnection = db.prepare('SELECT * FROM provider_connections WHERE provider_id = ?')
  const selectConnections = db.prepare('SELECT * FROM provider_connections')
  const deleteConnection = db.prepare('DELETE FROM provider_connections WHERE provider_id = ?')

  const upsertKey = db.prepare(`
    INSERT INTO provider_keys (
      id, provider_id, key_id, label, encrypted_value, status, created_at, updated_at,
      last_used_at, last_validated_at, last_validation_succeeded,
      last_validation_message, last_validation_latency
    ) VALUES (
      @id, @provider_id, @key_id, @label, @encrypted_value, @status, @created_at, @updated_at,
      @last_used_at, @last_validated_at, @last_validation_succeeded,
      @last_validation_message, @last_validation_latency
    )
    ON CONFLICT(provider_id, key_id) DO UPDATE SET
      label = excluded.label,
      encrypted_value = excluded.encrypted_value,
      status = excluded.status,
      updated_at = excluded.updated_at,
      last_used_at = excluded.last_used_at,
      last_validated_at = excluded.last_validated_at,
      last_validation_succeeded = excluded.last_validation_succeeded,
      last_validation_message = excluded.last_validation_message,
      last_validation_latency = excluded.last_validation_latency
  `)
  const selectKey = db.prepare('SELECT * FROM provider_keys WHERE provider_id = ? AND key_id = ?')
  const selectKeys = db.prepare(
    'SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY created_at, key_id'
  )
  const deleteKey = db.prepare('DELETE FROM provider_keys WHERE provider_id = ? AND key_id = ?')
  const deleteKeysForProvider = db.prepare('DELETE FROM provider_keys WHERE provider_id = ?')

  const upsertModel = db.prepare(`
    INSERT INTO provider_models (
      provider_id, family, model_id, name, enabled, is_custom,
      source, model_json, context_window_override, updated_at
    ) VALUES (
      @provider_id, @family, @model_id, @name, @enabled, @is_custom,
      @source, @model_json, @context_window_override, @updated_at
    )
    ON CONFLICT(provider_id, family, model_id) DO UPDATE SET
      name = excluded.name,
      enabled = excluded.enabled,
      is_custom = excluded.is_custom,
      source = excluded.source,
      model_json = excluded.model_json,
      context_window_override = excluded.context_window_override,
      updated_at = excluded.updated_at
  `)
  const deleteModel = db.prepare(
    'DELETE FROM provider_models WHERE provider_id = ? AND family = ? AND model_id = ?'
  )
  const selectModels = db.prepare(
    `SELECT provider_models.*,
       (
         SELECT provider_default_models.provider_id
         FROM provider_default_models
         WHERE provider_default_models.provider_id = provider_models.provider_id
           AND provider_default_models.family = provider_models.family
         ORDER BY provider_default_models.updated_at DESC, provider_default_models.provider_id, provider_default_models.model_id
         LIMIT 1
       ) AS default_provider_id,
       (
         SELECT provider_default_models.model_id
         FROM provider_default_models
         WHERE provider_default_models.provider_id = provider_models.provider_id
           AND provider_default_models.family = provider_models.family
         ORDER BY provider_default_models.updated_at DESC, provider_default_models.provider_id, provider_default_models.model_id
         LIMIT 1
       ) AS default_model_id
     FROM provider_models
     WHERE provider_models.provider_id = ?
     ORDER BY provider_models.family, provider_models.model_id`
  )
  const selectFamilyModels = db.prepare(
    `SELECT provider_models.*,
       (
         SELECT provider_default_models.provider_id
         FROM provider_default_models
         WHERE provider_default_models.provider_id = provider_models.provider_id
           AND provider_default_models.family = provider_models.family
         ORDER BY provider_default_models.updated_at DESC, provider_default_models.provider_id, provider_default_models.model_id
         LIMIT 1
       ) AS default_provider_id,
       (
         SELECT provider_default_models.model_id
         FROM provider_default_models
         WHERE provider_default_models.provider_id = provider_models.provider_id
           AND provider_default_models.family = provider_models.family
         ORDER BY provider_default_models.updated_at DESC, provider_default_models.provider_id, provider_default_models.model_id
         LIMIT 1
       ) AS default_model_id
     FROM provider_models
     WHERE provider_models.provider_id = ? AND provider_models.family = ?
     ORDER BY provider_models.model_id`
  )
  const deleteFamilyDefaultModel = db.prepare(
    'DELETE FROM provider_default_models WHERE family = ?'
  )
  const deleteMatchingDefaultModel = db.prepare(
    'DELETE FROM provider_default_models WHERE provider_id = ? AND family = ? AND model_id = ?'
  )
  const setDefault = db.prepare(
    `INSERT INTO provider_default_models (provider_id, family, model_id, updated_at)
     VALUES (?, ?, ?, ?)`
  )

  const upsertDefaults = db.prepare(`
    INSERT INTO provider_defaults (provider_id, family, defaults_json, updated_at)
    VALUES (@provider_id, @family, @defaults_json, @updated_at)
    ON CONFLICT(provider_id, family) DO UPDATE SET
      defaults_json = excluded.defaults_json,
      updated_at = excluded.updated_at
  `)
  const selectDefaults = db.prepare(
    'SELECT * FROM provider_defaults WHERE provider_id = ? AND family = ?'
  )
  const deleteModelsForProvider = db.prepare('DELETE FROM provider_models WHERE provider_id = ?')
  const deleteDefaultsForProvider = db.prepare(
    'DELETE FROM provider_defaults WHERE provider_id = ?'
  )
  const deleteDefaultModelsForProvider = db.prepare(
    'DELETE FROM provider_default_models WHERE provider_id = ?'
  )

  function setProviderDefaultModel(
    providerId: ProviderId,
    family: ModelFamily,
    modelId: string
  ): void {
    deleteFamilyDefaultModel.run([family])
    setDefault.run([providerId, family, modelId, Date.now()])
  }

  function persistDefaults(input: StoredDefaults): void {
    const now = Date.now()
    upsertDefaults.run({
      provider_id: input.providerId,
      family: input.family,
      defaults_json: JSON.stringify(input.defaults),
      updated_at: toTimestamp(input.updatedAt, now)
    })
  }

  return {
    saveConnection(input) {
      const now = Date.now()
      upsertConnection.run({
        provider_id: input.providerId,
        public_fields_json: JSON.stringify(input.publicFields),
        secret_fields_encrypted_json: JSON.stringify(input.secretFieldsEncrypted),
        active_key_id: input.activeKeyId ?? null,
        connected_at: input.connectedAt ? toTimestamp(input.connectedAt, now) : null,
        updated_at: toTimestamp(input.updatedAt, now),
        last_validated_at: input.lastValidatedAt ? toTimestamp(input.lastValidatedAt, now) : null,
        last_validation_succeeded:
          input.lastValidationSucceeded === undefined
            ? null
            : input.lastValidationSucceeded
              ? 1
              : 0,
        last_validation_message: input.lastValidationMessage ?? null,
        last_validation_latency: input.lastValidationLatency ?? null
      })
    },
    loadConnection(providerId) {
      const row = selectConnection.get([providerId]) as ConnectionRow | undefined
      return row ? rowToConnection(row) : undefined
    },
    listConnections() {
      return (selectConnections.all() as ConnectionRow[]).flatMap((row) => {
        const connection = rowToConnection(row)
        return connection ? [connection] : []
      })
    },
    deleteConnection(providerId) {
      deleteConnection.run([providerId])
    },
    saveKey(input) {
      const now = Date.now()
      upsertKey.run({
        id: providerKeyRowId(input.providerId, input.keyId),
        provider_id: input.providerId,
        key_id: input.keyId,
        label: input.label,
        encrypted_value: input.encryptedValue,
        status: input.status,
        created_at: toTimestamp(input.createdAt, now),
        updated_at: toTimestamp(input.updatedAt, now),
        last_used_at: input.lastUsedAt ? toTimestamp(input.lastUsedAt, now) : null,
        last_validated_at: input.lastValidatedAt ? toTimestamp(input.lastValidatedAt, now) : null,
        last_validation_succeeded:
          input.lastValidationSucceeded === undefined
            ? null
            : input.lastValidationSucceeded
              ? 1
              : 0,
        last_validation_message: input.lastValidationMessage ?? null,
        last_validation_latency: input.lastValidationLatency ?? null
      })
    },
    loadKey(providerId, keyId) {
      const row = selectKey.get([providerId, keyId]) as ProviderKeyRow | undefined
      return row ? rowToKey(row) : undefined
    },
    listKeys(providerId) {
      return (selectKeys.all([providerId]) as ProviderKeyRow[]).flatMap((row) => {
        const key = rowToKey(row)
        return key ? [key] : []
      })
    },
    deleteKey(providerId, keyId) {
      deleteKey.run([providerId, keyId])
    },
    deleteKeysForProvider(providerId) {
      deleteKeysForProvider.run([providerId])
    },
    saveModel(model) {
      const now = Date.now()
      const write = () => {
        upsertModel.run({
          provider_id: model.providerId,
          family: model.family,
          model_id: model.modelId,
          name: model.model.name || model.modelId,
          enabled: model.enabled ? 1 : 0,
          is_custom: model.isCustom ? 1 : 0,
          source: model.source,
          model_json: JSON.stringify(model.model),
          context_window_override: model.contextWindowOverride ?? null,
          updated_at: toTimestamp(model.updatedAt, now)
        })
        if (model.isDefault && model.enabled) {
          setProviderDefaultModel(model.providerId, model.family, model.modelId)
        } else {
          deleteMatchingDefaultModel.run([model.providerId, model.family, model.modelId])
        }
      }
      db.transaction(write)
    },
    deleteModel(providerId, family, modelId) {
      deleteModel.run([providerId, family, modelId])
    },
    listModels(providerId, family) {
      const rows = family
        ? (selectFamilyModels.all([providerId, family]) as ModelRow[])
        : (selectModels.all([providerId]) as ModelRow[])
      return rows.flatMap((row) => {
        const model = rowToModel(row)
        return model ? [model] : []
      })
    },
    setDefaultModel(providerId, family, modelId) {
      db.transaction(() => setProviderDefaultModel(providerId, family, modelId))
    },
    saveDefaults(input) {
      persistDefaults(input)
    },
    saveDefaultsBatch(inputs) {
      db.transaction(() => {
        for (const input of inputs) persistDefaults(input)
      })
    },
    getDefaults(providerId, family) {
      const row = selectDefaults.get([providerId, family]) as DefaultsRow | undefined
      if (!row) return undefined
      const provider = asProviderId(row.provider_id)
      const modelFamily = asFamily(row.family)
      if (!provider || !modelFamily) return undefined
      const parsed = parseJson(row.defaults_json, defaultsSchema, 'provider defaults')
      return {
        providerId: provider,
        family: modelFamily,
        defaults: parsed
          ? {
              callDefaults: parsed.callDefaults ?? {},
              providerOptions: parsed.providerOptions ?? {},
              rawProviderOptions: parsed.rawProviderOptions ?? {}
            }
          : { callDefaults: {}, providerOptions: {}, rawProviderOptions: {} },
        ...(fromTimestamp(row.updated_at) ? { updatedAt: fromTimestamp(row.updated_at) } : {})
      }
    },
    reset(providerId) {
      db.transaction(() => {
        deleteConnection.run([providerId])
        deleteKeysForProvider.run([providerId])
        deleteDefaultModelsForProvider.run([providerId])
        deleteModelsForProvider.run([providerId])
        deleteDefaultsForProvider.run([providerId])
      })
    }
  }
}
