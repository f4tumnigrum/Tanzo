/**
 * Chat Bridge — cross-process contract (multi-channel).
 *
 * The chat bridge connects Tanzo's local agent to external chat platforms via the Chat SDK.
 * Each platform is a "channel" with its own official/community adapter, credentials, and
 * connection mode. The bridge can run several channels at once; each enabled channel owns an
 * independent Chat SDK connection but shares one agent + one safety model (allowlist +
 * permission mode + approval surfacing).
 *
 * Supported channels and their adapters:
 *   - qq       → `@youglin/adapter-qq-bot`   (QQ Open Platform; WebSocket gateway)
 *   - discord  → `@chat-adapter/discord`     (Discord; Gateway WebSocket)
 *   - lark     → `chat-adapter-lark`         (Feishu/Lark; WebSocket long-connection)
 *   - wechat   → `chat-adapter-wechat`       (WeChat 对话开放平台 bot; webhook callback)
 *
 * This module is the single source of truth shared by main, preload, and renderer: the
 * channel registry, per-channel config shapes, the runtime status snapshot, live event
 * shapes, IPC channel names, and the typed client API on `window.electron.chatBridge`.
 *
 * Security note: each channel's secret (QQ AppSecret, Discord bot token, Lark AppSecret,
 * WeChat aesKey) is write-only from the renderer's side. The renderer sends it to main once on
 * save (per channel) and can only ever read a boolean `secretConfigured` back — the secret
 * value never travels main → renderer. Main persists it via the shared secret codec.
 */

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

export type ChannelId = 'qq' | 'wechat' | 'lark' | 'discord'

export const CHANNEL_IDS: readonly ChannelId[] = ['qq', 'wechat', 'lark', 'discord'] as const

/** Static, presentation-independent metadata about a channel. */
export interface ChannelMeta {
  id: ChannelId
  /** Display name, e.g. "QQ", "Discord", "Feishu / Lark". */
  name: string
  /** How the adapter receives events. `outbound` needs no public server (desktop-friendly). */
  transport: 'outbound' | 'webhook'
  /** Human label for the secret field, e.g. "AppSecret", "Bot Token". */
  secretLabel: string
}

export const CHANNEL_META: Record<ChannelId, ChannelMeta> = {
  qq: { id: 'qq', name: 'QQ', transport: 'outbound', secretLabel: 'AppSecret' },
  discord: { id: 'discord', name: 'Discord', transport: 'outbound', secretLabel: 'Bot Token' },
  lark: { id: 'lark', name: 'Feishu / Lark', transport: 'outbound', secretLabel: 'App Secret' },
  wechat: { id: 'wechat', name: 'WeChat', transport: 'webhook', secretLabel: 'AES Key' }
}

// ---------------------------------------------------------------------------
// Per-channel settings (the non-secret, channel-specific fields)
// ---------------------------------------------------------------------------

/** How a channel receives events. Mirrors each adapter's mode option. */
export type ChannelConnectionMode = 'websocket' | 'webhook'

/** QQ Open Platform (`@youglin/adapter-qq-bot`). Secret = AppSecret. */
export interface QQChannelSettings {
  appId: string
  sandbox: boolean
  mode: ChannelConnectionMode
  /** Route path when `mode === 'webhook'`. Informational in the desktop app. */
  webhookPath: string
}

/** Discord (`@chat-adapter/discord`). Secret = bot token. */
export interface DiscordChannelSettings {
  applicationId: string
  /** Required by the adapter for Discord interaction signature verification. */
  publicKey: string
  /** Extra role ids (besides direct user mentions) that trigger mention handlers. */
  mentionRoleIds: string[]
}

/** Feishu / Lark (`chat-adapter-lark`). Secret = app secret. */
export interface LarkChannelSettings {
  appId: string
  /** Event decryption key (optional; required only if the app enables encryption). */
  encryptKey: string
  /** `feishu` (default, China) or `lark` (international). */
  domain: 'feishu' | 'lark'
  /** Incoming transport: `ws` = long-connection (desktop-friendly), or `webhook`. */
  mode: 'ws' | 'webhook'
}

/** WeChat 对话开放平台 bot (`chat-adapter-wechat`). Secret = aesKey. */
export interface WeChatChannelSettings {
  appId: string
  /** Plaintext verification token from the WeChat platform (not the secret aesKey). */
  token: string
  env: 'online' | 'debug'
}

/** Discriminated map of channel id → its settings shape. */
export interface ChannelSettingsMap {
  qq: QQChannelSettings
  discord: DiscordChannelSettings
  lark: LarkChannelSettings
  wechat: WeChatChannelSettings
}

// ---------------------------------------------------------------------------
// Shared per-channel config (common safety fields + channel settings)
// ---------------------------------------------------------------------------

