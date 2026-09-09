import { Elysia, sse, status } from 'elysia'
import { ChatErrorResponse, ChatRequest, ChatResponse } from './model.js'
import { answerQuestion, chatDefaults, streamAnswer } from './service.js'

export const chat = new Elysia()
  .post(
    '/chat',
    async ({ body }) => {
      const result = await answerQuestion(body.corpus, body.question, body.history ?? [])

      if (!result.ok) {
        if (result.reason === 'unknown-corpus')
          return status(400, { code: 'unknown-corpus' as const })
        return { answer: chatDefaults.OUT_OF_SCOPE_ANSWER }
      }
      return { answer: result.answer }
    },
    { body: ChatRequest, response: { 200: ChatResponse, 400: ChatErrorResponse } },
  )
  .post(
    '/chat/stream',
    async function* ({ body }) {
      for await (const event of streamAnswer(body.corpus, body.question, body.history ?? [])) {
        if (event.type === 'error') {
          yield sse({ event: 'error', data: { reason: event.reason } })
          return
        }
        // data doit être un objet (pas une string brute) : sse() ne réencode pas les retours à
        // la ligne internes d'une string, ce qui casse le découpage SSE dès qu'un token contient
        // un saut de paragraphe markdown ("\n\n"). Un objet JSON échappe correctement les \n.
        yield sse({ event: 'token', data: { content: event.content } })
      }
      yield sse({ event: 'done', data: {} })
    },
    { body: ChatRequest },
  )
