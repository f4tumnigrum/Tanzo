import { Buffer } from 'node:buffer'
import { randomUUID } from 'crypto'
import type { Chat, ChatConfig, Message, Thread } from 'chat'
import type { AskQuestionAnswer, AskQuestionInput, TanzoUIMessage } from '@shared/agent-message'
import type { ChatApprovalResponse, QuestionReply } from '@shared/chat'
import { hasPendingApprovalRequest } from '@shared/approval-responses'
import type { PermissionMode } from '@shared/policy'
import {
  CHANNEL_IDS,
  DEFAULT_CHAT_BRIDGE_CONFIG,
  type ChannelId,
  type ChannelConfig,
  type ChannelConnectionState,
  type ChannelStatus,
  type ChannelPermissionMode,
  type ChatBridgeStatus,
  type ChatBridgeEvent
} from '@shared/chat-bridge'
import { createLogger } from '../logger'

/**
 * The multi-channel bridge runtime. Owns one Chat SDK `Chat` instance (and its adapter) per
 * enabled channel, translates inbound messages into `AgentService.submitMessage`, mirrors
 * assistant output back to chat by observing the agent chunk stream, and surfaces tool
 * approvals as a text prompt answered by a reply keyword.
 *
 * Channels are independent: each has its own connection, credentials, allowlist, and status.
 * The inbound/approval/streaming machinery is channel-agnostic — it operates on Chat SDK
 * `thread` / `chatId` (thread id), which every adapter namespaces with a distinct prefix
 * (`qq:` / `discord:` / `lark:` / `wechat:`), so the per-chatId run/thread/approval maps are
 * safely global and `observeChunk(chatId)` routes to the right conversation without a channel
 * argument. Per-channel config is resolved from the chatId prefix.
 */

export interface BridgeAgentPort {
  /** Ensure a persisted conversation row exists for this external chat id (idempotent). */
  ensureConversation(chatId: string): void
  submitMessage(chatId: string, message: TanzoUIMessage): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  answerQuestion(chatId: string, questionId: string, reply: QuestionReply): Promise<void>
  isRunning(chatId: string): boolean
  /** Snapshot of the conversation's current messages, to inspect for pending approvals. */
  loadMessages(chatId: string): Promise<TanzoUIMessage[]>
  setPermissionMode(chatId: string, mode: PermissionMode): void
}

export interface ChatBridgeRuntimeDeps {
  agent: BridgeAgentPort
  /** Emits per-channel status/log changes for the Settings UI. */
  onEvent: (event: ChatBridgeEvent) => void
}

const logger = createLogger('chat-bridge.runtime')

type ChatModules = {
  Chat: typeof import('chat').Chat
  createMemoryState: typeof import('@chat-adapter/state-memory').createMemoryState
  createQQBotAdapter: typeof import('@youglin/adapter-qq-bot').createQQBotAdapter
  createDiscordAdapter: typeof import('@chat-adapter/discord').createDiscordAdapter
  createLarkAdapter: typeof import('chat-adapter-lark').createLarkAdapter
  createWeChatBotAdapter: typeof import('chat-adapter-wechat').createWeChatBotAdapter
}

let chatModulesPromise: Promise<ChatModules> | null = null

function loadChatModules(): Promise<ChatModules> {
  chatModulesPromise ??= Promise.all([
    import('chat'),
    import('@chat-adapter/state-memory'),
    import('@youglin/adapter-qq-bot'),
    import('@chat-adapter/discord'),
    import('chat-adapter-lark'),
    import('chat-adapter-wechat')
  ]).then(([chat, stateMemory, qq, discord, lark, wechat]) => ({
    Chat: chat.Chat,
    createMemoryState: stateMemory.createMemoryState,
    createQQBotAdapter: qq.createQQBotAdapter,
    createDiscordAdapter: discord.createDiscordAdapter,
    createLarkAdapter: lark.createLarkAdapter,
    createWeChatBotAdapter: wechat.createWeChatBotAdapter
  }))
  return chatModulesPromise
}

/** Max characters to accumulate before flushing a segment mid-run (chat message size guard). */
const SEGMENT_FLUSH_CHARS = 1600
// QQ does not expose editable streaming. Simulate it with a few paced messages and reserve one
// reply slot for the final flush because QQ Bot msg_seq only supports up to five replies.
const QQ_STREAM_FLUSH_INTERVAL_MS = 900
const QQ_STREAM_MIN_CHARS = 80
const QQ_STREAM_SEGMENT_CHARS = 600
const QQ_MAX_REPLY_SEGMENTS = 5
const QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS = QQ_MAX_REPLY_SEGMENTS - 1

/** Keywords a user replies with to answer a surfaced approval. Case-insensitive, trimmed. */
const APPROVE_WORDS = new Set(['批准', '同意', 'approve', 'yes', 'y', 'ok'])
const DENY_WORDS = new Set(['拒绝', '否', 'deny', 'no', 'n'])
const CANCEL_WORDS = new Set(['取消', 'cancel', '算了'])

interface PendingApproval {
  chatId: string
  approvalIds: string[]
  requestedAt: number
}

interface PendingBridgeQuestion {
  chatId: string
  questionId: string
  input: AskQuestionInput
  requestedAt: number
}

