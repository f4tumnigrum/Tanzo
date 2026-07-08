import { tool, zodSchema, type Tool, type ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { ToolDeps } from './types'
import { toolResultToModelOutput } from './model-output'
import { toolError } from './builtin/shared'
import { reportInputSchema, reportOutputSchema } from './tool-schemas'

export function reportTool(
  deps: ToolDeps,
  chatId: string
): Tool<TanzoTools['report']['input'], TanzoTools['report']['output']> {
  return tool<
    TanzoTools['report']['input'],
    TanzoTools['report']['output'],
    Record<string, unknown>
  >({
    description:
      'Report progress and findings. Pass phase to announce the step you are starting (call ' +
      'before each major phase; shown live in the UI, sampled by the parent when it awaits ' +
      'you). Pass note for a mid-task finding the parent should know (surfaced via await; use ' +
      'for signal, not narration). Pass result to submit your final, self-contained ' +
      'deliverable — submitting a result ends your run immediately, so call it exactly once, ' +
      'when you have the answer.',
    inputSchema: zodSchema(reportInputSchema),
    outputSchema: zodSchema(reportOutputSchema),
    metadata: { tanzo: { kind: 'read', component: 'SubagentCard' } },
    toModelOutput: toolResultToModelOutput,
    execute({ phase, note, result }) {
      if (!phase && !note && !result) {
        return toolError('Provide a phase to report, a note to record, or a result to submit.')
      }
      if (phase) deps.reportTaskPhase(chatId, phase)
      if (note) deps.addTaskNote(chatId, note)
      if (result) deps.submitTaskResult(chatId, { summary: result })
      return { ok: true }
    }
  })
}

export function subagentReportTools(deps: ToolDeps, chatId: string): ToolSet {
  return {
    report: reportTool(deps, chatId)
  }
}
