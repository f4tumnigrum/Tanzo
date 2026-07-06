import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  externalizePastedTextParts,
  resolvePastedTextPointers
} from '@main/agent/runtime/pasted-text'

function pastedFilePart(text: string): TanzoUIMessage['parts'][number] {
  return {
    type: 'file',
    mediaType: 'text/plain',
    filename: 'pasted.txt',
    url: `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`
  }
}

describe('externalizePastedTextParts', () => {
  let baseDir: string

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'tanzo-pasted-test-'))
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('writes pasted text to a temp txt and rewrites the part url to file://', async () => {
    const text = 'long pasted content\nwith lines'
    const message: TanzoUIMessage = {
      id: 'm1',
      role: 'user',
      parts: [pastedFilePart(text), { type: 'text', text: 'summarize this' }]
    }

    const result = await externalizePastedTextParts(message, { chatId: 'chat-1', baseDir })

    expect(result.parts).toHaveLength(2)
    const filePart = result.parts[0]
    expect(filePart.type).toBe('file')
    const url = (filePart as { url: string }).url
    expect(url.startsWith('file://')).toBe(true)
    const path = fileURLToPath(url)
    expect(path.startsWith(join(baseDir, 'chat-1'))).toBe(true)
    expect(path.endsWith('.txt')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe(text)
    expect((filePart as { filename?: string }).filename).toBe('pasted.txt')
    expect(result.parts[1]).toEqual({ type: 'text', text: 'summarize this' })
  })

  it('leaves messages without text/plain file parts untouched', async () => {
    const message: TanzoUIMessage = {
      id: 'm2',
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
        { type: 'text', text: 'hi' }
      ]
    }
    const result = await externalizePastedTextParts(message, { chatId: 'chat-1', baseDir })
    expect(result).toBe(message)
  })

  it('leaves non-data-url text/plain parts untouched', async () => {
    const part: TanzoUIMessage['parts'][number] = {
      type: 'file',
      mediaType: 'text/plain',
      url: 'https://example.com/notes.txt'
    }
    const message: TanzoUIMessage = { id: 'm3', role: 'user', parts: [part] }
    const result = await externalizePastedTextParts(message, { chatId: 'chat-1', baseDir })
    expect(result.parts[0]).toBe(part)
  })
})

describe('resolvePastedTextPointers', () => {
  it('replaces externalized file parts with fileRead pointer text', () => {
    const path = join(tmpdir(), 'tanzo-pasted', 'chat-1', 'pasted-abc.txt')
    const messages: TanzoUIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'pasted.txt',
            url: `file://${path}`
          },
          { type: 'text', text: 'summarize this' }
        ]
      }
    ]

    const result = resolvePastedTextPointers(messages)

    const pointer = result[0].parts[0]
    expect(pointer.type).toBe('text')
    const pointerText = (pointer as { text: string }).text
    expect(pointerText).toContain('fileRead')
    expect(pointerText).toContain(path)
    expect(result[0].parts[1]).toEqual({ type: 'text', text: 'summarize this' })
  })

  it('leaves image parts and plain messages untouched', () => {
    const messages: TanzoUIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [
          { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
          { type: 'text', text: 'hi' }
        ]
      },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] }
    ]
    const result = resolvePastedTextPointers(messages)
    expect(result[0]).toBe(messages[0])
    expect(result[1]).toBe(messages[1])
  })
})
