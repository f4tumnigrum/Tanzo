export type SlashCommandKind = 'action' | 'prompt' | 'skill'
export type SlashCommandSource = 'builtin' | 'agent' | 'command' | 'skill'

/**
 * When a command may run. 'always' keeps it usable while a run is streaming;
 * 'idle' (the default) disables it until the active run finishes.
 */
export type SlashCommandAvailability = 'always' | 'idle'

export interface SlashCommandSubcommand {
  value: string
  descriptionKey?: string
  description?: string
}

export interface SlashCommandDef {
  name: string
  kind: SlashCommandKind
  source: SlashCommandSource
  descriptionKey?: string
  description?: string
  argsHint?: string
  template?: string
  skillName?: string
  insertText?: string
  availability?: SlashCommandAvailability
  subcommands?: SlashCommandSubcommand[]
}

/** Resolve availability, defaulting to 'idle' when unspecified. */
export function slashCommandAvailability(command: SlashCommandDef): SlashCommandAvailability {
  return command.availability ?? 'idle'
}

/** Whether a command can be invoked given the current streaming state. */
export function isSlashCommandAvailable(command: SlashCommandDef, isStreaming: boolean): boolean {
  return !isStreaming || slashCommandAvailability(command) === 'always'
}

export interface ParsedSlashInput {
  name: string
  args: string
}

const SLASH_INPUT = /^\/([a-z0-9][a-z0-9-]*)(?:[ \t]+([\s\S]*))?$/

export function parseSlashInput(text: string): ParsedSlashInput | null {
  if (!text.startsWith('/')) return null
  const firstLineEnd = text.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  const match = SLASH_INPUT.exec(firstLine)
  if (!match) return null
  const [, name, inlineArgs] = match
  const rest = firstLineEnd === -1 ? '' : text.slice(firstLineEnd + 1)
  const args = [inlineArgs ?? '', rest].filter((part) => part.length > 0).join('\n')
  return { name, args }
}

export function expandTemplate(template: string, args: string): string {
  const positional = args.trim().length > 0 ? args.trim().split(/\s+/) : []
  return template
    .replace(/\$ARGUMENTS\b/g, args)
    .replace(/\$(\d+)/g, (_whole, index: string) => positional[Number(index) - 1] ?? '')
}

export const SLASH_COMMAND_CHANNELS = {
  list: 'slash-command:list'
} as const

export type SlashCommandChannel =
  (typeof SLASH_COMMAND_CHANNELS)[keyof typeof SLASH_COMMAND_CHANNELS]

export interface SlashCommandApi {
  list(workspaceRoot: string): Promise<SlashCommandDef[]>
}
