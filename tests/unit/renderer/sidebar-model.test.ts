import { describe, expect, it } from 'vitest'
import { buildSidebarModel } from '@renderer/features/chat/model/sidebar-model'
import type { ConversationSummary } from '@shared/chat'

function conversation(
  id: string,
  workspaceId = 'workspace-1',
  parentConversationId: string | null = null,
  updatedAt = id === 'chat-1' ? 2 : 3,
  pinnedAt: number | null = null
): ConversationSummary {
  return {
    id,
    title: id,
    agentId: 'main',
    modelRef: 'openai:gpt',
    workspaceId,
    cwd: `/tmp/${workspaceId}`,
    parentConversationId,
    parentRelation: parentConversationId ? 'fork' : null,
    pinnedAt,
    createdAt: 1,
    updatedAt,
    archivedAt: null
  }
}

describe('chat/sidebar-model', () => {
  it('keeps a workspace group visible when it has no conversations', () => {
    const model = buildSidebarModel({
      conversations: [],
      workspaces: [
        {
          id: 'workspace-1',
          label: 'workspace-1',
          cwd: '/tmp/workspace-1',
          createdAt: 1,
          lastActivityAt: 2,
          expanded: true
        }
      ],
      currentWorkspaceId: 'workspace-1',
      expandedById: {},
      hydrated: true
    })

    expect(model.groups).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workspaceName: 'workspace-1',
        sessionCount: 0,
        isActive: true,
        families: []
      })
    ])
  })

  it('marks multiple conversations as streaming independently', () => {
    const model = buildSidebarModel({
      conversations: [conversation('chat-1'), conversation('chat-2')],
      currentWorkspaceId: 'workspace-1',
      expandedById: {},
      runningChatIds: new Set(['chat-1', 'chat-2']),
      hydrated: true
    })

    const rows = model.groups.flatMap((group) => group.families.map((family) => family.mainSession))

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 'chat-1', isStreaming: true }),
        expect.objectContaining({ sessionId: 'chat-2', isStreaming: true })
      ])
    )
  })

  it('groups fork conversations under their root family', () => {
    const model = buildSidebarModel({
      conversations: [
        conversation('root', 'workspace-1', null, 10),
        conversation('branch', 'workspace-1', 'root', 20)
      ],
      currentWorkspaceId: 'workspace-1',
      expandedById: {},
      runningChatIds: new Set(['branch']),
      hydrated: true
    })

    const family = model.groups[0]?.families[0]
    expect(family).toMatchObject({
      familyId: 'root',
      branchCount: 1,
      mainSession: {
        sessionId: 'root'
      },
      branches: [
        expect.objectContaining({
          sessionId: 'branch',
          isStreaming: true
        })
      ]
    })
  })

  it('sorts families by recent branch activity and ignores subagent children', () => {
    const subagent = {
      ...conversation('subagent', 'workspace-1', 'older-root', 100),
      parentRelation: 'subagent' as const
    }
    const model = buildSidebarModel({
      conversations: [
        conversation('newer-root', 'workspace-1', null, 20),
        conversation('older-root', 'workspace-1', null, 10),
        conversation('branch', 'workspace-1', 'older-root', 30),
        subagent
      ],
      currentWorkspaceId: 'workspace-1',
      expandedById: {},
      hydrated: true
    })

    expect(model.groups[0]?.families.map((family) => family.familyId)).toEqual([
      'older-root',
      'newer-root'
    ])
    expect(model.groups[0]?.families[0]?.branches.map((branch) => branch.sessionId)).toEqual([
      'branch'
    ])
  })

  it('sorts pinned families first, most recently pinned on top', () => {
    const model = buildSidebarModel({
      conversations: [
        conversation('active', 'workspace-1', null, 100),
        conversation('pinned-old', 'workspace-1', null, 10, 1),
        conversation('pinned-new', 'workspace-1', null, 5, 2)
      ],
      currentWorkspaceId: 'workspace-1',
      expandedById: {},
      hydrated: true
    })

    expect(model.groups[0]?.families.map((family) => family.familyId)).toEqual([
      'pinned-new',
      'pinned-old',
      'active'
    ])
    expect(model.groups[0]?.families[0]?.mainSession.isPinned).toBe(true)
    expect(model.groups[0]?.families[2]?.mainSession.isPinned).toBe(false)
  })
})
