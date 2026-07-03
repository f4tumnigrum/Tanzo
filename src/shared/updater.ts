export const UPDATER_CHANNELS = {
  stateChanged: 'updater:state-changed',
  getState: 'updater:get-state',
  download: 'updater:download',
  install: 'updater:install'
} as const

export type UpdaterStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  /** Version offered by the update feed, when one is available. */
  version: string | null
  /** Download progress in the range 0–100 while `status` is `downloading`. */
  percent: number
}

export const INITIAL_UPDATER_STATE: UpdaterState = {
  status: 'idle',
  version: null,
  percent: 0
}

export interface UpdaterApi {
  getState(): Promise<UpdaterState>
  download(): Promise<void>
  install(): Promise<void>
  onStateChanged(callback: (state: UpdaterState) => void): () => void
}
