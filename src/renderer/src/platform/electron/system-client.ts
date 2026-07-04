import type {
  ElectronPlatformInfo,
  ElectronProcessVersions,
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

export const systemClient = {
  pickDirectory(args?: PickDirectoryArgs): Promise<string | null> {
    return requirePickDirectory()(args)
  },
  getPlatform(): Promise<ElectronPlatformInfo> {
    return requireGetPlatform()()
  },
  processVersions(): ElectronProcessVersions {
    return window.electron?.process?.versions ?? {}
  }
}
