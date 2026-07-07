import { execFile } from 'node:child_process'

export const DEFAULT_GIT_TIMEOUT_MS = 60_000

export interface GitCommandError {
  message: string
}

interface GitExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/

function isFullGitSha(value: string): boolean {
  return FULL_SHA_RE.test(value)
}

function runGit(args: string[], timeoutMs: number): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error && (error as { code?: unknown }).code === 'ENOENT') {
          reject(new Error('git executable not found on PATH'))
          return
        }

        const killed = Boolean(error && (error as { killed?: boolean }).killed)
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: killed })
      }
    )
  })
}

function ensureSuccess(result: GitExecResult, context: string, timeoutMs: number): void {
  if (result.timedOut) {
    const stderr = result.stderr.trim()
    throw new Error(
      stderr
        ? `${context} timed out after ${Math.round(timeoutMs / 1000)}s: ${stderr}`
        : `${context} timed out after ${Math.round(timeoutMs / 1000)}s`
    )
  }
  if (result.code === 0) return
  const stderr = result.stderr.trim()
  throw new Error(
    stderr
      ? `${context} failed with status ${result.code}: ${stderr}`
      : `${context} failed with status ${result.code}`
  )
}

export async function gitRemoteRevision(
  source: string,
  refName: string | undefined,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS
): Promise<string> {
  if (refName && isFullGitSha(refName)) return refName

  const ref = refName ?? 'HEAD'
  const result = await runGit(['ls-remote', source, ref], timeoutMs)
  ensureSuccess(result, 'git ls-remote marketplace source', timeoutMs)

  const firstLine = result.stdout.split('\n').find((line) => line.trim().length > 0)
  if (!firstLine) {
    throw new Error('git ls-remote returned empty output for marketplace source')
  }
  const [revision] = firstLine.split('\t')
  const trimmed = revision?.trim() ?? ''
  if (trimmed.length === 0) {
    throw new Error('git ls-remote returned empty revision for marketplace source')
  }
  return trimmed
}

export async function cloneGitSource(
  source: string,
  refName: string | undefined,
  sparsePaths: string[],
  destination: string,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS
): Promise<string> {
  if (sparsePaths.length === 0) {
    ensureSuccess(
      await runGit(['clone', source, destination], timeoutMs),
      'git clone marketplace source',
      timeoutMs
    )
    if (refName) {
      ensureSuccess(
        await runGit(['-C', destination, 'checkout', refName], timeoutMs),
        'git checkout marketplace ref',
        timeoutMs
      )
    }
    return worktreeRevision(destination, timeoutMs)
  }

  ensureSuccess(
    await runGit(['clone', '--filter=blob:none', '--no-checkout', source, destination], timeoutMs),
    'git clone marketplace source',
    timeoutMs
  )
  ensureSuccess(
    await runGit(['-C', destination, 'sparse-checkout', 'set', ...sparsePaths], timeoutMs),
    'git sparse-checkout marketplace source',
    timeoutMs
  )
  ensureSuccess(
    await runGit(['-C', destination, 'checkout', refName ?? 'HEAD'], timeoutMs),
    'git checkout marketplace ref',
    timeoutMs
  )
  return worktreeRevision(destination, timeoutMs)
}

async function worktreeRevision(destination: string, timeoutMs: number): Promise<string> {
  const result = await runGit(['-C', destination, 'rev-parse', 'HEAD'], timeoutMs)
  ensureSuccess(result, 'git rev-parse marketplace revision', timeoutMs)
  const revision = result.stdout.trim()
  if (revision.length === 0) {
    throw new Error('git rev-parse returned empty revision for marketplace source')
  }
  return revision
}
