import type { Document } from '../document/Document.js'
import type { Chunk } from './Chunk.js'

const DEFAULT_MAX_WORDS = 300
const DEFAULT_OVERLAP_WORDS = 40

// Un chunk pris isolément (ex: une section procédurale profonde dans un long tutoriel) peut ne
// partager aucun mot avec une question formulée au niveau du sujet global du document ("page
// builder" apparaît dans l'intro, pas dans la section qui explique le champ à créer). On préfixe
// donc chaque chunk avec le titre/description du document (frontmatter) pour que le retrieval
// (BM25 et vecteur) reste rattaché au sujet même sur les chunks profonds.
//
// Ce préfixe a été testé à l'exclusion du texte embarqué en vecteur (soupçon de dilution de la
// similarité cosinus entre chunks frères d'un même document) : mesuré NEUTRE à légèrement négatif
// (MRR 0.446 -> 0.433 sur le jeu d'évaluation), donc conservé. C'est même lui qui porte la réponse
// quand le chunk le plus précis n'est pas récupéré — voir docs-internal/conventions.md.
function extractFrontmatter(content: string): { title?: string; description?: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { body: content }

  const frontmatter = match[1] ?? ''
  const title = frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim()
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim()

  return { title, description, body: content.slice(match[0].length) }
}

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

  const { title, description, body } = extractFrontmatter(document.content)
  const contextHeader = title ? `# ${title}${description ? `\n\n${description}` : ''}\n\n` : ''

  const sections = splitIntoSections(body)
  const pieces = sections.flatMap((section) => splitByWordCount(section, maxWords, overlapWords))

  return pieces.map((content, position) => ({
    id: crypto.randomUUID(),
    documentId: document.id,
    corpus: document.corpus,
    content: contextHeader + content,
    position,
  }))
}
