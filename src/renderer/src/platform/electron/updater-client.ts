import type { UpdaterApi, UpdaterState } from '@shared/updater'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requireUpdaterApi(): UpdaterApi {
  const api = window.electron?.updater
  if (!api) {
    throw new TanzoIntegrationError(
      'ELECTRON_UPDATER_API_UNAVAILABLE',
      'Electron updater API is not available'
    )
  }
  return withDecodedIpcErrors(api)
}

export const updaterClient = {
  isAvailable(): boolean {
    return Boolean(window.electron?.updater)
  },
  getState(): Promise<UpdaterState> {
    return requireUpdaterApi().getState()
  },
  check(): Promise<void> {
    return requireUpdaterApi().check()
  },
  download(): Promise<void> {
    return requireUpdaterApi().download()
  },
  install(): Promise<void> {
    return requireUpdaterApi().install()
  },
  onStateChanged(callback: (state: UpdaterState) => void): () => void {
    return requireUpdaterApi().onStateChanged(callback)
  }
}
