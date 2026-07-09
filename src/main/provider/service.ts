import type {
  AddProviderKeyInput,
  ConnectionTestResult,
  ModelFamily,
  ModelRefreshResult,
  ProviderDefaultsState,
  ProviderConfig,
  ProviderConnectionInfo,
  ProviderFamilyState,
  ProviderId,
  ProviderKeySummary,
  ProviderModel,
  ProviderOptionSchema,
  ProviderReasoningCapability,
  ProviderSetupState,
  ProviderWorkspace,
  SaveProviderConnectionInput,
  SaveProviderDefaultsInput,
  SaveProviderModelStateInput,
  StoredProviderModel,
  UpdateProviderKeyInput
} from '@shared/provider'
import { parseModelRef, requireModelRef } from '@shared/provider'
import type { LanguageModel } from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { randomUUID } from 'crypto'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import { getReasoningCapability } from './capabilities'
import { getAdapter, type Credentials, type RemoteModel } from './adapter'
import { getProvider, getSupportedFamilies, listProviders } from './catalog'
import { enrichLanguageModelsWithMetadata } from './model-metadata'
import { createProviderRuntime } from './runtime'
import {
  listOptionSchemas,
  mergeProviderOptions,
  normalizeDefaults,
  normalizeStoredDefaults,
  validateProviderOptions
} from './options'
import { coerceCallSettings, parseCallSettings, type CallSettings } from './call-settings'
import type { SecretCodec } from './secret'
import type { ProviderStore, StoredConnection, StoredModel, StoredProviderKey } from './store'

export interface ProviderService {
  listCatalog(): ProviderConfig[]
  listSetups(): ProviderSetupState[]
  getWorkspace(providerId: ProviderId): ProviderWorkspace
  saveConnection(input: SaveProviderConnectionInput): ProviderWorkspace
  testConnection(providerId: ProviderId): Promise<ConnectionTestResult>
  disconnect(providerId: ProviderId): void
  reset(providerId: ProviderId): void
  listKeys(providerId: ProviderId): ProviderKeySummary[]
  addKey(input: AddProviderKeyInput): ProviderKeySummary[]
  updateKey(input: UpdateProviderKeyInput): ProviderKeySummary[]
  deleteKey(providerId: ProviderId, keyId: string): ProviderKeySummary[]
  setActiveKey(providerId: ProviderId, keyId: string): ProviderWorkspace
  listOptionSchemas(providerId?: ProviderId, family?: ModelFamily): ProviderOptionSchema[]
  getReasoning(providerId: ProviderId, family?: ModelFamily): ProviderReasoningCapability
  syncModels(providerId: ProviderId, family: ModelFamily): Promise<ModelRefreshResult>
  saveModelState(input: SaveProviderModelStateInput): Promise<ProviderWorkspace>
  saveDefaults(input: SaveProviderDefaultsInput): ProviderWorkspace

  resolveLanguageModel(modelRef: string): LanguageModel

  getModelMetadata(modelRef: string): ModelMetadata | undefined
  getProviderOptions(providerId: ProviderId, family: ModelFamily): ProviderOptions
  getCallSettings(providerId: ProviderId, family: ModelFamily): CallSettings
}

export interface ModelMetadata {
  contextWindow?: number
  maxOutput?: number
  vision?: boolean
}

const SECRET_MASK_CHAR = '•'
const FULL_SECRET_MASK_RE = /^•+$/
const PREFIXED_SECRET_MASK_RE = /^[^\s•]{4}•{5,16}$/

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return SECRET_MASK_CHAR.repeat(8)
  return `${trimmed.slice(0, 4)}${SECRET_MASK_CHAR.repeat(Math.min(trimmed.length - 4, 16))}`
}

function maskEncryptedSecret(codec: SecretCodec, ciphertext: string): string {
  try {
    return maskSecret(codec.decrypt(ciphertext))
  } catch {
    return SECRET_MASK_CHAR.repeat(8)
  }
}

function isMask(value: string | undefined): boolean {
  const trimmed = value?.trim()
  return Boolean(
    trimmed && (FULL_SECRET_MASK_RE.test(trimmed) || PREFIXED_SECRET_MASK_RE.test(trimmed))
  )
}