interface BridgeObservedChunk {
  type?: string
  delta?: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  data?: unknown
}

interface RunAccumulator {
  chatId: string
  channelId: ChannelId
  thread: Thread
  buffer: string
  posted: boolean
  agentOutputPosted: boolean
  streamedSegments: number
  postQueue: Promise<void>
  flushTimer?: ReturnType<typeof setTimeout>
}

/** Per-channel live connection + identity, held by the runtime. */
interface ChannelRuntime {
  id: ChannelId
  bot: Chat | null
  state: ChannelConnectionState
  botId?: string
  lastError?: string
  lastActivityAt?: number
  lastDeniedThreadId?: string
  lastDeniedAuthorId?: string
  lastDeniedAt?: number
}

function toPermissionMode(mode: ChannelPermissionMode): PermissionMode {
  // ChannelPermissionMode is a safe subset; map straight through. 'dangerous' is unreachable.
  return mode
}

/** Derive the channel id from a chatId (thread id) by its adapter prefix. */
function channelOfChatId(chatId: string): ChannelId | undefined {
  const prefix = chatId.split(':', 1)[0]
  return (CHANNEL_IDS as readonly string[]).includes(prefix) ? (prefix as ChannelId) : undefined
}

export interface ChatBridgeRuntime {
  connect(channelId: ChannelId, config: ChannelConfig, secret: string): Promise<ChannelStatus>
  disconnect(channelId: ChannelId): Promise<ChannelStatus>
  status(): ChatBridgeStatus
  channelStatus(channelId: ChannelId): ChannelStatus
  /** Update live allowlist/permission settings without reconnecting the adapter. */
  updateConfig(channelId: ChannelId, config: ChannelConfig): void
  /** Called by the module's chunk observer for every agent chunk. */
  observeChunk(chatId: string, chunk: BridgeObservedChunk): void
  testConnection(
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): Promise<{ ok: boolean; botId?: string; message?: string }>
  /** Tear down all channels (app shutdown). */
  shutdownAll(): Promise<void>
}

