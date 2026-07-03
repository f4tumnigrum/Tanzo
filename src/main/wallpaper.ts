import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { copyFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  app,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  type BrowserWindow,
  type IpcMain
} from 'electron'
import {
  PREFERENCES_CHANNELS,
  WALLPAPER_MAX_ASSETS,
  type UserPreferences,
  type WallpaperAsset
} from '@shared/preferences'
import { createLogger } from './logger'
import {
  addWallpaperAsset,
  clearAllWallpapers,
  getPreferences,
  removeWallpaperAsset
} from './preferences'

const log = createLogger('wallpaper')

export const WALLPAPER_SCHEME = 'tanzo-asset'
const WALLPAPER_HOST = 'wallpaper'
const WALLPAPER_DIR = 'wallpapers'
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
/** Resize imported images so the long edge does not exceed this value (px). */
const MAX_DIMENSION = 3840
/** Skip native resize for files larger than this (bytes) to avoid OOM. */
const MAX_RESIZE_INPUT_BYTES = 80 * 1024 * 1024

function wallpaperDir(): string {
  return join(app.getPath('userData'), WALLPAPER_DIR)
}

function isSafeFileName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

export function registerWallpaperScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function registerWallpaperProtocol(): void {
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== WALLPAPER_HOST) return new Response('not found', { status: 404 })
      const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!isSafeFileName(fileName)) return new Response('forbidden', { status: 403 })
      const filePath = join(wallpaperDir(), fileName)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      log.error('failed to serve wallpaper asset', error)
      return new Response('error', { status: 500 })
    }
  })
}

/** Delete files in the wallpaper dir that are no longer referenced in prefs. */
async function pruneUnused(): Promise<void> {
  const dir = wallpaperDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const referenced = new Set(
    getPreferences().wallpaper.assets.flatMap((a) => {
      try {
        return [new URL(a.path).pathname.replace(/^\/+/, '')]
      } catch {
        return []
      }
    })
  )
  await Promise.all(
    entries
      .filter((entry) => !referenced.has(entry))
      .map((entry) => rm(join(dir, entry), { force: true }))
  )
}

/**
 * Copy a source image into the wallpaper store, resizing it down if it exceeds
 * MAX_DIMENSION on the long edge. GIFs are copied unchanged (animation support).
 */
async function importFile(sourcePath: string): Promise<WallpaperAsset> {
  const ext = extname(sourcePath).toLowerCase()
  const id = randomBytes(8).toString('hex')
  const fileName = `wallpaper-${id}${ext}`
  const destPath = join(wallpaperDir(), fileName)

  await mkdir(wallpaperDir(), { recursive: true })

  let didResize = false
  if (ext !== '.gif') {
    try {
      const { size } = await stat(sourcePath)
      if (size <= MAX_RESIZE_INPUT_BYTES) {
        const img = nativeImage.createFromPath(sourcePath)
        if (!img.isEmpty()) {
          const { width, height } = img.getSize()
          if (Math.max(width, height) > MAX_DIMENSION) {
            const scale = MAX_DIMENSION / Math.max(width, height)
            const resized = img.resize({
              width: Math.round(width * scale),
              height: Math.round(height * scale),
              quality: 'best'
            })
            const buf = ext === '.png' ? resized.toPNG() : resized.toJPEG(92)
            await writeFile(destPath, buf)
            didResize = true
          }
        }
      }
    } catch (err) {
      log.warn('nativeImage resize failed; falling back to direct copy', err)
    }
  }

  if (!didResize) {
    await copyFile(sourcePath, destPath)
  }

  return {
    id,
    path: `${WALLPAPER_SCHEME}://${WALLPAPER_HOST}/${fileName}`,
    addedAt: new Date().toISOString()
  }
}

async function pickWallpapers(window: BrowserWindow | null): Promise<UserPreferences> {
  const result = await (window
    ? dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }]
      })
    : dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }]
      }))

  if (result.canceled || result.filePaths.length === 0) return getPreferences()

  const existing = getPreferences().wallpaper.assets.length
  const slots = WALLPAPER_MAX_ASSETS - existing
  const paths = result.filePaths.slice(0, Math.max(0, slots))
  if (paths.length === 0) {
    log.warn('wallpaper library full', { max: WALLPAPER_MAX_ASSETS })
    return getPreferences()
  }

  let prefs = getPreferences()
  for (const sourcePath of paths) {
    if (!ALLOWED_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
      log.warn('rejected unsupported extension', { sourcePath })
      continue
    }
    try {
      const asset = await importFile(sourcePath)
      prefs = addWallpaperAsset(asset)
    } catch (err) {
      log.error('failed to import wallpaper', { sourcePath, err })
    }
  }
  return prefs
}

async function removeAsset(id: string): Promise<UserPreferences> {
  const asset = getPreferences().wallpaper.assets.find((a) => a.id === id)
  if (asset) {
    try {
      const fileName = new URL(asset.path).pathname.replace(/^\/+/, '')
      if (isSafeFileName(fileName)) {
        await rm(join(wallpaperDir(), fileName), { force: true })
      }
    } catch (err) {
      log.warn('failed to delete wallpaper file', err)
    }
  }
  return removeWallpaperAsset(id)
}

async function clearAll(): Promise<UserPreferences> {
  const dir = wallpaperDir()
  try {
    const entries = await readdir(dir)
    await Promise.all(entries.map((e) => rm(join(dir, e), { force: true })))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('failed to clear wallpaper dir', err)
    }
  }
  return clearAllWallpapers()
}

export function registerWallpaperIpc(
  mainWindowRef: () => BrowserWindow | null,
  target: IpcMain = ipcMain
): void {
  target.removeHandler(PREFERENCES_CHANNELS.addWallpaper)
  target.removeHandler(PREFERENCES_CHANNELS.removeWallpaper)
  target.removeHandler(PREFERENCES_CHANNELS.clearWallpaper)

  target.handle(PREFERENCES_CHANNELS.addWallpaper, () => pickWallpapers(mainWindowRef()))
  target.handle(PREFERENCES_CHANNELS.removeWallpaper, (_event, id: string) => removeAsset(id))
  target.handle(PREFERENCES_CHANNELS.clearWallpaper, () => clearAll())

  // Best-effort cleanup of orphaned files on startup.
  pruneUnused().catch((err) => log.warn('pruneUnused failed', err))
}
