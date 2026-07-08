import { Buffer } from 'node:buffer'
import { randomUUID } from 'crypto'
import type { Chat, ChatConfig, Message, Thread } from 'chat'
import type { AskQuestionAnswer, AskQuestionInput, TanzoUIMessage } from '@shared/agent-message'
import type { ChatApprovalResponse, CompactionOutcome, QuestionReply } from '@shared/chat'
import { hasPendingApprovalRequest } from '@shared/approval-responses'
import type { PermissionMode } from '@shared/policy'
import { resolveSlashInvocation, type SlashCommandDef } from '@shared/slash-command'
import { GOAL_COMMAND_KEYS, type GoalCommandResult } from '@shared/goal'
import {
  CHANNEL_IDS,
  DEFAULT_CHAT_BRIDGE_CONFIG,
  type ChannelId,
  type ChannelConfig,
  type ChannelConnectionState,
  type ChannelStatus,
  type ChannelPermissionMode,
  type ChatBridgeStatus,
  type ChatBridgeEvent,
  type ChannelWorkspaceSwitch,
  type ChannelWorkspaceView
} from '@shared/chat-bridge'
import { createLogger } from '../logger'

export interface BridgeAgentPort {
  ensureConversation(chatId: string): void
  submitMessage(chatId: string, message: TanzoUIMessage): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  answerQuestion(chatId: string, questionId: string, reply: QuestionReply): Promise<void>
  isRunning(chatId: string): boolean

  loadMessages(chatId: string): Promise<TanzoUIMessage[]>
  setPermissionMode(chatId: string, mode: PermissionMode): void

  /** Slash commands available on the channel surface for this conversation. */
  listChannelCommands(chatId: string): SlashCommandDef[]
  /** Compact the conversation context; resolves to a short status string. */
  compact(chatId: string): Promise<CompactionOutcome>
  /** Execute a `/goal` command; resolves to a result describing the outcome. */
  goalCommand(chatId: string, args: string): GoalCommandResult
  /** A one-line status summary (goal + run state) for `/status`. */
  status(chatId: string): string
  /** Cancel the in-progress run, if any. */
  cancel(chatId: string): void
  /** Clear all messages of the conversation, keeping the conversation itself. */
  clearConversation(chatId: string): void
  /** Rename the conversation. Returns the new title, or undefined if it does not exist. */
  renameConversation(chatId: string, title: string): string | undefined
  /** Workspaces available for switching, plus the conversation's current one. */
  listChannelWorkspaces(chatId: string): ChannelWorkspaceView
  /** Switch the conversation to an existing workspace by index or name. */
  setChannelWorkspace(chatId: string, selector: string): ChannelWorkspaceSwitch
}

export interface ChatBridgeRuntimeDeps {
  agent: BridgeAgentPort

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

const SEGMENT_FLUSH_CHARS = 1600

const QQ_STREAM_FLUSH_INTERVAL_MS = 900
const QQ_STREAM_MIN_CHARS = 80
const QQ_STREAM_SEGMENT_CHARS = 600
const QQ_MAX_REPLY_SEGMENTS = 5
const QQ_STREAM_MAX_INTERMEDIATE_SEGMENTS = QQ_MAX_REPLY_SEGMENTS - 1

const APPROVE_WORDS = new Set(['批准', '同意', 'approve', 'yes', 'y', 'ok'])
const DENY_WORDS = new Set(['拒绝', '否', 'deny', 'no', 'n'])
const CANCEL_WORDS = new Set(['取消', 'cancel', '算了'])

function compactionOutcomeText(outcome: CompactionOutcome): string {
  switch (outcome) {
    case 'compacted':
      return '已压缩会话上下文。'
    case 'not-needed':
      return '当前上下文无需压缩。'
    case 'aborted':
      return '压缩已中止。'
    case 'stale':
      return '上下文已变化,压缩未执行。'
  }
}

function goalCommandText(result: GoalCommandResult): string {
  switch (result.key) {
    case GOAL_COMMAND_KEYS.current:
      return `当前目标:${result.objective ?? ''}(${result.status ?? ''})`
    case GOAL_COMMAND_KEYS.none:
      return '当前没有活动目标。'
    case GOAL_COMMAND_KEYS.cleared:
      return '目标已清除。'
    case GOAL_COMMAND_KEYS.paused:
      return '目标已暂停。'
    case GOAL_COMMAND_KEYS.resumed:
      return '目标已恢复。'
    case GOAL_COMMAND_KEYS.objectiveUpdated:
      return '目标内容已更新。'
    case GOAL_COMMAND_KEYS.set:
      return '目标已设定。'
  }
}

function workspaceListText(view: ChannelWorkspaceView): string {
  if (view.workspaces.length === 0) {
    return '暂无可切换的工作区。请先在桌面端创建工作区。'
  }
  const lines = view.workspaces.map((ws, index) => {
    const marker = ws.isCurrent ? '(当前)' : ''
    return `  ${index + 1}. ${ws.name}${marker}`
  })
  return [
    view.currentName ? `当前工作区:${view.currentName}` : '当前工作区:默认',
    '可切换:',
    ...lines,
    '发送 /workspace <序号或名称> 切换。'
  ].join('\n')
}

function workspaceSwitchText(result: ChannelWorkspaceSwitch): string {
  if (result.ok) return `已切换到工作区「${result.name}」。后续消息将在该目录下执行。`
  switch (result.reason) {
    case 'no_conversation':
      return '当前对话尚不存在,无法切换工作区。'
    case 'already_current':
      return '已经在该工作区,无需切换。'
    case 'not_found':
    default:
      return '未找到该工作区。发送 /workspace 查看可切换的工作区。'
  }
}

// Channel-side descriptions for builtin commands (bridge has no i18next; the
// desktop menu resolves descriptionKey instead). File/skill commands carry a
// plain `description` and are read directly.
const CHANNEL_BUILTIN_DESCRIPTIONS: Record<string, string> = {
  help: '查看可用命令',
  status: '查看目标与运行状态',
  stop: '停止正在执行的任务',
  approve: '批准待确认的操作',
  deny: '拒绝待确认的操作',
  clear: '清空当前对话的历史记录',
  rename: '重命名当前对话',
  workspace: '查看或切换当前工作区',
  compact: '压缩当前对话的上下文',
  goal: '设定、查看或清除自主目标'
}

function channelCommandDescription(command: SlashCommandDef): string {
  return command.description || CHANNEL_BUILTIN_DESCRIPTIONS[command.name] || ''
}

function helpText(commands: SlashCommandDef[]): string {
  if (commands.length === 0) return '当前没有可用的命令。'
  const lines = commands.map((command) => {
    const desc = channelCommandDescription(command)
    return desc ? `  /${command.name} — ${desc}` : `  /${command.name}`
  })
  return ['可用命令:', ...lines].join('\n')
}

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
  return mode
}

