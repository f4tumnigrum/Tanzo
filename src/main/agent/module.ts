import { app, type BrowserWindow, type IpcMain } from 'electron'
import { join } from 'node:path'
import {
  chatAnyEventChannel,
  chatEventChannel,
  type ChatEvent,
  type ChatNotificationChunk
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { PermissionMode } from '@shared/policy'
import { gitEventChannel, type GitChangedEvent } from '@shared/git'
import { PET_CHANNELS, type PetPresencePayload } from '@shared/pet'
import { BROWSER_CHANNELS } from '@shared/browser-control'
import {
  deriveStatus,
  GOAL_COMMAND_KEYS,
  parseGoalCommand,
  type GoalCommandResult,
  type ThreadGoal,
  type ThreadGoalStatus
} from '@shared/goal'
import type {
  ChannelWorkspaceOption,
  ChannelWorkspaceSwitch,
  ChannelWorkspaceView
} from '@shared/chat-bridge'
import type { SqlDatabase } from '../database/types'
import { createLogger } from '../logger'
import type { McpService } from '../mcp/service'
import type { ProviderService } from '../provider/service'
import { createAgentIdentity } from './agents'
import { createContextEngine } from './context'
import { createContextEngineDeps } from './context/deps'
import { createGitService } from './git/service'
import { createChangeSetService } from './git/change-set-service'
import { createWorkspaceFs } from './fs/workspace-fs'
import { createGoalService } from './goal/service'
import { createGoalStore } from './goal/store'
import { createHookExecutor } from './hooks/executor'
import { createHookService } from './hooks/service'
import { createHooksStore } from './hooks/store'
import { createHooksContextSection } from './hooks/context-section'
import { registerAgentIpc } from './ipc'
import { createPolicyEngine } from './policy/engine'
import { createPolicyStore } from './policy/policy-store'
import { createPresenceAggregator, type PresenceAggregator } from './presence/aggregator'
import { createSearchBackend } from './search/backend'
import { createAgentService } from './service'
import { createQuestionBroker } from './question/broker'
import {
  createChatRunSessionRegistry,
  type ChatRunSessionRegistry
} from './runtime/run-session-registry'
import { createShellRunner } from './shell/runner'
import { createShellSessionService } from './shell/session-service'
import { createSkillsStore } from './skills/store'
import { createPluginsManager, defaultMarketplaceRoots } from './plugins/manager'
import { createPluginMentionTracker } from './plugins/mention-tracker'
import { createPluginStore } from './plugins/store'
import { createPluginStateStore } from './plugins/plugin-state-db'
import { createMarketplaceSourceStore } from './plugins/marketplace-source-db'
import { createMarketplaceInstaller } from './plugins/marketplace-install'
import { createAgentStore } from './store'
import { PASTED_TEXT_DIR } from './runtime/pasted-text'
import { createBuildTools } from './tools/registry'
import type { AgentService, ChunkSink, ChunkSinkMeta } from './runtime/types'
import type { SkillsStore } from './skills/types'
import type { PluginsManager } from './plugins/manager'
import type { ToolDeps } from './tools/types'

export interface AgentModule {
  service: AgentService
  skills: SkillsStore
  plugins: PluginsManager
  presence: PresenceAggregator

  setPermissionMode(chatId: string, mode: PermissionMode): void

  loadConversationMessages(chatId: string): TanzoUIMessage[]

  /** The workspace root of a conversation, if it exists. */
  conversationCwd(chatId: string): string | undefined

  /** Execute a `/goal` command against the goal service. */
  goalCommand(chatId: string, args: string): GoalCommandResult

  /** A one-line status summary (goal state) for a conversation. */
  goalStatusLine(chatId: string): string

  /** Clear all messages of a conversation, keeping the conversation itself. */
  clearConversation(chatId: string): void

  /** Rename a conversation. Returns the new title, or undefined if it does not exist. */
  renameConversation(chatId: string, title: string): string | undefined

  /** Workspaces available for switching, plus the conversation's current workspace id. */
  listChannelWorkspaces(chatId: string): ChannelWorkspaceView

  /**
   * Switch the conversation to an existing workspace, chosen by 1-based index
   * (matching listChannelWorkspaces order) or by case-insensitive name.
   * Only workspaces already known to the app are accepted (strict allowlist).
   */
  setChannelWorkspace(chatId: string, selector: string): ChannelWorkspaceSwitch

  ensureConversation(chatId: string, cwd?: string): void
  registerIpc(ipcMain: IpcMain): void
  close(): Promise<void>
}

export interface AgentModuleOptions {
  db: SqlDatabase
  providerService: ProviderService
  mcpService: McpService
  workspaceRoot: string
  getWindows: () => BrowserWindow[]
  getChatWindows?: () => BrowserWindow[]

  disabledTools?: () => readonly string[]

  browserAutomationEnabled?: () => boolean

  observeChunk?: (chatId: string, chunk: Parameters<ChunkSink>[1], meta?: ChunkSinkMeta) => void
}

interface WebContentsLike {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface BrowserWindowLike {
  isDestroyed(): boolean
  webContents: WebContentsLike
}

interface ServiceRef {
  current?: AgentService
}

const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function isUsableWindow(window: BrowserWindowLike): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed()
}

function isNotificationChunk(chunk: { type?: unknown }): chunk is ChatNotificationChunk {
  return typeof chunk.type === 'string' && chunk.type.startsWith('data-')
}

function runtimeChatIdOf(runtimeContext: unknown): string | undefined {
  if (typeof runtimeContext === 'object' && runtimeContext !== null && 'chatId' in runtimeContext) {
    const chatId = (runtimeContext as { chatId?: unknown }).chatId
    if (typeof chatId === 'string') return chatId
  }
  return undefined
}

function createChatEventDeliverer(getWindows: () => BrowserWindow[]): (event: ChatEvent) => void {
  return (event) => {
    for (const window of getWindows()) {
      if (!isUsableWindow(window)) continue
      window.webContents.send(chatEventChannel(event.chatId), event)
      if (event.kind === 'run-state') {
        window.webContents.send(chatAnyEventChannel(), event)
      }
    }
  }
}

function createChunkSink(
  streams: ChatRunSessionRegistry,
  deliver: (event: ChatEvent) => void,
  logger: Pick<ReturnType<typeof createLogger>, 'warn'>
): ChunkSink {
  return (chatId, chunk, meta?: ChunkSinkMeta) => {
    const published = streams.publish(chatId, chunk, meta)
    if (published.status === 'stale' || published.status === 'accepted') return
    if (!isNotificationChunk(chunk)) {
      logger.warn('dropped untracked non-data chat event', { chatId, type: chunk.type })
      return
    }
    streams.retainNotification(chatId, chunk)
    streams.flush(chatId)
    deliver({ kind: 'notification', chatId, chunk })
  }
}

function goalSnapshot(goal: ThreadGoal): {
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeBudgetSeconds: number | null
  timeUsedSeconds: number
} {
  return {
    objective: goal.objective,
    status: deriveStatus(goal),
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeBudgetSeconds: goal.timeBudgetSeconds,
    timeUsedSeconds: goal.timeUsedSeconds
  }
}

function defaultModelRef(providerService: ProviderService): string {
  for (const setup of providerService.listSetups()) {
    if (setup.connection.status !== 'connected') continue

    const language = setup.modalities.language
    const modelId = language?.defaultModelId ?? language?.enabledModelIds[0]
    if (modelId) return `${setup.providerId}:${modelId}`
  }
  return ''
}

function requireService(ref: ServiceRef): AgentService {
  if (!ref.current) throw new Error('agent service not initialized')
  return ref.current
}

export function createAgentModule(options: AgentModuleOptions): AgentModule {
  const logger = createLogger('agent.module')

  const policyStore = createPolicyStore(options.db)
  const shell = createShellRunner()
  const shellSessions = createShellSessionService()
  const deliverChatEvent = createChatEventDeliverer(options.getChatWindows ?? options.getWindows)
  const streams = createChatRunSessionRegistry({ deliver: deliverChatEvent })
  const rawSend = createChunkSink(streams, deliverChatEvent, logger)
  const serviceRef: ServiceRef = {}

  const presence = createPresenceAggregator({
    isAnyRunning: () => (serviceRef.current?.listRunning().length ?? 0) > 0,
    broadcast: (payload: PetPresencePayload) => {
      for (const window of options.getWindows()) {
        if (!isUsableWindow(window)) continue
        window.webContents.send(PET_CHANNELS.presenceChanged, payload)
      }
    }
  })

  const send: ChunkSink = (chatId, chunk, meta) => {
    if (isNotificationChunk(chunk)) {
      presence.observeChunk(chatId, chunk as ChatNotificationChunk)
    } else if (chunk.type === 'text-delta') {
      presence.observeText(chatId, chunk.delta)
    }
    rawSend(chatId, chunk, meta)
    if (options.observeChunk) {
      try {
        options.observeChunk(chatId, chunk, meta)
      } catch (error) {
        logger.warn('chat chunk observer threw', { chatId, error })
      }
    }
  }

  const sendTo = (channel: string, payload: unknown): void => {
    for (const window of (options.getChatWindows ?? options.getWindows)()) {
      if (!isUsableWindow(window)) continue
      window.webContents.send(channel, payload)
    }
  }

  const pluginStore = createPluginStore(app.getPath('userData'), logger)
  const marketplaceInstaller = options.db
    ? createMarketplaceInstaller({
        installRoot: join(app.getPath('userData'), 'plugins', 'marketplaces'),
        store: createMarketplaceSourceStore(options.db),
        logger
      })
    : null
  const plugins = createPluginsManager({
    store: pluginStore,
    state: options.db ? createPluginStateStore(options.db) : null,
    marketplaceRoots: defaultMarketplaceRoots(options.workspaceRoot),
    installer: marketplaceInstaller,
    logger
  })

  const skills = createSkillsStore({
    workspaceRoot: options.workspaceRoot,
    userDir: join(app.getPath('userData'), 'agent'),
    logger,
    db: options.db,

    pluginSkillRoots: () => plugins.skillRoots(),
    browserAutomationEnabled: () => options.browserAutomationEnabled?.() ?? true
  })

  const identity = createAgentIdentity({
    workspaceRoot: options.workspaceRoot,
    defaultModelRef: () => defaultModelRef(options.providerService),
    logger
  })

  const store = createAgentStore(options.db, identity, logger, options.workspaceRoot)
  const policyEngine = createPolicyEngine({
    policyStore,
    resolveScopeTarget: (chatId) => store.getConversation(store.rootOf(chatId))?.workspaceId
  })

  const hooksStore = createHooksStore(options.db)
  const hooks = createHookService({
    executor: createHookExecutor(),
    store: hooksStore,
    userDir: join(app.getPath('userData'), 'agent'),
    logger,

    pluginSources: () => plugins.hookSources(),
    sessionMeta: (chatId) => {
      const conversation = store.getConversation(chatId)
      if (!conversation) return undefined
      return {
        cwd: conversation.cwd || options.workspaceRoot,
        model: conversation.modelRef || 'unknown',
        mode: policyEngine.getMode(store.rootOf(chatId))
      }
    }
  })

  options.mcpService.setPluginServers(() => plugins.mcpServers())

  plugins.onContributionsChanged(() => {
    try {
      skills.reload()
    } catch (error) {
      logger.warn('skills reload after plugin change failed', error)
    }
    try {
      hooks.reload()
    } catch (error) {
      logger.warn('hooks reload after plugin change failed', error)
    }
    void options.mcpService.syncFromStore().catch((error) => {
      logger.warn('mcp sync after plugin change failed', error)
    })
  })

  const policy: typeof policyEngine = {
    ...policyEngine,
    decide: async (input) => {
      const chatId = runtimeChatIdOf(input.runtimeContext)
      if (chatId) {
        const outcome = await hooks.runPreToolUse({
          chatId,
          toolName: input.toolCall.toolName,
          toolInput: input.toolCall.input,
          toolUseId: `${chatId}:${input.toolCall.toolName}`
        })
        if (outcome.denied) {
          return { type: 'denied', reason: outcome.denyReason ?? 'blocked by hook' }
        }
      }
      return policyEngine.decide(input)
    }
  }
  const sweptRuns = store.sweepInterruptedRuns()
  if (sweptRuns > 0) logger.info('marked interrupted runs as failed', { count: sweptRuns })
  store.pruneActivityHistory(ACTIVITY_RETENTION_MS)
  const goalStore = createGoalStore(options.db)
  const goalService = createGoalService({
    store: goalStore,
    broadcast: (chatId, goal) => {
      if (!chatId) return
      send(chatId, {
        type: 'data-goal',
        id: `goal:${chatId}`,
        data: { goal: goal ? goalSnapshot(goal) : null },
        transient: true
      })
    }
  })

  const gitBroadcast = (event: GitChangedEvent): void => {
    for (const window of options.getWindows()) {
      if (!isUsableWindow(window)) continue
      window.webContents.send(gitEventChannel(), event)
    }
  }
  const git = createGitService({ broadcast: gitBroadcast, logger })
  const changeSet = createChangeSetService({ userDataPath: app.getPath('userData') })
  const questions = createQuestionBroker()

  const browser = {
    requestOpen: (url: string): boolean => {
      const windows = (options.getChatWindows ?? options.getWindows)().filter(isUsableWindow)
      if (windows.length === 0) return false
      for (const window of windows) {
        window.webContents.send(BROWSER_CHANNELS.openRequest, { url })
      }
      return true
    }
  }

  const pluginMentions = createPluginMentionTracker(() =>
    plugins.capabilitySummaries().map((plugin) => plugin.name)
  )

  const contextEngine = createContextEngine({
    ...createContextEngineDeps({
      userDir: join(app.getPath('userData'), 'agent'),
      skills,
      pluginCapabilities: () => plugins.capabilitySummaries(),
      pluginMention: {
        peek: (chatId) => pluginMentions.peek(chatId),
        take: (chatId) => pluginMentions.take(chatId)
      },
      providerService: options.providerService,
      goal: {
        get: (chatId) => goalService.get(chatId),
        peekInjection: (chatId) => goalService.peekInjection(chatId),
        takeInjection: (chatId) => goalService.takeInjection(chatId)
      },
      policyMode: {
        getMode: (chatId) => policy.getMode(store.rootOf(chatId))
      }
    }),
    extraSections: [createHooksContextSection(hooks.pendingContext)]
  })

  function toolDeps(workspaceRoot: string, mode: PermissionMode): ToolDeps {
    const dangerous = mode === 'dangerous'
    const fs = createWorkspaceFs(workspaceRoot, { dangerous })

    fs.registerReadRoot(PASTED_TEXT_DIR)
    return {
      fs,
      shell,
      shellSessions,
      questions,
      search: createSearchBackend(workspaceRoot, { dangerous }),
      mcpService: options.mcpService,
      skills,
      logger,
      store,
      resolveAgentType: identity.resolveAgentType,
      listAgents: identity.listAgents,
      listAgentTypes: identity.listAgentTypes,
      isRunning: (chatId) => serviceRef.current?.isRunning(chatId) ?? false,
      cancelConversation: (chatId) => serviceRef.current?.cancel(chatId),
      submitUserMessage: (chatId, message) =>
        requireService(serviceRef).submitUserMessage(chatId, message),
      rootOf: (chatId) => store.rootOf(chatId),
      spawnTask: (input) => requireService(serviceRef).spawnTask(input),
      awaitTask: (rootChatId, taskId, signal) =>
        requireService(serviceRef).awaitTask(rootChatId, taskId, signal),
      getTask: (rootChatId, taskId) => requireService(serviceRef).getTask(rootChatId, taskId),
      listTasks: (rootChatId, status) => requireService(serviceRef).listTasks(rootChatId, status),
      instructTask: (rootChatId, taskId, instruction) =>
        requireService(serviceRef).instructTask(rootChatId, taskId, instruction),
      redefineTask: (rootChatId, taskId, objective) =>
        requireService(serviceRef).redefineTask(rootChatId, taskId, objective),
      cancelTask: (rootChatId, taskId) => requireService(serviceRef).cancelTask(rootChatId, taskId),
      addTaskNote: (chatId, note) => requireService(serviceRef).addTaskNote(chatId, note),
      waitForNoteTask: (rootChatId, taskId, signal) =>
        requireService(serviceRef).waitForNoteTask(rootChatId, taskId, signal),
      goal: {
        get: (chatId) => goalService.get(chatId),
        markOutcome: (chatId, status, opts) => {
          const result = goalService.markOutcome(chatId, status, opts)
          if (result.kind === 'rejected') {
            return { kind: 'rejected', attempts: result.attempts, required: result.required }
          }
          return { kind: result.kind }
        }
      },
      browser,
      disabledTools: () => options.disabledTools?.() ?? [],
      browserAutomationEnabled: () => options.browserAutomationEnabled?.() ?? true
    }
  }

  const buildTools = async (context: Parameters<ReturnType<typeof createBuildTools>>[0]) => {
    const workspaceRoot = store.getConversation(context.chatId)?.cwd ?? options.workspaceRoot
    return createBuildTools(toolDeps(workspaceRoot, context.mode))(context)
  }

  const service = createAgentService({
    providerService: options.providerService,
    buildTools,
    policy,
    store,
    identity,
    send,
    sendTo,
    skills,
    logger,
    contextEngine,
    goal: goalService,
    streams,
    changeSet,
    questions,
    hooks,
    recordPluginMentions: (chatId, text) => pluginMentions.recordFromText(chatId, text)
  })
  serviceRef.current = service

  let unregisterIpc: (() => void) | undefined

  function listChannelWorkspaces(chatId: string): ChannelWorkspaceView {
    const conversation = store.getConversation(chatId)
    const currentId = conversation?.workspaceId
    const options: ChannelWorkspaceOption[] = store.listWorkspaces().map((ws) => ({
      id: ws.id,
      name: ws.name,
      rootPath: ws.rootPath,
      isCurrent: ws.id === currentId
    }))
    // Include the conversation's current workspace even if the table has not
    // caught up (e.g. a fresh channel thread on the default root).
    if (conversation && currentId && !options.some((o) => o.id === currentId)) {
      options.unshift({
        id: currentId,
        name: conversation.workspaceName || currentId,
        rootPath: conversation.cwd,
        isCurrent: true
      })
    }
    return { workspaces: options, currentName: conversation?.workspaceName || undefined }
  }

  return {
    service,
    skills,
    plugins,
    presence,
    setPermissionMode(chatId, mode) {
      policyEngine.setMode(mode, chatId)
    },
    loadConversationMessages(chatId) {
      return store.loadUnvalidated(chatId)
    },
    conversationCwd(chatId) {
      return store.getConversation(chatId)?.cwd
    },
    goalCommand(chatId, args): GoalCommandResult {
      const intent = parseGoalCommand(args)
      switch (intent.op) {
        case 'show': {
          const current = goalService.get(chatId)
          return current
            ? {
                key: GOAL_COMMAND_KEYS.current,
                objective: current.objective,
                status: deriveStatus(current)
              }
            : { key: GOAL_COMMAND_KEYS.none }
        }
        case 'clear':
          goalService.clear(chatId)
          return { key: GOAL_COMMAND_KEYS.cleared }
        case 'pause':
          goalService.setUserState(chatId, 'paused')
          return { key: GOAL_COMMAND_KEYS.paused }
        case 'resume':
          goalService.setUserState(chatId, 'active')
          return { key: GOAL_COMMAND_KEYS.resumed }
        case 'set': {
          if (goalService.get(chatId)) {
            goalService.updateObjective(chatId, intent.objective)
            return { key: GOAL_COMMAND_KEYS.objectiveUpdated }
          }
          goalService.create(chatId, { objective: intent.objective })
          return { key: GOAL_COMMAND_KEYS.set }
        }
      }
    },
    goalStatusLine(chatId) {
      const goal = goalService.get(chatId)
      const running = service.isRunning(chatId)
      const runLine = running ? '运行中' : '空闲'
      const workspace = store.getConversation(chatId)?.workspaceName
      const wsLine = workspace ? `工作区:${workspace};` : ''
      if (!goal) return `${wsLine}状态:${runLine};当前没有活动目标。`
      return `${wsLine}状态:${runLine};目标:${goal.objective}(${deriveStatus(goal)})`
    },
    clearConversation(chatId) {
      service.clearMessages(chatId)
    },
    renameConversation(chatId, title) {
      if (!store.getConversation(chatId)) return undefined
      return store.setConversationTitle(chatId, title).title
    },
    listChannelWorkspaces(chatId): ChannelWorkspaceView {
      return listChannelWorkspaces(chatId)
    },
    setChannelWorkspace(chatId, selector): ChannelWorkspaceSwitch {
      const conversation = store.getConversation(chatId)
      if (!conversation) return { ok: false, reason: 'no_conversation' }
      const { workspaces } = listChannelWorkspaces(chatId)
      const trimmed = selector.trim()
      // Prefer an exact (case-insensitive) name match so a workspace literally
      // named "2" stays selectable; fall back to a 1-based index.
      const byName = workspaces.find((ws) => ws.name.toLowerCase() === trimmed.toLowerCase())
      const asIndex = Number.parseInt(trimmed, 10)
      const byIndex =
        /^\d+$/.test(trimmed) && asIndex >= 1 && asIndex <= workspaces.length
          ? workspaces[asIndex - 1]
          : undefined
      const target = byName ?? byIndex
      if (!target) return { ok: false, reason: 'not_found' }
      if (target.isCurrent) return { ok: false, reason: 'already_current' }
      try {
        store.switchConversationWorkspace(chatId, target.id, target.name, target.rootPath)
      } catch {
        // The allowlisted directory no longer exists (e.g. deleted since listing).
        return { ok: false, reason: 'not_found' }
      }
      return { ok: true, name: target.name }
    },
    ensureConversation(chatId, cwd) {
      store.ensureConversation(chatId, { cwd: cwd ?? options.workspaceRoot })
    },
    registerIpc(ipcMain) {
      unregisterIpc?.()
      unregisterIpc = registerAgentIpc(ipcMain, {
        service,
        store,
        identity,
        policy,
        policyStore,
        hooks,
        goal: goalService,
        git,
        changeSet,
        skills,
        plugins,
        streams
      })
    },
    async close() {
      const startedAt = Date.now()
      let previousAt = startedAt
      const mark = (step: string, extra: Record<string, unknown> = {}): void => {
        const now = Date.now()
        logger.info('close step', {
          step,
          durationMs: now - previousAt,
          totalMs: now - startedAt,
          ...extra
        })
        previousAt = now
      }

      unregisterIpc?.()
      unregisterIpc = undefined
      mark('unregisterIpc')
      presence.dispose()
      mark('presence.dispose')
      git.unwatchAll()
      mark('git.unwatchAll')
      const runningIds = service.listRunning()
      mark('listRunning', { runningCount: runningIds.length })
      for (const chatId of runningIds) service.cancel(chatId)
      mark('cancelRunning', { runningCount: runningIds.length })
      const settled = await service.settleRuns(3000)
      mark('settleRuns', { settled })
      await shellSessions.close()
      mark('shellSessions.close')
      logger.info('closed')
    }
  }
}