function partitionFields(
  catalog: ProviderConfig,
  credentials: Record<string, string>,
  previous: StoredConnection | undefined,
  codec: SecretCodec
): { publicFields: Record<string, string>; secretFieldsEncrypted: Record<string, string> } {
  const publicFields: Record<string, string> = {}
  const secretFieldsEncrypted: Record<string, string> = {}
  for (const field of catalog.credentialFields) {
    const value = credentials[field.key]
    if (field.secret && isMask(value)) {
      const previousSecret = previous?.secretFieldsEncrypted[field.key]
      if (previousSecret) secretFieldsEncrypted[field.key] = previousSecret
      continue
    }
    if (value === undefined || value === '') continue
    if (field.key === 'apiKey') continue
    if (field.secret) {
      secretFieldsEncrypted[field.key] = codec.encrypt(value)
    } else {
      publicFields[field.key] = value
    }
  }
  return { publicFields, secretFieldsEncrypted }
}

function apiKeyInput(credentials: Record<string, string>): string | undefined {
  const value = credentials.apiKey
  if (value === undefined || value === '' || isMask(value)) return undefined
  return value
}

function hasRequiredCredentials(
  catalog: ProviderConfig,
  stored: StoredConnection,
  keys: StoredProviderKey[]
): boolean {
  return catalog.credentialFields.every((field) => {
    if (!field.required) return true
    if (field.key === 'apiKey') return Boolean(selectActiveKey(keys, stored.activeKeyId))
    if (field.secret) return Boolean(stored.secretFieldsEncrypted[field.key])
    return Boolean(stored.publicFields[field.key]?.trim())
  })
}

function selectActiveKey(
  keys: StoredProviderKey[],
  activeKeyId: string | undefined
): StoredProviderKey | undefined {
  return (activeKeyId ? keys.find((key) => key.keyId === activeKeyId) : undefined) ?? keys[0]
}

function effectiveActiveKeyId(
  stored: StoredConnection | undefined,
  keys: StoredProviderKey[]
): string | undefined {
  return selectActiveKey(keys, stored?.activeKeyId)?.keyId
}

function resetConnectionValidation(stored: StoredConnection): StoredConnection {
  const next = { ...stored }
  delete next.lastValidatedAt
  delete next.lastValidationSucceeded
  delete next.lastValidationMessage
  delete next.lastValidationLatency
  return next
}

function withValidationResult<T extends StoredConnection | StoredProviderKey>(
  record: T,
  result: ConnectionTestResult,
  validatedAt: string
): T {
  const next = {
    ...record,
    lastValidatedAt: validatedAt,
    lastValidationSucceeded: result.success,
    lastValidationMessage: result.message
  }
  if (result.latency === undefined) {
    delete next.lastValidationLatency
  } else {
    next.lastValidationLatency = result.latency
  }
  return next
}

function decryptCredentials(
  stored: StoredConnection,
  codec: SecretCodec,
  key: StoredProviderKey | undefined
): Credentials {
  const out: Record<string, string> = { ...stored.publicFields }
  for (const [fieldKey, value] of Object.entries(stored.secretFieldsEncrypted)) {
    if (fieldKey === 'apiKey') continue
    out[fieldKey] = codec.decrypt(value)
  }
  if (key) {
    out.apiKey = codec.decrypt(key.encryptedValue)
  }
  return out
}

interface CredentialSnapshot {
  stored: StoredConnection
  key?: StoredProviderKey
  credentials: Credentials
}

function stringRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key])
}

