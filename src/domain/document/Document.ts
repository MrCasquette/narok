import type { Static } from 'elysia'
import type { DocumentSchema } from './Document.schema.js'

export type Document = Static<typeof DocumentSchema>

export const Document = {
  hasChanged: (doc: Document, newHash: string): boolean => doc.contentHash !== newHash,
} as const
