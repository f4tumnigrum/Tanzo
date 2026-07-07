import { splitMarkdownBlocks } from './markdown-blocks'

export type MarkdownSegment =
  { kind: 'md'; content: string } | { kind: 'xml'; tag: string; body: string }

export interface IncrementalBlocksResult {
  frozen: readonly MarkdownSegment[]

  tail: string
}

export interface IncrementalSplitter {
  update(content: string): IncrementalBlocksResult
}

const RECOGNIZED_XML_TAGS = [
  'thinking',
  'reasoning',
  'toolplan',
  'observation',
  'reflection',
  'response'
] as const

const XML_TAG_PATTERN =
  /<\s*(thinking|reasoning|toolplan|observation|reflection|response)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi

const STANDALONE_MATH_HINT = /\\[a-zA-Z]+|[_^{}]|[=±]|\\frac|\\int|\\oint|\\sum|\\prod/

function looksLikeStandaloneMath(content: string): boolean {
  return STANDALONE_MATH_HINT.test(content)
}

export function normalizeMathDelimiters(content: string): string {
  if (!content) return content
  const segments = content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      let next = segment
      next = next.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (full, expr: string) => {
        const body = expr.trim()
        return body ? `\n$$\n${body}\n$$\n` : full
      })
      next = next.replace(/\\\((.+?)\\\)/g, (full, expr: string) => {
        const body = expr.trim()
        return body ? `$${body}$` : full
      })
      next = next
        .split('\n')
        .map((line) => {
          const match = /^(\s*)\[\s*(.+?)\s*\]\s*$/.exec(line)
          if (!match) return line
          const indent = match[1] ?? ''
          const body = (match[2] ?? '').trim()
          if (!body || !looksLikeStandaloneMath(body)) return line
          return `${indent}$$\n${indent}${body}\n${indent}$$`
        })
        .join('\n')
      return next
    })
    .join('')
}

export function splitSegments(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  const pushMarkdown = (text: string): void => {
    for (const block of splitMarkdownBlocks(text)) {
      segments.push({ kind: 'md', content: block })
    }
  }

  XML_TAG_PATTERN.lastIndex = 0
  while ((match = XML_TAG_PATTERN.exec(content)) !== null) {
    const [full, tag, body] = match
    if (match.index > cursor) pushMarkdown(content.slice(cursor, match.index))
    segments.push({ kind: 'xml', tag: tag?.toLowerCase() ?? 'reasoning', body: body ?? '' })
    cursor = match.index + full.length
  }
  if (cursor < content.length) pushMarkdown(content.slice(cursor))
  return segments
}

const FENCE_LINE = /^(`{3,}|~{3,})/

function countOccurrences(line: string, token: string): number {
  let count = 0
  let at = line.indexOf(token)
  while (at !== -1) {
    count += 1
    at = line.indexOf(token, at + token.length)
  }
  return count
}

export function findFreezeBoundary(text: string): number {
  let fenceChar: '`' | '~' | null = null
  let fenceLen = 0
  let displayMathBalance = 0
  let inlineMathBalance = 0
  let dollarPairTokens = 0
  const xmlBalance = new Map<string, number>()

  let lastSafe = 0
  let pos = 0
  let previousBlank = false

  const stable = (): boolean => {
    if (fenceChar !== null) return false
    if (displayMathBalance > 0 || inlineMathBalance > 0) return false
    if (dollarPairTokens % 2 !== 0) return false
    for (const balance of xmlBalance.values()) {
      if (balance > 0) return false
    }
    return true
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const blank = line.trim().length === 0

    if (!blank && previousBlank && stable() && pos > 0) {
      lastSafe = pos
    }

    const fenceMatch = FENCE_LINE.exec(line.trimStart())
    if (fenceChar !== null) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
    } else if (fenceMatch) {
      fenceChar = fenceMatch[1][0] as '`' | '~'
      fenceLen = fenceMatch[1].length
    } else {
      displayMathBalance += countOccurrences(line, '\\[') - countOccurrences(line, '\\]')
      inlineMathBalance += countOccurrences(line, '\\(') - countOccurrences(line, '\\)')
      dollarPairTokens += countOccurrences(line, '$$')
      for (const tag of RECOGNIZED_XML_TAGS) {
        const opens = countOccurrences(line.toLowerCase(), `<${tag}>`)
        const closes = countOccurrences(line.toLowerCase(), `</${tag}>`)
        if (opens !== closes) {
          xmlBalance.set(tag, (xmlBalance.get(tag) ?? 0) + opens - closes)
        }
      }
    }

    previousBlank = blank
    pos += line.length + 1
  }

  return lastSafe
}

export function createIncrementalSplitter(): IncrementalSplitter {
  let consumed = ''
  let frozen: MarkdownSegment[] = []

  const reset = (): void => {
    consumed = ''
    frozen = []
  }

  return {
    update(content) {
      if (!content.startsWith(consumed)) reset()

      const tail = content.slice(consumed.length)
      const boundary = findFreezeBoundary(tail)
      if (boundary > 0) {
        const region = tail.slice(0, boundary)
        const segments = splitSegments(normalizeMathDelimiters(region))
        if (segments.length > 0) frozen = [...frozen, ...segments]
        consumed += region
      }

      return { frozen, tail: content.slice(consumed.length) }
    }
  }
}
