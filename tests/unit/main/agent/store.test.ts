import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition, AgentIdentity } from '@main/agent/agents/types'
import { TanzoError, TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type { Logger } from '@main/agent/logging'
import { createAgentStore } from '@main/agent/store'
import { countRows, createRealDb, type RealDb } from '../../../helpers/real-db'

let root = ''

const general: AgentDefinition = {
  id: 'tanzo',
  name: 'tanzo',
  description: '',
  kind: 'main',
  modelRef: 'openai:gpt-5',
  systemPrompt: '',
  allowedTools: null
}

function identity(): AgentIdentity {
  return {
    resolveAgentType: vi.fn((name: string) => (name === 'tanzo' ? general : undefined)),
    listAgents: vi.fn(() => [general]),
    listAgentTypes: vi.fn(() => [general]),
    listLoadErrors: vi.fn(() => [])
  }
}

function logger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
}

function textMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function assistantMessage(id: string, text = 'Done'): TanzoUIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function summaryMessage(id: string): TanzoUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Summary' },
      { type: 'data-compaction', data: { stage: 'complete', summary: 'Summary', summaryId: id } }
    ]
  } as TanzoUIMessage
}

function logRows(db: RealDb, chatId: string): Array<{ id: string; seq: number }> {
  return db
    .prepare('SELECT id, seq FROM messages WHERE conversation_id = ? ORDER BY seq')
    .all([chatId]) as Array<{ id: string; seq: number }>
}

