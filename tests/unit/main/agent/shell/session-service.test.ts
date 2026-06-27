import { afterEach, describe, expect, it } from 'vitest'
import {
  createShellSessionService,
  type ShellSessionService
} from '@main/agent/shell/session-service'

let service: ShellSessionService | undefined

function createService(): ShellSessionService {
  service = createShellSessionService({ defaultYieldTimeMs: 100, maxYieldTimeMs: 5_000 })
  return service
}

afterEach(async () => {
  await service?.close()
  service = undefined
})

describe('main/agent/shell/session-service', () => {
  it('starts a command and drains output through poll', async () => {
    const sessions = createService()
    const started = await sessions.start({
      chatId: 'chat-1',
      command: `node -e "process.stdout.write('hello')"`,
      cwd: process.cwd(),
      yieldTimeMs: 3_000
    })

    expect(started.stdout).toContain('hello')
    expect(started.sessionId).toBeTruthy()

    const polled = await sessions.poll({
      chatId: 'chat-1',
      sessionId: started.sessionId,
      yieldTimeMs: 500
    })

    expect(polled.stdout).toBe('')
    expect(['exited', 'running']).toContain(polled.status)
  })

  it('writes stdin to a running session and stops it', async () => {
    const sessions = createService()
    const started = await sessions.start({
      chatId: 'chat-1',
      command:
        `node -e "process.stdin.setEncoding('utf8');` +
        `process.stdin.on('data',d=>process.stdout.write('got:'+d));setInterval(()=>{},1000)"`,
      cwd: process.cwd(),
      yieldTimeMs: 0
    })

    expect(started.status).toBe('running')
    expect(sessions.list('chat-1')).toHaveLength(1)

    const written = await sessions.write({
      chatId: 'chat-1',
      sessionId: started.sessionId,
      input: 'ping\\n',
      yieldTimeMs: 500
    })

    let stdout = written.stdout
    for (let attempt = 0; attempt < 20 && !stdout.includes('got:ping'); attempt += 1) {
      const polled = await sessions.poll({
        chatId: 'chat-1',
        sessionId: started.sessionId,
        yieldTimeMs: 500
      })
      stdout += polled.stdout
    }

    expect(stdout).toContain('got:ping')

    await expect(sessions.poll({ chatId: 'chat-2', sessionId: started.sessionId })).rejects.toThrow(
      /belongs to another chat/
    )

    await expect(
      sessions.stop({ chatId: 'chat-1', sessionId: started.sessionId })
    ).resolves.toEqual({
      stopped: true,
      sessionId: started.sessionId
    })
  })
})
