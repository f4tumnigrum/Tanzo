import type {
  ElectronPlatformInfo,
  ElectronProcessVersions,
  OpenPathResult,
  PickDirectoryArgs
} from '@shared/system'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcError } from './ipc-errors'

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

export const systemClient = {
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
