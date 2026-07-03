import type { HookEvent, HookSource, HookTrustStatus } from '@shared/hooks'

export type { HookEvent, HookSource, HookTrustStatus }

export interface HookEntry {
  key: string
  event: HookEvent
  matcher: string | null
  matches: (value: string) => boolean
  command: string
  commandWindows?: string
  timeoutSec: number
  statusMessage?: string
  source: HookSource
  configPath?: string
  displayOrder: number
  contentHash: string
}

export interface HookState {
  enabled: boolean
  trustedHash?: string
}

export type PermissionModeWire =
  'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'

interface CommonTurnInput {
  session_id: string
  turn_id: string
  agent_id?: string
  agent_type?: string
  transcript_path: string | null
  cwd: string
  model: string
  permission_mode: PermissionModeWire
}

export interface PreToolUseInput extends CommonTurnInput {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export interface PostToolUseInput extends CommonTurnInput {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}

export interface UserPromptSubmitInput extends CommonTurnInput {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

export interface SessionStartInput {
  hook_event_name: 'SessionStart'
  session_id: string
  transcript_path: string | null
  cwd: string
  model: string
  permission_mode: PermissionModeWire
  source: 'startup' | 'resume' | 'clear' | 'compact'
}

export interface StopInput {
  hook_event_name: 'Stop'
  session_id: string
  turn_id: string
  transcript_path: string | null
  cwd: string
  model: string
  permission_mode: PermissionModeWire
  stop_hook_active: boolean
  last_assistant_message: string | null
}

export type HookInput =
  PreToolUseInput | PostToolUseInput | UserPromptSubmitInput | SessionStartInput | StopInput

export interface HookUniversalOutput {
  continue?: boolean
  stopReason?: string
  suppressOutput?: boolean
  systemMessage?: string
}

export interface PreToolUseHookSpecificOutput {
  hookEventName: 'PreToolUse'
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  updatedInput?: unknown
  additionalContext?: string
}

export interface PreToolUseOutput extends HookUniversalOutput {
  decision?: 'approve' | 'block'
  reason?: string
  hookSpecificOutput?: PreToolUseHookSpecificOutput
}

export interface PostToolUseHookSpecificOutput {
  hookEventName: 'PostToolUse'
  additionalContext?: string
  updatedMCPToolOutput?: unknown
}

export interface PostToolUseOutput extends HookUniversalOutput {
  decision?: 'block'
  reason?: string
  hookSpecificOutput?: PostToolUseHookSpecificOutput
}

export interface UserPromptSubmitOutput extends HookUniversalOutput {
  decision?: 'block'
  reason?: string
  hookSpecificOutput?: { hookEventName: 'UserPromptSubmit'; additionalContext?: string }
}

export interface SessionStartOutput extends HookUniversalOutput {
  hookSpecificOutput?: { hookEventName: 'SessionStart'; additionalContext?: string }
}

export interface StopOutput extends HookUniversalOutput {
  decision?: 'block'
  reason?: string
}

export interface HookExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  error?: string
}

export type HookOutputEntryKind = 'warning' | 'stop' | 'feedback' | 'context' | 'error'

export interface HookOutputEntry {
  kind: HookOutputEntryKind
  message: string
  key: string
}

export interface HookOutcome {
  denied: boolean
  denyReason?: string
  stopped: boolean
  stopReason?: string
  feedback: string[]
  additionalContext: string[]
  entries: HookOutputEntry[]
}

export function emptyOutcome(): HookOutcome {
  return {
    denied: false,
    stopped: false,
    feedback: [],
    additionalContext: [],
    entries: []
  }
}
