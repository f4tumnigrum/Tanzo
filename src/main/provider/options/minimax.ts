import type { ProviderOptionSchema } from '@shared/provider'

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
