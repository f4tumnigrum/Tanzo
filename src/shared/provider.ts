import { TanzoValidationError } from './errors'

export const PROVIDER_CHANNELS = {
  listCatalog: 'provider:list-catalog',
  listSetups: 'provider:list-setups',
  getWorkspace: 'provider:get-workspace',
  saveConnection: 'provider:save-connection',
  testConnection: 'provider:test-connection',
  disconnect: 'provider:disconnect',
  reset: 'provider:reset',
  listKeys: 'provider:list-keys',
  addKey: 'provider:add-key',
  updateKey: 'provider:update-key',
  deleteKey: 'provider:delete-key',
  setActiveKey: 'provider:set-active-key',
  listOptionSchemas: 'provider:list-option-schemas',
  getReasoning: 'provider:get-reasoning',
  syncModels: 'provider:sync-models',
  saveModelState: 'provider:save-model-state',
  saveDefaults: 'provider:save-defaults'
} as const

export const PROVIDER_IDS = [
  'openai',
  'openai-chat',
  'anthropic',
  'google',
  'deepseek',
  'zhipu',
  'minimax',
  'grok',
  'openai-compatible'
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]
export type ModelFamily = 'language' | 'embedding' | 'image' | 'transcription' | 'speech'

export interface ParsedModelRef {
  providerId: ProviderId
  modelId: string
}

export function parseModelRef(modelRef: string): ParsedModelRef | undefined {
  const separator = modelRef.indexOf(':')
  if (separator === -1) return undefined
  const providerId = modelRef.slice(0, separator) as ProviderId
  const modelId = modelRef.slice(separator + 1)
  if (!PROVIDER_IDS.includes(providerId) || !modelId) return undefined
  return { providerId, modelId }
}

export function requireModelRef(modelRef: string): ParsedModelRef {
  const parsed = parseModelRef(modelRef)
  if (!parsed) {
    throw new TanzoValidationError('PROVIDER_MODEL_REF_INVALID', `Invalid model ref: ${modelRef}`, {
      details: { modelRef }
    })
  }
  return parsed
}
export type ProviderModelSource = 'api' | 'curated' | 'custom'
export type ProviderKeyStatus = 'untested' | 'valid' | 'invalid'

export interface CredentialField {
  key: string
  label: string
  placeholder?: string
  type: 'text' | 'password' | 'url' | 'select'
  required: boolean
  secret: boolean
  helperText?: string
  options?: { value: string; label: string }[]
}

export interface ProviderFamilyDescriptor {
  family: ModelFamily
  label: string
  description: string
  supported: boolean
  modelDiscoveryStrategy: 'api' | 'curated' | 'none'
}

export interface ProviderConfig {
  id: ProviderId
  name: string
  description: string
  docsUrl: string
  credentialFields: CredentialField[]
  families: Partial<Record<ModelFamily, ProviderFamilyDescriptor>>
}

export interface ModelCapabilityFlags {
  reasoning?: boolean
  toolCall?: boolean
  vision?: boolean
  json?: boolean
  audioInput?: boolean
  audioOutput?: boolean
  imageGeneration?: boolean
  transcription?: boolean
}

export interface ProviderModel {
  id: string
  name: string
  description?: string
  contextWindow?: number
  maxOutput?: number
  capabilities?: ModelCapabilityFlags
}

export interface EmbeddingModel {
  id: string
  name: string
  description?: string
  dimensions?: number
  maxContextLength?: number
  maxBatchSize?: number
}

export interface ImageGenerationModel {
  id: string
  name: string
  description?: string
  maxImagesPerCall?: number
  supportedSizes?: string[]
  supportedAspectRatios?: string[]
}

export interface TranscriptionModel {
  id: string
  name: string
  description?: string
  supportsTimestamps?: boolean
  supportedTimestampGranularities?: ('word' | 'segment')[]
}

export interface SpeechModel {
  id: string
  name: string
  description?: string
  defaultVoice?: string
  supportedVoices?: string[]
  supportedFormats?: string[]
}

export type ProviderFamilyModel =
  ProviderModel | EmbeddingModel | ImageGenerationModel | TranscriptionModel | SpeechModel

export interface StoredProviderModel {
  providerId: ProviderId
  family: ModelFamily
  id: string
  name: string
  description?: string
  enabled: boolean
  isDefault: boolean
  isCustom: boolean
  source: ProviderModelSource
  contextWindow?: number
  contextWindowOverride?: number
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

export interface ProviderConnectionInfo {
  providerId: ProviderId
  status: 'connected' | 'disconnected' | 'expired'
  encryptionAvailable: boolean
  formValues: Record<string, string>
  activeKeyId?: string
  keyCount: number
  connectedAt?: string
  updatedAt?: string
  lastValidatedAt?: string
  lastValidationSucceeded?: boolean
  lastValidationMessage?: string
  lastValidationLatency?: number
}

export interface ProviderKeySummary {
  providerId: ProviderId
  keyId: string
  label: string
  maskedKey: string
  active: boolean
  status: ProviderKeyStatus
  encryptionAvailable: boolean
  createdAt?: string
  updatedAt?: string
  lastUsedAt?: string
  lastValidatedAt?: string
  lastValidationSucceeded?: boolean
  lastValidationMessage?: string
  lastValidationLatency?: number
}

export type ProviderOptionControl =
  'boolean' | 'number' | 'string' | 'select' | 'string-list' | 'json'

export interface ProviderOptionChoice {
  value: string | number | boolean
  label: string
}

export interface ProviderOptionField {
  path: string
  label: string
  control: ProviderOptionControl

