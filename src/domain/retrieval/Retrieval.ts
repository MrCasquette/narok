export type RetrievedChunk = {
  chunkId: string
  documentId: string
  content: string
  score: number
  similarity: number
}

// Nombre de chunks récupérés et envoyés au LLM. Mesuré sur le corpus réel : récupérer plus large
// pour retrancher ensuite dégrade, parce que la taille demandée change aussi les limites internes
// de la requête hybride, donc la fusion RRF elle-même (pool 8 : MRR 0,429 ; 12 : 0,414 ; 20 :
// 0,395 ; 40 : 0,304 et un chunk attendu perdu). Voir docs-internal/conventions.md.
export const FINAL_CONTEXT_SIZE = 8

export const Retrieval = {
  // Garde-fou basé sur la similarité cosinus brute (0-1, intuitive), pas sur le score de fusion
  // RRF (`score`) qui sert uniquement au tri — son maximum théorique (~0.033) est sans rapport
  // avec une échelle de seuil 0-1. Seuil par corpus, calibré : voir corpora.ts.
  isInScope: (chunks: RetrievedChunk[], threshold: number): boolean =>
    chunks.some((chunk) => chunk.similarity >= threshold),
} as const
