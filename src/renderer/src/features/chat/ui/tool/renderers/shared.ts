import { Ban, CircleAlert, CircleCheckBig, CircleDashed, Pause, PowerOff } from 'lucide-react'
import type { SubagentTask, SubagentTaskResult } from '@shared/subagent-task'

export const TASK_STATUS_TONE: Record<SubagentTask['status'], { icon: string; dot: string }> = {
  pending: { icon: 'text-muted-foreground/70', dot: 'bg-muted-foreground/40' },
  running: { icon: 'text-primary', dot: 'bg-primary' },
  blocked: { icon: 'text-amber-500', dot: 'bg-amber-500' },
  done: { icon: 'text-emerald-500/85', dot: 'bg-emerald-500/80' },
  failed: { icon: 'text-red-500', dot: 'bg-red-500' },
  cancelled: { icon: 'text-muted-foreground/70', dot: 'bg-muted-foreground/40' }
}

const TASK_STATUS_ICON: Record<SubagentTask['status'], React.ElementType> = {
  pending: CircleDashed,
  running: CircleDashed,
  blocked: Pause,
  done: CircleCheckBig,
  failed: CircleAlert,
  cancelled: Ban
}

export function taskStatusGlyph(
  status: SubagentTask['status'],
  failureKind?: SubagentTaskResult['failureKind']
): { Icon: React.ElementType; tone: string; spin?: boolean } {
  if (status === 'failed' && failureKind === 'app-restart') {
    return { Icon: PowerOff, tone: 'text-muted-foreground/55' }
  }
  return {
    Icon: TASK_STATUS_ICON[status],
    tone: TASK_STATUS_TONE[status].icon,
    ...(status === 'running' ? { spin: true } : {})
  }
}

export function splitDirAndFile(input: string | undefined): { fileName: string; dir: string } {
  if (!input) return { fileName: '', dir: '' }
  const sanitized = input.replace(/\\/g, '/')
  const parts = sanitized.split('/').filter(Boolean)
  if (parts.length === 0) return { fileName: '', dir: '' }
  if (parts.length === 1) return { fileName: parts[0]!, dir: '' }
  const fileName = parts[parts.length - 1]!
  const dir = parts.slice(0, -1).join('/')
  return { fileName, dir }
}

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatBytes(bytes: number | undefined): string | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return undefined
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isToolError(output: unknown): output is { error: true; message: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'error' in output &&
    (output as { error: unknown }).error === true
  )
}
