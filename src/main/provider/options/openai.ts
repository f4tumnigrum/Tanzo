import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai'
import type { ProviderOptionField, ProviderOptionSchema } from '@shared/provider'

const _typecheckOpenAILanguageOptions: Partial<OpenAILanguageModelResponsesOptions> = {}
void _typecheckOpenAILanguageOptions

const openaiLanguageFields: ProviderOptionField[] = [
  {
    path: 'textVerbosity',
    label: 'Text verbosity',
    control: 'select',
    choices: ['low', 'medium', 'high'].map((value) => ({ value, label: value }))
  },
  {
    path: 'serviceTier',
    label: 'Service tier',
    control: 'select',
    choices: ['default', 'auto', 'flex', 'priority'].map((value) => ({ value, label: value }))
  },
  {
    path: 'store',
    label: 'Store responses',
    control: 'boolean',
    description: 'Allow OpenAI to store Responses API outputs for later retrieval.'
  },
  {
    path: 'parallelToolCalls',
    label: 'Parallel tool calls',
    control: 'boolean'
  },
  {
    path: 'strictJsonSchema',
    label: 'Strict JSON schema',
    control: 'boolean'
  },
  {
    path: 'user',
    label: 'User',
    control: 'string'
  },
  {
    path: 'reasoningSummary',
    label: 'Reasoning summary',
    control: 'select',
    choices: ['auto', 'concise', 'detailed'].map((value) => ({ value, label: value }))
  },
  {
    path: 'safetyIdentifier',
    label: 'Safety identifier',
    control: 'string'
  },
  {
    path: 'logprobs',
    label: 'Log probabilities',
    control: 'number',
    min: 0,
    step: 1
  },
  {
    path: 'metadata',
    label: 'Metadata',
    control: 'json'
  }
]

export const openaiOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'openai',
    family: 'language',
    providerKey: 'openai',
    label: 'OpenAI language options',
    fields: openaiLanguageFields
  }
]
