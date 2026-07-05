import type { ConversationSummary, WorkspaceSummary } from '@shared/chat'
import type { WorkspaceRecord } from './workspace-store'

export interface SidebarSessionRowModel {
  sessionId: string
  title: string
  lastActivityAt: number | null
  isStreaming: boolean
  isPinned: boolean
}

export interface SidebarConversationFamilyModel {
  familyId: string
  mainSession: SidebarSessionRowModel
  branchCount: number
  branches: SidebarSessionRowModel[]
  /** Stable id arrays so memoized rows keep referential equality across renders. */
  familySessionIds: string[]
  branchSessionIds: string[]
}

export interface SidebarWorkspaceGroupModel {
  key: string
  workspaceId: string
  workspaceName: string
  sessionCount: number
  isActive: boolean
  isExpanded: boolean
  families: SidebarConversationFamilyModel[]
}

export interface SidebarModel {
  hydrated: boolean
  groups: SidebarWorkspaceGroupModel[]
}

export interface BuildSidebarModelInput {
  conversations: ConversationSummary[]
  currentWorkspaceId: string | null
  expandedById: Readonly<Record<string, boolean>>
  runningChatIds?: ReadonlySet<string>
  workspaces?: ReadonlyArray<WorkspaceRecord>
  hydrated: boolean
}

export function deriveWorkspacesFromConversations(
  conversations: ReadonlyArray<ConversationSummary>,
  expandedById: Readonly<Record<string, boolean>>,
  persistedWorkspaces: ReadonlyArray<WorkspaceSummary> = []
): WorkspaceRecord[] {
  const workspaceById = new Map<string, WorkspaceRecord>()
  for (const workspace of persistedWorkspaces) {
    workspaceById.set(workspace.id, {
      id: workspace.id,
      label: workspace.name || fallbackTitleFromCwd(workspace.rootPath) || workspace.id,
      cwd: workspace.rootPath,
      createdAt: workspace.createdAt,
      lastActivityAt: workspace.updatedAt,
      expanded: expandedById[workspace.id] ?? true
    })
  }

  for (const conversation of conversations) {
    const existing = workspaceById.get(conversation.workspaceId)
    if (existing) {
      const previousLastActivityAt = existing.lastActivityAt
      existing.createdAt = Math.min(existing.createdAt, conversation.createdAt)
      existing.lastActivityAt = Math.max(existing.lastActivityAt, conversation.updatedAt)
      if (conversation.updatedAt >= previousLastActivityAt) existing.cwd = conversation.cwd
      continue
    }

    workspaceById.set(conversation.workspaceId, {
      id: conversation.workspaceId,
      label:
        conversation.workspaceName ||
        fallbackTitleFromCwd(conversation.cwd) ||
        conversation.workspaceId,
      cwd: conversation.cwd,
      createdAt: conversation.createdAt,
      lastActivityAt: conversation.updatedAt,
      expanded: expandedById[conversation.workspaceId] ?? true
    })
  }

  return [...workspaceById.values()]
}

export function buildSidebarModel({
  conversations,
  currentWorkspaceId,
  expandedById,
  runningChatIds,
  workspaces,
  hydrated
}: BuildSidebarModelInput): SidebarModel {
  const visibleConversations = conversations.filter(
    (conversation) => conversation.parentRelation !== 'subagent'
  )

  const workspaceRecords =
    workspaces ?? deriveWorkspacesFromConversations(visibleConversations, expandedById)

  if (visibleConversations.length === 0 && workspaceRecords.length === 0) {
    return { hydrated, groups: [] }
  }

  const byId = new Map(visibleConversations.map((conversation) => [conversation.id, conversation]))
  const branchesByParent = new Map<string, ConversationSummary[]>()
  const rootIds = new Set<string>()
  for (const conversation of visibleConversations) {
    if (
      conversation.parentRelation === 'fork' &&
      conversation.parentConversationId &&
      byId.has(conversation.parentConversationId)
    ) {
      const branches = branchesByParent.get(conversation.parentConversationId)
      if (branches) branches.push(conversation)
      else branchesByParent.set(conversation.parentConversationId, [conversation])
      continue
    }
    rootIds.add(conversation.id)
  }

  const byWorkspace = new Map<string, ConversationSummary[]>()
  for (const conversation of visibleConversations) {
    const list = byWorkspace.get(conversation.workspaceId)
    if (list) list.push(conversation)
    else byWorkspace.set(conversation.workspaceId, [conversation])
  }

  const ordered = workspaceRecords.slice().sort((a, b) => {
    if (a.id === currentWorkspaceId) return -1
    if (b.id === currentWorkspaceId) return 1
    return effectiveWorkspaceActivity(b, byWorkspace) - effectiveWorkspaceActivity(a, byWorkspace)
  })

  return {
    hydrated,
    groups: ordered.map((workspace) => {
      const workspaceConversations = (byWorkspace.get(workspace.id) ?? [])
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const rootConversations = workspaceConversations
        .filter((conversation) => rootIds.has(conversation.id))
        .sort((a, b) => {
          const aPinned = a.pinnedAt != null
          const bPinned = b.pinnedAt != null
          if (aPinned !== bPinned) return aPinned ? -1 : 1
          if (aPinned && bPinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
          return familyActivity(b, branchesByParent) - familyActivity(a, branchesByParent)
        })

      return {
        key: workspace.id,
        workspaceId: workspace.id,
        workspaceName: workspace.label,
        sessionCount: workspaceConversations.length,
        isActive: workspace.id === currentWorkspaceId,
        isExpanded: workspace.expanded,
        families: rootConversations.map((conversation): SidebarConversationFamilyModel => {
          const branches = (branchesByParent.get(conversation.id) ?? [])
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
          const branchRows = branches.map((branch) => sessionRow(branch, runningChatIds))
          const branchSessionIds = branches.map((branch) => branch.id)

          return {
            familyId: conversation.id,
            branchCount: branches.length,
            mainSession: sessionRow(conversation, runningChatIds),
            branches: branchRows,
            familySessionIds: [conversation.id, ...branchSessionIds],
            branchSessionIds
          }
        })
      }
    })
  }
}

function sessionRow(
  conversation: ConversationSummary,
  runningChatIds?: ReadonlySet<string>
): SidebarSessionRowModel {
  return {
    sessionId: conversation.id,
    title: conversation.title || fallbackTitleFromCwd(conversation.cwd) || conversation.id,
    lastActivityAt: conversation.updatedAt,
    isStreaming: runningChatIds?.has(conversation.id) ?? false,
    isPinned: conversation.pinnedAt != null
  }
}

function familyActivity(
  conversation: ConversationSummary,
  branchesByParent: Map<string, ConversationSummary[]>
): number {
  return Math.max(
    conversation.updatedAt,
    ...(branchesByParent.get(conversation.id) ?? []).map((branch) => branch.updatedAt)
  )
}

function effectiveWorkspaceActivity(
  workspace: WorkspaceRecord,
  byWorkspace: Map<string, ConversationSummary[]>
): number {
  return Math.max(
    workspace.lastActivityAt,
    ...(byWorkspace.get(workspace.id) ?? []).map((conversation) => conversation.updatedAt)
  )
}

function fallbackTitleFromCwd(cwd: string): string | null {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).filter(Boolean).pop()
  return segment && segment.length > 0 ? segment : null
}
