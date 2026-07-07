import type { ProviderOptionSchema } from '@shared/provider'

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
      }
    ]
  }
]
