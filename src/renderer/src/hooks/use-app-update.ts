import { useCallback, useEffect, useState } from 'react'
import { INITIAL_UPDATER_STATE, type UpdaterState } from '@shared/updater'
import { updaterClient } from '@/platform/electron/updater-client'
import { createLogger } from '@/common/logger'

const log = createLogger('renderer.app-update')

export interface AppUpdate {
  state: UpdaterState
  download: () => void
  install: () => void
}

export function useAppUpdate(): AppUpdate {
  const [state, setState] = useState<UpdaterState>(INITIAL_UPDATER_STATE)

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

  return { state, download, install }
}
