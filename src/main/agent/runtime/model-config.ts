import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LanguageModel } from 'ai'
import { requireModelRef } from '@shared/provider'
import type { CallSettings } from '../../provider/call-settings'
import { mergeProviderOptionsInto, reasoningEffortOverlay } from '../../provider/options'
import type { ProviderService } from '../../provider/service'

export type { CallSettings } from '../../provider/call-settings'

const DEFAULT_MAX_RETRIES = 5

export interface LanguageModelConfig {
  model: LanguageModel
  callSettings: CallSettings
  providerOptions: ProviderOptions
}

export interface ModelConfigOverrides {
  reasoningEffort?: string
}

export function resolveLanguageModelConfig(
  providerService: ProviderService,
  modelRef: string,
  overrides?: ModelConfigOverrides
): LanguageModelConfig {
  const { providerId } = requireModelRef(modelRef)
  const callSettings = providerService.getCallSettings(providerId, 'language')
  let providerOptions = providerService.getProviderOptions(providerId, 'language')
  const effort = overrides?.reasoningEffort?.trim()
  if (effort && effort !== 'default') {
    const overlay = reasoningEffortOverlay(providerId, effort)
    if (overlay) providerOptions = mergeProviderOptionsInto(providerOptions, overlay)
  }
  return {
    model: providerService.resolveLanguageModel(modelRef),
    callSettings: { maxRetries: DEFAULT_MAX_RETRIES, ...callSettings },
    providerOptions
  }
}

export function hasProviderOptions(options: ProviderOptions): boolean {
  return Object.keys(options).length > 0
}
