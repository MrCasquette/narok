import { t } from 'elysia'

export const DocumentSchema = t.Object({
  id: t.String(),
  corpus: t.String(),
  sourcePath: t.String(),
  content: t.String(),
  contentHash: t.String(),
  updatedAt: t.String({ format: 'date-time' }),
})
