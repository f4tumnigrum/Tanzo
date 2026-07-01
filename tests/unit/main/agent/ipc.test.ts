import { describe, expect, it, vi } from 'vitest'
import { CHAT_CHANNELS } from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import { GOAL_CHANNELS } from '@shared/goal'
import { GIT_CHANNELS } from '@shared/git'
import { POLICY_CHANNELS } from '@shared/policy'
import { HOOKS_CHANNELS } from '@shared/hooks'
import { SKILL_CHANNELS } from '@shared/skills'
import { PLUGIN_CHANNELS } from '@shared/plugins'
import { ACTIVITY_CHANNELS } from '@shared/activity'
import { CHANGE_SET_CHANNELS } from '@shared/change-set'
import { BROWSER_CHANNELS } from '@shared/browser-control'
import { registerAgentIpc } from '@main/agent/ipc'

vi.mock('ai', () => ({
  getToolName: vi.fn(() => 'fileEdit'),
  isDynamicToolUIPart: vi.fn(() => false),
  isToolUIPart: vi.fn((part: { type?: string }) => part.type?.startsWith('tool-') ?? false)
}))

type Handler = (_event: unknown, ...args: unknown[]) => unknown

function ipcTarget() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    target: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
}

function deps() {
  const service = {
    run: vi.fn(),
    submitMessage: vi.fn(),
    respondApprovals: vi.fn(),
    cancel: vi.fn(),
    steer: vi.fn(),
    compact: vi.fn(),
    contextSnapshot: vi.fn(() => ({
      source: 'reported',
      usedTokens: 42,
      compactionTriggerTokens: 100
    })),
    startGoalContinuation: vi.fn(),
    listRunning: vi.fn(() => ['chat-1', 'chat-2']),
    deleteConversation: vi.fn((chatId: string) => ({ deleted: chatId })),
    respondTaskApproval: vi.fn(),
    listTaskApprovals: vi.fn(() => [
      { taskId: 'explore-1', approval: { approvalId: 'approval-1' } }
    ]),
    listTasks: vi.fn(() => [{ id: 'explore-1' }]),
    retryTask: vi.fn(),
    cancelTask: vi.fn()
  }
  const store = {
    createConversation: vi.fn((input: unknown) => ({ id: 'chat-1', ...(input as object) })),
    forkConversation: vi.fn((input: unknown) => ({
      conversation: { id: 'fork-1', parentRelation: 'fork' },
      messages: [],
      input
    })),
    listConversations: vi.fn(() => [{ id: 'chat-1' }]),
    load: vi.fn((chatId: string) => [{ id: 'm1', chatId }]),
    loadDisplay: vi.fn((chatId: string) => [{ id: 'm1', chatId }]),
    setConversationModel: vi.fn((chatId: string, modelRef: string) => ({ chatId, modelRef })),
    setConversationAgent: vi.fn((chatId: string, agentId: string) => ({ chatId, agentId })),
    loadArchived: vi.fn((chatId: string, summaryId: string) => ({ chatId, summaryId })),
    getActivitySummary: vi.fn((range: unknown) => ({ kpis: range })),
    getActivityTrend: vi.fn((range: unknown) => ({ trend: range })),
    getActivityReliability: vi.fn((range: unknown) => ({ reliability: range })),
    listActivityConversations: vi.fn((range: unknown, page: unknown) => ({
      conversations: { range, page }
    })),
    listActivityRuns: vi.fn((range: unknown, page: unknown) => ({ range, page })),
    getActivityRunDetail: vi.fn((runId: string) => ({ runId }))
  }
  const identity = {
    listAgents: vi.fn((kind: string) => [
      {
        id: `${kind}-agent`,
        name: `${kind} agent`,
        description: 'visible description',
        kind,
        modelRef: 'openai:gpt',
        systemPrompt: 'private system prompt',
        allowedTools: ['shell']
      }
    ])
  }
  const policy = {
    remember: vi.fn(),
    getMode: vi.fn((chatId?: string) => ({ modeFor: chatId })),
    setMode: vi.fn((mode: string, chatId?: string) => ({ mode, chatId }))
  }
  const policyStore = {
    listRules: vi.fn(() => [{ id: 'rule-1' }]),
    saveRule: vi.fn((rule: unknown) => ({ saved: rule })),
    deleteRule: vi.fn((id: string) => ({ deleted: id })),
    listDecisions: vi.fn(() => [{ toolName: 'fileEdit' }]),
    revokeDecision: vi.fn((toolName: string, inputFingerprint: string) => ({
      toolName,
      inputFingerprint
    }))
  }
  const goal = {
    get: vi.fn((chatId: string) => ({ chatId })),
    create: vi.fn((chatId: string, input: unknown) => ({ chatId, ...(input as object) })),
    updateObjective: vi.fn((chatId: string, objective: string) => ({ chatId, objective })),
    setUserState: vi.fn((chatId: string, status: string) => ({ chatId, status })),
    clear: vi.fn()
  }
  const skills = {
    snapshot: vi.fn(() => ({ skills: [], updatedAt: 0 })),
    detail: vi.fn((name: string) => ({ name })),
    setEnabled: vi.fn(() => ({ skills: [], updatedAt: 0 })),
    install: vi.fn(() => ({ skills: [], updatedAt: 0 })),
    uninstall: vi.fn(() => ({ skills: [], updatedAt: 0 })),
    reload: vi.fn(() => ({ skills: [], updatedAt: 0 }))
  }
  const plugins = {
    list: vi.fn(() => ({ plugins: [], updatedAt: 0 })),
    detail: vi.fn((id: string) => ({ id })),
    setEnabled: vi.fn(() => ({ plugins: [], updatedAt: 0 })),
    install: vi.fn(() => ({ plugins: [], updatedAt: 0 })),
    uninstall: vi.fn(() => ({ plugins: [], updatedAt: 0 })),
    listMarketplacePlugins: vi.fn(() => []),
    reload: vi.fn(() => ({ plugins: [], updatedAt: 0 }))
  }
  const streams = {
    snapshot: vi.fn((chatId: string) => ({
      chatId,
      runId: 'run-1',
      status: 'running',
      baseMessages: [],
      frames: []
    }))
  }
  const changeSet = {
    listChangeSets: vi.fn((input: unknown) => ({ items: [], input })),
    getChangeSet: vi.fn((id: string) => ({ changeSetId: id })),
    getChangeSetFilePatch: vi.fn((id: string, filePath: string) => ({ id, filePath })),
    applyChangeSet: vi.fn((input: unknown) => ({ changeSet: input }))
  }
  const hooks = {
    list: vi.fn(() => []),
    reload: vi.fn(() => []),
    setEnabled: vi.fn(),
    setTrusted: vi.fn(),
    preview: vi.fn(async () => ({
      key: 'k',
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false
    }))
  }
  return {
    service,
    store,
    identity,
    policy,
    policyStore,
    hooks,
    goal,
    skills,
    plugins,
    streams,
    changeSet
  }
}

