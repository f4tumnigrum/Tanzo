import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { ProviderOptionSchema } from '@shared/provider'

const _typecheckAnthropicLanguageOptions: Partial<AnthropicProviderOptions> = {}
void _typecheckAnthropicLanguageOptions

export const anthropicOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'anthropic',
    family: 'language',
    providerKey: 'anthropic',
    label: 'Anthropic language options',
    fields: [
      {
        path: 'structuredOutputMode',
        label: 'Structured output mode',
        control: 'select',
        choices: ['outputFormat', 'jsonTool', 'auto'].map((value) => ({ value, label: value }))
      },
      { path: 'metadata.userId', label: 'Metadata user ID', control: 'string' },
      {
        path: 'inferenceGeo',
        label: 'Inference geo',
        control: 'select',
        choices: ['us', 'global'].map((value) => ({ value, label: value }))
      },
      { path: 'disableParallelToolUse', label: 'Disable parallel tool use', control: 'boolean' },
      { path: 'anthropicBeta', label: 'Anthropic beta headers', control: 'string-list' }
    ]
  }
]
