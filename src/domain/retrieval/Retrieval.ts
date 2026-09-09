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
  // avec une échelle de seuil 0-1. Évalué AVANT reranking (sur le pool large hybridSearch), pas
  // sur le résultat reranké : le score du cross-encoder n'est pas sur une échelle 0-1 calibrée,
  // le réutiliser comme garde-fou nécessiterait une calibration empirique séparée (non faite ici).
  isInScope: (chunks: RetrievedChunk[], threshold: number): boolean =>
    chunks.some((chunk) => chunk.similarity >= threshold),

  // Réordonne les chunks selon les indices retournés par un reranker cross-encoder et tronque au
  // nombre final. PAS utilisé en production : mesuré sur le corpus réel, le reranking n'améliore
  // aucune configuration (pool 8 : MRR 0,429 sans, 0,414 avec ; pool 20 : 0,395 sans, 0,333 avec)
  // pour 15 à 25 s de latence par requête. Conservé pour le harness `bun run eval --rerank`, qui
  // permet de refaire ce verdict si le corpus ou le modèle change — voir conventions.md.
  applyReranking: (chunks: RetrievedChunk[], order: number[], limit: number): RetrievedChunk[] =>
    order
      .slice(0, limit)
      .map((index) => chunks[index])
      .filter((chunk): chunk is RetrievedChunk => chunk !== undefined),
} as const
