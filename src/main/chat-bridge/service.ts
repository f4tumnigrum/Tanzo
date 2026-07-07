import {
  CHANNEL_IDS,
  DEFAULT_CHAT_BRIDGE_CONFIG,
  type ChannelConfig,
  type ChannelConfigInput,
  type ChannelId,
  type ChannelStatus,
  type ChatBridgeApi,
  type ChatBridgeConfig,
  type ChatBridgeEvent,
  type ChatBridgeStatus,
  type ChatBridgeTestResult
} from '@shared/chat-bridge'
import type { ChatBridgeStore } from './store'
import type { ChatBridgeRuntime } from './bridge'
import { createLogger } from '../logger'

export interface ChatBridgeService {
  getConfig(): ChatBridgeConfig
  setChannelConfig(config: ChannelConfigInput): ChatBridgeConfig
  setSecret(channelId: ChannelId, secret: string): { secretConfigured: boolean }
  getStatus(): ChatBridgeStatus
  connect(channelId: ChannelId): Promise<ChannelStatus>
  disconnect(channelId: ChannelId): Promise<ChannelStatus>
  testConnection(channelId: ChannelId): Promise<ChatBridgeTestResult>
  subscribe(listener: (event: ChatBridgeEvent) => void): () => void
  emit(event: ChatBridgeEvent): void

  autoStart(): Promise<void>
  close(): Promise<void>
}

const logger = createLogger('chat-bridge.service')

export interface ChatBridgeServiceDeps {
  store: ChatBridgeStore
  runtime: ChatBridgeRuntime
}

export function createChatBridgeService(deps: ChatBridgeServiceDeps): ChatBridgeService {
  const { store, runtime } = deps
  const listeners = new Set<(event: ChatBridgeEvent) => void>()

  const withSecretFlag = (status: ChannelStatus): ChannelStatus => ({
    ...status,
    secretConfigured: store.hasSecret(status.id)
  })

  const fullStatus = (): ChatBridgeStatus => {
    const runtimeStatus = runtime.status()
    const channels = {} as Record<ChannelId, ChannelStatus>
    for (const id of CHANNEL_IDS) channels[id] = withSecretFlag(runtimeStatus.channels[id])
    return { channels }
  }

  const emit = (event: ChatBridgeEvent): void => {
    const normalized: ChatBridgeEvent =
      event.kind === 'status'
        ? { kind: 'status', channelId: event.channelId, status: withSecretFlag(event.status) }
        : event
    for (const listener of listeners) {
      try {
        listener(normalized)
      } catch (error) {
        logger.warn('chat-bridge event listener threw', { error })
      }
    }
  }

  const service: ChatBridgeService = {
    getConfig() {
      return store.readConfig()
    },
    setChannelConfig(config) {
      const next = store.writeChannelConfig(config)
      runtime.updateConfig(config.id, next.channels[config.id])
      return next
    },
    setSecret(channelId, secret) {
      store.writeSecret(channelId, secret)

      emit({ kind: 'status', channelId, status: runtime.channelStatus(channelId) })
      return { secretConfigured: store.hasSecret(channelId) }
    },
    getStatus() {
      return fullStatus()
    },
    async connect(channelId) {
      const config = channelConfig(channelId)
      const secret = store.readSecret(channelId)
      const status = await runtime.connect(channelId, config, secret)
      return withSecretFlag(status)
    },
    async disconnect(channelId) {
      const status = await runtime.disconnect(channelId)
      return withSecretFlag(status)
    },
    async testConnection(channelId) {
      const config = channelConfig(channelId)
      const secret = store.readSecret(channelId)
      const result = await runtime.testConnection(channelId, config, secret)
      return result
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit,
    async autoStart() {
      const config = store.readConfig()
      for (const id of CHANNEL_IDS) {
        const channel = config.channels[id]
        if (!channel.enabled) continue
        if (!store.hasSecret(id)) {
          logger.warn(`channel ${id} enabled but no secret stored; skipping auto-start`)
          continue
        }
        logger.info(`auto-starting channel ${id}`)
        try {
          await service.connect(id)
        } catch (error) {
          logger.warn(`auto-start failed for channel ${id}`, { error })
        }
      }
    },
    async close() {
      listeners.clear()
      await runtime.shutdownAll()
    }
  }

  function channelConfig(channelId: ChannelId): ChannelConfig {
    return store.readConfig().channels[channelId]
  }

  return service
}

export type { ChatBridgeApi, ChatBridgeConfig }
export { DEFAULT_CHAT_BRIDGE_CONFIG }
