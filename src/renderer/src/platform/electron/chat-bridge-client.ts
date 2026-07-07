import { TanzoIntegrationError } from '@shared/errors'
import type {
  ChannelConfigInput,
  ChannelId,
  ChannelStatus,
  ChatBridgeApi,
  ChatBridgeConfig,
  ChatBridgeEvent,
  ChatBridgeStatus,
  ChatBridgeTestResult
} from '@shared/chat-bridge'
import { withDecodedIpcErrors } from './ipc-errors'

function requireChatBridgeApi(): ChatBridgeApi {
  const api = window.electron?.chatBridge
  if (!api) {
    throw new TanzoIntegrationError(
      'ELECTRON_CHAT_BRIDGE_API_UNAVAILABLE',
      'Electron chat bridge API is not available'
    )
  }
  return withDecodedIpcErrors(api)
}

export const chatBridgeClient = {
  getConfig(): Promise<ChatBridgeConfig> {
    return requireChatBridgeApi().getConfig()
  },
  setChannelConfig(config: ChannelConfigInput): Promise<ChatBridgeConfig> {
    return requireChatBridgeApi().setChannelConfig(config)
  },
  setSecret(channelId: ChannelId, secret: string): Promise<{ secretConfigured: boolean }> {
    return requireChatBridgeApi().setSecret(channelId, secret)
  },
  getStatus(): Promise<ChatBridgeStatus> {
    return requireChatBridgeApi().getStatus()
  },
  connect(channelId: ChannelId): Promise<ChannelStatus> {
    return requireChatBridgeApi().connect(channelId)
  },
  disconnect(channelId: ChannelId): Promise<ChannelStatus> {
    return requireChatBridgeApi().disconnect(channelId)
  },
  testConnection(channelId: ChannelId): Promise<ChatBridgeTestResult> {
    return requireChatBridgeApi().testConnection(channelId)
  },
  onEvent(callback: (event: ChatBridgeEvent) => void): () => void {
    return requireChatBridgeApi().onEvent(callback)
  }
}
