import { tool, zodSchema, type Tool, type ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { ToolDeps } from './types'
import { toolResultToModelOutput } from './model-output'
import { noteInputSchema, noteOutputSchema } from './tool-schemas'

export function noteTool(
  deps: ToolDeps,
  chatId: string
): Tool<TanzoTools['note']['input'], TanzoTools['note']['output']> {
  return tool<TanzoTools['note']['input'], TanzoTools['note']['output'], Record<string, unknown>>({
    description:
      'Send the parent a mid-task note — a finding, surprise, blocker, or partial result worth ' +
      'acting on before you finish. The note wakes the parent immediately if it is awaiting you, ' +
      'handing it your note and current progress; it can then keep waiting, steer you, or stop ' +
      'you. This does not end your run and is not your deliverable: your deliverable is the ' +
      'final message you produce when your work is done. Use notes for real signal, not to ' +
      'narrate routine steps. Live progress (which tools you run) is tracked automatically — you ' +
      'do not report it.',
    inputSchema: zodSchema(noteInputSchema),
    outputSchema: zodSchema(noteOutputSchema),
    metadata: { tanzo: { kind: 'read', component: 'SubagentCard' } },
    toModelOutput: toolResultToModelOutput,
    execute({ note }) {
      deps.addTaskNote(chatId, note)
      return { ok: true }
    }
  })
}

export function subagentNoteTools(deps: ToolDeps, chatId: string): ToolSet {
  return {
    note: noteTool(deps, chatId)
  }
}
