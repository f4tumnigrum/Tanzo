import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TanzoValidationError } from '@shared/errors'

const mocks = vi.hoisted(() => ({
  stdioTransport: vi.fn()
}))

vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: class Experimental_StdioMCPTransport {
    config: unknown

    constructor(config: unknown) {
      this.config = config
      mocks.stdioTransport(config)
    }
  }
}))

import { resolveStdioLaunchCommand } from '@main/mcp/stdio-command'
import { createMcpTransport } from '@main/mcp/transport'

describe('main/mcp/transport', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.unstubAllEnvs()
    mocks.stdioTransport.mockClear()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates required stdio command and remote URL fields', async () => {
    await expect(
      createMcpTransport({ name: 'local', transport: 'stdio', enabled: true })
    ).rejects.toThrow(TanzoValidationError)
    await expect(
      createMcpTransport({ name: 'remote', transport: 'http', enabled: true })
    ).rejects.toThrow(TanzoValidationError)
  })

  it('creates remote transports with headers and redirect mode', async () => {
    await expect(
      createMcpTransport({
        name: 'remote',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer token' },
        redirect: 'follow',
        enabled: true
      })
    ).resolves.toEqual({
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer token' },
      redirect: 'follow'
    })
  })

  it('passes normalized stdio config into the MCP transport and strips secrets', async () => {
    vi.stubEnv('PATH', '/bin')
    vi.stubEnv('SECRET_TOKEN', 'present')

    await createMcpTransport({
      name: 'local',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { CUSTOM: 'yes' },
      enabled: true
    })

    expect(mocks.stdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'node',
        args: ['server.js'],
        env: expect.objectContaining({
          PATH: '/bin',
          CUSTOM: 'yes'
        }),
        stderr: 'inherit'
      })
    )
    const call = mocks.stdioTransport.mock.calls[0][0] as { env: Record<string, string> }
    expect(call.env).not.toHaveProperty('SECRET_TOKEN')
  })

  it.each(['npx', 'npm', 'pnpm', 'bunx'])(
    'wraps the Windows %s cmd shim through cmd.exe even when an extensionless shim exists',
    (command) => {
      const binDir = mkdtempSync(join(tmpdir(), 'tanzo-mcp-transport-'))
      tempDirs.push(binDir)
      writeFileSync(join(binDir, command), '#!/bin/sh\n')
      // Use the uppercase extension from PATHEXT so the lookup matches on
      // case-sensitive filesystems (Linux CI), mirroring Windows' behavior of
      // locating the shim via PATHEXT rather than the on-disk casing.
      writeFileSync(join(binDir, `${command}.CMD`), '@echo off\r\n')

      const launch = resolveStdioLaunchCommand(
        command,
        ['--version'],
        {
          PATH: binDir,
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
          ComSpec: 'C:\\Windows\\System32\\cmd.exe'
        },
        { platform: 'win32' }
      )

      expect(launch.command).toBe('C:\\Windows\\System32\\cmd.exe')
      expect(launch.args).toEqual([
        '/d',
        '/c',
        expect.stringMatching(new RegExp(`${command}\\.CMD$`, 'i')),
        '--version'
      ])
    }
  )
})