/**
 * Which conversations may drive the local agent, for a single channel. Remote-triggered
 * local execution is powerful, so the default posture is deny-all: an empty list means
 * "nobody" (not "everybody"). Use raw platform ids: QQ openids/channel ids, WeChat openids
 * or group ids, Discord guild ids plus sender user ids, and Lark chat ids plus sender user ids.
 */
export interface ChannelAllowlist {
  /** Group / channel / guild ids allowed to trigger the agent. */
  groups: string[]
  /** User ids allowed in direct chats or as group senders. */
  users: string[]
}

/**
 * Permission posture applied to agent runs triggered from a channel. `default` keeps
 * human-in-the-loop approvals (surfaced back into chat); `yolo` auto-approves non-destructive
 * tools; `plan` blocks writes. `dangerous` is intentionally never offered — remote callers
 * must never get an unsandboxed shell.
 */
export type ChannelPermissionMode = 'default' | 'plan' | 'yolo'

/** The persisted configuration for one channel (minus its secret). */
export interface ChannelConfig<K extends ChannelId = ChannelId> {
  id: K
  /** Whether this channel connects. Channels are independent. */
  enabled: boolean
  /** Bot display name, used for fallback mention detection. */
  botUserName: string
  /** Channel-specific connection settings. */
  settings: ChannelSettingsMap[K]
  allowlist: ChannelAllowlist
  permissionMode: ChannelPermissionMode
  /** When false, any run that would pause for approval is answered "denied" instead. */
  surfaceApprovals: boolean
}

/** The full, persisted bridge configuration: every channel keyed by id (minus secrets). */
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

// ---------------------------------------------------------------------------
// Runtime status (per channel)
// ---------------------------------------------------------------------------

export type ChannelConnectionState =
  | 'disabled' // channel switch off
  | 'connecting' // opening / reconnecting (or validating credentials)
  | 'connected' // connected, bot identity resolved
  | 'error' // last connection attempt failed

/** A live, read-only view of one channel for the Settings UI. Never contains the secret. */
export interface ChannelStatus {
  id: ChannelId
  state: ChannelConnectionState
  /** Present once connected and the platform reported the bot's identity. */
  botId?: string
  /** Human-readable last error, if `state === 'error'`. */
  lastError?: string
  /** Whether this channel's secret is currently stored (never the value itself). */
  secretConfigured: boolean
  /** Count of active conversations the bridge is tracking for this channel. */
  activeConversations: number
  /** Epoch ms of the last inbound message this channel accepted. */
  lastActivityAt?: number
  /** Most recent inbound message blocked by the allowlist, shown locally for setup/debugging. */
  lastDeniedThreadId?: string
  lastDeniedAuthorId?: string
  lastDeniedAt?: number
}

/** The whole bridge status: one entry per channel. */
export interface ChatBridgeStatus {
  channels: Record<ChannelId, ChannelStatus>
}

// ---------------------------------------------------------------------------
// Live events (main → renderer, so the UI reflects state without polling)
// ---------------------------------------------------------------------------

export type ChatBridgeEvent =
  | { kind: 'status'; channelId: ChannelId; status: ChannelStatus }
  | {
      kind: 'log'
      channelId: ChannelId
      level: 'info' | 'warn' | 'error'
      message: string
      at: number
    }

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

export const CHAT_BRIDGE_CHANNELS = {
  getConfig: 'chat-bridge:get-config',
  /** Save one channel's config (non-secret). */
  setChannelConfig: 'chat-bridge:set-channel-config',
  /** Write-only per-channel secret setter. Empty string clears it. */
  setSecret: 'chat-bridge:set-secret',
  getStatus: 'chat-bridge:get-status',
  /** Apply config + (re)connect one channel. */
  connect: 'chat-bridge:connect',
  disconnect: 'chat-bridge:disconnect',
  /** Validate one channel's credentials without enabling it. */
  testConnection: 'chat-bridge:test-connection',
  event: 'chat-bridge:event'
} as const

export type ChatBridgeChannel = (typeof CHAT_BRIDGE_CHANNELS)[keyof typeof CHAT_BRIDGE_CHANNELS]

export const chatBridgeEventChannel = (): string => CHAT_BRIDGE_CHANNELS.event

/** Payload accepted by `setChannelConfig` — one channel's config without any secret. */
export type ChannelConfigInput = ChannelConfig

export interface ChatBridgeTestResult {
  ok: boolean
  /** Resolved bot id on success. */
  botId?: string
  /** Failure reason on `ok: false`. */
  message?: string
}

/**
 * The client surface on `window.electron.chatBridge`. Method signatures are the single
 * source of truth referenced by the preload, the renderer platform client, and the IPC
 * handler return types. All per-channel methods take a `channelId`.
 */
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
