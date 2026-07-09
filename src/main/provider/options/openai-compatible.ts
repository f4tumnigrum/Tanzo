import type { OpenAICompatibleProviderOptions } from '@ai-sdk/openai-compatible'
import type { ProviderOptionSchema } from '@shared/provider'

const _typecheckOpenAICompatibleLanguageOptions: Partial<OpenAICompatibleProviderOptions> = {}
void _typecheckOpenAICompatibleLanguageOptions

export const openaiCompatibleOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'openai-compatible',
    family: 'language',
    providerKey: 'openaiCompatible',
    label: 'OpenAI-compatible options',
    fields: [
      { path: 'user', label: 'User', control: 'string' },
      { path: 'textVerbosity', label: 'Text verbosity', control: 'string' }
    ]
  }
]
