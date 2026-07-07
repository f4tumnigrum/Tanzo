import type {
  AddProviderKeyInput,
  ConnectionTestResult,
  ModelFamily,
  ModelRefreshResult,
  ProviderConfig,
  ProviderId,
  ProviderKeySummary,
  ProviderOptionSchema,
  ProviderReasoningCapability,
  ProviderSetupState,
  ProviderWorkspace,
  SaveProviderConnectionInput,
  SaveProviderDefaultsInput,
  SaveProviderModelStateInput,
  UpdateProviderKeyInput
} from '@/common/contracts'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requireProviderApi() {
  const providerApi = window.electron?.provider
  if (!providerApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_PROVIDER_API_UNAVAILABLE',
      'Electron provider API is not available'
    )
  }
  return withDecodedIpcErrors(providerApi)
}

export const providersClient = {
  listCatalog(): Promise<ProviderConfig[]> {
    return requireProviderApi()
      .listCatalog()
      .then((catalog) => [...catalog])
  },
  listSetups(): Promise<ProviderSetupState[]> {
    return requireProviderApi()
      .listSetups()
      .then((setups) => [...setups])
  },
  getWorkspace(providerId: ProviderId): Promise<ProviderWorkspace> {
    return requireProviderApi().getWorkspace(providerId)
  },
  saveConnection(input: SaveProviderConnectionInput): Promise<ProviderWorkspace> {
    return requireProviderApi().saveConnection(input)
  },
  testConnection(providerId: ProviderId): Promise<ConnectionTestResult> {
    return requireProviderApi().testConnection(providerId)
  },
  recordValidation(
    providerId: ProviderId,
    result: ConnectionTestResult
  ): Promise<ProviderWorkspace> {
    return requireProviderApi().recordValidation(providerId, result)
  },
  async disconnect(providerId: ProviderId): Promise<void> {
    await requireProviderApi().disconnect(providerId)
  },
  async reset(providerId: ProviderId): Promise<void> {
    await requireProviderApi().reset(providerId)
  },
  listKeys(providerId: ProviderId): Promise<ProviderKeySummary[]> {
    return requireProviderApi()
      .listKeys(providerId)
      .then((keys) => [...keys])
  },
  addKey(input: AddProviderKeyInput): Promise<ProviderKeySummary[]> {
    return requireProviderApi().addKey(input)
  },
  updateKey(input: UpdateProviderKeyInput): Promise<ProviderKeySummary[]> {
    return requireProviderApi().updateKey(input)
  },
  deleteKey(providerId: ProviderId, keyId: string): Promise<ProviderKeySummary[]> {
    return requireProviderApi().deleteKey(providerId, keyId)
  },
  setActiveKey(providerId: ProviderId, keyId: string): Promise<ProviderWorkspace> {
    return requireProviderApi().setActiveKey(providerId, keyId)
  },
  listOptionSchemas(
    providerId?: ProviderId,
    family?: ModelFamily
  ): Promise<ProviderOptionSchema[]> {
    return requireProviderApi()
      .listOptionSchemas(providerId, family)
      .then((schemas) => [...schemas])
  },
  getReasoning(providerId: ProviderId, family?: ModelFamily): Promise<ProviderReasoningCapability> {
    return requireProviderApi().getReasoning(providerId, family)
  },
  syncModels(providerId: ProviderId, family: ModelFamily): Promise<ModelRefreshResult> {
    return requireProviderApi().syncModels(providerId, family)
  },
  saveModelState(input: SaveProviderModelStateInput): Promise<ProviderWorkspace> {
    return requireProviderApi().saveModelState(input)
  },
  saveDefaults(input: SaveProviderDefaultsInput): Promise<ProviderWorkspace> {
    return requireProviderApi().saveDefaults(input)
  }
}
