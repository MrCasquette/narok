// Garde-fou fail-fast : importé EN PREMIER par index.ts, avant tout client DB/HTTP.
// Autonome (aucun import interne) pour pouvoir s'exécuter avant le reste.

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`[env] variable requise manquante : ${name}`)
    process.exit(1)
  }
  return value
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  LLAMA_EMBEDDING_URL: required('LLAMA_EMBEDDING_URL'),
  LLAMA_CHAT_URL: required('LLAMA_CHAT_URL'),
  // Optionnel : le reranking n'est pas dans le chemin de production (mesuré sans gain, voir
  // Retrieval.applyReranking). Seul `bun run eval --rerank` en a besoin.
  LLAMA_RERANK_URL: process.env.LLAMA_RERANK_URL ?? '',
  API_PORT: Number(process.env.API_PORT ?? 8100),
} as const
