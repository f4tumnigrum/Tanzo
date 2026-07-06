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
  /** Version offered by the update feed, when one is available. */
  version: string | null
  /** Download progress in the range 0–100 while `status` is `downloading`. */
  percent: number
  /** Current download speed in bytes per second while `status` is `downloading`. */
  bytesPerSecond: number
  /** Bytes downloaded so far while `status` is `downloading`. */
  transferred: number
  /** Total download size in bytes, known once the download starts. */
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
