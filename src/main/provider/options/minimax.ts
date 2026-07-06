import type { ProviderOptionSchema } from '@shared/provider'

/**
 * MiniMax runs through `@ai-sdk/openai-compatible`, whose provider namespace is
 * the provider `name` ('minimax'). Fields are forwarded into the request body,
 * so `reasoningEffort` is exposed free-form for vendor-specific values.
 */
export const minimaxOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'minimax',
    family: 'language',
    providerKey: 'minimax',
    label: 'MiniMax language options',
    fields: [
      {
        path: 'reasoningEffort',
        label: 'Reasoning effort',
        control: 'string',
        role: 'reasoningEffort',
        default: 'high',
        choices: ['minimal', 'low', 'medium', 'high'].map((value) => ({ value, label: value }))
      }
    ]
  }
]
