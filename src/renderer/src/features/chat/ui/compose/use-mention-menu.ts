import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import type { FileMentionEntry } from '@shared/file-mention'
import { fileMentionClient } from '@/platform/electron/file-mention-client'

const SEARCH_DEBOUNCE_MS = 80
const MAX_PLUGIN_SUGGESTIONS = 5

/** A plugin that can be `@mentioned` to focus the model on its capabilities. */
export interface PluginMentionOption {
  /** The mention token (`displayName ?? pluginName`); matches the main-side namespace. */
  name: string
  description?: string
}

/**
 * A single suggestion in the `@` menu. Plugins (local, instant) and files
 * (remote, searched) share one trigger and one list, distinguished by `kind`.
 */
export type MentionItem =
  | { kind: 'plugin'; name: string; description?: string }
  | ({ kind: 'file' } & FileMentionEntry)

function mentionItemId(item: MentionItem): string {
  return item.kind === 'plugin' ? `plugin:${item.name}` : `file:${item.path}`
}

export interface MentionContext {
  query: string
  start: number
  end: number
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

export function getMentionContext(value: string, cursor: number): MentionContext | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  let start = safeCursor
  while (start > 0 && !/\s/.test(value[start - 1])) start -= 1
  if (value[start] !== '@') return null
  if (!isBoundary(value[start - 1])) return null
  let end = safeCursor
  while (end < value.length && !/\s/.test(value[end])) end += 1
  if (safeCursor < start || safeCursor > end) return null
  return { query: value.slice(start + 1, end), start, end }
}

function formatFileInsertion(entry: FileMentionEntry): string {
  const path = entry.type === 'directory' ? `${entry.path}/` : entry.path
  return /\s/.test(path) ? `"${path}"` : path
}

