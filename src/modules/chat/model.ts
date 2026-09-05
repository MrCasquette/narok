import { t } from 'elysia'

export const ChatRequest = t.Object({
  corpus: t.String(),
  question: t.String({ minLength: 1 }),
})

export const ChatResponse = t.Object({
  answer: t.String(),
})

export const ChatErrorResponse = t.Object({
  code: t.Literal('unknown-corpus'),
})
