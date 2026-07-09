import { z } from 'zod'
import type { ModelCapabilityFlags, ProviderId, ProviderModel } from '@shared/provider'
import { createLogger } from '../logger'

const log = createLogger('provider.model-metadata')

const MODELS_DEV_URL = 'https://models.dev/api.json'
const FETCH_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60 * 60 * 1000

const modelsDevModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  limit: z
    .object({
      context: z.number().optional(),
      output: z.number().optional()
    })
    .optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  attachment: z.boolean().optional(),
  modalities: z
    .object({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional()
    })
    .optional()
})

const modelsDevDataSchema = z.record(
  z.string(),
  z.object({
    id: z.string(),
    name: z.string().optional(),
    models: z.record(z.string(), modelsDevModelSchema)
  })
)

type ModelsDevModel = z.infer<typeof modelsDevModelSchema>
type ModelsDevData = z.infer<typeof modelsDevDataSchema>

const PROVIDER_KEY_MAP: Partial<Record<ProviderId, string>> = {
  openai: 'openai',
  'openai-chat': 'openai',
  anthropic: 'anthropic',
  google: 'google',
  deepseek: 'deepseek',
  zhipu: 'zhipuai',
  minimax: 'minimax',
  grok: 'xai'
}

let cachedData: ModelsDevData | null = null
let cachedAt = 0

async function fetchModelsDevData(): Promise<ModelsDevData> {
  const now = Date.now()
  if (cachedData && now - cachedAt < CACHE_TTL_MS) return cachedData

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(MODELS_DEV_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Tanzo/1.0' }
    })
    if (!response.ok) {
      throw new Error(`models.dev returned HTTP ${response.status}`)
    }
    const data = modelsDevDataSchema.parse(await response.json())
    cachedData = data
    cachedAt = now
    return data
  } finally {
    clearTimeout(timer)
  }
}

function extractCapabilities(model: ModelsDevModel): ModelCapabilityFlags {
  const capabilities: ModelCapabilityFlags = {}
  const inputModalities = model.modalities?.input ?? []
  const outputModalities = model.modalities?.output ?? []

  if (model.reasoning) capabilities.reasoning = true
  if (model.tool_call) capabilities.toolCall = true
  if (model.attachment || inputModalities.includes('image')) capabilities.vision = true
  if (outputModalities.includes('json')) capabilities.json = true
  if (inputModalities.includes('audio')) capabilities.audioInput = true
  if (outputModalities.includes('audio')) capabilities.audioOutput = true

  return capabilities
}

function isEmptyCapabilities(value: ModelCapabilityFlags | undefined): boolean {
  return !value || Object.keys(value).length === 0
}

function withMetadata(model: ProviderModel, metadata: ModelsDevModel): ProviderModel {
  return {
    ...model,
    contextWindow: model.contextWindow ?? metadata.limit?.context,
    maxOutput: model.maxOutput ?? metadata.limit?.output,
    ...(isEmptyCapabilities(model.capabilities)
      ? { capabilities: extractCapabilities(metadata) }
      : {})
  }
}

export async function enrichLanguageModelsWithMetadata(
  providerId: ProviderId,
  models: ProviderModel[]
): Promise<ProviderModel[]> {
  const providerKey = PROVIDER_KEY_MAP[providerId]
  if (!providerKey) return models

  try {
    const data = await fetchModelsDevData()
    const providerModels = data[providerKey]?.models
    if (!providerModels) return models

    return models.map((model) => {
      const metadata = providerModels[model.id]
      return metadata ? withMetadata(model, metadata) : model
    })
  } catch (error) {
    log.warn('Failed to enrich provider models from models.dev', {
      providerId,
      message: error instanceof Error ? error.message : String(error)
    })
    return models
  }
}
