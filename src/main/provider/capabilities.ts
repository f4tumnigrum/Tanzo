import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { OpenAICompatibleProviderOptions } from '@ai-sdk/openai-compatible'
import type { OpenAIChatLanguageModelOptions, OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { XaiResponsesProviderOptions } from '@ai-sdk/xai'
import type {
  ModelFamily,
  ProviderId,
  ProviderReasoningCapability,
  ReasoningEffortCapability
} from '@shared/provider'

type NonNullish<T> = Exclude<T, null | undefined>

type EffortPaths<TOptions> = {
  [K in keyof TOptions & string]:
    | (NonNullish<TOptions[K]> extends string ? K : never)
    | {
        [L in keyof NonNullish<TOptions[K]> & string]: NonNullish<
          NonNullish<TOptions[K]>[L]
        > extends string
          ? `${K}.${L}`
          : never
      }[keyof NonNullish<TOptions[K]> & string]
}[keyof TOptions & string]

type EffortValueAt<TOptions, TPath extends string> = TPath extends `${infer K}.${infer L}`
  ? K extends keyof TOptions
    ? L extends keyof NonNullish<TOptions[K]>
      ? NonNullish<NonNullish<TOptions[K]>[L]>
      : never
    : never
  : TPath extends keyof TOptions
    ? NonNullish<TOptions[TPath]>
    : never

function defineEffort<TOptions>() {
  return <TPath extends EffortPaths<TOptions>>(spec: {
    providerKey: string
    path: TPath
    values: EffortValueAt<TOptions, TPath>[]
    default: EffortValueAt<TOptions, TPath>
  }): ReasoningEffortCapability => ({
    providerKey: spec.providerKey,
    path: spec.path,
    values: spec.values.map((value) => String(value)),
    default: String(spec.default)
  })
}

const openaiEffort = defineEffort<OpenAIResponsesProviderOptions>()({
  providerKey: 'openai',
  path: 'reasoningEffort',
  values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  default: 'high'
})

const openaiChatEffort = defineEffort<OpenAIChatLanguageModelOptions>()({
  providerKey: 'openai',
  path: 'reasoningEffort',
  values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  default: 'high'
})

const anthropicEffort = defineEffort<AnthropicProviderOptions>()({
  providerKey: 'anthropic',
  path: 'effort',
  values: ['low', 'medium', 'high', 'xhigh'],
  default: 'high'
})

const googleEffort = defineEffort<GoogleLanguageModelOptions>()({
  providerKey: 'google',
  path: 'thinkingConfig.thinkingLevel',
  values: ['minimal', 'low', 'medium', 'high'],
  default: 'high'
})

const deepseekEffort = defineEffort<DeepSeekLanguageModelOptions>()({
  providerKey: 'deepseek',
  path: 'reasoningEffort',
  values: ['low', 'medium', 'high', 'xhigh'],
  default: 'high'
})

const minimaxEffort = defineEffort<OpenAICompatibleProviderOptions>()({
  providerKey: 'minimax',
  path: 'reasoningEffort',
  values: ['minimal', 'low', 'medium', 'high'],
  default: 'high'
})

const grokEffort = defineEffort<XaiResponsesProviderOptions>()({
  providerKey: 'xai',
  path: 'reasoningEffort',
  values: ['none', 'low', 'medium', 'high'],
  default: 'high'
})

const openaiCompatibleEffort = defineEffort<OpenAICompatibleProviderOptions>()({
  providerKey: 'openaiCompatible',
  path: 'reasoningEffort',
  values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  default: 'high'
})

const EFFORTS: Record<ProviderId, ReasoningEffortCapability | null> = {
  openai: openaiEffort,
  'openai-chat': openaiChatEffort,
  anthropic: anthropicEffort,
  google: googleEffort,
  deepseek: deepseekEffort,
  zhipu: null,
  minimax: minimaxEffort,
  grok: grokEffort,
  'openai-compatible': openaiCompatibleEffort
}

export function getReasoningCapability(
  providerId: ProviderId,
  family: ModelFamily = 'language'
): ProviderReasoningCapability {
  const effort = family === 'language' ? (EFFORTS[providerId] ?? null) : null
  return { providerId, family, effort }
}
