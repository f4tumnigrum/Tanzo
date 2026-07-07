import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { ProviderOptionSchema } from '@shared/provider'

const _typecheckGoogleLanguageOptions: Partial<GoogleLanguageModelOptions> = {}
void _typecheckGoogleLanguageOptions

export const googleOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'google',
    family: 'language',
    providerKey: 'google',
    label: 'Google language options',
    fields: [
      {
        path: 'thinkingConfig.thinkingBudget',
        label: 'Thinking budget',
        control: 'number',
        step: 1
      },
      { path: 'thinkingConfig.includeThoughts', label: 'Include thoughts', control: 'boolean' },
      { path: 'structuredOutputs', label: 'Structured outputs', control: 'boolean' },
      {
        path: 'responseModalities',
        label: 'Response modalities',
        control: 'string-list',
        choices: ['TEXT', 'IMAGE'].map((value) => ({ value, label: value }))
      },
      {
        path: 'serviceTier',
        label: 'Service tier',
        control: 'select',
        choices: ['standard', 'flex', 'priority'].map((value) => ({ value, label: value }))
      },
      {
        path: 'mediaResolution',
        label: 'Media resolution',
        control: 'select',
        choices: [
          'MEDIA_RESOLUTION_UNSPECIFIED',
          'MEDIA_RESOLUTION_LOW',
          'MEDIA_RESOLUTION_MEDIUM',
          'MEDIA_RESOLUTION_HIGH'
        ].map((value) => ({ value, label: value }))
      },
      { path: 'audioTimestamp', label: 'Audio timestamp', control: 'boolean' },
      { path: 'safetySettings', label: 'Safety settings', control: 'json' },
      { path: 'labels', label: 'Labels', control: 'json' }
    ]
  }
]
