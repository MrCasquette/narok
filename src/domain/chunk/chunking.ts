import type { Document } from '../document/Document.js'
import type { Chunk } from './Chunk.js'

const DEFAULT_MAX_WORDS = 300
const DEFAULT_OVERLAP_WORDS = 40

function splitIntoSections(content: string): string[] {
  const lines = content.split('\n')
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim())
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) sections.push(current.join('\n').trim())

  return sections.filter((section) => section.length > 0)
}

function splitByWordCount(text: string, maxWords: number, overlapWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return [text]

  const parts: string[] = []
  let start = 0
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length)
    parts.push(words.slice(start, end).join(' '))
    if (end >= words.length) break
    start = end - overlapWords
  }
  return parts
}

export function chunkDocument(
  document: Document,
  options: { maxWords?: number; overlapWords?: number } = {},
): Chunk[] {
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS
  const overlapWords = options.overlapWords ?? DEFAULT_OVERLAP_WORDS

  const sections = splitIntoSections(document.content)
  const pieces = sections.flatMap((section) => splitByWordCount(section, maxWords, overlapWords))

  return pieces.map((content, position) => ({
    id: crypto.randomUUID(),
    documentId: document.id,
    corpus: document.corpus,
    content,
    position,
  }))
}
