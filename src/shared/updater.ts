export const UPDATER_CHANNELS = {
  stateChanged: 'updater:state-changed',
  getState: 'updater:get-state',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install'
} as const

export type UpdaterStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterState {
  status: UpdaterStatus

  version: string | null

  percent: number

  bytesPerSecond: number

  transferred: number

  total: number
}

export const INITIAL_UPDATER_STATE: UpdaterState = {
  status: 'idle',
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0
}

export interface UpdaterApi {
  getState(): Promise<UpdaterState>
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  onStateChanged(callback: (state: UpdaterState) => void): () => void
}
