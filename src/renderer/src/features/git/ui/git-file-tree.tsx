import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  FileCode2,
  Folder,
  RotateCcw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GitStatusEntry } from '@shared/git'
import type { GitReviewController, GitReviewSelectedFile } from '../model'
import { DiscardConfirm } from './discard-confirm'
import {
  DeltaStats,
  GIT_DIALOG_ICON_BUTTON_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_LABEL_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  scopeStats
} from './git-dialog-shared'

export interface GitFileTreeLeaf {
  readonly entry: GitStatusEntry
  readonly scope: 'staged' | 'unstaged'
}

interface GitFileTreeFileNode extends GitFileTreeLeaf {
  readonly type: 'file'
  readonly name: string
  readonly path: string
}

interface GitFileTreeDirectoryNode {
  readonly type: 'directory'
  readonly name: string
  readonly path: string
  readonly children: readonly GitFileTreeNode[]
}

type GitFileTreeNode = GitFileTreeDirectoryNode | GitFileTreeFileNode

interface GitFileTreeDraftDirectory {
  readonly type: 'directory'
  readonly name: string
  readonly path: string
  readonly children: Map<string, GitFileTreeDraftNode>
}

interface GitFileTreeDraftFile extends GitFileTreeLeaf {
  readonly type: 'file'
  readonly name: string
  readonly path: string
}

type GitFileTreeDraftNode = GitFileTreeDraftDirectory | GitFileTreeDraftFile

function toFileTreeNode(node: GitFileTreeDraftNode): GitFileTreeNode {
  if (node.type === 'file') return node
  return {
    type: 'directory',
    name: node.name,
    path: node.path,
    children: Array.from(node.children.values())
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(toFileTreeNode)
  }
}

function buildFileTree(entries: readonly GitFileTreeLeaf[]): readonly GitFileTreeNode[] {
  const root: GitFileTreeDraftDirectory = {
    type: 'directory',
    name: '',
    path: '',
    children: new Map()
  }

  for (const leaf of entries) {
    const parts = leaf.entry.path.split(/[/\\]+/).filter(Boolean)
    if (parts.length === 0) continue

    let parent = root
    for (const part of parts.slice(0, -1)) {
      const nextPath = parent.path ? `${parent.path}/${part}` : part
      const key = `directory:${part}`
      const existing = parent.children.get(key)
      if (existing?.type === 'directory') {
        parent = existing
        continue
      }
      const directory: GitFileTreeDraftDirectory = {
        type: 'directory',
        name: part,
        path: nextPath,
        children: new Map()
      }
      parent.children.set(key, directory)
      parent = directory
    }

    const name = parts[parts.length - 1]!
    parent.children.set(`file:${name}:${leaf.scope}`, {
      type: 'file',
      name,
      path: leaf.entry.path,
      entry: leaf.entry,
      scope: leaf.scope
    })
  }

  const treeRoot = toFileTreeNode(root)
  return treeRoot.type === 'directory' ? treeRoot.children : []
}

