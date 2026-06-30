import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { encodeIpcError, TanzoValidationError } from '@shared/errors'

export type IpcHandler = (...args: unknown[]) => unknown
export type IpcRegistration = readonly [
  channel: string,
  handler: IpcHandler,
  options?: { readonly passEvent?: boolean }
]

export interface IpcRouterOptions {
  logger?: { warn(message: string, meta?: Record<string, unknown>): void }
}

function isZodError(error: unknown): error is { issues: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  )
}

function normalizeError(error: unknown): unknown {
  if (isZodError(error)) {
    return new TanzoValidationError('IPC_INPUT_INVALID', 'Invalid request payload.', {
      cause: error
    })
  }
  return error
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  registrations: readonly IpcRegistration[],
  options: IpcRouterOptions = {}
): () => void {
  for (const [channel] of registrations) ipcMain.removeHandler(channel)
  for (const [channel, handler, registrationOptions] of registrations) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        const result = registrationOptions?.passEvent ? handler(event, ...args) : handler(...args)
        return result instanceof Promise
          ? result.catch((error) => {
              options.logger?.warn('ipc handler failed', { channel, error })
              throw encodeIpcError(normalizeError(error))
            })
          : result
      } catch (error) {
        options.logger?.warn('ipc handler failed', { channel, error })
        throw encodeIpcError(normalizeError(error))
      }
    })
  }
  return () => {
    for (const [channel] of registrations) ipcMain.removeHandler(channel)
  }
}