function buildConnectionInfo(
  catalog: ProviderConfig,
  stored: StoredConnection | undefined,
  codec: SecretCodec,
  keys: StoredProviderKey[]
): ProviderConnectionInfo {
  const encryptionAvailable = codec.isEncryptionAvailable()
  if (!stored) {
    return {
      providerId: catalog.id,
      status: 'disconnected',
      encryptionAvailable,
      formValues: {},
      keyCount: keys.length
    }
  }
  const formValues: Record<string, string> = { ...stored.publicFields }
  const activeKey = selectActiveKey(keys, stored.activeKeyId)
  for (const field of catalog.credentialFields) {
    if (field.key === 'apiKey' && activeKey) {
      formValues[field.key] = maskEncryptedSecret(codec, activeKey.encryptedValue)
      continue
    }
    if (!field.secret) continue
    const ciphertext = stored.secretFieldsEncrypted[field.key]
    if (!ciphertext) continue
    formValues[field.key] = maskSecret('•'.repeat(20))
  }
  const status = !hasRequiredCredentials(catalog, stored, keys)
    ? 'disconnected'
    : stored.lastValidationSucceeded === false
      ? 'expired'
      : 'connected'
  return {
    providerId: catalog.id,
    status,
    encryptionAvailable,
    formValues,
    ...(activeKey ? { activeKeyId: activeKey.keyId } : {}),
    keyCount: keys.length,
    ...(stored.connectedAt ? { connectedAt: stored.connectedAt } : {}),
    ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
    ...(stored.lastValidatedAt ? { lastValidatedAt: stored.lastValidatedAt } : {}),
    ...(stored.lastValidationSucceeded !== undefined
      ? { lastValidationSucceeded: stored.lastValidationSucceeded }
      : {}),
    ...(stored.lastValidationMessage
      ? { lastValidationMessage: stored.lastValidationMessage }
      : {}),
    ...(stored.lastValidationLatency !== undefined
      ? { lastValidationLatency: stored.lastValidationLatency }
      : {})
  }
}

type ModelDetailFields = Omit<StoredModel['model'], 'id' | 'name' | 'description'>

const MODEL_DETAIL_KEYS: readonly (keyof ModelDetailFields)[] = [
  'contextWindow',
  'maxOutput',
  'capabilities',
  'dimensions',
  'maxContextLength',
  'maxBatchSize',
  'maxImagesPerCall',
  'supportedSizes',
  'supportedAspectRatios',
  'supportsTimestamps',
  'supportedTimestampGranularities',
  'defaultVoice',
  'supportedVoices',
  'supportedFormats'
]

