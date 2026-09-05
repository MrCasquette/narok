# Backlog

- Calibrer `minSimilarityThreshold` par corpus une fois un vrai corpus indexé.
- Trancher le LLM pour l'agent MCP Directus (usage distinct du RAG, gpt-oss-20b évoqué).
- Ajouter un tokenizer ICU (français) sur l'index BM25 `idx_chunks_bm25` une fois du vrai contenu
  français indexé (tokenizer par défaut pour l'instant, cf. `drizzle/0001_indexes.sql`).
