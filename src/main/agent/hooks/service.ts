import { randomUUID } from 'node:crypto'
import type {
  HookEntrySummary,
  HookPreviewResult,
  HookSource,
  HookTrustStatus
} from '@shared/hooks'
import type { PermissionMode } from '@shared/policy'
import { discoverHooks } from './discovery'
import { createHookDispatcher } from './dispatcher'
import { matchNamesForTool } from './tool-aliases'
import { isActive, isEnabled, trustStatus } from './trust'
import { createPendingHookContext, type PendingHookContext } from './pending-context'
import type { HookExecutor } from './executor'
import type { HooksStore } from './store'
import type {
  HookEntry,
  HookInput,
  HookOutcome,
  PermissionModeWire,
  PreToolUseInput,
  PostToolUseInput,
  SessionStartInput,
  StopInput,
  UserPromptSubmitInput
} from './types'

export interface HookSessionMeta {
  cwd: string
  workspaceId?: string
  model: string
  mode: PermissionMode
  transcriptPath?: string | null
}

export interface HookServiceDeps {
  executor: HookExecutor
  store: HooksStore
  userDir?: string
  sessionMeta: (chatId: string) => HookSessionMeta | undefined
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void }

  pluginSources?: () => { source: HookSource; path: string }[]
}

export interface HookService {
  readonly pendingContext: PendingHookContext
  runPreToolUse(input: {
    chatId: string
    toolName: string
    toolInput: unknown
    toolUseId: string
    signal?: AbortSignal
  }): Promise<HookOutcome>
  runPostToolUse(input: {
    chatId: string
    toolName: string
    toolInput: unknown
    toolResponse: unknown
    toolUseId: string
  }): Promise<HookOutcome>
  runUserPromptSubmit(input: { chatId: string; prompt: string }): Promise<HookOutcome>
  runSessionStart(input: {
    chatId: string
    source: SessionStartInput['source']
  }): Promise<HookOutcome>
  runStop(input: {
    chatId: string
    stopHookActive: boolean
    lastAssistantMessage: string | null
  }): Promise<HookOutcome>
  reload(cwd?: string): HookEntrySummary[]
  list(workspaceId?: string): HookEntrySummary[]
  setEnabled(key: string, enabled: boolean, workspaceId?: string): void
  setTrusted(key: string, contentHash: string, workspaceId?: string): void
  preview(key: string): Promise<HookPreviewResult>
}

const MODE_TO_WIRE: Record<PermissionMode, PermissionModeWire> = {
  default: 'default',
  plan: 'plan',
  yolo: 'dontAsk',
  dangerous: 'bypassPermissions'
}