  description?: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  choices?: ProviderOptionChoice[]
}

export interface ProviderOptionSchema {
  providerId: ProviderId
  family: ModelFamily
  providerKey: string
  label: string
  description?: string
  fields: ProviderOptionField[]
}

export interface ProviderDefaultsState {
  callDefaults: Record<string, unknown>
  providerOptions: Record<string, unknown>
  rawProviderOptions: Record<string, unknown>
}

export type ProviderDefaultsInput = Partial<ProviderDefaultsState>

export interface ProviderFamilyState {
  family: ModelFamily
  descriptor: ProviderFamilyDescriptor
  models: StoredProviderModel[]
  enabledModelIds: string[]
  defaultModelId: string | null
  modelCount: number
  enabledModelCount: number
  defaults: ProviderDefaultsState
}

export interface ProviderSetupState {
  providerId: ProviderId
  connection: ProviderConnectionInfo
  configurationStatus: 'not_connected' | 'connected_no_models' | 'models_not_enabled' | 'ready'
  supportedFamilies: ModelFamily[]
  modalities: Partial<Record<ModelFamily, ProviderFamilyState>>
}

export interface ProviderWorkspace {
  provider: ProviderConfig
  setup: ProviderSetupState
  connection: ProviderConnectionInfo
  modalities: Partial<Record<ModelFamily, ProviderFamilyState>>
}

export interface ConnectionTestResult {
  success: boolean
  message: string
  modelCount?: number
  latency?: number
}

export interface ModelRefreshResult {
  success: boolean
  count?: number
  message?: string
  error?: string
}

export interface SaveProviderConnectionInput {
  providerId: ProviderId
  credentials: Record<string, string>
}

export interface AddProviderKeyInput {
  providerId: ProviderId
  label?: string
  apiKey: string
  makeActive?: boolean
}

export interface UpdateProviderKeyInput {
  providerId: ProviderId
  keyId: string
  label?: string
  apiKey?: string
}

export interface SaveProviderModelStateInput {
  providerId: ProviderId
  family: ModelFamily
  modelId: string
  enabled?: boolean
  isDefault?: boolean
  isCustom?: boolean
  contextWindowOverride?: number | null
  model?: ProviderFamilyModel
  delete?: boolean
}

export interface SaveProviderDefaultsInput {
  providerId: ProviderId
  byFamily: Partial<Record<ModelFamily, ProviderDefaultsInput>>
}

export interface ProviderApi {
  listCatalog(): Promise<ProviderConfig[]>
  listSetups(): Promise<ProviderSetupState[]>
  getWorkspace(providerId: ProviderId): Promise<ProviderWorkspace>
  saveConnection(input: SaveProviderConnectionInput): Promise<ProviderWorkspace>
  testConnection(providerId: ProviderId): Promise<ConnectionTestResult>
  disconnect(providerId: ProviderId): Promise<void>
  reset(providerId: ProviderId): Promise<void>
  listKeys(providerId: ProviderId): Promise<ProviderKeySummary[]>
  addKey(input: AddProviderKeyInput): Promise<ProviderKeySummary[]>
  updateKey(input: UpdateProviderKeyInput): Promise<ProviderKeySummary[]>
  deleteKey(providerId: ProviderId, keyId: string): Promise<ProviderKeySummary[]>
  setActiveKey(providerId: ProviderId, keyId: string): Promise<ProviderWorkspace>
  listOptionSchemas(providerId?: ProviderId, family?: ModelFamily): Promise<ProviderOptionSchema[]>
  getReasoning(providerId: ProviderId, family?: ModelFamily): Promise<ProviderReasoningCapability>
  syncModels(providerId: ProviderId, family: ModelFamily): Promise<ModelRefreshResult>
  saveModelState(input: SaveProviderModelStateInput): Promise<ProviderWorkspace>
  saveDefaults(input: SaveProviderDefaultsInput): Promise<ProviderWorkspace>
}

export interface ReasoningEffortCapability {
  providerKey: string
  path: string
  values: string[]
  default: string
}

export interface ProviderReasoningCapability {
  providerId: ProviderId
  family: ModelFamily
  effort: ReasoningEffortCapability | null
}
