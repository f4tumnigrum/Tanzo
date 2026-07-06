import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { Logger } from './types'

/**
 * Base directory for externalized pasted-text attachments. Registered as a
 * read root on the workspace fs so fileRead can access it in sandboxed modes.
 */
export const PASTED_TEXT_DIR = join(tmpdir(), 'tanzo-pasted')

const DATA_URL_PATTERN = /^data:text\/plain(?:;[^,]*)?;base64,([A-Za-z0-9+/=]*)$/

function decodePastedDataUrl(url: string): string | null {
  const match = DATA_URL_PATTERN.exec(url)
  if (!match) return null
  try {
    return Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return null
  }
}

type UIPart = TanzoUIMessage['parts'][number]

function isExternalizedPastedText(
  part: UIPart
): part is UIPart & { type: 'file'; mediaType: string; url: string } {
  return part.type === 'file' && part.mediaType === 'text/plain' && part.url.startsWith('file://')
}

/**
 * Persists long pasted-text attachments (text/plain data URLs produced by the
 * composer paste handler) to temp .txt files, rewriting each part's url to the
 * file:// location. The transcript keeps the file part (so the UI renders an
 * attachment chip); `resolvePastedTextPointers` swaps it for a fileRead
 * pointer at model-conversion time.
 */
export async function externalizePastedTextParts(
  message: TanzoUIMessage,
  options: { chatId: string; baseDir?: string; logger?: Logger }
): Promise<TanzoUIMessage> {
  if (message.role !== 'user') return message
  if (!message.parts.some((part) => part.type === 'file' && part.mediaType === 'text/plain')) {
    return message
  }
  const dir = join(options.baseDir ?? PASTED_TEXT_DIR, options.chatId)
  const parts = await Promise.all(
    message.parts.map(async (part) => {
      if (part.type !== 'file' || part.mediaType !== 'text/plain') return part
      const text = decodePastedDataUrl(part.url)
      if (text === null) return part
      try {
        await mkdir(dir, { recursive: true })
        const path = join(dir, `pasted-${randomUUID().slice(0, 8)}.txt`)
        await writeFile(path, text, 'utf8')
        return { ...part, url: pathToFileURL(path).href }
      } catch (error) {
        options.logger?.warn('Failed to externalize pasted text; inlining it instead', { error })
        return { type: 'text' as const, text }
      }
    })
  )
  return { ...message, parts }
}

/**
 * Replaces externalized pasted-text file parts with a text pointer telling the
 * model to read the temp .txt with fileRead. Applied to the UI transcript just
 * before convertToModelMessages so the stored messages keep their attachment
 * chips.
 */
export function resolvePastedTextPointers(messages: TanzoUIMessage[]): TanzoUIMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message
    if (!message.parts.some(isExternalizedPastedText)) return message
    return {
      ...message,
      parts: message.parts.map((part) =>
        isExternalizedPastedText(part)
          ? {
              type: 'text' as const,
              text: `[Attachment: the user pasted long text, saved to ${fileURLToPath(part.url)}. Read it with the fileRead tool before responding.]`
            }
          : part
      )
    }
  })
}
