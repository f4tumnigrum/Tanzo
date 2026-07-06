import type { ProviderOptionSchema } from '@shared/provider'

/**
 * Zhipu (GLM) runs through `@ai-sdk/openai-compatible`, whose provider
 * namespace is the provider `name` ('zhipu'). Unknown namespace keys are
 * forwarded verbatim into the request body, so `thinking` maps to Zhipu's
 * top-level `thinking` field for GLM-4.5+ reasoning control.
 */
export const zhipuOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'zhipu',
    family: 'language',
    providerKey: 'zhipu',
    label: 'Zhipu language options',
    fields: [
      {
        path: 'thinking.type',
        label: 'Thinking',
        control: 'select',
        choices: ['enabled', 'disabled'].map((value) => ({ value, label: value }))
      },
      {
        path: 'reasoningEffort',
        label: 'Reasoning effort',
        // Free-form: forwarded to the OpenAI-compatible surface as-is.
        control: 'string',
        role: 'reasoningEffort',
        default: 'high',
        choices: ['minimal', 'low', 'medium', 'high'].map((value) => ({ value, label: value }))
      }
    ]
  }
]
