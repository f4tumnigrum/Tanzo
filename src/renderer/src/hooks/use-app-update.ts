import { useCallback, useEffect, useState } from 'react'
import { INITIAL_UPDATER_STATE, type UpdaterState } from '@shared/updater'
import { updaterClient } from '@/platform/electron/updater-client'
import { createLogger } from '@/common/logger'

const log = createLogger('renderer.app-update')

export interface AppUpdate {
  state: UpdaterState
  /** Whether the updater IPC surface exists (packaged Electron builds). */
  available: boolean
  check: () => void
  download: () => void
  install: () => void
}

/** Human-readable byte size, e.g. "12.4 MB". Returns null for unknown sizes. */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** "3.1 MB/s"-style download speed, or null when unknown. */
export function formatSpeed(bytesPerSecond: number): string | null {
  const size = formatBytes(bytesPerSecond)
  return size ? `${size}/s` : null
}

export function useAppUpdate(): AppUpdate {
  const [state, setState] = useState<UpdaterState>(INITIAL_UPDATER_STATE)
  const available = updaterClient.isAvailable()

  useEffect(() => {
    if (!updaterClient.isAvailable()) return

    let cancelled = false
    void updaterClient
      .getState()
      .then((value) => {
        if (!cancelled) setState(value)
      })
      .catch((error) => {
        log.warn('failed to read updater state', error)
      })
    const unsubscribe = updaterClient.onStateChanged((value) => setState(value))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback(() => {
    void updaterClient.check().catch((error) => {
      log.error('failed to check for updates', error)
    })
  }, [])

  const download = useCallback(() => {
    void updaterClient.download().catch((error) => {
      log.error('failed to start update download', error)
    })
  }, [])

  const install = useCallback(() => {
    void updaterClient.install().catch((error) => {
      log.error('failed to start update install', error)
    })
  }, [])

  return { state, available, check, download, install }
}
