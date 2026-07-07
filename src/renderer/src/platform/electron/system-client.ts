import type {
  ElectronPlatformInfo,
  ElectronProcessVersions,
  ElectronSystemPreferences,
  NativeWindowEffect,
  OpenPathResult,
  PickDirectoryArgs,
  WindowControlsApi
} from '@shared/system'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcError } from './ipc-errors'

interface RendererPlatformInfo {
  platform: NodeJS.Platform
  effect: NativeWindowEffect
}

function requireSystemApiError(): TanzoIntegrationError {
  return new TanzoIntegrationError(
    'ELECTRON_SYSTEM_API_UNAVAILABLE',
    'Electron system API is not available'
  )
}

function requirePickDirectory(): (args?: PickDirectoryArgs) => Promise<string | null> {
  const pickDirectory = window.electron?.pickDirectory
  if (!pickDirectory) {
    throw new TanzoIntegrationError(
      'ELECTRON_SYSTEM_API_UNAVAILABLE',
      'Electron system API is not available'
    )
  }
  return withDecodedIpcError(pickDirectory)
}

function requireGetPlatform(): () => Promise<ElectronPlatformInfo> {
  const getPlatform = window.electron?.getPlatform
  if (!getPlatform) {
    throw new TanzoIntegrationError(
      'ELECTRON_SYSTEM_API_UNAVAILABLE',
      'Electron system API is not available'
    )
  }
  return withDecodedIpcError(getPlatform)
}

function requireOpenPath(): (path: string) => Promise<OpenPathResult> {
  const openPath = window.electron?.openPath
  if (!openPath) {
    throw new TanzoIntegrationError(
      'ELECTRON_SYSTEM_API_UNAVAILABLE',
      'Electron system API is not available'
    )
  }
  return withDecodedIpcError(openPath)
}

function requireRevealInFolder(): (path: string) => Promise<OpenPathResult> {
  const revealInFolder = window.electron?.revealInFolder
  if (!revealInFolder) {
    throw new TanzoIntegrationError(
      'ELECTRON_SYSTEM_API_UNAVAILABLE',
      'Electron system API is not available'
    )
  }
  return withDecodedIpcError(revealInFolder)
}

function requireGetSystemPreferences(): () => Promise<ElectronSystemPreferences> {
  const getSystemPreferences = window.electron?.getSystemPreferences
  if (!getSystemPreferences) throw requireSystemApiError()
  return withDecodedIpcError(getSystemPreferences)
}

function requireWindowControls(): WindowControlsApi {
  const windowControls = window.electron?.windowControls
  if (!windowControls) throw requireSystemApiError()
  return windowControls
}

export function isWindowControlsAvailable(): boolean {
  return Boolean(window.electron?.windowControls)
}

export function isSystemApiAvailable(): boolean {
  return Boolean(window.electron)
}

export const systemClient = {
  platformInfo(): RendererPlatformInfo | null {
    return window.electron?.platformInfo ?? null
  },
  getSystemPreferences(): Promise<ElectronSystemPreferences> {
    return requireGetSystemPreferences()()
  },
  onSystemPreferencesChanged(
    callback: (preferences: ElectronSystemPreferences) => void
  ): () => void {
    const subscribe = window.electron?.onSystemPreferencesChanged
    if (!subscribe) throw requireSystemApiError()
    return subscribe(callback)
  },
  windowControls: {
    minimize(): Promise<void> {
      return withDecodedIpcError(requireWindowControls().minimize)()
    },
    toggleMaximize(): Promise<boolean> {
      return withDecodedIpcError(requireWindowControls().toggleMaximize)()
    },
    close(): Promise<void> {
      return withDecodedIpcError(requireWindowControls().close)()
    },
    isMaximized(): Promise<boolean> {
      return withDecodedIpcError(requireWindowControls().isMaximized)()
    }
  },
  pickDirectory(args?: PickDirectoryArgs): Promise<string | null> {
    return requirePickDirectory()(args)
  },
  openPath(path: string): Promise<OpenPathResult> {
    return requireOpenPath()(path)
  },
  revealInFolder(path: string): Promise<OpenPathResult> {
    return requireRevealInFolder()(path)
  },
  getPlatform(): Promise<ElectronPlatformInfo> {
    return requireGetPlatform()()
  },
  processVersions(): ElectronProcessVersions {
    return window.electron?.process?.versions ?? {}
  }
}
