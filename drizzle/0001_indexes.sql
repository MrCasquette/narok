CREATE INDEX idx_chunks_bm25 ON chunks USING bm25 (id, content) WITH (key_field = 'id');
CREATE INDEX idx_chunks_vector ON chunks USING hnsw (embedding vector_cosine_ops);
