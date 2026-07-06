import type { OpenAILanguageModelChatOptions } from '@ai-sdk/openai'
import type { ProviderOptionField, ProviderOptionSchema } from '@shared/provider'

const _typecheckOpenAIChatLanguageOptions: Partial<OpenAILanguageModelChatOptions> = {}
void _typecheckOpenAIChatLanguageOptions

const openaiChatLanguageFields: ProviderOptionField[] = [
  {
    path: 'reasoningEffort',
    label: 'Reasoning effort',
    control: 'select',
    role: 'reasoningEffort',
    default: 'high',
    choices: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((value) => ({
      value,
      label: value
    }))
  },
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
    description: 'Allow OpenAI to store completions for later retrieval.'
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
    path: 'maxCompletionTokens',
    label: 'Max completion tokens',
    control: 'number',
    min: 1,
    step: 1
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
  },
  {
    path: 'logitBias',
    label: 'Logit bias',
    control: 'json'
  },
  {
    path: 'prediction',
    label: 'Prediction',
    control: 'json'
  }
]

export const openaiChatOptionSchemas: ProviderOptionSchema[] = [
  {
    providerId: 'openai-chat',
    family: 'language',
    providerKey: 'openai',
    label: 'OpenAI Chat Completions options',
    fields: openaiChatLanguageFields
  }
]