/** Rank plugins whose name matches the query: prefix matches before substring. */
export function matchPlugins(plugins: PluginMentionOption[], query: string): MentionItem[] {
  const q = query.toLowerCase()
  const scored = plugins
    .map((plugin) => {
      const name = plugin.name.toLowerCase()
      const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1
      return { plugin, rank }
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.plugin.name.localeCompare(b.plugin.name))
    .slice(0, MAX_PLUGIN_SUGGESTIONS)
  return scored.map(({ plugin }) => ({
    kind: 'plugin' as const,
    name: plugin.name,
    ...(plugin.description ? { description: plugin.description } : {})
  }))
}

/**
 * The literal text a selected item writes back. Plugins and directories keep the
 * leading `@` (plugins so the parser matches; directories so the user can drill
 * in); files resolve to a bare path. Returns the insertion plus any trailing
 * separator the caret should land after.
 */
export function buildMentionInsertion(item: MentionItem): { text: string; trailing: string } {
  if (item.kind === 'plugin') return { text: `@${item.name}`, trailing: ' ' }
  if (item.type === 'directory') return { text: `@${item.path}/`, trailing: '' }
  return { text: formatFileInsertion(item), trailing: ' ' }
}

export interface UseMentionMenuArgs {
  value: string
  setValue: (next: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  workspaceRoot: string | null
  isStreaming: boolean
  plugins?: PluginMentionOption[]
}

export interface UseMentionMenuResult {
  mentionMenuOpen: boolean
  mentionItems: MentionItem[]
  mentionHighlight: number
  setMentionHighlight: React.Dispatch<React.SetStateAction<number>>
  selectMention: (item: MentionItem) => void
  syncMention: () => void
  resetHighlightOnQueryChange: (nextValue: string) => void
  handleMentionKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    composing: boolean
  ) => boolean
}

export function useMentionMenu({
  value,
  setValue,
  textareaRef,
  workspaceRoot,
  isStreaming,
  plugins = []
}: UseMentionMenuArgs): UseMentionMenuResult {
  const [cursor, setCursor] = useState(0)
  const [fileEntries, setFileEntries] = useState<FileMentionEntry[]>([])
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)

  // Plugins need no workspace (they live in app state); files do. The menu can
  // therefore open in a fresh conversation to offer plugin mentions alone.
  const canOpen = !isStreaming

  const context = useMemo(() => {
    if (!canOpen) return null
    const next = getMentionContext(value, cursor)
    if (!next) return null
    if (dismissed !== null && dismissed === next.query) return null
    return next
  }, [canOpen, value, cursor, dismissed])

  const contextKey = context ? `${context.start}:${context.query}` : null

  const syncMention = useCallback(() => {
    const el = textareaRef.current
    setCursor(el ? el.selectionStart : value.length)
    setDismissed(null)
  }, [textareaRef, value])

  // Reset the highlight to the top whenever the typed mention query changes, so
  // arrow-key selection stays predictable as the candidate list shifts. Driven
  // synchronously from the change handler (like the slash menu) rather than an
  // effect, which avoids cascading renders and works for plugin-only menus where
  // no async file search resolves to reset it.
  const resetHighlightOnQueryChange = useCallback(
    (nextValue: string) => {
      const el = textareaRef.current
      const nextCursor = el ? el.selectionStart : nextValue.length
      const next = getMentionContext(nextValue, nextCursor)
      if ((next?.query ?? null) !== (context?.query ?? null)) {
        setHighlight(0)
      }
    },
    [textareaRef, context]
  )

  useEffect(() => {
    if (!context || !workspaceRoot) return
    let active = true
    const handle = setTimeout(() => {
      void fileMentionClient
        .search(workspaceRoot, context.query)
        .then((result) => {
          if (!active) return
          setFileEntries(result)
        })
        .catch(() => {
          if (active) setFileEntries([])
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [context, contextKey, workspaceRoot])

  const pluginMatches = useMemo(
    () => (context ? matchPlugins(plugins, context.query) : []),
    [context, plugins]
  )

  // Plugins first (local, instant, few), then files. Stale file entries are
  // gated by `context`, mirroring the original menu, so no synchronous clear is
  // needed when the trigger closes.
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!context) return []
    return [...pluginMatches, ...fileEntries.map((entry) => ({ kind: 'file' as const, ...entry }))]
  }, [context, pluginMatches, fileEntries])

  const mentionMenuOpen = context !== null && mentionItems.length > 0

  const selectMention = useCallback(
    (item: MentionItem) => {
      const target = context ?? getMentionContext(value, textareaRef.current?.selectionStart ?? 0)
      if (!target) return

      const place = (insertion: string, trailing: string, dismissAfter: string | null): void => {
        const next = `${value.slice(0, target.start)}${insertion}${trailing}${value.slice(target.end)}`
        const caret = target.start + insertion.length + trailing.length
        setValue(next)
        setDismissed(dismissAfter)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (!el) return
          el.focus()
          el.setSelectionRange(caret, caret)
          setCursor(caret)
        })
      }

      // Plugins keep `@` (parser match); directories keep `@` + `/`; files
      // resolve to a bare path. Files dismiss the menu for the inserted text.
      const { text, trailing } = buildMentionInsertion(item)
      const dismissAfter = item.kind === 'file' && item.type === 'file' ? text : null
      place(text, trailing, dismissAfter)
    },
    [context, setValue, textareaRef, value]
  )

  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, composing: boolean): boolean => {
      if (!mentionMenuOpen) return false
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((index) => (index + 1) % mentionItems.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((index) => (index - 1 + mentionItems.length) % mentionItems.length)
        return true
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !composing) {
        event.preventDefault()
        const item = mentionItems[highlight] ?? mentionItems[0]
        if (item) selectMention(item)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(context?.query ?? '')
        return true
      }
      return false
    },
    [mentionMenuOpen, mentionItems, highlight, selectMention, context]
  )

  return useMemo(
    () => ({
      mentionMenuOpen,
      mentionItems,
      mentionHighlight: highlight,
      setMentionHighlight: setHighlight,
      selectMention,
      syncMention,
      resetHighlightOnQueryChange,
      handleMentionKeyDown
    }),
    [
      mentionMenuOpen,
      mentionItems,
      highlight,
      selectMention,
      syncMention,
      resetHighlightOnQueryChange,
      handleMentionKeyDown
    ]
  )
}

export { mentionItemId }
