import type { IpcMain } from 'electron'
import type { PermissionMode } from '@shared/policy'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { ChatApprovalResponse, QuestionReply } from '@shared/chat'
import { createSecretCodec } from '../provider/secret'
import { createLogger } from '../logger'
import { createChatBridgeStore } from './store'
import { createChatBridgeRuntime, type BridgeAgentPort } from './bridge'
import { createChatBridgeService, type ChatBridgeService } from './service'
import { registerChatBridgeIpc, type ChatBridgeIpcDeps } from './ipc'

export interface ChatBridgeAgentPort {
  ensureConversation(chatId: string): void
  submitMessage(chatId: string, message: TanzoUIMessage): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  answerQuestion(chatId: string, questionId: string, reply: QuestionReply): Promise<void>
  isRunning(chatId: string): boolean
  loadConversationMessages(chatId: string): TanzoUIMessage[]
  setPermissionMode(chatId: string, mode: PermissionMode): void
}

export interface CreateChatBridgeModuleOptions {
  userDataPath: string
  agent: ChatBridgeAgentPort

  broadcast: (event: import('@shared/chat-bridge').ChatBridgeEvent) => void
}

export interface ChatBridgeModule {
  service: ChatBridgeService

  observeChunk(
    chatId: string,
    chunk: {
      type?: string
      delta?: string
      toolName?: string
      toolCallId?: string
      input?: unknown
      data?: unknown
    }
  ): void
  registerIpc(ipcMain: IpcMain): void

  autoStart(): Promise<void>
  close(): Promise<void>
}

export function createChatBridgeModule(options: CreateChatBridgeModuleOptions): ChatBridgeModule {
  const logger = createLogger('chat-bridge.module')

  const codec = createSecretCodec({ allowPlaintextFallback: true })
  const store = createChatBridgeStore(options.userDataPath, codec)

  const agentPort: BridgeAgentPort = {
    ensureConversation: (chatId) => options.agent.ensureConversation(chatId),
    submitMessage: (chatId, message) => options.agent.submitMessage(chatId, message),
    respondApprovals: (chatId, responses) => options.agent.respondApprovals(chatId, responses),
    answerQuestion: (chatId, questionId, reply) =>
      options.agent.answerQuestion(chatId, questionId, reply),
    isRunning: (chatId) => options.agent.isRunning(chatId),
    loadMessages: async (chatId) => options.agent.loadConversationMessages(chatId),
    setPermissionMode: (chatId, mode) => options.agent.setPermissionMode(chatId, mode)
  }

  let serviceRef: ChatBridgeService | null = null

  const runtime = createChatBridgeRuntime({
    agent: agentPort,
    onEvent: (event) => {
      serviceRef?.emit(event)
    }
  })

  const service = createChatBridgeService({ store, runtime })
  serviceRef = service

  const unsubscribeBroadcast = service.subscribe((event) => options.broadcast(event))

  let unregisterIpc: (() => void) | null = null

  const ipcDeps: ChatBridgeIpcDeps = { service }

  return {
    service,
    observeChunk(chatId, chunk) {
      runtime.observeChunk(chatId, chunk)
    },
    registerIpc(ipcMain) {
      unregisterIpc?.()
      unregisterIpc = registerChatBridgeIpc(ipcMain, ipcDeps)
    },
    async autoStart() {
      try {
        await service.autoStart()
      } catch (error) {
        logger.warn('chat bridge auto-start failed', { error })
      }
    },
    async close() {
      unregisterIpc?.()
      unregisterIpc = null
      unsubscribeBroadcast()
      await service.close()
    }
  }
}

export type { ChatBridgeService }
