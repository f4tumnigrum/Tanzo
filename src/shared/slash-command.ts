export type SlashCommandKind = 'action' | 'prompt' | 'skill'
export type SlashCommandSource = 'builtin' | 'agent' | 'command' | 'skill'

/**
 * When a command may run. 'always' keeps it usable while a run is streaming;
 * 'idle' (the default) disables it until the active run finishes.
 */
export type SlashCommandAvailability = 'always' | 'idle'

/**
 * Where a command can be invoked. 'desktop' is the renderer composer;
 * 'channel' is a chat-bridge surface (QQ / Discord / Lark / WeChat).
 * A command with no explicit surfaces defaults to desktop-only.
 */
export type SlashCommandSurface = 'desktop' | 'channel'

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
  surfaces?: SlashCommandSurface[]
}

/** Resolve availability, defaulting to 'idle' when unspecified. */
export function slashCommandAvailability(command: SlashCommandDef): SlashCommandAvailability {
  return command.availability ?? 'idle'
}

/** Whether a command can be invoked given the current streaming state. */
export function isSlashCommandAvailable(command: SlashCommandDef, isStreaming: boolean): boolean {
  return !isStreaming || slashCommandAvailability(command) === 'always'
}

/**
 * Resolve the surfaces a command targets. File-based ('command') commands and
 * skills are surface-agnostic and available everywhere; builtin/agent commands
 * default to desktop-only unless they opt into channels.
 */
export function slashCommandSurfaces(command: SlashCommandDef): SlashCommandSurface[] {
  if (command.surfaces && command.surfaces.length > 0) return command.surfaces
  if (command.source === 'command' || command.source === 'skill') return ['desktop', 'channel']
  return ['desktop']
}

/** Whether a command is exposed on the given surface. */
export function isSlashCommandOnSurface(
  command: SlashCommandDef,
  surface: SlashCommandSurface
): boolean {
  return slashCommandSurfaces(command).includes(surface)
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

/**
 * Built-in slash commands, shared across the renderer composer and (future)
 * chat-bridge surfaces. Descriptions are i18n keys resolved by the renderer;
 * non-desktop surfaces fall back to the command name.
 */
export const BUILTIN_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: 'compact',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.compact',
    availability: 'idle',
    surfaces: ['desktop', 'channel']
  },
  {
    name: 'goal',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.goal',
    argsHint: '<objective> | clear | pause | resume',
    availability: 'always',
    surfaces: ['desktop', 'channel'],
    subcommands: [
      { value: 'clear', descriptionKey: 'chat.composer.slashCommands.subcommands.goal.clear' },
      { value: 'pause', descriptionKey: 'chat.composer.slashCommands.subcommands.goal.pause' },
      { value: 'resume', descriptionKey: 'chat.composer.slashCommands.subcommands.goal.resume' }
    ]
  },
  {
    name: 'agent',
    kind: 'action',
    source: 'agent',
    descriptionKey: 'chat.composer.slashCommands.descriptions.agent',
    argsHint: '<name|id>',
    availability: 'idle',
    surfaces: ['desktop']
  },
  // Channel-only controls. These replace/augment the free-text keyword flow on
  // chat bridges; the desktop app exposes these actions through its own UI.
  {
    name: 'status',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.status',
    availability: 'always',
    surfaces: ['channel']
  },
  {
    name: 'stop',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.stop',
    availability: 'always',
    surfaces: ['channel']
  },
  {
    name: 'approve',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.approve',
    availability: 'always',
    surfaces: ['channel']
  },
  {
    name: 'deny',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.deny',
    availability: 'always',
    surfaces: ['channel']
  },
  {
    name: 'clear',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.clear',
    surfaces: ['channel']
  },
  {
    name: 'rename',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.rename',
    availability: 'always',
    surfaces: ['channel']
  },
  {
    name: 'workspace',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.workspace',
    surfaces: ['channel']
  },
  {
    name: 'help',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.help',
    availability: 'always',
    surfaces: ['channel']
  }
]

/**
 * Assemble the command catalog exposed on a given surface: built-ins that opt
 * into the surface, plus dynamic (file/skill) commands, which are
 * surface-agnostic. Dynamic commands override built-ins of the same name.
 */
export function surfaceSlashCommands(
  surface: SlashCommandSurface,
  dynamic: SlashCommandDef[]
): SlashCommandDef[] {
  const dynamicNames = new Set(dynamic.map((command) => command.name))
  const builtins = BUILTIN_SLASH_COMMANDS.filter(
    (command) => isSlashCommandOnSurface(command, surface) && !dynamicNames.has(command.name)
  )
  const dynamicOnSurface = dynamic.filter((command) => isSlashCommandOnSurface(command, surface))
  return [...builtins, ...dynamicOnSurface]
}

/**
 * The outcome of interpreting a submitted text against a command catalog,
 * with no side effects. Both the renderer composer and the chat-bridge use
 * this to decide how to act on a user's input.
 *
 * - `passthrough`: not a slash command (or an unknown one treated as text on
 *   desktop) — send the original text as a normal message.
 * - `unknown`: a slash-shaped input with no matching command. Callers on
 *   text-only surfaces should report this instead of sending it to the model.
 * - `action`: a builtin/agent action to execute via the surface's handler.
 * - `prompt`: a file/template command; `text` is already expanded.
 * - `skill`: invoke a skill; `text` is the ready-to-send instruction.
 */
export type SlashInvocation =
  | { type: 'passthrough'; text: string }
  | { type: 'unknown'; name: string }
  | { type: 'action'; command: SlashCommandDef; args: string }
  | { type: 'prompt'; command: SlashCommandDef; text: string }
  | { type: 'skill'; command: SlashCommandDef; text: string }

/** Build the ready-to-send instruction text for a skill command. */
export function skillInvocationText(skillName: string, args: string): string {
  const suffix = args.trim() ? ` ${args}` : ''
  return `Use the ${skillName} skill.${suffix}`
}

/**
 * Pure interpretation of submitted text against a command catalog. Performs no
 * side effects; the caller executes the returned invocation on its surface.
 */
export function resolveSlashInvocation(text: string, commands: SlashCommandDef[]): SlashInvocation {
  const parsed = parseSlashInput(text)
  if (!parsed) return { type: 'passthrough', text }

  const command = commands.find((candidate) => candidate.name === parsed.name)
  if (!command) return { type: 'unknown', name: parsed.name }

  if (command.kind === 'prompt' && command.template) {
    return { type: 'prompt', command, text: expandTemplate(command.template, parsed.args) }
  }
  if (command.kind === 'skill' && command.skillName) {
    return { type: 'skill', command, text: skillInvocationText(command.skillName, parsed.args) }
  }
  return { type: 'action', command, args: parsed.args }
}

export const SLASH_COMMAND_CHANNELS = {
  list: 'slash-command:list'
} as const

export type SlashCommandChannel =
  (typeof SLASH_COMMAND_CHANNELS)[keyof typeof SLASH_COMMAND_CHANNELS]

export interface SlashCommandApi {
  list(workspaceRoot: string): Promise<SlashCommandDef[]>
}
