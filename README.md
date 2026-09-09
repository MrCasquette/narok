# narok

Backend RAG auto-hébergé, sans dépendance cloud : recherche hybride (BM25 + vecteur) sur Postgres/
ParadeDB, embeddings et génération servis par [llama.cpp](https://github.com/ggml-org/llama.cpp)
en local (aucun GPU requis).

Deux usages : interrogation de documentation technique, et chat sur une base de connaissance
personnelle. Voir [`docs-internal/adr/`](./docs-internal/adr/) pour le détail des choix
d'architecture.

## Stack

- [Elysia](https://elysiajs.com/) (Bun) — HTTP, TypeBox comme SSOT de validation
- [Drizzle](https://orm.drizzle.team/) — accès Postgres
- [ParadeDB](https://www.paradedb.com/) — BM25 + recherche vectorielle native
- `llama-server` — [Granite-4.0-H-Tiny](https://huggingface.co/ibm-granite/granite-4.0-h-tiny)
  (génération) et [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
  (embedding)

## Lancer en local

```sh
cp .env.example .env
docker compose up -d      # Postgres + ParadeDB
bun install
bun run db:push
bun run ingest docs       # indexe ./content/docs (corpus à fournir, non versionné)
bun run dev
```

`bun run eval` mesure la qualité du retrieval sur le corpus indexé (hit-rate@8, MRR, garde-fou) —
à lancer avant et après toute modification de la chaîne de recherche.

## Structure

```
src/
  domain/          # logique métier pure (document, chunk, corpus, retrieval)
  infrastructure/  # clients externes (Postgres, llama-server)
  modules/         # surface HTTP Elysia (1 module = 1 concept)
  scripts/         # CLI (ingestion)
```
