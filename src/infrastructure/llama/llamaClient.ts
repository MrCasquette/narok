import { env } from '../../env.js'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export async function embed(text: string): Promise<number[]> {
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

export async function chat(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${env.LLAMA_CHAT_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.3, max_tokens: 500 }),
  })
  if (!res.ok) throw new Error(`llama chat a échoué : ${res.status}`)

  const body = (await res.json()) as { choices: { message: { content: string } }[] }
  const content = body.choices[0]?.message.content
  if (!content) throw new Error('llama chat : réponse sans contenu')
  return content
}
