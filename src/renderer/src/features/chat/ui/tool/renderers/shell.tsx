import { useTranslation } from 'react-i18next'
import { AlertTriangle, FolderOpen, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CopyButton,
  PANEL_HEIGHT_LG,
  ToolBadge,
  ToolErrorState,
  ToolHeaderRow,
  ToolMetaChip,
  ToolPreText
} from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'

interface ShellInput {
  command?: string
  workdir?: string
  cmd?: string
  cwd?: string
  timeoutMs?: number
}

interface ShellOutput {
  stdout: string
  stderr: string
  code: number
  reason?: 'exit' | 'error' | 'timeout' | 'abort' | 'closed'
}

interface ShellSessionOutput {
  sessionId: string
  command: string
  cwd: string
  status: 'running' | 'exited' | 'failed' | 'stopped'
  stdout: string
  stderr: string
  exitCode: number | null
  reason?: 'exit' | 'error' | 'timeout' | 'abort' | 'closed'
  truncated: boolean
}

interface ShellListOutput {
  sessions: Array<{
    sessionId: string
    command: string
    cwd: string
    status: ShellSessionOutput['status']
    exitCode: number | null
    reason?: ShellSessionOutput['reason']
  }>
}

function isShellSessionOutput(output: unknown): output is ShellSessionOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    typeof (output as ShellSessionOutput).sessionId === 'string' &&
    typeof (output as ShellSessionOutput).command === 'string' &&
    typeof (output as ShellSessionOutput).status === 'string'
  )
}

function isShellListOutput(output: unknown): output is ShellListOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    Array.isArray((output as ShellListOutput).sessions)
  )
}

function isShellStopOutput(output: unknown): output is { stopped: true; sessionId: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { stopped?: unknown }).stopped === true &&
    typeof (output as { sessionId?: unknown }).sessionId === 'string'
  )
}

type TFn = ReturnType<typeof useTranslation>['t']

function shellExitInfo(
  sessionOutput: ShellSessionOutput | undefined,
  foregroundOutput: ShellOutput | undefined,
  t: TFn
): { text: string; running: boolean } | null {
  if (sessionOutput?.status === 'running') {
    return { text: t('chat.tool.shell.exit.running'), running: true }
  }
  if (sessionOutput?.status === 'stopped') {
    return { text: t('chat.tool.shell.exit.stopped'), running: false }
  }
  if (sessionOutput?.status === 'failed') {
    return { text: t('chat.tool.shell.exit.failed'), running: false }
  }
  if (sessionOutput && sessionOutput.exitCode !== null && sessionOutput.exitCode !== 0) {
    return { text: `exit ${sessionOutput.exitCode}`, running: false }
  }
  if (foregroundOutput?.reason === 'timeout') {
    return { text: t('chat.tool.shell.exit.timeout'), running: false }
  }
  if (foregroundOutput?.reason === 'abort' || foregroundOutput?.reason === 'closed') {
    return { text: t('chat.tool.shell.exit.aborted'), running: false }
  }
  if (foregroundOutput && foregroundOutput.code !== 0) {
    return { text: `exit ${foregroundOutput.code}`, running: false }
  }
  return null
}

function ShellHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as ShellInput | undefined
  const output = context.output
  const sessionOutput = isShellSessionOutput(output) ? output : undefined
  const foregroundOutput =
    output !== undefined &&
    !sessionOutput &&
    !isShellListOutput(output) &&
    !isShellStopOutput(output)
      ? (output as ShellOutput)
      : undefined
  const command = input?.command ?? input?.cmd ?? sessionOutput?.command ?? ''
  const isFinal = context.state === 'output-available'
  const exitInfo = shellExitInfo(sessionOutput, foregroundOutput, t)

  const meta =
    output && isFinal && exitInfo ? (
      <ToolMetaChip text={exitInfo.text} tone={exitInfo.running ? 'info' : 'danger'} />
    ) : null

  return (
    <ToolHeaderRow
      icon={SquareTerminal}
      label="Shell"
      {...(command ? { title: command } : {})}
      state={context.state}
      {...(meta ? { meta } : {})}
      titleClassName="font-mono text-foreground/85"
    />
  )
}

function CommandLine({ cmd }: { cmd: string }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/10 bg-secondary/80 px-2.5 py-1.5 pr-8 font-mono text-[length:var(--code-font-size-sm)] leading-[1.4] backdrop-blur-sm">
      <span className="shrink-0 select-none font-semibold text-emerald-500/80">$</span>
      <span className="min-w-0 flex-1 truncate text-foreground/82">{cmd}</span>
    </div>
  )
}

