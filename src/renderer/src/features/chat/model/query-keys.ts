export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  messages: (chatId: string) => [...chatKeys.all, 'messages', chatId] as const,
  workspaces: () => [...chatKeys.all, 'workspaces'] as const,
  agents: (kind: string) => [...chatKeys.all, 'agents', kind] as const,
  policyRules: () => [...chatKeys.all, 'policy', 'rules'] as const,
  policyModeAll: () => [...chatKeys.all, 'policy', 'mode'] as const,
  policyMode: (chatId?: string) =>
    [...chatKeys.all, 'policy', 'mode', chatId ?? '__global__'] as const,
  policyDecisions: () => [...chatKeys.all, 'policy', 'decisions'] as const,
  slashCommands: (workspaceRoot: string) =>
    [...chatKeys.all, 'slash-commands', workspaceRoot] as const
}
