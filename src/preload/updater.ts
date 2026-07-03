import { UPDATER_CHANNELS, type UpdaterApi, type UpdaterState } from '@shared/updater'
import { invoke, subscribe } from './invoke'

export const updaterApi: UpdaterApi = {
  getState: invoke<() => Promise<UpdaterState>>(UPDATER_CHANNELS.getState),
  download: invoke<() => Promise<void>>(UPDATER_CHANNELS.download),
  install: invoke<() => Promise<void>>(UPDATER_CHANNELS.install),
  onStateChanged: (callback: (state: UpdaterState) => void) =>
    subscribe<UpdaterState>(UPDATER_CHANNELS.stateChanged, callback)
}
