import { t } from 'elysia'

export const ChunkSchema = t.Object({
  id: t.String(),
  documentId: t.String(),
  corpus: t.String(),
  content: t.String(),
  position: t.Number(),
})
