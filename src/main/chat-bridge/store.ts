import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  CHANNEL_IDS,
  DEFAULT_CHAT_BRIDGE_CONFIG,
  type ChannelConfig,
  type ChannelId,
  type ChannelPermissionMode,
  type ChatBridgeConfig
} from '@shared/chat-bridge'
import type { SecretCodec } from '../provider/secret'
import { createLogger } from '../logger'

export interface ChatBridgeStore {
  readConfig(): ChatBridgeConfig

  writeChannelConfig(config: ChannelConfig): ChatBridgeConfig

  readSecret(channelId: ChannelId): string

  writeSecret(channelId: ChannelId, secret: string): void
  hasSecret(channelId: ChannelId): boolean
}

interface PersistShape {
  version: 2
  config: ChatBridgeConfig

  secrets: Partial<Record<ChannelId, string>>
}

const logger = createLogger('chat-bridge.store')

function coercePermissionMode(value: unknown): ChannelPermissionMode {
  return value === 'plan' || value === 'yolo' ? value : 'default'
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeChannel(id: ChannelId, raw: unknown): ChannelConfig {
  const input = (raw ?? {}) as Partial<ChannelConfig>
  const def = DEFAULT_CHAT_BRIDGE_CONFIG.channels[id]
  const allowlist = (input.allowlist ?? {}) as Partial<ChannelConfig['allowlist']>
  const rawSettings = (input.settings ?? {}) as Record<string, unknown>

  const settings = { ...(def.settings as unknown as Record<string, unknown>), ...rawSettings }
  if (id === 'qq') {
    settings.appId = str(settings.appId)
    settings.sandbox = settings.sandbox === true
    settings.mode = settings.mode === 'webhook' ? 'webhook' : 'websocket'
    settings.webhookPath = str(settings.webhookPath, '/api/qq/webhook') || '/api/qq/webhook'
  } else if (id === 'discord') {
    settings.applicationId = str(settings.applicationId)
    settings.publicKey = str(settings.publicKey)
    settings.mentionRoleIds = coerceStringArray(settings.mentionRoleIds)
  } else if (id === 'lark') {
    settings.appId = str(settings.appId)
    settings.encryptKey = str(settings.encryptKey)
    settings.domain = settings.domain === 'lark' ? 'lark' : 'feishu'
    settings.mode = settings.mode === 'webhook' ? 'webhook' : 'ws'
  } else {
    settings.appId = str(settings.appId)
    settings.token = str(settings.token)
    settings.env = settings.env === 'debug' ? 'debug' : 'online'
  }

  return {
    id,
    enabled: input.enabled === true,
    botUserName: str(input.botUserName) || def.botUserName,
    settings: settings as unknown as ChannelConfig['settings'],
    allowlist: {
      groups: coerceStringArray(allowlist.groups),
      users: coerceStringArray(allowlist.users)
    },
    permissionMode: coercePermissionMode(input.permissionMode),
    surfaceApprovals: input.surfaceApprovals !== false
  }
}

function normalizeConfig(raw: unknown): ChatBridgeConfig {
  const input = (raw ?? {}) as { channels?: Record<string, unknown> }
  const channelsIn = input.channels ?? {}
  const channels = {} as ChatBridgeConfig['channels']
  for (const id of CHANNEL_IDS) {
    // @ts-expect-error index write across the discriminated map is sound (id matches).
    channels[id] = normalizeChannel(id, channelsIn[id])
  }
  return { channels }
}

export function createChatBridgeStore(userDataPath: string, codec: SecretCodec): ChatBridgeStore {
  const filePath = join(userDataPath, 'chat-bridge.json')

  let cache: PersistShape = {
    version: 2,
    config: DEFAULT_CHAT_BRIDGE_CONFIG,
    secrets: {}
  }

  const load = (): void => {
    if (!existsSync(filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PersistShape>
      const secrets: Partial<Record<ChannelId, string>> = {}
      const rawSecrets = (parsed.secrets ?? {}) as Record<string, unknown>
      for (const id of CHANNEL_IDS) {
        const v = rawSecrets[id]
        if (typeof v === 'string' && v.length > 0) secrets[id] = v
      }
      cache = { version: 2, config: normalizeConfig(parsed.config), secrets }
    } catch (error) {
      logger.warn('failed to read chat-bridge.json; using defaults', { error })
    }
  }

  const persist = (): void => {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tmp, filePath)
  }

  load()

  return {
    readConfig() {
      return cache.config
    },
    writeChannelConfig(config) {
      const normalized = normalizeChannel(config.id, config)
      cache = {
        ...cache,
        config: {
          channels: { ...cache.config.channels, [normalized.id]: normalized }
        }
      }
      persist()
      return cache.config
    },
    readSecret(channelId) {
      const enc = cache.secrets[channelId]
      if (!enc) return ''
      try {
        return codec.decrypt(enc)
      } catch (error) {
        logger.warn('failed to decrypt stored channel secret', { channelId, error })
        return ''
      }
    },
    writeSecret(channelId, secret) {
      const secrets = { ...cache.secrets }
      if (!secret) delete secrets[channelId]
      else secrets[channelId] = codec.encrypt(secret)
      cache = { ...cache, secrets }
      persist()
    },
    hasSecret(channelId) {
      return typeof cache.secrets[channelId] === 'string'
    }
  }
}
