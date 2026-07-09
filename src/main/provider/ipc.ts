import type { IpcMain } from 'electron'
import { z } from 'zod'
import { PROVIDER_CHANNELS, PROVIDER_IDS } from '@shared/provider'
import type {
  AddProviderKeyInput,
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
const positiveIntegerSchema = z.number().int().positive()
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)
const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

const providerFamilyModelSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema.optional(),
  contextWindow: positiveIntegerSchema.optional(),
  maxOutput: positiveIntegerSchema.optional(),
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
  dimensions: positiveIntegerSchema.optional(),
  maxContextLength: positiveIntegerSchema.optional(),
  maxBatchSize: positiveIntegerSchema.optional(),
  maxImagesPerCall: positiveIntegerSchema.optional(),
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
  callDefaults: jsonObjectSchema.optional(),
  providerOptions: jsonObjectSchema.optional(),
  rawProviderOptions: jsonObjectSchema.optional()
})

const saveModelStateSchema = z.object({
  providerId: providerIdSchema,
  family: familySchema,
  modelId: nonEmptyStringSchema,
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isCustom: z.boolean().optional(),
  contextWindowOverride: positiveIntegerSchema.nullable().optional(),
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
