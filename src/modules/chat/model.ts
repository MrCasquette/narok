import { t } from 'elysia'

export const ChatHistoryTurn = t.Object({
  question: t.String(),
  answer: t.String(),
})

export const ChatRequest = t.Object({
  corpus: t.String(),
  question: t.String({ minLength: 1 }),
  // Bornée côté client (dernières ~10 échanges) ; retronquée côté serveur pour la reformulation
  // (voir MAX_HISTORY_TURNS dans service.ts) — la fenêtre de contexte du modèle est limitée.
  history: t.Optional(t.Array(ChatHistoryTurn, { maxItems: 20 })),
})

export const ChatResponse = t.Object({
  answer: t.String(),
})

export const ChatErrorResponse = t.Object({
  code: t.Literal('unknown-corpus'),
})
