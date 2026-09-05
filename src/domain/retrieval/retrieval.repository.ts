import { sql } from 'drizzle-orm'
import { db } from '../../infrastructure/db/client.js'
import type { RetrievedChunk } from './Retrieval.js'

// Fusion BM25 (ParadeDB pg_search, opérateur @@@) + vecteur (pgvector, distance cosinus) par
// Reciprocal Rank Fusion. Syntaxe vérifiée manuellement contre une instance ParadeDB réelle
// (paradedb/paradedb:pg17) le 2026-09-05 — voir drizzle/0001_indexes.sql pour les index requis.
export async function hybridSearch(
  corpus: string,
  queryText: string,
  queryEmbedding: number[],
  limit = 8,
): Promise<RetrievedChunk[]> {
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`

  const rows = await db.execute<{
    chunk_id: string
    document_id: string
    content: string
    score: number
  }>(sql`
    with bm25_ranked as (
      select id as chunk_id, document_id, content,
             row_number() over (order by paradedb.score(id) desc) as rank
      from chunks
      where corpus = ${corpus} and content @@@ ${queryText}
      limit ${limit * 2}
    ),
    vector_ranked as (
      select id as chunk_id, document_id, content,
             row_number() over (order by embedding <=> ${embeddingLiteral}::vector) as rank
      from chunks
      where corpus = ${corpus}
      limit ${limit * 2}
    )
    select
      coalesce(b.chunk_id, v.chunk_id) as chunk_id,
      coalesce(b.document_id, v.document_id) as document_id,
      coalesce(b.content, v.content) as content,
      (coalesce(1.0 / (60 + b.rank), 0) + coalesce(1.0 / (60 + v.rank), 0)) as score
    from bm25_ranked b
    full outer join vector_ranked v using (chunk_id)
    order by score desc
    limit ${limit}
  `)

  type Row = { chunk_id: string; document_id: string; content: string; score: number }
  return rows.map((row: Row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    score: row.score,
  }))
}
