import { env } from '../../env.js'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// Qwen3-Embedding attend un format d'instruction asymétrique : la requête doit être préfixée
// ("Instruct: <tâche>\nQuery:<texte>"), le passage indexé non ("no need to add instruction for
// retrieval documents" — https://huggingface.co/Qwen/Qwen3-Embedding-0.6B). Sans ce préfixe côté
// requête, le modèle perd ~1-5% de perf retrieval : la doc Qwen note que l'embedding se rabat
// alors sur une similarité de surface (vocabulaire commun) au lieu de la sémantique de la tâche —
// cohérent avec le symptôme mesuré ici (intros génériques mieux scorées qu'un chunk pertinent).
const RETRIEVAL_INSTRUCTION =
  'Given a search query, retrieve relevant passages from the documentation that answer the query'

async function embedRaw(text: string): Promise<number[]> {
  const res = await fetch(`${env.LLAMA_EMBEDDING_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text }),
  })
  if (!res.ok) throw new Error(`llama embedding a échoué : ${res.status}`)

  const body = (await res.json()) as { data: { embedding: number[] }[] }
  const embedding = body.data[0]?.embedding
  if (!embedding) throw new Error('llama embedding : réponse sans vecteur')
  return embedding
}

// Passage à indexer (chunk de doc) : pas de préfixe, voir RETRIEVAL_INSTRUCTION ci-dessus.
export async function embed(text: string): Promise<number[]> {
  return embedRaw(text)
}

// Requête de recherche : préfixée avec l'instruction de tâche, voir RETRIEVAL_INSTRUCTION ci-dessus.
export async function embedQuery(text: string): Promise<number[]> {
  return embedRaw(`Instruct: ${RETRIEVAL_INSTRUCTION}\nQuery:${text}`)
}

// Plafond de génération. Le décodage coûte ~22 tokens/s sur ce CPU (mesuré le 2026-09-09) : 400
// tokens plafonnent la réponse à ~18s, et une réponse documentaire tient dans ce budget. Laisser
// filer coûte cher pour rien — une réponse libre est montée à 756 tokens, soit +30s.
const DEFAULT_MAX_TOKENS = 400

export async function chat(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const res = await fetch(`${env.LLAMA_CHAT_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    }),
  })
  if (!res.ok) throw new Error(`llama chat a échoué : ${res.status}`)

  const body = (await res.json()) as { choices: { message: { content: string } }[] }
  const content = body.choices[0]?.message.content
  if (!content) throw new Error('llama chat : réponse sans contenu')
  return content
}

export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
  const res = await fetch(`${env.LLAMA_CHAT_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.3, max_tokens: DEFAULT_MAX_TOKENS, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error(`llama chat a échoué : ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const payload = line.trim()
      if (!payload.startsWith('data:')) continue
      const data = payload.slice(5).trim()
      if (data === '[DONE]') return

      const chunk = JSON.parse(data) as { choices: { delta: { content?: string } }[] }
      const delta = chunk.choices[0]?.delta.content
      if (delta) yield delta
    }
  }
}