const userMessage: TanzoUIMessage = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }]
}

function registeredChatChannelCount(): number {
  return Object.entries(CHAT_CHANNELS).filter(([key]) => key !== 'event' && key !== 'taskEvent')
    .length
}

function registeredBrowserChannelCount(): number {
  // openRequest is a main → renderer push channel, not an ipcMain.handle target.
  return Object.entries(BROWSER_CHANNELS).filter(([key]) => key !== 'openRequest').length
}

describe('agent/ipc', () => {
  it('registers chat and policy handlers with validation', async () => {
    const fakeDeps = deps()
    const { handlers, target } = ipcTarget()

    const unregister = registerAgentIpc(target as never, fakeDeps as never)
    expect(target.handle).toHaveBeenCalledTimes(
      registeredChatChannelCount() +
        Object.keys(POLICY_CHANNELS).length +
        Object.keys(HOOKS_CHANNELS).length +
        Object.keys(GOAL_CHANNELS).length +
        Object.keys(SKILL_CHANNELS).length +
        Object.keys(PLUGIN_CHANNELS).length +
        Object.keys(ACTIVITY_CHANNELS).length +
        Object.keys(GIT_CHANNELS).length +
        Object.keys(CHANGE_SET_CHANNELS).length +
        registeredBrowserChannelCount()
    )

    await handlers.get(CHAT_CHANNELS.submit)?.(null, 'chat-1', userMessage)
    expect(fakeDeps.service.submitMessage).toHaveBeenCalledWith('chat-1', userMessage)
    expect(() => handlers.get(CHAT_CHANNELS.submit)?.(null, 'chat-1', { id: 'bad' })).toThrow()
    expect(() => handlers.get(CHAT_CHANNELS.submit)?.(null, '', userMessage)).toThrow()

    await handlers.get(CHAT_CHANNELS.respondApprovals)?.(null, 'chat-1', [
      { approvalId: 'approval-9', approved: false, reason: 'nope', scope: 'once' }
    ])
    expect(fakeDeps.service.respondApprovals).toHaveBeenCalledWith('chat-1', [
      { approvalId: 'approval-9', approved: false, reason: 'nope', scope: 'once' }
    ])
    expect(() => handlers.get(CHAT_CHANNELS.respondApprovals)?.(null, 'chat-1', [])).toThrow()

    handlers.get(CHAT_CHANNELS.cancel)?.(null, 'chat-1')
    expect(fakeDeps.service.cancel).toHaveBeenCalledWith('chat-1')
    handlers.get(CHAT_CHANNELS.steer)?.(null, 'chat-1', ' run tests ')
    expect(fakeDeps.service.steer).toHaveBeenCalledWith('chat-1', 'run tests')
    expect(handlers.get(CHAT_CHANNELS.listRunning)?.(null)).toEqual(['chat-1', 'chat-2'])
    expect(handlers.get(CHAT_CHANNELS.runSnapshot)?.(null, 'chat-1')).toEqual({
      chatId: 'chat-1',
      runId: 'run-1',
      status: 'running',
      baseMessages: [],
      frames: []
    })
    expect(
      handlers.get(CHAT_CHANNELS.createConversation)?.(null, {
        agentId: 'main',
        title: 'New',
        cwd: '/tmp'
      })
    ).toMatchObject({ id: 'chat-1', title: 'New' })
    await expect(
      Promise.resolve(
        handlers.get(CHAT_CHANNELS.forkConversation)?.(null, {
          sourceChatId: 'chat-1',
          messageId: 'm1'
        })
      )
    ).resolves.toMatchObject({
      conversation: { id: 'fork-1', parentRelation: 'fork' },
      input: { sourceChatId: 'chat-1', messageId: 'm1' }
    })
    expect(handlers.get(CHAT_CHANNELS.listConversations)?.(null)).toEqual([{ id: 'chat-1' }])
    await expect(
      Promise.resolve(handlers.get(CHAT_CHANNELS.listMessages)?.(null, 'chat-1'))
    ).resolves.toEqual([{ id: 'm1', chatId: 'chat-1' }])
    expect(handlers.get(CHAT_CHANNELS.deleteConversation)?.(null, 'chat-1')).toEqual({
      deleted: 'chat-1'
    })
    expect(
      handlers.get(CHAT_CHANNELS.setConversationModel)?.(null, 'chat-1', 'openai:gpt')
    ).toEqual({
      chatId: 'chat-1',
      modelRef: 'openai:gpt'
    })
    expect(handlers.get(CHAT_CHANNELS.setConversationAgent)?.(null, 'chat-1', 'main')).toEqual({
      chatId: 'chat-1',
      agentId: 'main'
    })
    expect(handlers.get(CHAT_CHANNELS.listAgents)?.(null, 'subagent')).toEqual([
      {
        id: 'subagent-agent',
        name: 'subagent agent',
        description: 'visible description',
        kind: 'subagent'
      }
    ])
    await handlers.get(CHAT_CHANNELS.compact)?.(null, 'chat-1', { instructions: 'shorter' })
    expect(fakeDeps.service.compact).toHaveBeenCalledWith('chat-1', { instructions: 'shorter' })
    handlers.get(CHAT_CHANNELS.contextSnapshot)?.(null, 'chat-1')
    expect(fakeDeps.service.contextSnapshot).toHaveBeenCalledWith('chat-1')
    expect(handlers.get(CHAT_CHANNELS.loadArchived)?.(null, 'chat-1', 'summary-1')).toEqual({
      chatId: 'chat-1',
      summaryId: 'summary-1'
    })
    await handlers.get(CHAT_CHANNELS.approveTask)?.(null, 'root-1', {
      approvalId: 'approval-1',
      approved: false,
      reason: 'no',
      scope: 'forever'
    })
    expect(fakeDeps.service.respondTaskApproval).toHaveBeenCalledWith('root-1', {
      approvalId: 'approval-1',
      approved: false,
      reason: 'no',
      scope: 'forever'
    })
    expect(handlers.get(CHAT_CHANNELS.pendingTaskApprovals)?.(null, 'root-1')).toEqual([
      { taskId: 'explore-1', approval: { approvalId: 'approval-1' } }
    ])

    expect(handlers.get(POLICY_CHANNELS.listRules)?.(null)).toEqual([{ id: 'rule-1' }])
    const savedRule = handlers.get(POLICY_CHANNELS.saveRule)?.(null, {
      match: { toolName: 'fileEdit', argMatch: { path: 'path', regex: '.*' } },
      action: 'ask',
      scope: 'user',
      priority: 10
    })
    expect(savedRule).toEqual({
      saved: expect.objectContaining({
        id: expect.any(String),
        action: 'ask',
        priority: 10
      })
    })
    expect(handlers.get(POLICY_CHANNELS.deleteRule)?.(null, 'rule-1')).toEqual({
      deleted: 'rule-1'
    })
    expect(handlers.get(POLICY_CHANNELS.listDecisions)?.(null)).toEqual([{ toolName: 'fileEdit' }])
    expect(handlers.get(POLICY_CHANNELS.revokeDecision)?.(null, 'fileEdit', 'fingerprint')).toEqual(
      {
        toolName: 'fileEdit',
        inputFingerprint: 'fingerprint'
      }
    )
    expect(handlers.get(POLICY_CHANNELS.getMode)?.(null, 'chat-1')).toEqual({
      modeFor: 'chat-1'
    })
    expect(handlers.get(POLICY_CHANNELS.getMode)?.(null)).toEqual({ modeFor: undefined })
    expect(handlers.get(POLICY_CHANNELS.setMode)?.(null, 'plan', 'chat-1')).toEqual({
      mode: 'plan',
      chatId: 'chat-1'
    })

    handlers.get(GOAL_CHANNELS.create)?.(null, 'chat-1', { objective: 'Ship it' })
    expect(fakeDeps.goal.create).toHaveBeenCalledWith('chat-1', { objective: 'Ship it' })
    expect(fakeDeps.service.startGoalContinuation).toHaveBeenCalledWith('chat-1')

    fakeDeps.service.startGoalContinuation.mockClear()
    handlers.get(GOAL_CHANNELS.updateObjective)?.(null, 'chat-1', 'New objective')
    expect(fakeDeps.service.startGoalContinuation).toHaveBeenCalledWith('chat-1')

    fakeDeps.service.startGoalContinuation.mockClear()
    handlers.get(GOAL_CHANNELS.setStatus)?.(null, 'chat-1', 'active')
    expect(fakeDeps.service.startGoalContinuation).toHaveBeenCalledWith('chat-1')

    fakeDeps.service.startGoalContinuation.mockClear()
    handlers.get(GOAL_CHANNELS.setStatus)?.(null, 'chat-1', 'paused')
    expect(fakeDeps.service.startGoalContinuation).not.toHaveBeenCalled()

    expect(handlers.get(ACTIVITY_CHANNELS.summary)?.(null, { from: 0, to: 100 })).toEqual({
      kpis: { from: 0, to: 100 }
    })
    expect(handlers.get(ACTIVITY_CHANNELS.trend)?.(null, { from: 0, to: 100 })).toEqual({
      trend: { from: 0, to: 100 }
    })
    expect(handlers.get(ACTIVITY_CHANNELS.reliability)?.(null, { from: 0, to: 100 })).toEqual({
      reliability: { from: 0, to: 100 }
    })
    expect(
      handlers.get(ACTIVITY_CHANNELS.conversations)?.(
        null,
        { from: 0, to: 100 },
        { limit: 10, offset: 0 }
      )
    ).toEqual({ conversations: { range: { from: 0, to: 100 }, page: { limit: 10, offset: 0 } } })
    expect(
      handlers.get(ACTIVITY_CHANNELS.runs)?.(null, { from: 0, to: 100 }, { limit: 10, offset: 0 })
    ).toEqual({ range: { from: 0, to: 100 }, page: { limit: 10, offset: 0 } })
    expect(handlers.get(ACTIVITY_CHANNELS.runs)?.(null, { from: 0, to: 100 }, {})).toEqual({
      range: { from: 0, to: 100 },
      page: { limit: 50, offset: 0 }
    })
    expect(handlers.get(ACTIVITY_CHANNELS.runDetail)?.(null, 'c1:r1')).toEqual({ runId: 'c1:r1' })

    expect(() => handlers.get(CHAT_CHANNELS.steer)?.(null, 'chat-1', '')).toThrow()
    expect(() => handlers.get(CHAT_CHANNELS.listAgents)?.(null, 'other')).toThrow()
    expect(() => handlers.get(POLICY_CHANNELS.getMode)?.(null, '')).toThrow()
    expect(() => handlers.get(POLICY_CHANNELS.setMode)?.(null, 'danger', 'chat-1')).toThrow()
    expect(() => handlers.get(ACTIVITY_CHANNELS.summary)?.(null, { from: 100, to: 0 })).toThrow()

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(
      (registeredChatChannelCount() +
        Object.keys(POLICY_CHANNELS).length +
        Object.keys(HOOKS_CHANNELS).length +
        Object.keys(GOAL_CHANNELS).length +
        Object.keys(SKILL_CHANNELS).length +
        Object.keys(ACTIVITY_CHANNELS).length +
        Object.keys(GIT_CHANNELS).length +
        Object.keys(CHANGE_SET_CHANNELS).length +
        Object.keys(PLUGIN_CHANNELS).length +
        registeredBrowserChannelCount()) *
        2
    )
  })
})