function copyDefinedModelFields(source: Partial<ModelDetailFields>): Partial<ModelDetailFields> {
  const out: Partial<ModelDetailFields> = {}
  for (const key of MODEL_DETAIL_KEYS) {
    const value = source[key]
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

function storedModelToContract(row: StoredModel): StoredProviderModel {
  return {
    providerId: row.providerId,
    family: row.family,
    id: row.modelId,
    name: row.model.name,
    ...(row.model.description ? { description: row.model.description } : {}),
    enabled: row.enabled,
    isDefault: row.enabled && row.isDefault,
    isCustom: row.isCustom,
    source: row.source,
    ...copyDefinedModelFields(row.model),
    ...(row.contextWindowOverride !== undefined
      ? { contextWindowOverride: row.contextWindowOverride }
      : {})
  }
}

function familyState(
  catalog: ProviderConfig,
  family: ModelFamily,
  rows: StoredModel[],
  defaults: ProviderDefaultsState
): ProviderFamilyState {
  const descriptor = catalog.families[family]
  if (!descriptor) {
    throw new TanzoNotFoundError(
      'PROVIDER_FAMILY_UNSUPPORTED',
      `Provider ${catalog.id} does not support ${family}`,
      { details: { providerId: catalog.id, family } }
    )
  }
  const models = rows.filter((row) => row.family === family).map(storedModelToContract)
  const enabledModels = models.filter((model) => model.enabled)
  const defaultModel = enabledModels.find((model) => model.isDefault)
  return {
    family,
    descriptor,
    models,
    enabledModelIds: enabledModels.map((model) => model.id),
    defaultModelId: defaultModel?.id ?? null,
    modelCount: models.length,
    enabledModelCount: enabledModels.length,
    defaults
  }
}

function configurationStatus(
  connection: ProviderConnectionInfo,
  modalities: Partial<Record<ModelFamily, ProviderFamilyState>>
): ProviderSetupState['configurationStatus'] {
  if (connection.status === 'disconnected') return 'not_connected'
  const language = modalities.language
  if ((language?.enabledModelCount ?? 0) > 0) return 'ready'
  if ((language?.modelCount ?? 0) > 0) return 'models_not_enabled'
  return 'connected_no_models'
}

function remoteToStored(
  providerId: ProviderId,
  family: ModelFamily,
  remote: RemoteModel
): StoredModel {
  return {
    providerId,
    family,
    modelId: remote.id,
    enabled: true,
    isDefault: false,
    isCustom: false,
    source: 'api',
    model: {
      id: remote.id,
      name: remote.name,
      ...(remote.description ? { description: remote.description } : {}),
      ...copyDefinedModelFields(remote)
    }
  }
}

function familyModelPayload(
  modelId: string,
  model: SaveProviderModelStateInput['model']
): StoredModel['model'] | undefined {
  if (!model) return undefined
  return {
    id: modelId,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    ...copyDefinedModelFields(model)
  }
}

function incomingModelToStoredModel(
  input: SaveProviderModelStateInput,
  existing?: StoredModel
): StoredModel {
  const modelPayload =
    familyModelPayload(input.modelId, input.model) ??
    (existing
      ? { ...existing.model, id: input.modelId }
      : { id: input.modelId, name: input.modelId })

  const enabled = input.enabled ?? existing?.enabled ?? true
  const isDefault = enabled ? (input.isDefault ?? existing?.isDefault ?? false) : false

  return {
    providerId: input.providerId,
    family: input.family,
    modelId: input.modelId,
    enabled,
    isDefault,
    isCustom: input.isCustom ?? existing?.isCustom ?? false,
    source: existing?.source ?? (input.isCustom ? 'custom' : 'api'),
    model: modelPayload,
    ...(input.contextWindowOverride === null
      ? {}
      : input.contextWindowOverride !== undefined
        ? { contextWindowOverride: input.contextWindowOverride }
        : existing?.contextWindowOverride !== undefined
          ? { contextWindowOverride: existing.contextWindowOverride }
          : {})
  }
}

async function enrichProviderModels(
  providerId: ProviderId,
  family: ModelFamily,
  models: RemoteModel[]
): Promise<RemoteModel[]> {
  if (family !== 'language') return models
  return enrichLanguageModelsWithMetadata(providerId, models as ProviderModel[])
}

async function enrichModelStateInput(
  input: SaveProviderModelStateInput
): Promise<SaveProviderModelStateInput> {
  if (input.family !== 'language' || !input.model || input.delete) return input
  const [model] = await enrichLanguageModelsWithMetadata(input.providerId, [
    input.model as ProviderModel
  ])
  return model ? { ...input, model } : input
}

export function createProviderService(store: ProviderStore, codec: SecretCodec): ProviderService {
  function getActiveKey(
    stored: StoredConnection,
    explicitKeyId?: string
  ): StoredProviderKey | undefined {
    if (explicitKeyId) return store.loadKey(stored.providerId, explicitKeyId)
    return selectActiveKey(store.listKeys(stored.providerId), stored.activeKeyId)
  }

  function loadCredentialSnapshot(providerId: ProviderId, keyId?: string): CredentialSnapshot {
    const stored = store.loadConnection(providerId)
    if (!stored) {
      throw new TanzoNotFoundError(
        'PROVIDER_NOT_CONNECTED',
        `Provider not connected: ${providerId}`,
        { details: { providerId } }
      )
    }
    const key = getActiveKey(stored, keyId)
    if (key) {
      store.saveKey({ ...key, lastUsedAt: new Date().toISOString() })
    }
    return {
      stored,
      ...(key ? { key } : {}),
      credentials: decryptCredentials(stored, codec, key)
    }
  }

  function loadCredentials(providerId: ProviderId, keyId?: string): Credentials {
    const snapshot = loadCredentialSnapshot(providerId, keyId)
    if (!getAdapter(providerId).validateCredentials(snapshot.credentials)) {
      const missing = getProvider(providerId)
        .credentialFields.filter(
          (field) => field.required && !snapshot.credentials[field.key]?.trim()
        )
        .map((field) => field.key)
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        `Missing required credentials: ${missing.join(', ') || 'credentials'}`,
        { details: { providerId, missing } }
      )
    }
    return snapshot.credentials
  }

  function credentialSnapshotStillCurrent(
    snapshot: CredentialSnapshot,
    options: { requireActiveKeyMatch: boolean }
  ): { stored: StoredConnection; key?: StoredProviderKey } | undefined {
    const current = store.loadConnection(snapshot.stored.providerId)
    if (!current) return undefined
    if (!stringRecordsEqual(current.publicFields, snapshot.stored.publicFields)) return undefined
    if (!stringRecordsEqual(current.secretFieldsEncrypted, snapshot.stored.secretFieldsEncrypted)) {
      return undefined
    }
    if (options.requireActiveKeyMatch && current.activeKeyId !== snapshot.stored.activeKeyId) {
      return undefined
    }
    if (!snapshot.key) return { stored: current }
    const key = store.loadKey(snapshot.stored.providerId, snapshot.key.keyId)
    if (!key || key.encryptedValue !== snapshot.key.encryptedValue) return undefined
    return { stored: current, key }
  }

  const runtime = createProviderRuntime({ loadCredentials })

  function keySummary(
    providerId: ProviderId,
    activeKeyId: string | undefined,
    key: StoredProviderKey
  ): ProviderKeySummary {
    return {
      providerId,
      keyId: key.keyId,
      label: key.label,
      maskedKey: maskEncryptedSecret(codec, key.encryptedValue),
      active: activeKeyId === key.keyId,
      status: key.status,
      encryptionAvailable: codec.isEncryptionAvailable(),
      ...(key.createdAt ? { createdAt: key.createdAt } : {}),
      ...(key.updatedAt ? { updatedAt: key.updatedAt } : {}),
      ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt } : {}),
      ...(key.lastValidatedAt ? { lastValidatedAt: key.lastValidatedAt } : {}),
      ...(key.lastValidationSucceeded !== undefined
        ? { lastValidationSucceeded: key.lastValidationSucceeded }
        : {}),
      ...(key.lastValidationMessage ? { lastValidationMessage: key.lastValidationMessage } : {}),
      ...(key.lastValidationLatency !== undefined
        ? { lastValidationLatency: key.lastValidationLatency }
        : {})
    }
  }

  function listKeySummaries(providerId: ProviderId): ProviderKeySummary[] {
    const stored = store.loadConnection(providerId)
    const keys = store.listKeys(providerId)
    const activeKeyId = effectiveActiveKeyId(stored, keys)
    return keys.map((key) => keySummary(providerId, activeKeyId, key))
  }

  function ensureConnection(providerId: ProviderId, activeKeyId?: string): StoredConnection {
    const previous = store.loadConnection(providerId)
    if (previous) {
      return activeKeyId ? { ...previous, activeKeyId } : previous
    }
    const now = new Date().toISOString()
    return {
      providerId,
      publicFields: {},
      secretFieldsEncrypted: {},
      ...(activeKeyId ? { activeKeyId } : {}),
      connectedAt: now,
      updatedAt: now
    }
  }

  function firstRemainingKeyId(providerId: ProviderId, exceptKeyId: string): string | undefined {
    return store.listKeys(providerId).find((key) => key.keyId !== exceptKeyId)?.keyId
  }

  function saveConnectionWithActiveKey(
    stored: StoredConnection,
    activeKeyId: string | undefined,
    options: { resetValidation?: boolean } = {}
  ): void {
    const connection = options.resetValidation ? resetConnectionValidation(stored) : stored
    const withoutActiveKey: StoredConnection = {
      ...connection,
      activeKeyId: undefined
    }
    store.saveConnection({
      ...withoutActiveKey,
      ...(activeKeyId ? { activeKeyId } : {}),
      updatedAt: new Date().toISOString()
    })
  }

  function buildSetup(providerId: ProviderId): ProviderSetupState {
    const catalog = getProvider(providerId)
    const storedConnection = store.loadConnection(providerId)
    const connection = buildConnectionInfo(
      catalog,
      storedConnection,
      codec,
      store.listKeys(providerId)
    )
    const rows = store.listModels(providerId)
    const modalities: Partial<Record<ModelFamily, ProviderFamilyState>> = {}
    for (const family of getSupportedFamilies(providerId)) {
      modalities[family] = familyState(
        catalog,
        family,
        rows,
        normalizeStoredDefaults(store.getDefaults(providerId, family)?.defaults)
      )
    }
    return {
      providerId,
      connection,
      configurationStatus: configurationStatus(connection, modalities),
      supportedFamilies: getSupportedFamilies(providerId),
      modalities
    }
  }

  function buildWorkspace(providerId: ProviderId): ProviderWorkspace {
    const setup = buildSetup(providerId)
    return {
      provider: getProvider(providerId),
      setup,
      connection: setup.connection,
      modalities: setup.modalities
    }
  }

  function requireSupportedFamily(providerId: ProviderId, family: ModelFamily): void {
    const descriptor = getProvider(providerId).families[family]
    if (descriptor?.supported) return
    throw new TanzoValidationError(
      'PROVIDER_FAMILY_UNSUPPORTED',
      `Provider ${providerId} does not support ${family} models.`,
      { details: { providerId, family } }
    )
  }

  function ensureUsableLanguageModel(providerId: ProviderId, modelId: string): void {
    getProvider(providerId)
    const model = store.listModels(providerId, 'language').find((row) => row.modelId === modelId)
    if (!model) {
      throw new TanzoNotFoundError(
        'PROVIDER_MODEL_NOT_FOUND',
        `Language model not found: ${providerId}:${modelId}`,
        { details: { providerId, modelId, family: 'language' } }
      )
    }
    if (!model.enabled) {
      throw new TanzoValidationError(
        'PROVIDER_MODEL_DISABLED',
        `Language model is disabled: ${providerId}:${modelId}`,
        { details: { providerId, modelId, family: 'language' } }
      )
    }
  }

  return {
    listCatalog: () => listProviders(),
    listSetups: () => listProviders().map((provider) => buildSetup(provider.id)),
    getWorkspace: (providerId) => buildWorkspace(providerId),
    saveConnection(input) {
      const catalog = getProvider(input.providerId)
      const previous = store.loadConnection(input.providerId)
      const { publicFields, secretFieldsEncrypted } = partitionFields(
        catalog,
        input.credentials,
        previous,
        codec
      )
      const plainApiKey = apiKeyInput(input.credentials)
      let activeKeyId = previous?.activeKeyId ?? store.listKeys(input.providerId)[0]?.keyId
      if (plainApiKey) {
        const now = new Date().toISOString()
        const existingKey = activeKeyId ? store.loadKey(input.providerId, activeKeyId) : undefined
        const keyId = existingKey?.keyId ?? 'primary'
        store.saveKey({
          providerId: input.providerId,
          keyId,
          label: existingKey?.label ?? 'Primary',
          encryptedValue: codec.encrypt(plainApiKey),
          status: 'untested',
          createdAt: existingKey?.createdAt ?? now,
          updatedAt: now
        })
        activeKeyId = keyId
      }
      const now = new Date().toISOString()
      store.saveConnection({
        providerId: input.providerId,
        publicFields,
        secretFieldsEncrypted,
        ...(activeKeyId ? { activeKeyId } : {}),
        connectedAt: previous?.connectedAt ?? now,
        updatedAt: now
      })
      runtime.invalidate(input.providerId)
      return buildWorkspace(input.providerId)
    },
    async testConnection(providerId) {
      if (!store.loadConnection(providerId)) {
        getProvider(providerId)
        return {
          success: false,
          message: 'Save provider credentials before testing the connection.'
        }
      }
      const snapshot = loadCredentialSnapshot(providerId)
      const result = await getAdapter(providerId).testConnection(snapshot.credentials)
      const current = credentialSnapshotStillCurrent(snapshot, { requireActiveKeyMatch: true })
      if (current) {
        const validatedAt = new Date().toISOString()
        store.saveConnection(withValidationResult(current.stored, result, validatedAt))
        if (current.key) {
          store.saveKey({
            ...withValidationResult(current.key, result, validatedAt),
            status: result.success ? 'valid' : 'invalid'
          })
        }
      }
      return result
    },
    disconnect(providerId) {
      store.deleteConnection(providerId)
      store.deleteKeysForProvider(providerId)
      runtime.invalidate(providerId)
    },
    reset(providerId) {
      store.reset(providerId)
      runtime.invalidate(providerId)
    },
    listKeys(providerId) {
      getProvider(providerId)
      return listKeySummaries(providerId)
    },
    addKey(input) {
      getProvider(input.providerId)
      if (!input.apiKey.trim()) {
        throw new TanzoValidationError('PROVIDER_API_KEY_REQUIRED', 'API key is required.', {
          details: { providerId: input.providerId }
        })
      }
      const now = new Date().toISOString()
      const keyId = randomUUID()
      const existingKeys = store.listKeys(input.providerId)
      const shouldActivate = input.makeActive ?? existingKeys.length === 0
      store.saveKey({
        providerId: input.providerId,
        keyId,
        label: input.label?.trim() || `Key ${existingKeys.length + 1}`,
        encryptedValue: codec.encrypt(input.apiKey),
        status: 'untested',
        createdAt: now,
        updatedAt: now
      })
      if (shouldActivate) {
        store.saveConnection({
          ...resetConnectionValidation(ensureConnection(input.providerId, keyId)),
          activeKeyId: keyId,
          updatedAt: now
        })
        runtime.invalidate(input.providerId)
      }
      return listKeySummaries(input.providerId)
    },
    updateKey(input) {
      getProvider(input.providerId)
      const key = store.loadKey(input.providerId, input.keyId)
      if (!key) {
        throw new TanzoNotFoundError(
          'PROVIDER_KEY_NOT_FOUND',
          `Provider key not found: ${input.keyId}`,
          { details: { providerId: input.providerId, keyId: input.keyId } }
        )
      }
      const encryptedValue =
        input.apiKey && !isMask(input.apiKey) ? codec.encrypt(input.apiKey) : key.encryptedValue
      const changedSecret = encryptedValue !== key.encryptedValue
      store.saveKey({
        ...key,
        label: input.label?.trim() || key.label,
        encryptedValue,
        status: changedSecret ? 'untested' : key.status,
        updatedAt: new Date().toISOString(),
        ...(changedSecret
          ? {
              lastValidatedAt: undefined,
              lastValidationSucceeded: undefined,
              lastValidationMessage: undefined,
              lastValidationLatency: undefined
            }
          : {})
      })
      if (changedSecret) {
        runtime.invalidate(input.providerId)
        const stored = store.loadConnection(input.providerId)
        const activeKeyId = effectiveActiveKeyId(stored, store.listKeys(input.providerId))
        if (stored && activeKeyId === input.keyId) {
          saveConnectionWithActiveKey(stored, activeKeyId, { resetValidation: true })
        }
      }
      return listKeySummaries(input.providerId)
    },
    deleteKey(providerId, keyId) {
      getProvider(providerId)
      const key = store.loadKey(providerId, keyId)
      if (!key) {
        throw new TanzoNotFoundError('PROVIDER_KEY_NOT_FOUND', `Provider key not found: ${keyId}`, {
          details: { providerId, keyId }
        })
      }
      const stored = store.loadConnection(providerId)
      const previousActiveKeyId = effectiveActiveKeyId(stored, store.listKeys(providerId))
      store.deleteKey(providerId, keyId)
      runtime.invalidate(providerId)
      if (stored && previousActiveKeyId === keyId) {
        const nextKeyId = firstRemainingKeyId(providerId, keyId)
        saveConnectionWithActiveKey(stored, nextKeyId, { resetValidation: true })
      }
      return listKeySummaries(providerId)
    },
    setActiveKey(providerId, keyId) {
      getProvider(providerId)
      const key = store.loadKey(providerId, keyId)
      if (!key) {
        throw new TanzoNotFoundError('PROVIDER_KEY_NOT_FOUND', `Provider key not found: ${keyId}`, {
          details: { providerId, keyId }
        })
      }
      const previous = store.loadConnection(providerId)
      const previousActiveKeyId = effectiveActiveKeyId(previous, store.listKeys(providerId))
      const connection = ensureConnection(providerId, keyId)
      store.saveConnection({
        ...(previousActiveKeyId !== keyId ? resetConnectionValidation(connection) : connection),
        activeKeyId: keyId,
        updatedAt: new Date().toISOString()
      })
      if (previousActiveKeyId !== keyId) runtime.invalidate(providerId)
      return buildWorkspace(providerId)
    },
    listOptionSchemas(providerId, family) {
      if (providerId) getProvider(providerId)
      return listOptionSchemas(providerId, family)
    },
    getReasoning(providerId, family = 'language') {
      getProvider(providerId)
      return getReasoningCapability(providerId, family)
    },
    async syncModels(providerId, family) {
      const descriptor = getProvider(providerId).families[family]
      if (!descriptor?.supported) {
        return {
          success: false,
          error: `Provider ${providerId} does not support ${family} models.`
        } satisfies ModelRefreshResult
      }
      if (descriptor.modelDiscoveryStrategy !== 'api') {
        return {
          success: false,
          error: `Model discovery is not available for ${providerId} ${family} models.`
        } satisfies ModelRefreshResult
      }
      try {
        const credentials = loadCredentials(providerId)
        const fetched = await enrichProviderModels(
          providerId,
          family,
          await getAdapter(providerId).fetchModels(credentials, family)
        )
        const remoteIds = new Set(fetched.map((model) => model.id))
        const existing = store.listModels(providerId, family)
        const previous = new Map(existing.map((model) => [model.modelId, model] as const))

        for (const model of existing) {
          if (!model.isCustom && !remoteIds.has(model.modelId)) {
            store.deleteModel(providerId, family, model.modelId)
          }
        }

        for (const remote of fetched) {
          const prior = previous.get(remote.id)
          const next = remoteToStored(providerId, family, remote)
          store.saveModel({
            ...next,
            enabled: prior?.enabled ?? true,
            isDefault: prior?.isDefault ?? false,
            ...(prior?.contextWindowOverride !== undefined
              ? { contextWindowOverride: prior.contextWindowOverride }
              : {})
          })
        }

        return { success: true, count: fetched.length }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies ModelRefreshResult
      }
    },
    async saveModelState(input) {
      requireSupportedFamily(input.providerId, input.family)
      if (input.delete) {
        store.deleteModel(input.providerId, input.family, input.modelId)
        return buildWorkspace(input.providerId)
      }
      const enrichedInput = await enrichModelStateInput(input)
      const existing = store
        .listModels(enrichedInput.providerId, enrichedInput.family)
        .find((model) => model.modelId === enrichedInput.modelId)
      const nextModel = incomingModelToStoredModel(enrichedInput, existing)
      store.saveModel(nextModel)
      return buildWorkspace(enrichedInput.providerId)
    },
    saveDefaults(input) {
      const now = new Date().toISOString()
      const updates = Object.entries(input.byFamily).flatMap(([familyValue, defaults]) => {
        if (!defaults) return []
        const family = familyValue as ModelFamily
        requireSupportedFamily(input.providerId, family)
        const normalized = normalizeDefaults(defaults)
        parseCallSettings(normalized.callDefaults)
        validateProviderOptions(input.providerId, family, normalized.providerOptions)
        return [
          {
            providerId: input.providerId,
            family,
            defaults: normalized,
            updatedAt: now
          }
        ]
      })
      store.saveDefaultsBatch(updates)
      return buildWorkspace(input.providerId)
    },
    resolveLanguageModel(modelRef) {
      const parsed = requireModelRef(modelRef)
      ensureUsableLanguageModel(parsed.providerId, parsed.modelId)
      return runtime.resolveLanguageModel(modelRef)
    },
    getModelMetadata(modelRef) {
      const parsed = parseModelRef(modelRef)
      if (!parsed) return undefined
      const stored = store
        .listModels(parsed.providerId, 'language')
        .find((row) => row.modelId === parsed.modelId)
      if (!stored) return undefined
      const metadata: ModelMetadata = {}
      const contextWindow = stored.contextWindowOverride ?? stored.model.contextWindow
      if (contextWindow !== undefined) metadata.contextWindow = contextWindow
      if (stored.model.maxOutput !== undefined) metadata.maxOutput = stored.model.maxOutput
      if (stored.model.capabilities?.vision !== undefined) {
        metadata.vision = stored.model.capabilities.vision
      }
      return metadata
    },
    getProviderOptions(providerId, family) {
      return mergeProviderOptions(
        normalizeStoredDefaults(store.getDefaults(providerId, family)?.defaults),
        providerId,
        family
      )
    },
    getCallSettings(providerId, family) {
      return coerceCallSettings(
        normalizeStoredDefaults(store.getDefaults(providerId, family)?.defaults).callDefaults
      )
    }
  }
}
