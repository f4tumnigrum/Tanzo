import { describe, expect, it } from 'vitest'
import type { ShellEvent } from '@main/agent/shell/types'
import { createShellRunner } from '@main/agent/shell/runner'
import { describeShellRuntime, resolveShellCandidates } from '@main/agent/shell/resolve'

async function collect(iterable: AsyncIterable<ShellEvent>): Promise<ShellEvent[]> {
  const events: ShellEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('main/agent/shell/resolve', () => {
  it('uses configured POSIX shells before bash and sh fallbacks', () => {
    const candidates = resolveShellCandidates({ platform: 'darwin', env: { SHELL: '/bin/zsh' } })

    expect(candidates.map((candidate) => candidate.file)).toEqual(['/bin/zsh', 'bash', 'sh'])
    expect(candidates[0].args('echo ok')).toEqual(['-lc', 'echo ok'])
  })

  it('uses PowerShell candidates before cmd.exe on Windows', () => {
    const candidates = resolveShellCandidates({
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    })

    expect(candidates.map((candidate) => candidate.file)).toEqual([
      'pwsh.exe',
      'powershell.exe',
      'C:\\Windows\\System32\\cmd.exe'
    ])
    expect(candidates[0].args('Write-Output ok')).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Write-Output ok'
    ])
    expect(candidates[2].args('echo ok')).toEqual(['/d', '/s', '/c', 'echo ok'])
  })

  it('describes the Windows runtime syntax and fallback chain', () => {
    expect(describeShellRuntime({ platform: 'win32', env: {} })).toBe(
      'pwsh.exe → powershell.exe → cmd.exe (PowerShell syntax; cmd.exe fallback)'
    )
  })
})

describe('main/agent/shell/runner', () => {
  it('streams stdout, stderr, and final exit events', async () => {
    const runner = createShellRunner()
    const events = await collect(
      runner.spawn(`node -e "process.stdout.write('out'); process.stderr.write('err')"`, {
        cwd: process.cwd(),
        timeout: 4000
      })
    )

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'stdout', data: 'out' },
        { type: 'stderr', data: 'err' },
        { type: 'exit', code: 0, reason: 'exit' }
      ])
    )
  })

  it('reports timeout exits with shell-style timeout code', async () => {
    const runner = createShellRunner()
    const events = await collect(
      runner.spawn(`node -e "setTimeout(() => {}, 2000)"`, { cwd: process.cwd(), timeout: 20 })
    )

    expect(events[events.length - 1]).toEqual({ type: 'exit', code: 124, reason: 'timeout' })
  })
})
