export type ChannelId = 'qq' | 'wechat' | 'lark' | 'discord'

export const CHANNEL_IDS: readonly ChannelId[] = ['qq', 'wechat', 'lark', 'discord'] as const

export interface ChannelMeta {
  id: ChannelId

  name: string

  transport: 'outbound' | 'webhook'

  secretLabel: string
}

export const CHANNEL_META: Record<ChannelId, ChannelMeta> = {
  qq: { id: 'qq', name: 'QQ', transport: 'outbound', secretLabel: 'AppSecret' },
  discord: { id: 'discord', name: 'Discord', transport: 'outbound', secretLabel: 'Bot Token' },
  lark: { id: 'lark', name: 'Feishu / Lark', transport: 'outbound', secretLabel: 'App Secret' },
  wechat: { id: 'wechat', name: 'WeChat', transport: 'webhook', secretLabel: 'AES Key' }
}

export type ChannelConnectionMode = 'websocket' | 'webhook'

export interface QQChannelSettings {
  appId: string
  sandbox: boolean
  mode: ChannelConnectionMode

  webhookPath: string
}

export interface DiscordChannelSettings {
  applicationId: string

  publicKey: string

  mentionRoleIds: string[]
}

export interface LarkChannelSettings {
  appId: string

  encryptKey: string

  domain: 'feishu' | 'lark'

  mode: 'ws' | 'webhook'
}

export interface WeChatChannelSettings {
  appId: string

  token: string
  env: 'online' | 'debug'
}

export interface ChannelSettingsMap {
  qq: QQChannelSettings
  discord: DiscordChannelSettings
  lark: LarkChannelSettings
  wechat: WeChatChannelSettings
}

export interface ChannelAllowlist {
  groups: string[]

  users: string[]
}

export type ChannelPermissionMode = 'default' | 'plan' | 'yolo'

export interface ChannelConfig<K extends ChannelId = ChannelId> {
  id: K

  enabled: boolean

  botUserName: string

  settings: ChannelSettingsMap[K]
  allowlist: ChannelAllowlist
  permissionMode: ChannelPermissionMode

  surfaceApprovals: boolean
}

export interface ChatBridgeConfig {
  channels: { [K in ChannelId]: ChannelConfig<K> }
}

function defaultChannel<K extends ChannelId>(
  id: K,
  settings: ChannelSettingsMap[K]
): ChannelConfig<K> {
  return {
    id,
    enabled: false,
    botUserName: 'Tanzo',
    settings,
    allowlist: { groups: [], users: [] },
    permissionMode: 'default',
    surfaceApprovals: true
  }
}

export const DEFAULT_CHAT_BRIDGE_CONFIG: ChatBridgeConfig = {
  channels: {
    qq: defaultChannel('qq', {
      appId: '',
      sandbox: false,
      mode: 'websocket',
      webhookPath: '/api/qq/webhook'
    }),
    discord: defaultChannel('discord', {
      applicationId: '',
      publicKey: '',
      mentionRoleIds: []
    }),
    lark: defaultChannel('lark', {
      appId: '',
      encryptKey: '',
      domain: 'feishu',
      mode: 'ws'
    }),
    wechat: defaultChannel('wechat', {
      appId: '',
      token: '',
      env: 'online'
    })
  }
}

export type ChannelConnectionState = 'disabled' | 'connecting' | 'connected' | 'error'

export interface ChannelStatus {
  id: ChannelId
  state: ChannelConnectionState

  botId?: string

  lastError?: string

  secretConfigured: boolean

  activeConversations: number

  lastActivityAt?: number

  lastDeniedThreadId?: string
  lastDeniedAuthorId?: string
  lastDeniedAt?: number
}

export interface ChatBridgeStatus {
  channels: Record<ChannelId, ChannelStatus>
}

export type ChatBridgeEvent =
  | { kind: 'status'; channelId: ChannelId; status: ChannelStatus }
  | {
      kind: 'log'
      channelId: ChannelId
      level: 'info' | 'warn' | 'error'
      message: string
      at: number
    }

export const CHAT_BRIDGE_CHANNELS = {
  getConfig: 'chat-bridge:get-config',

  setChannelConfig: 'chat-bridge:set-channel-config',

  setSecret: 'chat-bridge:set-secret',
  getStatus: 'chat-bridge:get-status',

  connect: 'chat-bridge:connect',
  disconnect: 'chat-bridge:disconnect',

  testConnection: 'chat-bridge:test-connection',
  event: 'chat-bridge:event'
} as const

export type ChatBridgeChannel = (typeof CHAT_BRIDGE_CHANNELS)[keyof typeof CHAT_BRIDGE_CHANNELS]

export const chatBridgeEventChannel = (): string => CHAT_BRIDGE_CHANNELS.event

export type ChannelConfigInput = ChannelConfig

export interface ChatBridgeTestResult {
  ok: boolean

  botId?: string

  message?: string
}

export interface ChatBridgeApi {
  getConfig(): Promise<ChatBridgeConfig>
  setChannelConfig(config: ChannelConfigInput): Promise<ChatBridgeConfig>
  setSecret(channelId: ChannelId, secret: string): Promise<{ secretConfigured: boolean }>
  getStatus(): Promise<ChatBridgeStatus>
  connect(channelId: ChannelId): Promise<ChannelStatus>
  disconnect(channelId: ChannelId): Promise<ChannelStatus>
  testConnection(channelId: ChannelId): Promise<ChatBridgeTestResult>
  onEvent(callback: (event: ChatBridgeEvent) => void): () => void
}
