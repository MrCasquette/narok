import { sql } from 'drizzle-orm'
import { db } from '../../infrastructure/db/client.js'
import type { RetrievedChunk } from './Retrieval.js'

// Fusion BM25 (ParadeDB pg_search, opérateur ||| — match disjunction) + vecteur (pgvector,
// distance cosinus) par Reciprocal Rank Fusion. `|||` tokenise le texte simplement, sans passer
// par le mini-langage de requête Tantivy de `@@@` (`content @@@ queryText`) — celui-ci interprète
// apostrophes/guillemets/parenthèses comme de la syntaxe de requête et plante sur du texte libre
// utilisateur (ex: "Comment utilise t'on..." → erreur de parsing). Syntaxe vérifiée manuellement
// contre une instance ParadeDB réelle (paradedb/paradedb:pg17) le 2026-09-05 — voir
// drizzle/0001_indexes.sql pour les index requis.
//
// Le vecteur est la source primaire (vector_ranked, left join) : un chunk n'est retenu que s'il a
// une similarité cosinus réelle. `|||` étant très permissif (match sur n'importe quel mot), un
// simple full outer join laissait entrer des chunks matchés QUE via BM25 sur des mots communs
// ("sections", "champ"...), sans aucune pertinence sémantique (similarity forcée à 0 par le
// coalesce) — du bruit pur dans le contexte envoyé au LLM. Le BM25 ne sert plus qu'à booster le
// score de fusion d'un chunk déjà retenu par le vecteur, jamais à en introduire un nouveau seul.
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
    similarity: number
  }>(sql`
    with bm25_ranked as (
      select id as chunk_id, document_id, content,
             row_number() over (order by paradedb.score(id) desc) as rank
      from chunks
      where corpus = ${corpus} and content ||| ${queryText}
      limit ${limit * 2}
    ),
    vector_ranked as (
      select id as chunk_id, document_id, content,
             row_number() over (order by embedding <=> ${embeddingLiteral}::vector) as rank,
             1 - (embedding <=> ${embeddingLiteral}::vector) as similarity
      from chunks
      where corpus = ${corpus}
      limit ${limit * 2}
    )
    select
      v.chunk_id,
      v.document_id,
      v.content,
      (coalesce(1.0 / (60 + b.rank), 0) + 1.0 / (60 + v.rank)) as score,
      v.similarity
    from vector_ranked v
    left join bm25_ranked b using (chunk_id)
    order by score desc
    limit ${limit}
  `)

  type Row = {
    chunk_id: string
    document_id: string
    content: string
    score: number
    similarity: number
  }
  return rows.map((row: Row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    score: row.score,
    similarity: row.similarity,
  }))
}
