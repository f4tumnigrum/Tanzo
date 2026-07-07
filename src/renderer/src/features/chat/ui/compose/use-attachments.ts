import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileUIPart } from 'ai'
import { toast } from 'sonner'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const LONG_PASTE_THRESHOLD = 2000

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

async function pastedTextToPart(text: string): Promise<FileUIPart> {
  return {
    type: 'file',
    mediaType: 'text/plain',
    filename: 'pasted.txt',
    url: await readBlobAsDataUrl(new Blob([text], { type: 'text/plain' }))
  }
}

function readImageFile(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () =>
      resolve({
        type: 'file',
        mediaType: file.type,
        filename: file.name || 'image',
        url: String(reader.result)
      })
    reader.readAsDataURL(file)
  })
}

export async function filesToImageParts(
  files: Iterable<File>,
  onTooLarge: () => void,
  onNonImage: () => void
): Promise<FileUIPart[]> {
  const parts: FileUIPart[] = []
  let sawTooLarge = false
  let sawNonImage = false
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      sawNonImage = true
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      sawTooLarge = true
      continue
    }
    try {
      parts.push(await readImageFile(file))
    } catch {
      void 0
    }
  }
  if (sawTooLarge) onTooLarge()
  if (sawNonImage) onNonImage()
  return parts
}

export function useAttachments(isStreaming: boolean): {
  attachments: FileUIPart[]
  isDragging: boolean
  addFiles: (files: Iterable<File>) => Promise<void>
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  handleDrop: (event: React.DragEvent<HTMLDivElement>) => void
  handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  handleDragLeave: () => void
  handleFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
} {
  const { t } = useTranslation()
  const [attachments, setAttachments] = useState<FileUIPart[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      const parts = await filesToImageParts(
        files,
        () => toast.error(t('chat.composer.attachments.tooLarge')),
        () => toast.error(t('chat.composer.attachments.onlyImages'))
      )
      if (parts.length > 0) setAttachments((prev) => [...prev, ...parts])
    },
    [t]
  )

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearAttachments = useCallback(() => setAttachments([]), [])

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isStreaming) return
      const files = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith('image/')
      )
      if (files.length > 0) {
        event.preventDefault()
        void addFiles(files)
        return
      }

      const text = event.clipboardData.getData('text/plain')
      if (text.length < LONG_PASTE_THRESHOLD) return
      event.preventDefault()
      void pastedTextToPart(text).then((part) => setAttachments((prev) => [...prev, part]))
    },
    [addFiles, isStreaming]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      if (isStreaming) return
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) void addFiles(files)
    },
    [addFiles, isStreaming]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (isStreaming) return
      if (!Array.from(event.dataTransfer.types).includes('Files')) return
      event.preventDefault()
      setIsDragging(true)
    },
    [isStreaming]
  )

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (files && files.length > 0) void addFiles(Array.from(files))
      event.target.value = ''
    },
    [addFiles]
  )

  return {
    attachments,
    isDragging,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleFileInputChange
  }
}
