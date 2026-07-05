import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LanguageModel } from 'ai'
import { requireModelRef } from '@shared/provider'
import type { CallSettings } from '../../provider/call-settings'
import { mergeProviderOptionsInto, reasoningEffortOverlay } from '../../provider/options'
import type { ProviderService } from '../../provider/service'

export type { CallSettings } from '../../provider/call-settings'

/** Agent-runtime policy, not user configuration: retry transient failures. */
const DEFAULT_MAX_RETRIES = 5

export interface LanguageModelConfig {
  model: LanguageModel
  callSettings: CallSettings
  providerOptions: ProviderOptions
}

export interface ModelConfigOverrides {
  /** Per-conversation reasoning effort; '' or 'default' follows provider defaults. */
  reasoningEffort?: string
}

/**
 * Resolve everything an agent run needs for one language model ref: the
 * model instance plus the user-configured call settings and provider options
 * for its provider. Merge chain: provider defaults → conversation overrides.
 * Validation lives at the provider boundary — settings arrive here already
 * typed.
 */
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
