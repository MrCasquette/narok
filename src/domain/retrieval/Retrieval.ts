export type RetrievedChunk = {
  chunkId: string
  documentId: string
  content: string
  score: number
  similarity: number
}

// Le retrieval hybride récupère un pool large (candidats plausibles mais mal classés entre eux —
// cosinus/RRF discrimine mal des chunks proches d'un même document), que le reranker départage
// avant de ne garder que les meilleurs pour le LLM. Tailles calibrées, voir applyReranking.
export const CANDIDATE_POOL_SIZE = 20
export const FINAL_CONTEXT_SIZE = 8

export const Retrieval = {
  // Garde-fou basé sur la similarité cosinus brute (0-1, intuitive), pas sur le score de fusion
  // RRF (`score`) qui sert uniquement au tri — son maximum théorique (~0.033) est sans rapport
  // avec une échelle de seuil 0-1. Évalué AVANT reranking (sur le pool large hybridSearch), pas
  // sur le résultat reranké : le score du cross-encoder n'est pas sur une échelle 0-1 calibrée,
  // le réutiliser comme garde-fou nécessiterait une calibration empirique séparée (non faite ici).
  isInScope: (chunks: RetrievedChunk[], threshold: number): boolean =>
    chunks.some((chunk) => chunk.similarity >= threshold),

  // Réordonne les chunks selon les indices retournés par le reranker (cross-encoder, voir
  // llamaClient.ts) et tronque au nombre final envoyé au LLM. Le cross-encoder lit question et
  // chunk ensemble, là où la similarité cosinus compare deux embeddings calculés indépendamment.
  // Gain mesuré à pool constant (20 candidats, 7 questions de contrôle) : hit-rate@8 5/7 -> 6/7 et
  // MRR 0.423 -> 0.511. Élargir le pool au-delà de 20 dégrade (50 candidats : 5/7, MRR 0.493) —
  // plus de candidats, plus d'occasions de mal classer. Voir docs-internal/conventions.md.
  applyReranking: (chunks: RetrievedChunk[], order: number[], limit: number): RetrievedChunk[] =>
    order
      .slice(0, limit)
      .map((index) => chunks[index])
      .filter((chunk): chunk is RetrievedChunk => chunk !== undefined),
} as const
