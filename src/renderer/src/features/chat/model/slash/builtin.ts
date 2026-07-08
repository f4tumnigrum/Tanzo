import type { SlashCommandDef } from '@shared/slash-command'

export const BUILTIN_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: 'compact',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.compact',
    availability: 'idle'
  },
  {
    name: 'goal',
    kind: 'action',
    source: 'builtin',
    descriptionKey: 'chat.composer.slashCommands.descriptions.goal',
    argsHint: '<objective> | clear | pause | resume',
    availability: 'always',
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
    availability: 'idle'
  }
]
