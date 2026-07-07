import type { IpcMain } from 'electron'
import { z } from 'zod'
import { PROVIDER_CHANNELS, PROVIDER_IDS } from '@shared/provider'
import type {
  AddProviderKeyInput,
  ConnectionTestResult,
  ModelFamily,
  ProviderId,
  SaveProviderConnectionInput,
  SaveProviderDefaultsInput,
  SaveProviderModelStateInput,
  UpdateProviderKeyInput
} from '@shared/provider'
import { registerIpcHandlers, type IpcRegistration } from '../ipc/router'
import type { ProviderService } from './service'

const providerIdSchema = z.enum(PROVIDER_IDS)
const familySchema = z.enum(['language', 'embedding', 'image', 'transcription', 'speech'])
const nonEmptyStringSchema = z.string().trim().min(1)
const credentialsSchema = z.record(z.string(), z.string())
const connectionResultSchema = z.object({
  success: z.boolean(),
  message: nonEmptyStringSchema,
  modelCount: z.number().optional(),
  latency: z.number().optional()
})

const providerFamilyModelSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema.optional(),
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
  maxImagesPerCall: z.number().optional(),
  supportedSizes: z.array(nonEmptyStringSchema).optional(),
  supportedAspectRatios: z.array(nonEmptyStringSchema).optional(),
  supportsTimestamps: z.boolean().optional(),
  supportedTimestampGranularities: z.array(z.enum(['word', 'segment'])).optional(),
  defaultVoice: nonEmptyStringSchema.optional(),
  supportedVoices: z.array(nonEmptyStringSchema).optional(),
  supportedFormats: z.array(nonEmptyStringSchema).optional()
})

const saveConnectionSchema = z.object({
  providerId: providerIdSchema,
  credentials: credentialsSchema
})

const addKeySchema = z.object({
  providerId: providerIdSchema,
  label: nonEmptyStringSchema.optional(),
  apiKey: nonEmptyStringSchema,
  makeActive: z.boolean().optional()
})

const updateKeySchema = z.object({
  providerId: providerIdSchema,
  keyId: nonEmptyStringSchema,
  label: nonEmptyStringSchema.optional(),
  apiKey: nonEmptyStringSchema.optional()
})

const defaultsStateSchema = z.object({
  callDefaults: z.record(z.string(), z.unknown()).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  rawProviderOptions: z.record(z.string(), z.unknown()).optional()
})

const saveModelStateSchema = z.object({
  providerId: providerIdSchema,
  family: familySchema,
  modelId: nonEmptyStringSchema,
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isCustom: z.boolean().optional(),
  contextWindowOverride: z.number().nullable().optional(),
  model: providerFamilyModelSchema.optional(),
  delete: z.boolean().optional()
})

const saveDefaultsSchema = z.object({
  providerId: providerIdSchema,
  byFamily: z.partialRecord(familySchema, defaultsStateSchema)
})

export function registerProviderIpc(ipcMain: IpcMain, service: ProviderService): () => void {
  const channels = [
    [PROVIDER_CHANNELS.listCatalog, () => service.listCatalog()],
    [PROVIDER_CHANNELS.listSetups, () => service.listSetups()],
    [
      PROVIDER_CHANNELS.getWorkspace,
      (providerId: unknown) =>
        service.getWorkspace(providerIdSchema.parse(providerId) as ProviderId)
    ],
    [
      PROVIDER_CHANNELS.saveConnection,
      (input: unknown) =>
        service.saveConnection(saveConnectionSchema.parse(input) as SaveProviderConnectionInput)
    ],
    [
      PROVIDER_CHANNELS.testConnection,
      (providerId: unknown) =>
        service.testConnection(providerIdSchema.parse(providerId) as ProviderId)
    ],
    [
      PROVIDER_CHANNELS.recordValidation,
      (providerId: unknown, result: unknown) =>
        service.recordValidation(
          providerIdSchema.parse(providerId) as ProviderId,
          connectionResultSchema.parse(result) as ConnectionTestResult
        )
    ],
    [
      PROVIDER_CHANNELS.disconnect,
      (providerId: unknown) => service.disconnect(providerIdSchema.parse(providerId) as ProviderId)
    ],
    [
      PROVIDER_CHANNELS.reset,
      (providerId: unknown) => service.reset(providerIdSchema.parse(providerId) as ProviderId)
    ],
    [
      PROVIDER_CHANNELS.listKeys,
      (providerId: unknown) => service.listKeys(providerIdSchema.parse(providerId) as ProviderId)
    ],
    [
      PROVIDER_CHANNELS.addKey,
      (input: unknown) => service.addKey(addKeySchema.parse(input) as AddProviderKeyInput)
    ],
    [
      PROVIDER_CHANNELS.updateKey,
      (input: unknown) => service.updateKey(updateKeySchema.parse(input) as UpdateProviderKeyInput)
    ],
    [
      PROVIDER_CHANNELS.deleteKey,
      (providerId: unknown, keyId: unknown) =>
        service.deleteKey(
          providerIdSchema.parse(providerId) as ProviderId,
          nonEmptyStringSchema.parse(keyId)
        )
    ],
    [
      PROVIDER_CHANNELS.setActiveKey,
      (providerId: unknown, keyId: unknown) =>
        service.setActiveKey(
          providerIdSchema.parse(providerId) as ProviderId,
          nonEmptyStringSchema.parse(keyId)
        )
    ],
    [
      PROVIDER_CHANNELS.listOptionSchemas,
      (providerId?: unknown, family?: unknown) =>
        service.listOptionSchemas(
          providerId === undefined ? undefined : (providerIdSchema.parse(providerId) as ProviderId),
          family === undefined ? undefined : (familySchema.parse(family) as ModelFamily)
        )
    ],
    [
      PROVIDER_CHANNELS.getReasoning,
      (providerId: unknown, family?: unknown) =>
        service.getReasoning(
          providerIdSchema.parse(providerId) as ProviderId,
          family === undefined ? undefined : (familySchema.parse(family) as ModelFamily)
        )
    ],
    [
      PROVIDER_CHANNELS.syncModels,
      (providerId: unknown, family: unknown) =>
        service.syncModels(
          providerIdSchema.parse(providerId) as ProviderId,
          familySchema.parse(family) as ModelFamily
        )
    ],
    [
      PROVIDER_CHANNELS.saveModelState,
      (input: unknown) =>
        service.saveModelState(saveModelStateSchema.parse(input) as SaveProviderModelStateInput)
    ],
    [
      PROVIDER_CHANNELS.saveDefaults,
      (input: unknown) =>
        service.saveDefaults(saveDefaultsSchema.parse(input) as SaveProviderDefaultsInput)
    ]
  ] as const

  return registerIpcHandlers(ipcMain, channels as readonly IpcRegistration[])
}