export function createHookService(deps: HookServiceDeps): HookService {
  const pendingContext = createPendingHookContext()
  let entries: HookEntry[] = []
  let lastCwd: string | undefined

  function refresh(cwd: string): HookEntry[] {
    const result = discoverHooks({
      cwd,
      ...(deps.userDir ? { userDir: deps.userDir } : {}),
      ...(deps.pluginSources ? { pluginSources: deps.pluginSources() } : {})
    })
    for (const warning of result.warnings) deps.logger?.warn('hooks config', { warning })
    entries = result.entries
    lastCwd = cwd
    return entries
  }

  function ensure(cwd: string): HookEntry[] {
    if (lastCwd !== cwd || entries.length === 0) return refresh(cwd)
    return entries
  }

  function stateFor(entry: HookEntry, workspaceId?: string) {
    return deps.store.getState(entry.key, workspaceId)
  }

  function activeEntries(cwd: string, workspaceId?: string): HookEntry[] {
    return ensure(cwd).filter((entry) => isActive(entry, stateFor(entry, workspaceId)))
  }

  function commonInput(
    chatId: string,
    meta: HookSessionMeta
  ): {
    session_id: string
    turn_id: string
    transcript_path: string | null
    cwd: string
    model: string
    permission_mode: PermissionModeWire
  } {
    return {
      session_id: chatId,
      turn_id: chatId,
      transcript_path: meta.transcriptPath ?? null,
      cwd: meta.cwd,
      model: meta.model,
      permission_mode: MODE_TO_WIRE[meta.mode]
    }
  }

  async function dispatch(
    chatId: string,
    meta: HookSessionMeta,
    event: HookInput['hook_event_name'],
    matchValues: string[],
    payload: HookInput,
    signal?: AbortSignal
  ): Promise<HookOutcome> {
    const dispatcher = createHookDispatcher({
      executor: deps.executor,
      activeEntries: () => activeEntries(meta.cwd, meta.workspaceId)
    })
    const outcome = await dispatcher.run({
      event,
      matchValues,
      payload,
      cwd: meta.cwd,
      ...(signal ? { signal } : {})
    })
    for (const text of outcome.additionalContext) pendingContext.push(chatId, text)
    for (const text of outcome.feedback) pendingContext.push(chatId, text)
    if (outcome.stopped && outcome.stopReason) pendingContext.push(chatId, outcome.stopReason)
    return outcome
  }

  return {
    pendingContext,

    async runPreToolUse(input) {
      const meta = deps.sessionMeta(input.chatId)
      if (!meta) return emptyResult()
      const payload: PreToolUseInput = {
        hook_event_name: 'PreToolUse',
        ...commonInput(input.chatId, meta),
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId
      }
      return dispatch(
        input.chatId,
        meta,
        'PreToolUse',
        matchNamesForTool(input.toolName),
        payload,
        input.signal
      )
    },

    async runPostToolUse(input) {
      const meta = deps.sessionMeta(input.chatId)
      if (!meta) return emptyResult()
      const payload: PostToolUseInput = {
        hook_event_name: 'PostToolUse',
        ...commonInput(input.chatId, meta),
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_response: input.toolResponse,
        tool_use_id: input.toolUseId
      }
      return dispatch(input.chatId, meta, 'PostToolUse', matchNamesForTool(input.toolName), payload)
    },

    async runUserPromptSubmit(input) {
      const meta = deps.sessionMeta(input.chatId)
      if (!meta) return emptyResult()
      const payload: UserPromptSubmitInput = {
        hook_event_name: 'UserPromptSubmit',
        ...commonInput(input.chatId, meta),
        prompt: input.prompt
      }
      return dispatch(input.chatId, meta, 'UserPromptSubmit', ['*'], payload)
    },

    async runSessionStart(input) {
      const meta = deps.sessionMeta(input.chatId)
      if (!meta) return emptyResult()
      const payload: SessionStartInput = {
        hook_event_name: 'SessionStart',
        session_id: input.chatId,
        transcript_path: meta.transcriptPath ?? null,
        cwd: meta.cwd,
        model: meta.model,
        permission_mode: MODE_TO_WIRE[meta.mode],
        source: input.source
      }
      return dispatch(input.chatId, meta, 'SessionStart', [input.source], payload)
    },

    async runStop(input) {
      const meta = deps.sessionMeta(input.chatId)
      if (!meta) return emptyResult()
      const payload: StopInput = {
        hook_event_name: 'Stop',
        session_id: input.chatId,
        turn_id: input.chatId,
        transcript_path: meta.transcriptPath ?? null,
        cwd: meta.cwd,
        model: meta.model,
        permission_mode: MODE_TO_WIRE[meta.mode],
        stop_hook_active: input.stopHookActive,
        last_assistant_message: input.lastAssistantMessage
      }
      return dispatch(input.chatId, meta, 'Stop', ['*'], payload)
    },

    reload(cwd) {
      refresh(cwd ?? lastCwd ?? process.cwd())
      return this.list()
    },

    list(workspaceId) {
      return entries.map((entry) => toSummary(entry, stateFor(entry, workspaceId)))
    },

    setEnabled(key, enabled, workspaceId) {
      const existing = deps.store.getState(key, workspaceId)
      deps.store.setState(
        key,
        { enabled, ...(existing?.trustedHash ? { trustedHash: existing.trustedHash } : {}) },
        workspaceId
      )
    },

    setTrusted(key, contentHash, workspaceId) {
      const existing = deps.store.getState(key, workspaceId)
      deps.store.setState(
        key,
        { enabled: existing?.enabled ?? true, trustedHash: contentHash },
        workspaceId
      )
    },

    async preview(key) {
      const entry = entries.find((candidate) => candidate.key === key)
      if (!entry) {
        return {
          key,
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: 0,
          timedOut: false,
          error: 'hook not found'
        }
      }
      if (!isActive(entry, stateFor(entry))) {
        return {
          key,
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: 0,
          timedOut: false,
          error: 'hook must be enabled and trusted before preview'
        }
      }
      const result = await deps.executor.run({
        command: entry.command,
        ...(entry.commandWindows ? { commandWindows: entry.commandWindows } : {}),
        stdin: JSON.stringify({ hook_event_name: entry.event, preview: true }),
        cwd: lastCwd ?? process.cwd(),
        timeoutSec: Math.min(entry.timeoutSec, 30)
      })
      return {
        key,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        ...(result.error ? { error: result.error } : {})
      }
    }
  }

  function toSummary(entry: HookEntry, state = stateFor(entry)): HookEntrySummary {
    const trust: HookTrustStatus = trustStatus(entry, state)
    const source: HookSource = entry.source
    return {
      key: entry.key,
      event: entry.event,
      matcher: entry.matcher,
      command: entry.command,
      source,
      ...(entry.configPath ? { configPath: entry.configPath } : {}),
      timeoutSec: entry.timeoutSec,
      ...(entry.statusMessage ? { statusMessage: entry.statusMessage } : {}),
      enabled: isEnabled(entry, state),
      trust,
      contentHash: entry.contentHash
    }
  }
}

function emptyResult(): HookOutcome {
  return { denied: false, stopped: false, feedback: [], additionalContext: [], entries: [] }
}

export function hookContextMessageId(): string {
  return `hook-context:${randomUUID()}`
}
