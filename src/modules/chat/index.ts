import { Elysia, status } from 'elysia'
import { ChatErrorResponse, ChatRequest, ChatResponse } from './model.js'
import { answerQuestion, chatDefaults } from './service.js'

export const chat = new Elysia().post(
  '/chat',
  async ({ body }) => {
    const result = await answerQuestion(body.corpus, body.question)

    if (!result.ok) {
      if (result.reason === 'unknown-corpus')
        return status(400, { code: 'unknown-corpus' as const })
      return { answer: chatDefaults.OUT_OF_SCOPE_ANSWER }
    }
    return { answer: result.answer }
  },
  { body: ChatRequest, response: { 200: ChatResponse, 400: ChatErrorResponse } },
)
