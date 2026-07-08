import { useCallback, useMemo, useState, type RefObject } from 'react'
import { isSlashCommandAvailable, type SlashCommandDef } from '@shared/slash-command'
import { orderSlashCommands } from './slash-command-order'

export function getSlashQuery(value: string, canOpenSlash: boolean): string | null {
  if (!canOpenSlash) return null
  const match = /^\/([a-z0-9-]*)$/i.exec(value)
  return match ? match[1].toLowerCase() : null
}

export function executesOnSelect(command: SlashCommandDef): boolean {
  return command.kind === 'action' && !command.argsHint && !command.insertText
}

export interface UseSlashMenuArgs {
  value: string
  setValue: (next: string) => void
  slashCommands: SlashCommandDef[]
  isStreaming: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onSubmit?: (text: string) => void | Promise<void>
}

export interface UseSlashMenuResult {
  slashMenuOpen: boolean
  slashMatches: SlashCommandDef[]
  slashHighlight: number
  setSlashHighlight: React.Dispatch<React.SetStateAction<number>>
  selectSlashCommand: (command: SlashCommandDef) => Promise<void>
  resetHighlightOnQueryChange: (nextValue: string) => void
  handleSlashKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    composing: boolean
  ) => boolean
}

export function useSlashMenu({
  value,
  setValue,
  slashCommands,
  isStreaming,
  textareaRef,
  onSubmit
}: UseSlashMenuArgs): UseSlashMenuResult {
  const [slashHighlight, setSlashHighlight] = useState(0)

  const canOpenSlash = slashCommands.length > 0
  const slashQuery = useMemo(() => getSlashQuery(value, canOpenSlash), [value, canOpenSlash])
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return []
    const ordered = orderSlashCommands(slashCommands)
    if (!slashQuery) return ordered
    return ordered.filter((command) => command.name.toLowerCase().startsWith(slashQuery))
  }, [slashQuery, slashCommands])
  const slashMenuOpen = slashQuery !== null && slashMatches.length > 0

  const insertSlash = useCallback(
    (command: SlashCommandDef) => {
      setValue(command.insertText ?? `/${command.name} `)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
      })
    },
    [setValue, textareaRef]
  )

  const selectSlashCommand = useCallback(
    async (command: SlashCommandDef) => {
      if (!isSlashCommandAvailable(command, isStreaming)) return
      if (executesOnSelect(command)) {
        setValue('')
        await onSubmit?.(`/${command.name}`)
        return
      }
      insertSlash(command)
    },
    [insertSlash, isStreaming, onSubmit, setValue]
  )

  const resetHighlightOnQueryChange = useCallback(
    (nextValue: string) => {
      if (getSlashQuery(nextValue, canOpenSlash) !== slashQuery) {
        setSlashHighlight(0)
      }
    },
    [canOpenSlash, slashQuery]
  )

  const handleSlashKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, composing: boolean): boolean => {
      if (!slashMenuOpen) return false
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashHighlight((index) => (index + 1) % slashMatches.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashHighlight((index) => (index - 1 + slashMatches.length) % slashMatches.length)
        return true
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !composing) {
        event.preventDefault()
        const command = slashMatches[slashHighlight] ?? slashMatches[0]
        if (command && isSlashCommandAvailable(command, isStreaming))
          void selectSlashCommand(command)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setValue('')
        return true
      }
      return false
    },
    [slashMenuOpen, slashMatches, slashHighlight, isStreaming, selectSlashCommand, setValue]
  )

  return {
    slashMenuOpen,
    slashMatches,
    slashHighlight,
    setSlashHighlight,
    selectSlashCommand,
    resetHighlightOnQueryChange,
    handleSlashKeyDown
  }
}
