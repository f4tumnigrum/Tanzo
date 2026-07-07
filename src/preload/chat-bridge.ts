import {
  CHAT_BRIDGE_CHANNELS,
  chatBridgeEventChannel,
  type ChatBridgeApi,
  type ChatBridgeEvent
} from '@shared/chat-bridge'
import { invoke, subscribe } from './invoke'

export const chatBridgeApi: ChatBridgeApi = {
  getConfig: invoke<ChatBridgeApi['getConfig']>(CHAT_BRIDGE_CHANNELS.getConfig),
  setChannelConfig: invoke<ChatBridgeApi['setChannelConfig']>(
    CHAT_BRIDGE_CHANNELS.setChannelConfig
  ),
  setSecret: invoke<ChatBridgeApi['setSecret']>(CHAT_BRIDGE_CHANNELS.setSecret),
  getStatus: invoke<ChatBridgeApi['getStatus']>(CHAT_BRIDGE_CHANNELS.getStatus),
  connect: invoke<ChatBridgeApi['connect']>(CHAT_BRIDGE_CHANNELS.connect),
  disconnect: invoke<ChatBridgeApi['disconnect']>(CHAT_BRIDGE_CHANNELS.disconnect),
  testConnection: invoke<ChatBridgeApi['testConnection']>(CHAT_BRIDGE_CHANNELS.testConnection),
  onEvent: (callback) => subscribe<ChatBridgeEvent>(chatBridgeEventChannel(), callback)
}
