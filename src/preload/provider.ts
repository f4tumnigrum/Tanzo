import { PROVIDER_CHANNELS, type ProviderApi } from '@shared/provider'
import { invoke } from './invoke'

export const providerApi: ProviderApi = {
  listCatalog: invoke<ProviderApi['listCatalog']>(PROVIDER_CHANNELS.listCatalog),
  listSetups: invoke<ProviderApi['listSetups']>(PROVIDER_CHANNELS.listSetups),
  getWorkspace: invoke<ProviderApi['getWorkspace']>(PROVIDER_CHANNELS.getWorkspace),
  saveConnection: invoke<ProviderApi['saveConnection']>(PROVIDER_CHANNELS.saveConnection),
  testConnection: invoke<ProviderApi['testConnection']>(PROVIDER_CHANNELS.testConnection),
  recordValidation: invoke<ProviderApi['recordValidation']>(PROVIDER_CHANNELS.recordValidation),
  disconnect: invoke<ProviderApi['disconnect']>(PROVIDER_CHANNELS.disconnect),
  reset: invoke<ProviderApi['reset']>(PROVIDER_CHANNELS.reset),
  listKeys: invoke<ProviderApi['listKeys']>(PROVIDER_CHANNELS.listKeys),
  addKey: invoke<ProviderApi['addKey']>(PROVIDER_CHANNELS.addKey),
  updateKey: invoke<ProviderApi['updateKey']>(PROVIDER_CHANNELS.updateKey),
  deleteKey: invoke<ProviderApi['deleteKey']>(PROVIDER_CHANNELS.deleteKey),
  setActiveKey: invoke<ProviderApi['setActiveKey']>(PROVIDER_CHANNELS.setActiveKey),
  listOptionSchemas: invoke<ProviderApi['listOptionSchemas']>(PROVIDER_CHANNELS.listOptionSchemas),
  getReasoning: invoke<ProviderApi['getReasoning']>(PROVIDER_CHANNELS.getReasoning),
  syncModels: invoke<ProviderApi['syncModels']>(PROVIDER_CHANNELS.syncModels),
  saveModelState: invoke<ProviderApi['saveModelState']>(PROVIDER_CHANNELS.saveModelState),
  saveDefaults: invoke<ProviderApi['saveDefaults']>(PROVIDER_CHANNELS.saveDefaults)
}
