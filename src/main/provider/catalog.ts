import type { ModelFamily, ProviderConfig, ProviderId } from '@shared/provider'
import { TanzoNotFoundError } from '@shared/errors'

const languageFamily = {
  family: 'language',
  label: 'Language',
  description: 'Text and multimodal generation models.',
  supported: true,
  modelDiscoveryStrategy: 'api'
} as const

const embeddingFamily = {
  family: 'embedding',
  label: 'Embedding',
  description: 'Vector embedding models.',
  supported: true,
  modelDiscoveryStrategy: 'api'
} as const

const imageFamily = {
  family: 'image',
  label: 'Image',
  description: 'Image generation and editing models.',
  supported: true,
  modelDiscoveryStrategy: 'none'
} as const

const transcriptionFamily = {
  family: 'transcription',
  label: 'Transcription',
  description: 'Audio transcription models.',
  supported: true,
  modelDiscoveryStrategy: 'none'
} as const

const speechFamily = {
  family: 'speech',
  label: 'Speech',
  description: 'Text-to-speech models.',
  supported: true,
  modelDiscoveryStrategy: 'none'
} as const

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT and embedding models.',
    docsUrl: 'https://platform.openai.com/docs',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'sk-...'
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://api.openai.com/v1'
      },
      {
        key: 'organization',
        label: 'Organization',
        type: 'text',
        required: false,
        secret: false
      },
      {
        key: 'project',
        label: 'Project',
        type: 'text',
        required: false,
        secret: false
      }
    ],
    families: {
      language: languageFamily,
      embedding: embeddingFamily,
      image: { ...imageFamily, modelDiscoveryStrategy: 'api' },
      transcription: { ...transcriptionFamily, modelDiscoveryStrategy: 'api' },
      speech: { ...speechFamily, modelDiscoveryStrategy: 'api' }
    }
  },
  'openai-chat': {
    id: 'openai-chat',
    name: 'OpenAI Chat',
    description: 'OpenAI models via the Chat Completions API.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'sk-...'
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://api.openai.com/v1'
      },
      {
        key: 'organization',
        label: 'Organization',
        type: 'text',
        required: false,
        secret: false
      },
      {
        key: 'project',
        label: 'Project',
        type: 'text',
        required: false,
        secret: false
      }
    ],
    families: { language: languageFamily }
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude language models.',
    docsUrl: 'https://docs.anthropic.com',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'sk-ant-...'
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false
      }
    ],
    families: { language: languageFamily }
  },
  google: {
    id: 'google',
    name: 'Google',
    description: 'Google Gemini language, embedding, and image models.',
    docsUrl: 'https://ai.google.dev',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://generativelanguage.googleapis.com/v1beta'
      }
    ],
    families: { language: languageFamily, embedding: embeddingFamily, image: imageFamily }
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek language models.',
    docsUrl: 'https://api-docs.deepseek.com',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://api.deepseek.com'
      }
    ],
    families: { language: languageFamily }
  },
  zhipu: {
    id: 'zhipu',
    name: 'Zhipu (Z.ai)',
    description: 'Zhipu GLM language, embedding, and image models.',
    docsUrl: 'https://docs.z.ai/guides/overview/quick-start',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://open.bigmodel.cn/api/paas/v4'
      }
    ],
    families: { language: languageFamily, embedding: embeddingFamily, image: imageFamily }
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax language models.',
    docsUrl: 'https://www.minimaxi.com/document',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://api.minimaxi.com/v1'
      }
    ],
    families: { language: languageFamily }
  },
  grok: {
    id: 'grok',
    name: 'Grok (xAI)',
    description: 'xAI Grok language models.',
    docsUrl: 'https://docs.x.ai/docs',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'xai-...'
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        secret: false,
        placeholder: 'https://api.x.ai/v1'
      }
    ],
    families: { language: languageFamily }
  },
  'openai-compatible': {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    description: 'Local or hosted OpenAI-compatible endpoints.',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    credentialFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: true,
        secret: false,
        placeholder: 'http://localhost:11434/v1'
      },
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        required: false,
        secret: true
      },
      {
        key: 'name',
        label: 'Provider name',
        type: 'text',
        required: false,
        secret: false
      }
    ],
    families: {
      language: {
        ...languageFamily,
        modelDiscoveryStrategy: 'api'
      },
      embedding: {
        ...embeddingFamily,
        modelDiscoveryStrategy: 'api'
      },
      image: {
        ...imageFamily,
        modelDiscoveryStrategy: 'api'
      }
    }
  }
}

export function getProvider(providerId: ProviderId): ProviderConfig {
  const provider = PROVIDERS[providerId]
  if (!provider) {
    throw new TanzoNotFoundError('PROVIDER_UNKNOWN', `Unknown provider: ${providerId}`, {
      details: { providerId }
    })
  }
  return provider
}

export function listProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS)
}

export function getSupportedFamilies(providerId: ProviderId): ModelFamily[] {
  return Object.entries(getProvider(providerId).families)
    .filter(([, descriptor]) => descriptor?.supported)
    .map(([family]) => family as ModelFamily)
}
