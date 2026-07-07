import type { IpcMain } from 'electron'
import { z } from 'zod'
import { CHAT_BRIDGE_CHANNELS, type ChannelConfigInput } from '@shared/chat-bridge'
import { registerIpcHandlers, type IpcRegistration } from '../ipc/router'
import { createLogger } from '../logger'
import type { ChatBridgeService } from './service'

export interface ChatBridgeIpcDeps {
  service: ChatBridgeService
}

const channelIdSchema = z.enum(['qq', 'wechat', 'lark', 'discord'])
const permissionModeSchema = z.enum(['default', 'plan', 'yolo'])

// Ids are opaque per-platform identifiers (openids, snowflakes, chat ids).
const allowlistSchema = z.object({
  groups: z.array(z.string().min(1).max(128)).max(200),
  users: z.array(z.string().min(1).max(128)).max(200)
})

const commonFields = {
  enabled: z.boolean(),
  botUserName: z.string().min(1).max(64),
  allowlist: allowlistSchema,
  permissionMode: permissionModeSchema,
  surfaceApprovals: z.boolean()
}

const qqSettings = z.object({
  appId: z.string().max(64),
  sandbox: z.boolean(),
  mode: z.enum(['websocket', 'webhook']),
  webhookPath: z.string().max(256)
})
const discordSettings = z.object({
  applicationId: z.string().max(64),
  publicKey: z.string().max(256),
  mentionRoleIds: z.array(z.string().min(1).max(64)).max(50)
})
const larkSettings = z.object({
  appId: z.string().max(64),
  encryptKey: z.string().max(256),
  domain: z.enum(['feishu', 'lark']),
  mode: z.enum(['ws', 'webhook'])
})
const wechatSettings = z.object({
  appId: z.string().max(64),
  token: z.string().max(256),
  env: z.enum(['online', 'debug'])
})

// A channel config, discriminated by `id` so the correct settings shape is enforced.
const channelConfigSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('qq'), settings: qqSettings, ...commonFields }),
  z.object({ id: z.literal('discord'), settings: discordSettings, ...commonFields }),
  z.object({ id: z.literal('lark'), settings: larkSettings, ...commonFields }),
  z.object({ id: z.literal('wechat'), settings: wechatSettings, ...commonFields })
]) satisfies z.ZodType<ChannelConfigInput>

const secretSchema = z.string().max(4096)

export function chatBridgeHandlers(deps: ChatBridgeIpcDeps): IpcRegistration[] {
  return [
    [CHAT_BRIDGE_CHANNELS.getConfig, () => deps.service.getConfig()],
    [
      CHAT_BRIDGE_CHANNELS.setChannelConfig,
      (config) => deps.service.setChannelConfig(channelConfigSchema.parse(config))
    ],
    [
      CHAT_BRIDGE_CHANNELS.setSecret,
      (channelId, secret) =>
        deps.service.setSecret(channelIdSchema.parse(channelId), secretSchema.parse(secret))
    ],
    [CHAT_BRIDGE_CHANNELS.getStatus, () => deps.service.getStatus()],
    [
      CHAT_BRIDGE_CHANNELS.connect,
      (channelId) => deps.service.connect(channelIdSchema.parse(channelId))
    ],
    [
      CHAT_BRIDGE_CHANNELS.disconnect,
      (channelId) => deps.service.disconnect(channelIdSchema.parse(channelId))
    ],
    [
      CHAT_BRIDGE_CHANNELS.testConnection,
      (channelId) => deps.service.testConnection(channelIdSchema.parse(channelId))
    ]
  ]
}

export function registerChatBridgeIpc(ipcMain: IpcMain, deps: ChatBridgeIpcDeps): () => void {
  return registerIpcHandlers(ipcMain, chatBridgeHandlers(deps), {
    logger: createLogger('chat-bridge.ipc')
  })
}
