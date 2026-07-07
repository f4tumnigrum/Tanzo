import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { ProviderOptionSchema } from '@shared/provider'

const _typecheckDeepSeekLanguageOptions: Partial<DeepSeekLanguageModelOptions> = {}
void _typecheckDeepSeekLanguageOptions

export const deepseekOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'deepseek',
    family: 'language',
    providerKey: 'deepseek',
    label: 'DeepSeek language options',
    fields: [
      {
        path: 'thinking.type',
        label: 'Thinking',
        control: 'select',
        choices: ['adaptive', 'enabled', 'disabled'].map((value) => ({ value, label: value }))
      }
    ]
  }
]
