import { integer, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core'

// Dimension Qwen3-Embedding-0.6B (hidden_size du modèle) — à ajuster si le modèle d'embedding change.
const EMBEDDING_DIM = 1024

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  corpus: text('corpus').notNull(),
  sourcePath: text('source_path').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const chunks = pgTable('chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  corpus: text('corpus').notNull(),
  content: text('content').notNull(),
  position: integer('position').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
})

// Index BM25 (ParadeDB, pg_search) et index vectoriel : créés en SQL brut dans une migration
// dédiée, `pg_search`/pgvector n'ont pas d'équivalent typé côté drizzle-orm pg-core.
