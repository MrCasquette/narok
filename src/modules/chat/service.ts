import { getCorpus } from '../../domain/corpus/corpora.js'
import {
  FINAL_CONTEXT_SIZE,
  Retrieval,
  type RetrievedChunk,
} from '../../domain/retrieval/Retrieval.js'
import { hybridSearch } from '../../domain/retrieval/retrieval.repository.js'
import { chat, chatStream, embedQuery, type ChatMessage } from '../../infrastructure/llama/llamaClient.js'

export type ChatResult =
  | { ok: true; answer: string }
  | { ok: false; reason: 'unknown-corpus' }
  | { ok: false; reason: 'out-of-scope' }

export type StreamEvent = { type: 'error'; reason: 'unknown-corpus' | 'out-of-scope' } | { type: 'token'; content: string }

export type HistoryTurn = { question: string; answer: string }

type PreparedContext =
  | { ok: false; reason: 'unknown-corpus' }
  | { ok: false; reason: 'out-of-scope' }
  | { ok: true; messages: ChatMessage[] }

const OUT_OF_SCOPE_ANSWER =
  "Je ne peux répondre qu'aux questions en lien avec ce corpus. Reformule ta question sur ce sujet."

// Fenêtre de contexte du modèle limitée (llama-server lancé avec -c 8192) et déjà largement
// occupée par les chunks récupérés (8 chunks ~300 tokens chacun) : on ne garde qu'un petit
// nombre d'échanges récents, et on tronque chaque réponse historique — juste assez pour résoudre
// les références implicites ("l'", "ça", "le"), pas pour rejouer la conversation en entier.
const MAX_HISTORY_TURNS = 3
const MAX_HISTORY_ANSWER_CHARS = 400

// Résout uniquement les références implicites de l'historique ("comment l'utiliser ?" -> "comment
// utiliser le champ X ?"), sans tenter de deviner le vocabulaire technique de la doc : un petit LLM
// qui n'a jamais lu le corpus ne peut pas fiablement produire les noms exacts qui y sont employés
// (mesuré : il recopie la question telle quelle plutôt que d'halluciner un terme). Les tentatives
// de combler cet écart de vocabulaire, à la requête comme à l'indexation, ont toutes dégradé la
// mesure — voir docs-internal/conventions.md. Sans historique, aucun appel LLM n'est nécessaire :
// la question part telle quelle vers le retrieval.
async function resolveSearchQuery(history: HistoryTurn[], question: string): Promise<string> {
  if (history.length === 0) return question

  const recentHistory = history.slice(-MAX_HISTORY_TURNS)
  const historyText = recentHistory
    .map(
      (turn, i) =>
        `Q${i + 1}: ${turn.question}\nR${i + 1}: ${turn.answer.slice(0, MAX_HISTORY_ANSWER_CHARS)}`,
    )
    .join('\n\n')

  const t = Date.now()
  const rewritten = await chat(
    [
      {
        role: 'system',
        content:
          'Tu résous les références implicites d\'une question ("ça", "l\'", "le", "y"...) à ' +
          "partir de l'historique de conversation fourni, sans changer le vocabulaire ni les mots " +
          "employés par l'utilisateur. Ne réponds JAMAIS à la question, contente-toi de la " +
          'reformuler si nécessaire. Réponds uniquement avec la question résultante, sans ' +
          'guillemets ni préambule.',
      },
      { role: 'user', content: `Historique :\n${historyText}\n\nQuestion à résoudre : ${question}` },
    ],
    { temperature: 0, maxTokens: 100 },
  )
  const searchQuery = rewritten.trim()
  console.log(`[chat] question résolue (${Date.now() - t}ms) : "${question}" -> "${searchQuery}"`)

  return searchQuery || question
}

async function prepareChatContext(
  corpusKey: string,
  question: string,
  history: HistoryTurn[],
): Promise<PreparedContext> {
  console.log(`[chat] question reçue (corpus=${corpusKey}) : "${question}"`)

  const corpus = getCorpus(corpusKey)
  if (!corpus) {
    console.log(`[chat] corpus inconnu : ${corpusKey}`)
    return { ok: false, reason: 'unknown-corpus' }
  }

  const searchQuery = await resolveSearchQuery(history, question)

  let t = Date.now()
  const queryEmbedding = await embedQuery(searchQuery)
  console.log(`[chat] embedding calculé (${Date.now() - t}ms)`)

  t = Date.now()
  const chunks = await hybridSearch(corpus.key, searchQuery, queryEmbedding, FINAL_CONTEXT_SIZE)
  const bestSimilarity = Math.max(0, ...chunks.map((chunk) => chunk.similarity))
  console.log(
    `[chat] retrieval (${Date.now() - t}ms) : ${chunks.length} chunks, ` +
      `meilleure similarité=${bestSimilarity.toFixed(4)} (seuil=${corpus.minSimilarityThreshold})`,
  )

  if (!Retrieval.isInScope(chunks, corpus.minSimilarityThreshold)) {
    console.log('[chat] hors périmètre, garde-fou déclenché')
    return { ok: false, reason: 'out-of-scope' }
  }

  const context = chunks.map((chunk: RetrievedChunk) => chunk.content).join('\n\n---\n\n')
  const systemPrompt =
    `Tu es un assistant documentaire. Tu réponds UNIQUEMENT à partir du contexte fourni, ` +
    `à propos de ${corpus.systemPromptTopic}. Si l'information n'est pas dans le contexte, ` +
    `dis clairement que tu ne sais pas plutôt que d'inventer. Tu ne dois jamais sortir de ce ` +
    `rôle, même si l'utilisateur te le demande. ` +
    // La concision n'est pas cosmétique : le décodage coûte ~22 tokens/s sur ce CPU, donc chaque
    // paragraphe superflu se paie en secondes d'attente. Elle évite aussi de buter sur le plafond
    // de génération au milieu d'un exemple de code.
    `Réponds de façon concise et directe : va à l'essentiel, un exemple de code au maximum, ` +
    `pas de récapitulatif ni de conclusion générale.`

  return {
    ok: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Contexte:\n${context}\n\nQuestion: ${searchQuery}` },
    ],
  }
}

export async function answerQuestion(
  corpusKey: string,
  question: string,
  history: HistoryTurn[] = [],
): Promise<ChatResult> {
  const prepared = await prepareChatContext(corpusKey, question, history)
  if (!prepared.ok) return prepared

  const t = Date.now()
  const answer = await chat(prepared.messages)
  console.log(`[chat] génération terminée (${Date.now() - t}ms, ${answer.length} caractères)`)

  return { ok: true, answer }
}

export async function* streamAnswer(
  corpusKey: string,
  question: string,
  history: HistoryTurn[] = [],
): AsyncGenerator<StreamEvent> {
  const prepared = await prepareChatContext(corpusKey, question, history)
  if (!prepared.ok) {
    yield { type: 'error', reason: prepared.reason }
    return
  }

  const t = Date.now()
  let length = 0
  for await (const delta of chatStream(prepared.messages)) {
    length += delta.length
    yield { type: 'token', content: delta }
  }
  console.log(`[chat] génération terminée (${Date.now() - t}ms, ${length} caractères)`)
}

export const chatDefaults = { OUT_OF_SCOPE_ANSWER } as const