function overlayRows(db: RealDb, chatId: string): Array<{ id: string; generation: number }> {
  return db
    .prepare(
      'SELECT id, generation FROM compaction_overlays WHERE conversation_id = ? ORDER BY generation'
    )
    .all([chatId]) as Array<{ id: string; generation: number }>
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'tanzo-agent-store-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('main/agent/store', () => {
  it('creates conversations, normalizes cwd, and lists roots/children', () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const parent = store.createConversation({ title: 'Parent' })
    const child = store.createConversation({ parentConversationId: parent.id, title: 'Child' })

    expect(parent.cwd).toBe(root)
    expect(parent.workspaceId).toMatch(/^ws_[a-f0-9]{24}$/)
    expect(parent.workspaceName).toBe(basename(root))
    expect(store.listConversations()).toEqual([expect.objectContaining({ id: parent.id })])
    expect(store.listChildren(parent.id)).toEqual([expect.objectContaining({ id: child.id })])
    expect(store.listChildren(parent.id, 'subagent')).toEqual([
      expect.objectContaining({ id: child.id })
    ])
    expect(child.parentRelation).toBe('subagent')
    expect(store.depthOf(child.id)).toBe(1)
    expect(store.rootOf(child.id)).toBe(parent.id)
    expect(() => store.createConversation({ agentId: 'missing' })).toThrow(TanzoNotFoundError)
    expect(() => store.createConversation({ cwd: join(root, 'missing') })).toThrow(
      TanzoValidationError
    )
  })

  it('pins and unpins conversations without touching updated_at', () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({ title: 'Pin me' })

    const pinned = store.setConversationPinned(conversation.id, true)
    expect(pinned.pinnedAt).toBeTypeOf('number')
    expect(store.getConversation(conversation.id)?.pinnedAt).toBe(pinned.pinnedAt)
    expect(store.getConversation(conversation.id)?.updatedAt).toBe(conversation.updatedAt)

    const unpinned = store.setConversationPinned(conversation.id, false)
    expect(unpinned.pinnedAt).toBeNull()
    expect(store.getConversation(conversation.id)?.pinnedAt).toBeNull()
  })

  it('saves, loads, and deletes messages', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    expect(countRows(db, 'workspaces', 'id = ?', [conversation.workspaceId])).toBe(1)
    const first = textMessage('m1', 'Hello from a first user message')
    const second = textMessage('m2', 'Second')

    store.save(conversation.id, [first, second])
    expect(store.getConversation(conversation.id)?.title).toBe('Hello from a first user message')
    await expect(store.load(conversation.id)).resolves.toEqual([first, second])
    expect(store.loadUnvalidated(conversation.id)).toEqual([first, second])

    store.deleteConversation(conversation.id)
    expect(store.getConversation(conversation.id)).toBeUndefined()
    expect(store.listConversations()).toEqual([])
    expect(countRows(db, 'workspaces', 'id = ?', [conversation.workspaceId])).toBe(1)
    expect(store.listWorkspaces()).toEqual([
      expect.objectContaining({ id: conversation.workspaceId, rootPath: root })
    ])
    await expect(store.load(conversation.id)).resolves.toEqual([])
  })

  it('clearMessages wipes messages but keeps the conversation', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    store.save(conversation.id, [textMessage('m1', 'Hello'), textMessage('m2', 'World')])

    store.clearMessages(conversation.id)

    expect(store.getConversation(conversation.id)).toBeDefined()
    await expect(store.load(conversation.id)).resolves.toEqual([])
  })

  it('clearMessages removes a compaction projection before accepting new messages', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'Old')
    const tail = textMessage('m2', 'Tail')
    const summary = summaryMessage('sum')
    store.save(conversation.id, [first, tail])
    store.finalizeCompaction(conversation.id, [first.id], summary.id, [summary, tail])

    store.clearMessages(conversation.id)
    const fresh = textMessage('m3', 'Fresh')
    store.save(conversation.id, [fresh])

    await expect(store.load(conversation.id)).resolves.toEqual([fresh])
    expect(countRows(db, 'compaction_overlays', 'conversation_id = ?', [conversation.id])).toBe(0)
  })

  it('updateConversationCwd switches the workspace and registers it', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const otherRoot = await realpath(await mkdtemp(join(tmpdir(), 'tanzo-agent-store-alt-')))

    const updated = store.updateConversationCwd(conversation.id, otherRoot)

    expect(updated.cwd).toBe(otherRoot)
    expect(updated.workspaceName).toBe(basename(otherRoot))
    expect(updated.workspaceId).not.toBe(conversation.workspaceId)
    // Persisted on the conversation row.
    expect(store.getConversation(conversation.id)?.cwd).toBe(otherRoot)
    // The new workspace is registered and listable for switching.
    expect(store.listWorkspaces()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: updated.workspaceId, rootPath: otherRoot })
      ])
    )
    await rm(otherRoot, { recursive: true, force: true })
  })

  it('updateConversationCwd rejects a non-existent directory', () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})
    expect(() => store.updateConversationCwd(conversation.id, join(root, 'nope'))).toThrow(
      TanzoValidationError
    )
  })

  it('switchConversationWorkspace reuses an existing workspace id without a root_path conflict', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    // A workspace whose id is a custom value, not the cwd-derived hash.
    const target = await realpath(await mkdtemp(join(tmpdir(), 'tanzo-agent-store-custom-')))
    const owner = store.createConversation({ workspaceId: 'ws_custom_id', cwd: target })
    const conversation = store.createConversation({})

    const updated = store.switchConversationWorkspace(
      conversation.id,
      owner.workspaceId,
      owner.workspaceName,
      target
    )

    expect(updated.workspaceId).toBe('ws_custom_id')
    expect(updated.cwd).toBe(target)
    expect(store.getConversation(conversation.id)?.workspaceId).toBe('ws_custom_id')
    // No duplicate workspace row was created for the same root_path.
    expect(store.listWorkspaces().filter((ws) => ws.rootPath === target)).toHaveLength(1)
    await rm(target, { recursive: true, force: true })
  })

  it('drops empty messages and assigns stable seqs before the next save', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First')
    const emptyAssistant = {
      id: 'a-empty',
      role: 'assistant',
      parts: []
    } as unknown as TanzoUIMessage
    const second = textMessage('m2', 'Second')

    store.save(conversation.id, [first, emptyAssistant])
    await expect(store.load(conversation.id)).resolves.toEqual([first])
    expect(logRows(db, conversation.id)).toEqual([{ id: 'm1', seq: 0 }])

    store.save(conversation.id, [first, second])
    await expect(store.load(conversation.id)).resolves.toEqual([first, second])
    expect(logRows(db, conversation.id)).toEqual([
      { id: 'm1', seq: 0 },
      { id: 'm2', seq: 1 }
    ])
  })

  it('writes only changed rows, preserves unchanged rows, and keeps omitted ids in the log', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First message')
    const second = textMessage('m2', 'Second message')
    const third = textMessage('m3', 'Third message')

    store.save(conversation.id, [first, second])
    db.prepare('UPDATE messages SET created_at = 111 WHERE conversation_id = ? AND id = ?').run([
      conversation.id,
      'm1'
    ])

    store.save(conversation.id, [first, second, third])

    const rows = db
      .prepare('SELECT id, seq, created_at FROM messages WHERE conversation_id = ? ORDER BY seq')
      .all([conversation.id]) as Array<{ id: string; seq: number; created_at: number }>
    expect(rows.map((row) => ({ id: row.id, seq: row.seq }))).toEqual([
      { id: 'm1', seq: 0 },
      { id: 'm2', seq: 1 },
      { id: 'm3', seq: 2 }
    ])
    expect(rows[0].created_at).toBe(111)

    store.save(conversation.id, [first, third])
    expect(logRows(db, conversation.id)).toEqual([
      { id: 'm1', seq: 0 },
      { id: 'm2', seq: 1 },
      { id: 'm3', seq: 2 }
    ])
    await expect(store.load(conversation.id)).resolves.toEqual([first, second, third])
  })

  it('forks a root conversation through the selected assistant message', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({ title: 'Parent', modelRef: 'openai:gpt' })
    const user = textMessage('u1', 'Question')
    const assistant = assistantMessage('a1', 'Answer')
    const tail = textMessage('u2', 'Later')
    store.save(conversation.id, [user, assistant, tail])

    const result = await store.forkConversation({
      sourceChatId: conversation.id,
      messageId: assistant.id
    })

    expect(result.conversation).toMatchObject({
      title: 'Parent',
      modelRef: 'openai:gpt',
      parentConversationId: conversation.id,
      parentRelation: 'fork'
    })
    await expect(store.load(result.conversation.id)).resolves.toEqual([user, assistant])
    expect(store.listConversations().map((item) => item.id)).toContain(result.conversation.id)
    expect(store.listChildren(conversation.id, 'fork')).toEqual([
      expect.objectContaining({ id: result.conversation.id })
    ])
  })

  it('forks from an archived assistant message after compaction', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({ title: 'Parent' })
    const user = textMessage('u1', 'Question')
    const assistant = assistantMessage('a1', 'Answer')
    const recent = textMessage('u2', 'Later')
    const summary = summaryMessage('summary')
    store.save(conversation.id, [user, assistant, recent])
    store.finalizeCompaction(conversation.id, [user.id, assistant.id], summary.id, [
      summary,
      recent
    ])

    const result = await store.forkConversation({
      sourceChatId: conversation.id,
      messageId: assistant.id
    })

    expect(result.conversation).toMatchObject({
      title: 'Parent',
      parentConversationId: conversation.id,
      parentRelation: 'fork'
    })
    await expect(store.loadFullHistory(result.conversation.id)).resolves.toEqual([user, assistant])
    // The fork also carries the source's compaction overlay: the context
    // projection is the summary (both archived rows are covered by it).
    await expect(store.load(result.conversation.id)).resolves.toEqual([
      expect.objectContaining({ id: 'summary' })
    ])
  })

  it('forks an existing fork as a sibling while copying the source branch history', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const parent = store.createConversation({ title: 'Parent' })
    const firstFork = store.createConversation({
      title: 'Parent',
      parentConversationId: parent.id,
      parentRelation: 'fork'
    })
    const branchUser = textMessage('branch-u', 'Branch question')
    const branchAssistant = assistantMessage('branch-a', 'Branch answer')
    store.save(firstFork.id, [branchUser, branchAssistant])

    const result = await store.forkConversation({
      sourceChatId: firstFork.id,
      messageId: branchAssistant.id
    })

    expect(result.conversation.parentConversationId).toBe(parent.id)
    expect(result.conversation.parentRelation).toBe('fork')
    await expect(store.load(result.conversation.id)).resolves.toEqual([branchUser, branchAssistant])
  })

  it('rejects invalid fork targets', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})
    const user = textMessage('u1', 'Question')
    const streamingAssistant = {
      id: 'a-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'partial', state: 'streaming' }]
    } as TanzoUIMessage
    const toolAssistant = {
      id: 'a-tool',
      role: 'assistant',
      parts: [
        {
          type: 'tool-fileEdit',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { path: 'a.ts', oldText: 'a', newText: 'b' },
          approval: { id: 'approval-1' }
        }
      ]
    } as TanzoUIMessage
    store.save(conversation.id, [user, streamingAssistant, toolAssistant])

    await expect(
      store.forkConversation({ sourceChatId: 'missing', messageId: 'a1' })
    ).rejects.toThrow(TanzoNotFoundError)
    await expect(
      store.forkConversation({ sourceChatId: conversation.id, messageId: 'missing' })
    ).rejects.toThrow(TanzoNotFoundError)
    await expect(
      store.forkConversation({ sourceChatId: conversation.id, messageId: user.id })
    ).rejects.toThrow(TanzoValidationError)
    await expect(
      store.forkConversation({ sourceChatId: conversation.id, messageId: streamingAssistant.id })
    ).rejects.toThrow(TanzoValidationError)
    await expect(
      store.forkConversation({ sourceChatId: conversation.id, messageId: toolAssistant.id })
    ).rejects.toThrow(TanzoValidationError)
  })

  it('rejects forking from a message with a streaming reasoning part', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})
    const reasoningAssistant = {
      id: 'a-reasoning',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'thinking…', state: 'streaming' }]
    } as TanzoUIMessage
    store.save(conversation.id, [textMessage('u1', 'Question'), reasoningAssistant])

    await expect(
      store.forkConversation({ sourceChatId: conversation.id, messageId: reasoningAssistant.id })
    ).rejects.toThrow(TanzoValidationError)
  })

  it('treats forks as execution roots for rootOf/depthOf while subagents chain up', () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const parent = store.createConversation({ title: 'Parent' })
    const fork = store.createConversation({
      parentConversationId: parent.id,
      parentRelation: 'fork'
    })
    const subagentUnderFork = store.createConversation({
      parentConversationId: fork.id,
      parentRelation: 'subagent'
    })

    // Fork is its own execution root at depth 0.
    expect(store.rootOf(fork.id)).toBe(fork.id)
    expect(store.depthOf(fork.id)).toBe(0)
    // Subagents spawned inside the fork resolve to the fork, not the parent.
    expect(store.rootOf(subagentUnderFork.id)).toBe(fork.id)
    expect(store.depthOf(subagentUnderFork.id)).toBe(1)
  })

  it('detaches forks when the parent conversation is deleted', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const parent = store.createConversation({ title: 'Parent' })
    const user = textMessage('u1', 'Question')
    const assistant = assistantMessage('a1', 'Answer')
    store.save(parent.id, [user, assistant])
    const fork = (
      await store.forkConversation({ sourceChatId: parent.id, messageId: assistant.id })
    ).conversation
    const subagent = store.createConversation({
      parentConversationId: parent.id,
      parentRelation: 'subagent'
    })

    store.deleteConversation(parent.id)

    // Fork survives, promoted to a root conversation with its history intact.
    expect(store.getConversation(fork.id)).toMatchObject({
      parentConversationId: null,
      parentRelation: null
    })
    expect(store.listConversations().map((item) => item.id)).toContain(fork.id)
    await expect(store.load(fork.id)).resolves.toEqual([user, assistant])
    // Subagent children still cascade away with the parent.
    expect(store.getConversation(subagent.id)).toBeUndefined()
  })

  it('copies compaction overlays into the fork with remapped coverage', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First')
    const second = textMessage('m2', 'Second')
    const assistant = assistantMessage('a1', 'Answer')
    const tail = textMessage('m3', 'Later')
    const summary = summaryMessage('summary')

    store.save(conversation.id, [first, second, assistant, tail])
    store.finalizeCompaction(conversation.id, ['m1', 'm2'], 'summary', [summary, assistant, tail])

    const fork = (
      await store.forkConversation({ sourceChatId: conversation.id, messageId: assistant.id })
    ).conversation

    // Fork context projection matches the source: summary + retained tail,
    // no cold-start recompaction of the full history.
    await expect(store.load(fork.id)).resolves.toEqual([
      expect.objectContaining({ id: 'summary' }),
      assistant
    ])
    await expect(store.loadFullHistory(fork.id)).resolves.toEqual([first, second, assistant])
    await expect(store.loadArchived(fork.id, 'summary')).resolves.toEqual([first, second])
  })

  it('finalizes compaction as an overlay and keeps the full log intact', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First')
    const second = textMessage('m2', 'Second')
    const recent = textMessage('m3', 'Recent')
    const summary = summaryMessage('summary')

    store.save(conversation.id, [first, second, recent])

    store.finalizeCompaction(conversation.id, ['m1', 'm2'], 'summary', [summary, recent])

    await expect(store.load(conversation.id)).resolves.toEqual([summary, recent])
    await expect(store.loadFullHistory(conversation.id)).resolves.toEqual([first, second, recent])
    await expect(store.loadArchived(conversation.id, 'summary')).resolves.toEqual([first, second])
  })

  it('finalizeCompaction appends a partial tail fragment without rewriting old history', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})
    const user = textMessage('u1', 'Do work')
    const loop = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'early step' },
        { type: 'step-start' },
        { type: 'text', text: 'late step' }
      ]
    } as TanzoUIMessage
    const summary = summaryMessage('summary')
    const tailFragment = {
      id: 'a1-tail',
      role: 'assistant',
      parts: [{ type: 'step-start' }, { type: 'text', text: 'late step' }]
    } as TanzoUIMessage

    store.save(conversation.id, [user, loop])

    const headFragment = {
      ...loop,
      parts: [{ type: 'step-start' }, { type: 'text', text: 'early step' }]
    } as TanzoUIMessage
    store.finalizeCompaction(
      conversation.id,
      ['u1', 'a1'],
      'summary',
      [summary, tailFragment],
      undefined,
      [user, headFragment]
    )

    await expect(store.load(conversation.id)).resolves.toEqual([summary, tailFragment])
    await expect(store.loadFullHistory(conversation.id)).resolves.toEqual([
      user,
      headFragment,
      tailFragment
    ])
    await expect(store.loadArchived(conversation.id, 'summary')).resolves.toEqual([
      user,
      headFragment
    ])
  })

  it('keeps historical messages in the log after saving a context projection', async () => {
    const db = createRealDb()
    const log = logger()
    const store = createAgentStore(db, identity(), log, root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First')
    const second = textMessage('m2', 'Second')
    const recent = textMessage('m3', 'Recent')
    const summary = summaryMessage('summary')
    const fresh = textMessage('m4', 'New message')

    store.save(conversation.id, [first, second, recent])
    store.finalizeCompaction(conversation.id, ['m1', 'm2'], 'summary', [summary, recent])

    store.save(conversation.id, [first, summary, recent, fresh])

    await expect(store.load(conversation.id)).resolves.toEqual([summary, recent, fresh])
    await expect(store.loadFullHistory(conversation.id)).resolves.toEqual([
      first,
      second,
      recent,
      fresh
    ])
    await expect(store.loadArchived(conversation.id, 'summary')).resolves.toEqual([first, second])
    // Compaction renumbers the retained tail into a fresh seq block above the
    // prior max, so seqs stay ordered but may skip values (m3: 2 -> 3).
    expect(logRows(db, conversation.id)).toEqual([
      { id: 'm1', seq: 0 },
      { id: 'm2', seq: 1 },
      { id: 'm3', seq: 3 },
      { id: 'm4', seq: 4 }
    ])
    expect(overlayRows(db, conversation.id)).toEqual([{ id: 'summary', generation: 1 }])
  })

  it('refuses to finalize compaction when active messages changed after planning', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'First')
    const second = textMessage('m2', 'Second')
    const recent = textMessage('m3', 'Recent')
    const concurrent = textMessage('m4', 'Concurrent message')
    const summary = summaryMessage('summary')

    store.save(conversation.id, [first, second, recent])
    const plannedIds = ['m1', 'm2', 'm3']

    store.save(conversation.id, [first, second, recent, concurrent])

    let thrown: unknown
    try {
      store.finalizeCompaction(
        conversation.id,
        ['m1', 'm2'],
        'summary',
        [summary, recent],
        plannedIds
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TanzoError)
    expect((thrown as TanzoError).code).toBe('CHAT_COMPACTION_STALE')

    await expect(store.load(conversation.id)).resolves.toEqual([first, second, recent, concurrent])
    expect(countRows(db, 'compaction_overlays', 'conversation_id = ?', [conversation.id])).toBe(0)

    store.finalizeCompaction(
      conversation.id,
      ['m1', 'm2'],
      'summary',
      [summary, recent, concurrent],
      ['m1', 'm2', 'm3', 'm4']
    )
    await expect(store.load(conversation.id)).resolves.toEqual([summary, recent, concurrent])
    await expect(store.loadArchived(conversation.id, 'summary')).resolves.toEqual([first, second])
  })

  it('cascades conversation deletion to children, runs, diagnostics, and tool executions', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const parent = store.createConversation({})
    const child = store.createConversation({ parentConversationId: parent.id })

    store.save(parent.id, [textMessage('p1', 'Parent message')])
    store.save(child.id, [textMessage('c1', 'Child message')])
    store.recordPromptDiagnostic({
      id: 'diag-1',
      conversationId: parent.id,
      runId: 'run-1',
      stepNumber: 1,
      createdAt: 1,
      modelRef: 'openai:gpt-5',
      provider: 'openai',
      systemHash: 's',
      systemChars: 1,
      messagesHash: 'm',
      messagesChars: 2,
      toolsHash: 't',
      toolsJson: '[]',
      providerOptionsHash: 'p',
      providerOptionsJson: '{}',
      promptHash: 'h',
      promptChars: 3,
      segmentsJson: '[{"hash":"x"}]'
    })
    store.recordToolExecution({
      id: 'tool-1',
      runId: `${parent.id}:run-1`,
      conversationId: parent.id,
      toolName: 'shell',
      success: true,
      createdAt: 1
    })
    db.prepare(
      `INSERT INTO conversation_goals (conversation_id, objective, user_state, created_at, updated_at)
       VALUES (?, ?, 'active', 0, 0)`
    ).run([parent.id, 'objective'])

    store.deleteConversation(parent.id)

    expect(store.getConversation(parent.id)).toBeUndefined()
    expect(store.getConversation(child.id)).toBeUndefined()
    expect(countRows(db, 'messages')).toBe(0)
    expect(countRows(db, 'runs')).toBe(0)
    expect(countRows(db, 'run_steps')).toBe(0)
    expect(countRows(db, 'prompt_diagnostics')).toBe(0)
    expect(countRows(db, 'tool_executions')).toBe(0)
    expect(countRows(db, 'conversation_goals')).toBe(0)
  })

  it('enforces unique seqs for log messages at the schema level', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const insert = db.prepare(
      `INSERT INTO messages (conversation_id, id, seq, role, message_json, created_at)
       VALUES (?, ?, ?, 'user', ?, 0)`
    )

    insert.run([conversation.id, 'x1', 0, '{"id":"x1"}'])
    expect(() => insert.run([conversation.id, 'x2', 0, '{"id":"x2"}'])).toThrow()
  })

  it('stores messages in a versioned envelope and still reads legacy rows', async () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const first = textMessage('m1', 'Enveloped message')
    store.save(conversation.id, [first])

    const row = db
      .prepare('SELECT message_json FROM messages WHERE conversation_id = ? AND id = ?')
      .get([conversation.id, 'm1']) as { message_json: string }
    expect(JSON.parse(row.message_json)).toEqual({ v: 1, message: first })

    const legacy = textMessage('m0', 'Legacy raw row')
    db.prepare(
      `INSERT INTO messages (conversation_id, id, seq, role, message_json, created_at)
       VALUES (?, ?, -1, 'user', ?, 0)`
    ).run([conversation.id, 'm0', JSON.stringify(legacy)])

    await expect(store.load(conversation.id)).resolves.toEqual([legacy, first])
  })

  it('quarantines invalid messages instead of dropping them', async () => {
    const db = createRealDb()
    const log = logger()
    const store = createAgentStore(db, identity(), log, root)
    const conversation = store.createConversation({})
    const good = textMessage('m1', 'Valid message')
    store.save(conversation.id, [good])
    db.prepare(
      `INSERT INTO messages (conversation_id, id, seq, role, message_json, created_at)
       VALUES (?, 'broken', 99, 'assistant', ?, 0)`
    ).run([conversation.id, JSON.stringify({ v: 1, message: { id: 'broken', role: 'unknown' } })])

    await expect(store.load(conversation.id)).resolves.toEqual([good])

    const quarantined = db
      .prepare('SELECT id, ord, reason FROM quarantined_messages WHERE conversation_id = ?')
      .all([conversation.id]) as Array<{ id: string; ord: number; reason: string }>
    expect(quarantined).toEqual([
      expect.objectContaining({ id: 'broken', ord: 99, reason: expect.any(String) })
    ])
    expect(
      countRows(db, 'messages', `conversation_id = ? AND id = 'broken'`, [conversation.id])
    ).toBe(0)
    expect(log.warn).toHaveBeenCalledWith('quarantined invalid message', {
      chatId: conversation.id,
      id: 'broken'
    })

    await expect(store.load(conversation.id)).resolves.toEqual([good])
  })

  it('updates conversation model/agent and resolves final agent definitions', async () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})

    expect(store.setConversationModel(conversation.id, 'anthropic:claude')).toMatchObject({
      modelRef: 'anthropic:claude'
    })
    expect(store.setConversationAgent(conversation.id, 'tanzo')).toMatchObject({
      agentId: 'tanzo'
    })
    await expect(store.resolveAgentDefinition(conversation.id)).resolves.toMatchObject({
      modelRef: 'anthropic:claude'
    })
    expect(() => store.setConversationModel('missing', 'openai:gpt-5')).toThrow(TanzoNotFoundError)
    await expect(store.resolveAgentDefinition('missing')).rejects.toThrow(TanzoNotFoundError)
  })

  it('stores prompt cache diagnostics', () => {
    const store = createAgentStore(createRealDb(), identity(), logger(), root)
    const conversation = store.createConversation({})

    store.recordPromptDiagnostic({
      id: 'diag-1',
      conversationId: conversation.id,
      runId: 'run-1',
      stepNumber: 1,
      createdAt: 1,
      modelRef: 'openai:gpt-5',
      provider: 'openai',
      systemHash: 's',
      systemChars: 1,
      messagesHash: 'm',
      messagesChars: 2,
      toolsHash: 't',
      toolsJson: '[]',
      providerOptionsHash: 'p',
      providerOptionsJson: '{}',
      promptHash: 'h',
      promptChars: 3,
      segmentsJson: '[{"hash":"x"}]'
    })
    expect(store.getLatestPromptDiagnostic(conversation.id)).toEqual({
      id: 'diag-1',
      segmentsJson: '[{"hash":"x"}]'
    })
    store.finishPromptDiagnostic({
      conversationId: conversation.id,
      runId: 'run-1',
      stepNumber: 1,
      usageJson: '{}',
      finishReason: 'stop',
      inputTokens: 1
    })
  })

  it('marks run outcomes and sweeps interrupted runs on startup', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const diagnostic = (
      id: string,
      runId: string
    ): Parameters<typeof store.recordPromptDiagnostic>[0] => ({
      id,
      conversationId: conversation.id,
      runId,
      stepNumber: 1,
      createdAt: 1,
      modelRef: 'openai:gpt-5',
      provider: 'openai',
      systemHash: 's',
      systemChars: 1,
      messagesHash: 'm',
      messagesChars: 2,
      toolsHash: 't',
      toolsJson: '[]',
      providerOptionsHash: 'p',
      providerOptionsJson: '{}',
      promptHash: 'h',
      promptChars: 3,
      segmentsJson: '[]'
    })
    const runRow = (runId: string): { status: string; error_json: string | null } =>
      db
        .prepare('SELECT status, error_json FROM runs WHERE id = ?')
        .get([`${conversation.id}:${runId}`]) as { status: string; error_json: string | null }

    store.recordPromptDiagnostic(diagnostic('diag-1', 'run-1'))
    store.markRunOutcome(conversation.id, 'run-1', 'failed', '{"kind":"stream-error"}')
    expect(runRow('run-1')).toEqual({ status: 'failed', error_json: '{"kind":"stream-error"}' })

    store.recordPromptDiagnostic(diagnostic('diag-2', 'run-2'))
    expect(runRow('run-2').status).toBe('running')
    expect(store.sweepInterruptedRuns()).toBe(1)
    expect(runRow('run-2')).toEqual({ status: 'failed', error_json: '{"kind":"interrupted"}' })
    expect(store.sweepInterruptedRuns()).toBe(0)
  })

  it('reads back the latest run outcome with structured error detail', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const diagnostic = (
      id: string,
      runId: string,
      createdAt: number
    ): Parameters<typeof store.recordPromptDiagnostic>[0] => ({
      id,
      conversationId: conversation.id,
      runId,
      stepNumber: 1,
      createdAt,
      modelRef: 'openai:gpt-5',
      provider: 'openai',
      systemHash: 's',
      systemChars: 1,
      messagesHash: 'm',
      messagesChars: 2,
      toolsHash: 't',
      toolsJson: '[]',
      providerOptionsHash: 'p',
      providerOptionsJson: '{}',
      promptHash: 'h',
      promptChars: 3,
      segmentsJson: '[]'
    })

    expect(store.getLatestRunOutcome(conversation.id)).toBeNull()

    store.recordPromptDiagnostic(diagnostic('diag-1', 'run-1', 1))
    // Running rows are excluded until a terminal outcome lands.
    expect(store.getLatestRunOutcome(conversation.id)).toBeNull()

    store.markRunOutcome(
      conversation.id,
      'run-1',
      'failed',
      JSON.stringify({
        kind: 'stream-error',
        message: 'Rate limited',
        code: 'AISDK_API_CALL_ERROR',
        detail: { kind: 'api', message: 'Rate limited', statusCode: 429 }
      })
    )
    expect(store.getLatestRunOutcome(conversation.id)).toMatchObject({
      runId: 'run-1',
      status: 'failed',
      error: {
        kind: 'stream-error',
        message: 'Rate limited',
        code: 'AISDK_API_CALL_ERROR',
        detail: { kind: 'api', statusCode: 429 }
      }
    })

    // A newer finished run supersedes the earlier failure.
    store.recordPromptDiagnostic(diagnostic('diag-2', 'run-2', 2))
    store.markRunOutcome(conversation.id, 'run-2', 'finished')
    expect(store.getLatestRunOutcome(conversation.id)).toMatchObject({
      runId: 'run-2',
      status: 'finished'
    })

    // Malformed legacy error_json degrades to no error rather than throwing.
    db.prepare(
      "UPDATE runs SET error_json = NULL, status = 'failed' WHERE external_run_id = ?"
    ).run(['run-2'])
    expect(store.getLatestRunOutcome(conversation.id)).toMatchObject({
      runId: 'run-2',
      status: 'failed'
    })
    expect(store.getLatestRunOutcome(conversation.id)?.error).toBeUndefined()
  })

  it('does not let a late finishPromptDiagnostic overwrite a failed run outcome', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const runRow = (runId: string): { status: string; error_json: string | null } =>
      db
        .prepare('SELECT status, error_json FROM runs WHERE id = ?')
        .get([`${conversation.id}:${runId}`]) as { status: string; error_json: string | null }

    store.recordPromptDiagnostic({
      id: 'diag-1',
      conversationId: conversation.id,
      runId: 'run-1',
      stepNumber: 1,
      createdAt: 1,
      modelRef: 'openai:gpt-5',
      provider: 'openai',
      systemHash: 's',
      systemChars: 1,
      messagesHash: 'm',
      messagesChars: 2,
      toolsHash: 't',
      toolsJson: '[]',
      providerOptionsHash: 'p',
      providerOptionsJson: '{}',
      promptHash: 'h',
      promptChars: 3,
      segmentsJson: '[]'
    })
    store.markRunOutcome(conversation.id, 'run-1', 'failed', '{"kind":"stream-error"}')
    store.finishPromptDiagnostic({
      conversationId: conversation.id,
      runId: 'run-1',
      stepNumber: 1,
      usageJson: '{}',
      finishReason: 'stop',
      inputTokens: 5
    })

    expect(runRow('run-1')).toEqual({ status: 'failed', error_json: '{"kind":"stream-error"}' })
  })

  it('prunes activity history older than the retention window', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const conversation = store.createConversation({})
    const now = Date.now()
    db.prepare(
      `INSERT INTO runs (id, conversation_id, external_run_id, model_ref, provider, status, started_at)
       VALUES (?, ?, ?, 'openai:gpt', 'openai', 'finished', ?)`
    ).run([`${conversation.id}:old`, conversation.id, 'old', now - 100_000])
    db.prepare(
      `INSERT INTO runs (id, conversation_id, external_run_id, model_ref, provider, status, started_at)
       VALUES (?, ?, ?, 'openai:gpt', 'openai', 'finished', ?)`
    ).run([`${conversation.id}:new`, conversation.id, 'new', now])
    store.recordToolExecution({
      id: 'tool-old',
      runId: `${conversation.id}:new`,
      conversationId: conversation.id,
      toolName: 'shell',
      success: true,
      createdAt: now - 100_000
    })

    store.pruneActivityHistory(50_000)

    expect(countRows(db, 'runs')).toBe(1)
    expect(countRows(db, 'runs', 'external_run_id = ?', ['new'])).toBe(1)
    expect(countRows(db, 'tool_executions')).toBe(0)
  })

  it('persists queued messages per conversation and cascades them on delete', () => {
    const db = createRealDb()
    const store = createAgentStore(db, identity(), logger(), root)
    const first = store.createConversation({})
    const second = store.createConversation({})

    store.saveQueuedMessages(first.id, ['one', 'two'])
    store.saveQueuedMessages(second.id, ['three'])
    expect(store.listAllQueuedMessages()).toHaveLength(2)
    expect(store.listAllQueuedMessages()).toEqual(
      expect.arrayContaining([
        { chatId: first.id, items: ['one', 'two'] },
        { chatId: second.id, items: ['three'] }
      ])
    )

    store.saveQueuedMessages(first.id, ['two'])
    expect(store.listAllQueuedMessages().find((entry) => entry.chatId === first.id)?.items).toEqual(
      ['two']
    )

    store.saveQueuedMessages(second.id, [])
    expect(countRows(db, 'queued_messages', 'conversation_id = ?', [second.id])).toBe(0)

    store.deleteConversation(first.id)
    expect(countRows(db, 'queued_messages')).toBe(0)
    expect(store.listAllQueuedMessages()).toEqual([])
  })
})