function StreamLabel({
  text,
  tone
}: {
  text: string
  tone: 'neutral' | 'danger'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 text-[0.5625rem] font-medium uppercase tracking-[0.08em]',
        tone === 'danger' ? 'text-red-500/80' : 'text-muted-foreground/55'
      )}
    >
      {tone === 'danger' ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : null}
      {text}
    </div>
  )
}

function ShellOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const input = context.input as ShellInput | undefined
  const output = context.output
  const sessionOutput = isShellSessionOutput(output) ? output : undefined
  const foregroundOutput =
    output !== undefined &&
    !sessionOutput &&
    !isShellListOutput(output) &&
    !isShellStopOutput(output)
      ? (output as ShellOutput)
      : undefined
  const command = input?.command ?? input?.cmd ?? sessionOutput?.command ?? ''
  const workdir = input?.workdir ?? input?.cwd ?? sessionOutput?.cwd
  const displayWorkdir = workdir && workdir !== '.' && workdir !== './' ? workdir : undefined
  const stdout = sessionOutput?.stdout ?? foregroundOutput?.stdout ?? ''
  const stderr = sessionOutput?.stderr ?? foregroundOutput?.stderr ?? ''
  const isFinal = context.state === 'output-available'

  if (context.state === 'output-error' && !stdout && !stderr) {
    return (
      <ToolErrorState
        className="m-2.5"
        message={context.errorText ?? t('chat.tool.shell.errors.commandFailed')}
      />
    )
  }

  if (isShellListOutput(output)) {
    return (
      <div className="bg-secondary/18 px-2.5 py-1.5">
        {output.sessions.length === 0 ? (
          <p className="font-mono text-[length:var(--code-font-size-sm)] text-muted-foreground/80">
            {t('chat.tool.shell.noSessions')}
          </p>
        ) : (
          <div className="space-y-1">
            {output.sessions.map((session) => (
              <div
                key={session.sessionId}
                className="min-w-0 font-mono text-[length:var(--code-font-size-sm)]"
              >
                <div className="flex items-center gap-1.5">
                  <ToolBadge
                    text={session.status}
                    tone={session.status === 'running' ? 'info' : 'neutral'}
                  />
                  <span className="truncate text-foreground/85">{session.command}</span>
                </div>
                <div className="truncate text-muted-foreground/70">{session.sessionId}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (isShellStopOutput(output)) {
    return (
      <div className="bg-secondary/18 px-2.5 py-1.5 font-mono text-[length:var(--code-font-size-sm)] text-foreground/85">
        {t('chat.tool.shell.stopped')} {output.sessionId}
      </div>
    )
  }

  return (
    <div className="group/term relative">
      {stdout && (
        <div className="pointer-events-none absolute right-1 top-0.5 z-20 opacity-0 transition-opacity group-hover/term:pointer-events-auto group-hover/term:opacity-100">
          <CopyButton text={stdout} />
        </div>
      )}
      <div
        className="scrollbar-elegant overflow-auto bg-secondary/18"
        style={{ maxHeight: PANEL_HEIGHT_LG }}
      >
        <CommandLine cmd={command} />
        {displayWorkdir ? (
          <div className="flex items-center gap-1.5 border-b border-border/8 px-2.5 py-1 font-mono text-[length:var(--code-font-size-xs)] text-muted-foreground/60">
            <FolderOpen className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{displayWorkdir}</span>
          </div>
        ) : null}
        {!stdout && !stderr ? (
          <p className="px-2.5 py-1.5 font-mono text-[length:var(--code-font-size-sm)] text-muted-foreground/80">
            {isFinal ? t('chat.tool.shell.noOutput') : t('chat.tool.common.running')}
          </p>
        ) : (
          <>
            {stdout && (
              <pre className="whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[length:var(--code-font-size-sm)] leading-[1.5] text-foreground/85">
                <ToolPreText text={stdout} />
              </pre>
            )}
            {stderr && (
              <div
                className={cn(
                  'group/stderr relative border-l-2 border-red-500/40 bg-red-500/[0.04]',
                  stdout && 'mt-1 border-t border-t-red-500/10'
                )}
              >
                <div className="pointer-events-none absolute right-1 top-0.5 z-10 opacity-0 transition-opacity group-hover/stderr:pointer-events-auto group-hover/stderr:opacity-100">
                  <CopyButton text={stderr} />
                </div>
                <StreamLabel text="stderr" tone="danger" />
                <pre className="whitespace-pre-wrap break-words px-2.5 pb-1.5 font-mono text-[length:var(--code-font-size-sm)] leading-[1.5] text-red-500/85">
                  <ToolPreText text={stderr} />
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export const shellRenderer: ToolRenderer = {
  Header: ShellHeader,
  Output: ShellOutputComp,
  renderWhenPending: true,
  fullBleed: true
}
