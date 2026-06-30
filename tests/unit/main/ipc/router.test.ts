import { describe, expect, it, vi } from 'vitest'
import { decodeIpcError, TanzoValidationError } from '@shared/errors'
import { registerIpcHandlers } from '@main/ipc/router'

type Handler = (_event: unknown, ...args: unknown[]) => unknown

function ipcTarget() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    target: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
}

describe('main/ipc/router', () => {
  it('can pass the invoke event to handlers that opt in', () => {
    const { handlers, target } = ipcTarget()
    const event = { sender: { id: 7 } }
    registerIpcHandlers(target as never, [
      ['demo:event', (received: unknown, value: unknown) => ({ received, value }), { passEvent: true }]
    ])

    expect(handlers.get('demo:event')?.(event, 'x')).toEqual({ received: event, value: 'x' })
  })

  it('passes successful sync and async results through untouched', async () => {
    const { handlers, target } = ipcTarget()
    registerIpcHandlers(target as never, [
      ['demo:sync', (value: unknown) => ({ value })],
      ['demo:async', async (value: unknown) => ({ value })]
    ])

    expect(handlers.get('demo:sync')?.(null, 1)).toEqual({ value: 1 })
    await expect(handlers.get('demo:async')?.(null, 2)).resolves.toEqual({ value: 2 })
  })

  it('encodes sync failures as decodable errors without losing sync throw semantics', () => {
    const { handlers, target } = ipcTarget()
    const logger = { warn: vi.fn() }
    registerIpcHandlers(
      target as never,
      [
        [
          'demo:fail',
          () => {
            throw new TanzoValidationError('BAD_INPUT', 'invalid', { details: { field: 'id' } })
          }
        ]
      ],
      { logger }
    )

    let thrown: unknown
    try {
      handlers.get('demo:fail')?.(null)
    } catch (error) {
      thrown = error
    }

    const decoded = decodeIpcError(thrown)
    expect(decoded).toMatchObject({
      code: 'BAD_INPUT',
      message: 'invalid',
      details: { field: 'id' }
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'ipc handler failed',
      expect.objectContaining({ channel: 'demo:fail' })
    )
  })

  it('encodes async rejections as decodable errors', async () => {
    const { handlers, target } = ipcTarget()
    registerIpcHandlers(target as never, [
      [
        'demo:reject',
        async () => {
          throw new Error('downstream exploded')
        }
      ]
    ])

    const rejection = await handlers
      .get('demo:reject')?.(null)
      ?.catch?.((error: unknown) => error)
    const decoded = decodeIpcError(rejection)
    expect(decoded).toMatchObject({ code: 'UNEXPECTED_ERROR', message: 'downstream exploded' })
  })

  it('unregisters every channel on cleanup', () => {
    const { handlers, target } = ipcTarget()
    const unregister = registerIpcHandlers(target as never, [
      ['demo:a', () => 'a'],
      ['demo:b', () => 'b']
    ])

    expect(handlers.size).toBe(2)
    unregister()
    expect(handlers.size).toBe(0)
  })
})