export function createChatBridgeRuntime(deps: ChatBridgeRuntimeDeps): ChatBridgeRuntime {
  // Per-channel connection state.
  const channels = new Map<ChannelId, ChannelRuntime>(
    CHANNEL_IDS.map((id) => [id, { id, bot: null, state: 'disabled' } as ChannelRuntime])
  )
  // Live per-channel config (set on connect), for allowlist / permission lookups.
  const configs = new Map<ChannelId, ChannelConfig>()

  // Global, keyed by chatId (thread ids are channel-namespaced, so no collisions).
  const threads = new Map<string, Thread>()
  const modeApplied = new Set<string>()
  const runs = new Map<string, RunAccumulator>()
  const finalizing = new Set<string>()
  const pendingApprovals = new Map<string, PendingApproval>()
  const pendingQuestions = new Map<string, PendingBridgeQuestion>()

  const rt = (id: ChannelId): ChannelRuntime => channels.get(id)!

  const emitStatus = (id: ChannelId): void => {
    deps.onEvent({ kind: 'status', channelId: id, status: channelStatus(id) })
  }
  const emitLog = (id: ChannelId, level: 'info' | 'warn' | 'error', message: string): void => {
    deps.onEvent({ kind: 'log', channelId: id, level, message, at: Date.now() })
  }

  const activeConversationsFor = (id: ChannelId): number => {
    let n = 0
    for (const chatId of threads.keys()) if (channelOfChatId(chatId) === id) n++
    return n
  }

  function channelStatus(id: ChannelId): ChannelStatus {
    const c = rt(id)
    return {
      id,
      state: c.state,
      botId: c.botId,
      lastError: c.lastError,
      secretConfigured: false, // filled in by the service layer, which owns the store
      activeConversations: activeConversationsFor(id),
      lastActivityAt: c.lastActivityAt,
      lastDeniedThreadId: c.lastDeniedThreadId,
      lastDeniedAuthorId: c.lastDeniedAuthorId,
      lastDeniedAt: c.lastDeniedAt
    }
  }

  function status(): ChatBridgeStatus {
    const out = {} as Record<ChannelId, ChannelStatus>
    for (const id of CHANNEL_IDS) out[id] = channelStatus(id)
    return { channels: out }
  }

  function updateConfig(channelId: ChannelId, config: ChannelConfig): void {
    configs.set(channelId, config)
    for (const chatId of activeChatIdsFor(channelId)) {
      deps.agent.setPermissionMode(chatId, toPermissionMode(config.permissionMode))
      modeApplied.add(chatId)
    }
    emitStatus(channelId)
  }

  function activeChatIdsFor(channelId: ChannelId): string[] {
    const ids = new Set<string>()
    for (const chatId of threads.keys()) if (channelOfChatId(chatId) === channelId) ids.add(chatId)
    for (const [chatId, run] of runs.entries()) if (run.channelId === channelId) ids.add(chatId)
    for (const chatId of finalizing.keys())
      if (channelOfChatId(chatId) === channelId) ids.add(chatId)
    for (const chatId of pendingApprovals.keys()) {
      if (channelOfChatId(chatId) === channelId) ids.add(chatId)
    }
    for (const chatId of pendingQuestions.keys()) {
      if (channelOfChatId(chatId) === channelId) ids.add(chatId)
    }
    return [...ids]
  }

  function isAllowed(channelId: ChannelId, threadId: string, authorUserId: string): boolean {
    const cfg = configs.get(channelId)
    if (!cfg) return false
    return isThreadAllowed(channelId, threadId, authorUserId, cfg.allowlist)
  }

  function ensureMode(channelId: ChannelId, chatId: string): void {
    const cfg = configs.get(channelId)
    if (!cfg) return
    if (modeApplied.has(chatId)) return
    deps.agent.setPermissionMode(chatId, toPermissionMode(cfg.permissionMode))
    modeApplied.add(chatId)
  }

  function messageToUIMessage(text: string): TanzoUIMessage {
    return {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }],
      metadata: { createdAt: Date.now() }
    } as TanzoUIMessage
  }

  /** Route an inbound message into the agent, or handle it as an approval reply. */
  async function handleInbound(
    channelId: ChannelId,
    thread: Thread,
    message: Message
  ): Promise<void> {
    const chatId = thread.id
    const authorId = message.author?.userId ?? ''
    // Non-text messages (images/cards/stickers) may carry no `text`; guard everywhere.
    const text = typeof message.text === 'string' ? message.text : ''

    if (!isAllowed(channelId, chatId, authorId)) {
      const c = rt(channelId)
      c.lastDeniedThreadId = chatId
      c.lastDeniedAuthorId = authorId
      c.lastDeniedAt = Date.now()
      emitStatus(channelId)
      logger.info('ignored message from non-allowlisted source', { channelId, chatId, authorId })
      return
    }

    await safeSubscribe(channelId, thread)

    rt(channelId).lastActivityAt = Date.now()
    threads.set(chatId, thread)

    // If we're waiting on an approval for this conversation, interpret the message as the answer.
    const pending = pendingApprovals.get(chatId)
    if (pending) {
      const answer = text.trim().toLowerCase()
      const approved = APPROVE_WORDS.has(answer)
      const denied = DENY_WORDS.has(answer)
      const cancelled = CANCEL_WORDS.has(answer)
      if (!approved && !denied && !cancelled) {
        await safePost(thread, '请回复「批准」执行、「拒绝」取消该操作,或「取消」放弃本次任务。')
        return
      }
      pendingApprovals.delete(chatId)
      const grant = approved
      const responses: ChatApprovalResponse[] = pending.approvalIds.map((approvalId) => ({
        approvalId,
        approved: grant
      }))
      await resumeApprovals(
        channelId,
        thread,
        responses,
        grant ? '已批准,继续执行。' : cancelled ? '已取消本次任务。' : '已拒绝该操作。'
      )
      return
    }

    const pendingQuestion = pendingQuestions.get(chatId)
    if (pendingQuestion) {
      await handleQuestionReply(channelId, thread, pendingQuestion, text)
      return
    }

    if (!text.trim()) {
      // Nothing actionable (e.g. a bare image/sticker). Don't start an empty run.
      return
    }
    if (runs.has(chatId) || finalizing.has(chatId) || deps.agent.isRunning(chatId)) {
      await safePost(thread, '正在处理上一条消息,请等待完成后再发送。')
      return
    }
    // Fresh request: ensure a conversation row exists (so messages/approvals persist and tools
    // run against the bridge workspace), fix permission posture, then submit.
    deps.agent.ensureConversation(chatId)
    ensureMode(channelId, chatId)
    const run = startRun(channelId, chatId, thread)
    try {
      await deps.agent.submitMessage(chatId, messageToUIMessage(text))
      if (runs.get(chatId) === run && !deps.agent.isRunning(chatId) && !finalizing.has(chatId)) {
        await finalizeRun(chatId)
      }
    } catch (error) {
      deleteRun(chatId)
      threads.delete(chatId)
      const msg = error instanceof Error ? error.message : String(error)
      emitLog(channelId, 'error', `submitMessage failed for ${chatId}: ${msg}`)
      await safePost(thread, `处理消息时出错: ${msg}`)
    }
  }

  async function resumeApprovals(
    channelId: ChannelId,
    thread: Thread,
    responses: ChatApprovalResponse[],
    acknowledgement: string,
    promptForRemaining = true
  ): Promise<void> {
    const chatId = thread.id
    const run = startRun(channelId, chatId, thread)
    await enqueuePost(run, acknowledgement)
    if (run.channelId === 'qq') run.streamedSegments += 1
    try {
      const result = await deps.agent.respondApprovals(chatId, responses)
      if (!result.started)
        await handleApprovalContinuationNotStarted(channelId, thread, promptForRemaining)
      else if (runs.get(chatId) === run && !deps.agent.isRunning(chatId)) {
        await finalizeRun(chatId)
      }
    } catch (error) {
      deleteRun(chatId)
      if (promptForRemaining) {
        pendingApprovals.set(chatId, {
          chatId,
          approvalIds: responses.map((response) => response.approvalId),
          requestedAt: Date.now()
        })
      }
      const msg = error instanceof Error ? error.message : String(error)
      emitLog(channelId, 'error', `respondApprovals failed for ${chatId}: ${msg}`)
      await safePost(thread, `处理审批回复时出错: ${msg}`)
    }
  }

  async function handleApprovalContinuationNotStarted(
    channelId: ChannelId,
    thread: Thread,
    promptForRemaining: boolean
  ): Promise<void> {
    const chatId = thread.id
    deleteRun(chatId)
    let approvalIds: string[] = []
    try {
      approvalIds = collectPendingApprovalIds(await deps.agent.loadMessages(chatId))
    } catch (error) {
      logger.warn('failed to load messages after approval response', { chatId, error })
    }
    if (approvalIds.length > 0) {
      if (promptForRemaining) {
        pendingApprovals.set(chatId, { chatId, approvalIds, requestedAt: Date.now() })
        await safePost(
          thread,
          `还有 ${approvalIds.length} 个操作需要确认。回复「批准」继续,「拒绝」取消,或「取消」放弃本次任务。`
        )
      } else {
        emitLog(
          channelId,
          'warn',
          `approval continuation still has ${approvalIds.length} pending approvals`
        )
        await safePost(thread, '仍有操作需要确认,但当前渠道设置为不在聊天中审批,已停止继续执行。')
      }
    } else {
      emitLog(channelId, 'warn', `approval response did not start continuation for ${chatId}`)
      await safePost(thread, '审批已处理,但没有启动后续执行。')
    }
  }

  async function handleQuestionReply(
    channelId: ChannelId,
    thread: Thread,
    pending: PendingBridgeQuestion,
    text: string
  ): Promise<void> {
    const chatId = thread.id
    const parsed = parseQuestionReply(pending.input, text)
    if ('error' in parsed) {
      await safePost(thread, parsed.error)
      return
    }

    const run = runs.get(chatId) ?? startRun(channelId, chatId, thread)
    await enqueuePost(
      run,
      parsed.reply.declined ? '已取消选择,继续执行。' : '已收到选择,继续执行。'
    )
    if (run.channelId === 'qq') run.streamedSegments += 1
    try {
      await deps.agent.answerQuestion(chatId, pending.questionId, parsed.reply)
      pendingQuestions.delete(chatId)
      if (runs.get(chatId) === run && !deps.agent.isRunning(chatId) && !finalizing.has(chatId)) {
        await finalizeRun(chatId)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      emitLog(channelId, 'error', `answerQuestion failed for ${chatId}: ${msg}`)
      await safePost(thread, `处理选择回复时出错: ${msg}`)
    }
  }

  function postRunNotice(run: RunAccumulator, text: string, countsAsOutput = true): void {
    if (run.channelId === 'qq') {
      if (run.streamedSegments >= QQ_MAX_REPLY_SEGMENTS) return
      run.streamedSegments += 1
    }
    if (countsAsOutput) run.agentOutputPosted = true
    void enqueuePost(run, text)
  }

  function surfaceQuestion(chatId: string, questionId: string, input: AskQuestionInput): void {
    const run = runs.get(chatId)
    if (!run) return
    const current = pendingQuestions.get(chatId)
    if (current?.questionId === questionId) return
    pendingQuestions.set(chatId, { chatId, questionId, input, requestedAt: Date.now() })
    postRunNotice(run, formatQuestionPrompt(input), false)
  }

  function formatQuestionPrompt(input: AskQuestionInput): string {
    const blocks = input.questions.map((question, index) => {
      const type = question.type ?? 'single_select'
      const optionLines = question.options.map((option, optionIndex) => {
        const desc = option.description ? ` - ${option.description}` : ''
        return `${optionIndex + 1}. ${option.label}${desc}`
      })
      const prefix = input.questions.length > 1 ? `${index + 1}. ${question.id}: ` : ''
      const mode =
        type === 'multi_select'
          ? '可多选,用逗号分隔编号。'
          : type === 'rank_priorities'
            ? '请按优先级回复全部编号,用逗号分隔。'
            : '回复一个编号。'
      return `${prefix}${question.title}\n${question.prompt}\n${optionLines.join('\n')}\n${mode}`
    })
    const suffix =
      input.questions.length > 1
        ? '多问题请逐行回复: question_id: 编号。例如 color: 1'
        : '也可以回复「取消」跳过本次选择。'
    return `需要你选择后才能继续:\n\n${blocks.join('\n\n')}\n\n${suffix}`
  }

  function readTextData(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null
    const text = (value as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text : null
  }

  function normalizeAskQuestionInput(value: unknown): AskQuestionInput | null {
    if (!value || typeof value !== 'object') return null
    const questions = (value as { questions?: unknown }).questions
    if (!Array.isArray(questions) || questions.length === 0) return null
    for (const question of questions) {
      if (!question || typeof question !== 'object') return null
      const q = question as { id?: unknown; title?: unknown; prompt?: unknown; options?: unknown }
      if (typeof q.id !== 'string' || typeof q.title !== 'string' || typeof q.prompt !== 'string') {
        return null
      }
      if (!Array.isArray(q.options) || q.options.length < 2) return null
    }
    return value as AskQuestionInput
  }

  function parseQuestionReply(
    input: AskQuestionInput,
    text: string
  ): { reply: QuestionReply } | { error: string } {
    const trimmed = text.trim()
    if (!trimmed) return { error: '请回复选项编号,或回复「取消」。' }
    if (CANCEL_WORDS.has(trimmed.toLowerCase())) {
      return { reply: { declined: true, note: 'User cancelled from chat.' } }
    }

    const valuesByQuestion = new Map<string, string>()
    if (input.questions.length === 1) {
      valuesByQuestion.set(input.questions[0].id, trimmed)
    } else {
      for (const line of trimmed
        .split(/\r?\n|;/u)
        .map((part) => part.trim())
        .filter(Boolean)) {
        const match = /^([a-z][a-z0-9_]*):\s*(.+)$/u.exec(line)
        if (!match) {
          return { error: '多问题请逐行回复: question_id: 编号。例如 color: 1' }
        }
        valuesByQuestion.set(match[1], match[2])
      }
    }

    const answers: AskQuestionAnswer[] = []
    for (const question of input.questions) {
      const raw = valuesByQuestion.get(question.id)
      if (!raw) return { error: `缺少问题 ${question.id} 的答案。` }
      const parsed = parseSingleQuestionAnswer(question, raw)
      if ('error' in parsed) return parsed
      answers.push(parsed.answer)
    }
    return { reply: { answers } }
  }

  function parseSingleQuestionAnswer(
    question: AskQuestionInput['questions'][number],
    raw: string
  ): { answer: AskQuestionAnswer } | { error: string } {
    const type = question.type ?? 'single_select'
    const tokens = raw
      .split(/[\s,，、]+/u)
      .map((token) => token.trim())
      .filter(Boolean)
    const selected = tokens.map((token) => {
      const index = Number(token)
      if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
        return question.options[index - 1]
      }
      return question.options.find((option) => option.value === token || option.label === token)
    })

    if (selected.some((option) => !option)) {
      if (question.allowCustom) {
        return {
          answer: { id: question.id, type, values: [raw], labels: [raw], custom: true }
        }
      }
      return { error: `问题 ${question.id} 的选项无效。请回复编号。` }
    }

    const options = selected as Array<NonNullable<(typeof selected)[number]>>
    if (type === 'single_select' && options.length !== 1) {
      return { error: `问题 ${question.id} 只能选择一个选项。` }
    }
    if (type === 'rank_priorities' && options.length !== question.options.length) {
      return { error: `问题 ${question.id} 需要按顺序回复全部选项编号。` }
    }
    if (new Set(options.map((option) => option.value)).size !== options.length) {
      return { error: `问题 ${question.id} 不能重复选择同一选项。` }
    }

    return {
      answer: {
        id: question.id,
        type,
        values: options.map((option) => option.value),
        labels: options.map((option) => option.label),
        custom: false
      }
    }
  }

  function startRun(channelId: ChannelId, chatId: string, thread: Thread): RunAccumulator {
    deleteRun(chatId)
    const run: RunAccumulator = {
      chatId,
      channelId,
      thread,
      buffer: '',
      posted: false,
      agentOutputPosted: false,
      streamedSegments: 0,
      postQueue: Promise.resolve()
    }
    runs.set(chatId, run)
    return run
  }

  function clearRunTimer(run: RunAccumulator): void {
    if (!run.flushTimer) return
    clearTimeout(run.flushTimer)
    run.flushTimer = undefined
  }

  function deleteRun(chatId: string): void {
    const run = runs.get(chatId)
    if (run) clearRunTimer(run)
    runs.delete(chatId)
  }

  function enqueuePost(run: RunAccumulator, text: string): Promise<void> {
    run.posted = true
    const next = run.postQueue.then(() => safePost(run.thread, text))
    run.postQueue = next
    return next
  }

  function takeFinalSegment(run: RunAccumulator): string {
    if (run.channelId !== 'qq') {
      const finalText = run.buffer.trim()
      run.buffer = ''
      return finalText
    }
    if (run.streamedSegments >= QQ_MAX_REPLY_SEGMENTS) {
      emitLog(run.channelId, 'warn', `QQ reply segment budget exhausted for ${run.chatId}`)
      run.buffer = ''
      return ''
    }
    const segment = takeRunSegment(run, SEGMENT_FLUSH_CHARS)
    if (segment) run.streamedSegments += 1
    if (run.buffer.trim()) {
      run.buffer = ''
      return `${segment}\n\n（回复过长,剩余内容未发送。）`
    }
    return segment
  }

  function takeRunSegment(run: RunAccumulator, maxChars: number): string {
    const raw = run.buffer
    if (!raw.trim()) {
      run.buffer = ''
      return ''
    }

    let end = Math.min(raw.length, maxChars)
    if (raw.length > maxChars) {
      const breakAt = Math.max(
        raw.lastIndexOf('\n', maxChars),
        raw.lastIndexOf('。', maxChars),
        raw.lastIndexOf('！', maxChars),
        raw.lastIndexOf('？', maxChars),
        raw.lastIndexOf('.', maxChars),
        raw.lastIndexOf('!', maxChars),
        raw.lastIndexOf('?', maxChars),
        raw.lastIndexOf(' ', maxChars)
      )
      if (breakAt >= Math.floor(maxChars * 0.35)) end = breakAt + 1
    }

    const segment = raw.slice(0, end).trim()
    run.buffer = raw.slice(end)
    return segment
  }

  function scheduleQqStreamFlush(chatId: string): void {
    const run = runs.get(chatId)
    if (!run || run.channelId !== 'qq') return
    if (run.flushTimer || run.streamedSegments >= QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS) return

    run.flushTimer = setTimeout(() => {
      const current = runs.get(chatId)
      if (!current) return
      current.flushTimer = undefined
      if (current.buffer.trim().length < QQ_STREAM_MIN_CHARS) return
      if (current.streamedSegments >= QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS) return
      void flushRunSegment(chatId, QQ_STREAM_SEGMENT_CHARS)
    }, QQ_STREAM_FLUSH_INTERVAL_MS)
  }

  async function flushRunSegment(chatId: string, maxChars = SEGMENT_FLUSH_CHARS): Promise<void> {
    const run = runs.get(chatId)
    if (!run) return
    clearRunTimer(run)

    const segment = takeRunSegment(run, maxChars)
    if (!segment) return
    run.agentOutputPosted = true
    if (run.channelId === 'qq') run.streamedSegments += 1
    await enqueuePost(run, segment)

    if (
      runs.get(chatId) === run &&
      run.channelId === 'qq' &&
      run.buffer.trim() &&
      run.streamedSegments < QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS
    ) {
      scheduleQqStreamFlush(chatId)
    }
  }

  async function safeSubscribe(channelId: ChannelId, thread: Thread): Promise<void> {
    try {
      await thread.subscribe()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      emitLog(channelId, 'warn', `failed to subscribe ${thread.id}: ${msg}`)
      logger.warn('failed to subscribe thread', { threadId: thread.id, error })
    }
  }

  async function safePost(thread: Thread, text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      await thread.post(trimmed)
    } catch (error) {
      const channelId = channelOfChatId(thread.id)
      if (channelId) {
        const msg = error instanceof Error ? error.message : String(error)
        emitLog(channelId, 'error', `failed to post reply to ${thread.id}: ${msg}`)
      }
      logger.warn('failed to post reply', { threadId: thread.id, error })
    }
  }

  /**
   * Observe an agent chunk. Accumulate assistant text; on a terminal chunk, post the reply,
   * then check whether the run paused awaiting approval and, if so, surface it into chat.
   */
  function observeChunk(chatId: string, chunk: BridgeObservedChunk): void {
    const run = runs.get(chatId)
    if (!run) return

    if (chunk.type === 'data-steering') {
      const text = readTextData(chunk.data)
      if (text) postRunNotice(run, text)
      return
    }

    if (chunk.type === 'tool-input-available' && chunk.toolName === 'askQuestion') {
      const input = normalizeAskQuestionInput(chunk.input)
      if (input && typeof chunk.toolCallId === 'string') {
        surfaceQuestion(chatId, chunk.toolCallId, input)
      }
      return
    }

    if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
      run.buffer += chunk.delta
      if (run.channelId === 'qq') {
        if (
          run.buffer.length >= SEGMENT_FLUSH_CHARS &&
          run.streamedSegments < QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS
        ) {
          void flushRunSegment(chatId, QQ_STREAM_SEGMENT_CHARS)
        } else {
          scheduleQqStreamFlush(chatId)
        }
        return
      }
      if (run.buffer.length >= SEGMENT_FLUSH_CHARS) {
        void flushRunSegment(chatId)
      }
      return
    }

    // 'finish' is the normal end; 'error'/'abort' can end a run without a 'finish', so we
    // handle them too or buffered text leaks and the run entry is never cleared.
    if (chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort') {
      void finalizeRun(chatId, chunk.type === 'error' || chunk.type === 'abort')
    }
  }

  async function finalizeRun(chatId: string, errored = false): Promise<void> {
    const run = runs.get(chatId)
    if (!run) return
    // Claim the run immediately so a second terminal chunk can't double-finalize.
    clearRunTimer(run)
    runs.delete(chatId)
    finalizing.add(chatId)

    const finalSegment = takeFinalSegment(run)
    if (finalSegment) {
      run.agentOutputPosted = true
      await enqueuePost(run, finalSegment)
    }
    if (errored) {
      await enqueuePost(run, '（本次运行出错或被中断。）')
      pendingQuestions.delete(chatId)
      threads.delete(chatId)
      finalizing.delete(chatId)
      return
    }

    let messages: TanzoUIMessage[] = []
    try {
      messages = await deps.agent.loadMessages(chatId)
    } catch (error) {
      logger.warn('failed to load messages for approval check', { chatId, error })
    }

    const channelId = channelOfChatId(chatId)
    const surface = channelId ? (configs.get(channelId)?.surfaceApprovals ?? false) : false

    if (hasPendingApprovalRequest(messages)) {
      const approvalIds = collectPendingApprovalIds(messages)
      if (approvalIds.length > 0 && surface) {
        pendingApprovals.set(chatId, { chatId, approvalIds, requestedAt: Date.now() })
        await enqueuePost(
          run,
          '⚠️ 该操作需要确认。回复「批准」以执行,「拒绝」取消该操作,或「取消」放弃本次任务。'
        )
        finalizing.delete(chatId)
        return
      }
      if (approvalIds.length > 0) {
        // Approvals not surfaced -> deny by default, but still track the continuation.
        await resumeApprovals(
          run.channelId,
          run.thread,
          approvalIds.map((approvalId) => ({ approvalId, approved: false })),
          '（需要确认的操作已被自动拒绝。）',
          false
        )
        finalizing.delete(chatId)
        return
      }
    }

    if (!run.agentOutputPosted) {
      logger.info('run finished with no textual output', { chatId })
      const canPostFallback = run.channelId !== 'qq' || run.streamedSegments < QQ_MAX_REPLY_SEGMENTS
      if (run.posted && canPostFallback)
        await enqueuePost(run, '（后续执行完成,但没有返回文本输出。）')
    }
    // Conversation is idle; drop the thread ref so activeConversations reflects reality.
    pendingQuestions.delete(chatId)
    threads.delete(chatId)
    finalizing.delete(chatId)
  }

  // -------------------------------------------------------------------------
  // Adapter registry: one builder per channel. Returns a Chat SDK adapter.
  // -------------------------------------------------------------------------

  function buildAdapter(
    modules: ChatModules,
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): unknown {
    switch (channelId) {
      case 'qq': {
        const s = config.settings as import('@shared/chat-bridge').QQChannelSettings
        return modules.createQQBotAdapter({
          appId: s.appId,
          appSecret: secret,
          sandbox: s.sandbox,
          mode: s.mode,
          userName: config.botUserName
        })
      }
      case 'discord': {
        const s = config.settings as import('@shared/chat-bridge').DiscordChannelSettings
        return modules.createDiscordAdapter({
          applicationId: s.applicationId,
          botToken: secret,
          publicKey: s.publicKey,
          userName: config.botUserName,
          ...(s.mentionRoleIds.length ? { mentionRoleIds: s.mentionRoleIds } : {})
        })
      }
      case 'lark': {
        const s = config.settings as import('@shared/chat-bridge').LarkChannelSettings
        return modules.createLarkAdapter({
          appId: s.appId,
          appSecret: secret,
          ...(s.encryptKey ? { encryptKey: s.encryptKey } : {}),
          domain: s.domain,
          userName: config.botUserName,
          incoming: { events: s.mode, callbacks: s.mode }
        })
      }
      case 'wechat': {
        const s = config.settings as import('@shared/chat-bridge').WeChatChannelSettings
        return modules.createWeChatBotAdapter({
          appId: s.appId,
          token: s.token,
          aesKey: secret,
          env: s.env
        })
      }
    }
  }

  async function buildBot(
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): Promise<Chat> {
    const modules = await loadChatModules()
    const adapter = buildAdapter(modules, channelId, config, secret)
    const chatConfig: ChatConfig = {
      userName: config.botUserName,
      adapters: { [channelId]: adapter } as ChatConfig['adapters'],
      state: modules.createMemoryState()
    }
    const instance = new modules.Chat(chatConfig)

    instance.onDirectMessage(async (thread: Thread, message: Message) => {
      await handleInbound(channelId, thread, message)
    })
    instance.onNewMention(async (thread: Thread, message: Message) => {
      await handleInbound(channelId, thread, message)
    })
    instance.onSubscribedMessage(async (thread: Thread, message: Message) => {
      await handleInbound(channelId, thread, message)
    })

    return instance
  }

  async function connect(
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): Promise<ChannelStatus> {
    await disconnect(channelId)
    configs.set(channelId, config)
    const c = rt(channelId)
    if (!config.enabled) {
      c.state = 'disabled'
      emitStatus(channelId)
      return channelStatus(channelId)
    }
    c.state = 'connecting'
    c.lastError = undefined
    emitStatus(channelId)
    try {
      c.bot = await buildBot(channelId, config, secret)
      await c.bot.initialize()
      c.botId = resolveBotId(c.bot, channelId)
      c.state = 'connected'
      emitLog(channelId, 'info', `${channelId} channel connected${c.botId ? ` as ${c.botId}` : ''}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      c.state = 'error'
      c.lastError = msg
      emitLog(channelId, 'error', `${channelId} channel failed to connect: ${msg}`)
      await teardownBot(channelId)
    }
    emitStatus(channelId)
    return channelStatus(channelId)
  }

  async function disconnect(channelId: ChannelId): Promise<ChannelStatus> {
    await teardownBot(channelId)
    const c = rt(channelId)
    c.state = 'disabled'
    c.botId = undefined
    // Drop this channel's conversations from the global maps.
    for (const chatId of activeChatIdsFor(channelId)) {
      threads.delete(chatId)
      modeApplied.delete(chatId)
      deleteRun(chatId)
      finalizing.delete(chatId)
      pendingApprovals.delete(chatId)
      pendingQuestions.delete(chatId)
    }
    emitStatus(channelId)
    return channelStatus(channelId)
  }

  async function teardownBot(channelId: ChannelId): Promise<void> {
    const c = rt(channelId)
    if (!c.bot) return
    try {
      await c.bot.shutdown()
    } catch (error) {
      logger.warn('error during bot shutdown', { channelId, error })
    }
    c.bot = null
  }

  async function shutdownAll(): Promise<void> {
    for (const id of CHANNEL_IDS) await teardownBot(id)
    threads.clear()
    modeApplied.clear()
    for (const chatId of [...runs.keys()]) deleteRun(chatId)
    finalizing.clear()
    pendingApprovals.clear()
    pendingQuestions.clear()
  }

  async function testConnection(
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): Promise<{ ok: boolean; botId?: string; message?: string }> {
    let probe: Chat | null = null
    try {
      probe = await buildBot(channelId, { ...config, enabled: true }, secret)
      await probe.initialize()
      const id = resolveBotId(probe, channelId)
      return { ok: true, botId: id }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally {
      if (probe) {
        try {
          await probe.shutdown()
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    connect,
    disconnect,
    status,
    channelStatus,
    updateConfig,
    observeChunk,
    testConnection,
    shutdownAll
  }
}

/**
 * Pure allowlist check (exported for testing). Default posture is deny-all: an empty allowlist
 * denies everything. Private conversations are bound to the AUTHENTICATED sender, never to the
 * thread-id-encoded peer alone, so a wrong sender can't drive an allow-listed private thread.
 *
 * Thread-id shapes per adapter (the parts we depend on):
 *   QQ:       qq:group:{gid} | qq:channel:{cid} | qq:c2c:{openid} | qq:guild-dm:{gid}
 *   Discord:  discord:{guildId}:{channelId}[:{threadId}], with DMs using guildId "@me"
 *   Lark:     lark:{base64url(chatId)}[:{base64url(threadId)}]
 *   WeChat:   wechat:dm:{openid}[:{contextToken}] | wechat:group:{gid}[:{contextToken}]
 * An unrecognised thread id denies (safe).
 */
export function isThreadAllowed(
  channelId: ChannelId,
  threadId: string,
  authorUserId: string,
  allowlist: { groups: string[]; users: string[] }
): boolean {
  const { groups, users } = allowlist

  let groupId: string | null = null
  let peerUserId: string | null = null
  let eitherGroupOrUser: string | null = null

  if (channelId === 'qq') {
    const m = /^qq:(group|channel|c2c|guild-dm):(.+)$/.exec(threadId)
    if (!m) return false
    const kind = m[1]
    if (kind === 'group' || kind === 'channel') groupId = m[2]
    else if (kind === 'c2c') peerUserId = m[2]
    else peerUserId = '' // guild-dm: rely on author only
  } else if (channelId === 'discord') {
    const m = /^discord:([^:]+):([^:]+)(?::[^:]+)?$/.exec(threadId)
    if (!m) return false
    if (m[1] === '@me')
      peerUserId = '' // DM channel id does not encode the peer user.
    else groupId = m[1] // guild id
  } else if (channelId === 'lark') {
    const m = /^lark:([^:]+)(?::[^:]+)?$/.exec(threadId)
    if (!m) return false
    const chatId = decodeBase64UrlPart(m[1])
    if (!chatId) return false
    eitherGroupOrUser = chatId
  } else {
    const m = /^wechat:(dm|group):([^:]+)(?::[^:]+)?$/.exec(threadId)
    if (!m) return false
    if (m[1] === 'group') groupId = m[2]
    else peerUserId = m[2]
  }

  if (eitherGroupOrUser !== null) {
    if (groups.includes(eitherGroupOrUser)) {
      return users.length === 0 || users.includes(authorUserId)
    }
    return users.includes(authorUserId)
  }
  if (groupId !== null) {
    if (!groups.includes(groupId)) return false
    if (users.length > 0 && !users.includes(authorUserId)) return false
    return true
  }
  // Private: require the authenticated sender to be allow-listed.
  if (!users.includes(authorUserId)) return false
  return peerUserId === '' || authorUserId === peerUserId || (peerUserId?.length ?? 0) === 0
}

function decodeBase64UrlPart(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padding = (4 - (normalized.length % 4)) % 4
    const decoded = Buffer.from(
      normalized.padEnd(normalized.length + padding, '='),
      'base64'
    ).toString('utf8')
    if (!decoded) return null
    return encodeBase64UrlPart(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

function encodeBase64UrlPart(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')
}

/** Collect approval ids in state 'approval-requested' across assistant messages. */
function collectPendingApprovalIds(messages: TanzoUIMessage[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      const p = part as { state?: string; approval?: { id?: string } }
      if (p.state === 'approval-requested' && typeof p.approval?.id === 'string') {
        ids.push(p.approval.id)
      }
    }
  }
  return ids
}

/** Best-effort read of the bot's own id from the channel's adapter, if exposed. */
function resolveBotId(bot: Chat, channelId: ChannelId): string | undefined {
  try {
    const adapter = (bot as unknown as { getAdapter?: (name: string) => unknown }).getAdapter?.(
      channelId
    )
    const a = adapter as { botUserId?: unknown; botId?: unknown } | undefined
    const id = a?.botUserId ?? a?.botId
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

// Re-export so the service/module can reference the default without a second import.
export { DEFAULT_CHAT_BRIDGE_CONFIG }