function FileTreeNodeRow({
  node,
  depth,
  section,
  collapsedDirectories,
  onToggleDirectory,
  selectedFile,
  disabled,
  controller
}: {
  readonly node: GitFileTreeNode
  readonly depth: number
  readonly section: string
  readonly collapsedDirectories: ReadonlySet<string>
  readonly onToggleDirectory: (key: string) => void
  readonly selectedFile: GitReviewSelectedFile | null
  readonly disabled: boolean
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const paddingLeft = 8 + depth * 12

  if (node.type === 'directory') {
    const directoryKey = `${section}:${node.path}`
    const collapsed = collapsedDirectories.has(directoryKey)
    return (
      <div>
        <button
          type="button"
          className="flex h-6 w-full min-w-0 items-center gap-1 rounded-[var(--radius-md)] pr-2 text-left text-foreground/38 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] hover:text-foreground/55 dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]"
          style={{ paddingLeft }}
          aria-expanded={!collapsed}
          onClick={() => onToggleDirectory(directoryKey)}
        >
          <ChevronDown
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              collapsed && '-rotate-90'
            )}
          />
          <Folder className="size-3.5 shrink-0" />
          <span className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_META_CLASSNAME)}>
            {node.name}
          </span>
        </button>
        {!collapsed ? (
          <div className="space-y-px">
            {node.children.map((child) => (
              <FileTreeNodeRow
                key={`${child.type}:${child.path}`}
                node={child}
                depth={depth + 1}
                section={section}
                collapsedDirectories={collapsedDirectories}
                onToggleDirectory={onToggleDirectory}
                selectedFile={selectedFile}
                disabled={disabled}
                controller={controller}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const selected = selectedFile?.path === node.path && selectedFile.scope === node.scope
  const stats = scopeStats(node.entry, node.scope)

  return (
    <div
      className={cn(
        'group/file relative flex h-7 min-w-0 items-center gap-1 rounded-[var(--radius-md)] pr-1 transition-[background-color,color,box-shadow,opacity] duration-150 ease-out',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/50',
        selected
          ? 'bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] dark:bg-[color-mix(in_oklab,var(--sidebar-primary)_15%,transparent)] dark:ring-[color-mix(in_oklab,var(--sidebar-primary)_24%,transparent)]'
          : 'hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]'
      )}
      style={{ paddingLeft }}
    >
      <button
        type="button"
        onClick={() => controller.setSelectedFile({ path: node.path, scope: node.scope })}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <FileCode2
          className={cn(
            'size-3.5 shrink-0',
            selected ? 'text-foreground/70' : 'text-foreground/38'
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[0.8125rem] leading-tight',
            selected ? 'font-medium text-foreground' : 'text-foreground/78'
          )}
        >
          {node.name}
        </span>
        {stats ? <DeltaStats stats={stats} className="shrink-0" /> : null}
        {node.entry.conflicted ? (
          <span className="shrink-0 rounded-full border border-destructive/25 bg-destructive/10 px-1.5 py-px text-[0.5625rem] leading-none text-destructive">
            {t('gitReview.badges.conflict')}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-px opacity-0 transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100">
        {node.scope === 'unstaged' ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={GIT_DIALOG_ICON_BUTTON_CLASSNAME}
              disabled={disabled || node.entry.conflicted}
              aria-label={t('gitReview.aria.stageFile', { path: node.path })}
              onClick={() => void controller.stageFile(node.path)}
            >
              <ArrowDownToLine className="size-3" />
            </Button>
            <DiscardConfirm
              onConfirm={() => void controller.discardFile(node.path)}
              untrackedCount={node.entry.untracked ? 1 : 0}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={GIT_DIALOG_ICON_BUTTON_CLASSNAME}
                  disabled={disabled || node.entry.conflicted}
                  aria-label={
                    node.entry.untracked
                      ? t('gitReview.aria.discardFile', { path: node.path })
                      : t('gitReview.aria.restoreFile', { path: node.path })
                  }
                >
                  <RotateCcw className="size-3" />
                </Button>
              }
            />
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={GIT_DIALOG_ICON_BUTTON_CLASSNAME}
            disabled={disabled}
            aria-label={t('gitReview.aria.unstageFile', { path: node.path })}
            onClick={() => void controller.unstageFile(node.path)}
          >
            <ArrowUpFromLine className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function FileTreeSection({
  title,
  entries,
  collapsedDirectories,
  onToggleDirectory,
  controller
}: {
  readonly title: string
  readonly entries: readonly GitFileTreeLeaf[]
  readonly collapsedDirectories: ReadonlySet<string>
  readonly onToggleDirectory: (key: string) => void
  readonly controller: GitReviewController
}): React.JSX.Element | null {
  const tree = useMemo(() => buildFileTree(entries), [entries])
  if (entries.length === 0) return null
  return (
    <section className="space-y-1">
      <div className="flex min-w-0 items-center gap-1.5 px-2">
        <h3 className={cn('truncate', GIT_DIALOG_TYPO_LABEL_CLASSNAME)}>{title}</h3>
        <span
          className={cn(
            'shrink-0 rounded-full border border-border/20 bg-background/40 px-1.5 py-px text-[0.5625rem] leading-none',
            GIT_DIALOG_TYPO_CODE_META_CLASSNAME
          )}
        >
          {entries.length}
        </span>
      </div>
      <div className="space-y-px">
        {tree.map((node) => (
          <FileTreeNodeRow
            key={`${node.type}:${node.path}`}
            node={node}
            depth={0}
            section={title}
            collapsedDirectories={collapsedDirectories}
            onToggleDirectory={onToggleDirectory}
            selectedFile={controller.selectedFile}
            disabled={controller.mutating}
            controller={controller}
          />
        ))}
      </div>
    </section>
  )
}