function channelOfChatId(chatId: string): ChannelId | undefined {
  const prefix = chatId.split(':', 1)[0]
  return (CHANNEL_IDS as readonly string[]).includes(prefix) ? (prefix as ChannelId) : undefined
}

export interface ChatBridgeRuntime {
  connect(channelId: ChannelId, config: ChannelConfig, secret: string): Promise<ChannelStatus>
  disconnect(channelId: ChannelId): Promise<ChannelStatus>
  status(): ChatBridgeStatus
  channelStatus(channelId: ChannelId): ChannelStatus

  updateConfig(channelId: ChannelId, config: ChannelConfig): void

  observeChunk(chatId: string, chunk: BridgeObservedChunk): void
  testConnection(
    channelId: ChannelId,
    config: ChannelConfig,
    secret: string
  ): Promise<{ ok: boolean; botId?: string; message?: string }>

  shutdownAll(): Promise<void>
}

export function createChatBridgeRuntime(deps: ChatBridgeRuntimeDeps): ChatBridgeRuntime {
  const channels = new Map<ChannelId, ChannelRuntime>(
    CHANNEL_IDS.map((id) => [id, { id, bot: null, state: 'disabled' } as ChannelRuntime])
  )

  const configs = new Map<ChannelId, ChannelConfig>()

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

  async function handleInbound(
    channelId: ChannelId,
    thread: Thread,
    message: Message
  ): Promise<void> {
    const chatId = thread.id
    const authorId = message.author?.userId ?? ''

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

    const pending = pendingApprovals.get(chatId)
    if (pending) {
      // Slash forms (/approve, /deny) augment the free-text keyword flow.
      const answer = text
        .trim()
        .toLowerCase()
        .replace(/^\/(approve|deny)$/, '$1')
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
      // Let pure control commands through even while a question is pending;
      // any other reply answers the question as before.
      const control = text.trim().toLowerCase()
      if (control === '/stop' || control === '/status') {
        await handleSlashCommand(channelId, thread, text.trim(), true)
        return
      }
      await handleQuestionReply(channelId, thread, pendingQuestion, text)
      return
    }

    if (!text.trim()) {
      return
    }

    const busy = runs.has(chatId) || finalizing.has(chatId) || deps.agent.isRunning(chatId)

    // Slash commands are dispatched before the busy guard so that control
    // commands (e.g. /stop, /status) work while a run is in progress. Commands
    // that would submit a new run are themselves blocked when busy.
    if (text.trim().startsWith('/')) {
      const consumed = await handleSlashCommand(channelId, thread, text.trim(), busy)
      if (consumed) return
    }

    if (busy) {
      await safePost(thread, '正在处理上一条消息,请等待完成后再发送。')
      return
    }

    await runSubmission(channelId, thread, text)
  }

  async function runSubmission(channelId: ChannelId, thread: Thread, text: string): Promise<void> {
    const chatId = thread.id
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

  /**
   * Interpret a leading-slash message against the channel command catalog.
   * Returns true when the input was consumed (do not fall through to a normal
   * run). Prompt/skill commands are submitted as runs; supported actions run
   * inline; unknown commands are reported instead of sent to the model.
   */
  async function handleSlashCommand(
    channelId: ChannelId,
    thread: Thread,
    text: string,
    busy: boolean
  ): Promise<boolean> {
    const chatId = thread.id
    const commands = deps.agent.listChannelCommands(chatId)
    const invocation = resolveSlashInvocation(text, commands)

    // Commands that submit a new run or mutate the conversation are blocked
    // while a run is in progress; pure controls (/stop, /status) are allowed.
    const wouldSubmit =
      invocation.type === 'prompt' ||
      invocation.type === 'skill' ||
      (invocation.type === 'action' &&
        (invocation.command.name === 'compact' || invocation.command.name === 'goal'))
    if (busy && wouldSubmit) {
      await safePost(thread, '正在处理上一条消息,请等待完成后再发送。')
      return true
    }

    switch (invocation.type) {
      case 'passthrough':
        return false
      case 'unknown':
        await safePost(thread, `未知命令 /${invocation.name}。发送 / 查看可用命令。`)
        return true
      case 'prompt':
      case 'skill':
        await runSubmission(channelId, thread, invocation.text)
        return true
      case 'action': {
        const name = invocation.command.name
        if (name === 'compact') {
          const outcome = await deps.agent.compact(chatId)
          await safePost(thread, compactionOutcomeText(outcome))
          return true
        }
        if (name === 'goal') {
          // Ensure the conversation exists before mutating its goal (FK safety).
          deps.agent.ensureConversation(chatId)
          const result = deps.agent.goalCommand(chatId, invocation.args)
          await safePost(thread, goalCommandText(result))
          return true
        }
        if (name === 'status') {
          await safePost(thread, deps.agent.status(chatId))
          return true
        }
        if (name === 'help') {
          await safePost(thread, helpText(commands))
          return true
        }
        if (name === 'clear') {
          // Ensure the conversation exists before clearing (FK safety on first msg).
          deps.agent.ensureConversation(chatId)
          deps.agent.clearConversation(chatId)
          await safePost(thread, '已清空当前对话的历史记录。')
          return true
        }
        if (name === 'rename') {
          const title = invocation.args.trim()
          if (!title) {
            await safePost(thread, '请提供新的对话标题,例如 /rename 我的项目。')
            return true
          }
          deps.agent.ensureConversation(chatId)
          const next = deps.agent.renameConversation(chatId, title)
          await safePost(
            thread,
            next ? `已将对话标题改为「${next}」。` : '当前对话尚不存在,无法重命名。'
          )
          return true
        }
        if (name === 'workspace') {
          // Ensure the conversation exists so the list reflects its real cwd.
          deps.agent.ensureConversation(chatId)
          const selector = invocation.args.trim()
          if (!selector) {
            await safePost(thread, workspaceListText(deps.agent.listChannelWorkspaces(chatId)))
            return true
          }
          // Switching changes the run cwd; block while a run is in progress.
          if (busy) {
            await safePost(thread, '正在处理上一条消息,请等待完成后再切换工作区。')
            return true
          }
          const result = deps.agent.setChannelWorkspace(chatId, selector)
          await safePost(thread, workspaceSwitchText(result))
          return true
        }
        if (name === 'stop') {
          if (busy) {
            deps.agent.cancel(chatId)
            await safePost(thread, '已停止当前任务。')
          } else {
            await safePost(thread, '当前没有正在执行的任务。')
          }
          return true
        }
        if (name === 'approve' || name === 'deny') {
          // Only reachable with no pending approval (handled earlier otherwise).
          await safePost(thread, '当前没有等待确认的操作。')
          return true
        }
        // Other actions are desktop-only; surface a hint rather than run them.
        await safePost(thread, `命令 /${name} 暂不支持在此渠道使用。`)
        return true
      }
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

    if (chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort') {
      void finalizeRun(chatId, chunk.type === 'error' || chunk.type === 'abort')
    }
  }

  async function finalizeRun(chatId: string, errored = false): Promise<void> {
    const run = runs.get(chatId)
    if (!run) return

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

    pendingQuestions.delete(chatId)
    threads.delete(chatId)
    finalizing.delete(chatId)
  }

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
    else peerUserId = ''
  } else if (channelId === 'discord') {
    const m = /^discord:([^:]+):([^:]+)(?::[^:]+)?$/.exec(threadId)
    if (!m) return false
    if (m[1] === '@me') peerUserId = ''
    else groupId = m[1]
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

export { DEFAULT_CHAT_BRIDGE_CONFIG }
