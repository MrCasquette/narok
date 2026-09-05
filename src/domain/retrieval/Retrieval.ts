export type RetrievedChunk = {
  chunkId: string
  documentId: string
  content: string
  score: number
}

export const Retrieval = {
  isInScope: (chunks: RetrievedChunk[], threshold: number): boolean =>
    chunks.some((chunk) => chunk.score >= threshold),
} as const
