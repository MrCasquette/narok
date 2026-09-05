# ADR-0001 — Stack : Elysia/TypeBox/Postgres+ParadeDB/llama.cpp

Statut : accepté · 2026-09-05

## Contexte

Backend RAG à héberger sur un serveur sans GPU (i9-9900K, 62 Go RAM), destiné à deux usages :
interrogation de documentation technique, et chat sur une base de connaissance personnelle
(portfolio). Faible nombre d'utilisateurs simultanés, priorité à la maîtrise fine du pipeline
(garde-fous, fidélité au contexte) plutôt qu'à l'abstraction.

## Options envisagées

- **Framework RAG** (LangChain/LlamaIndex) vs custom : écarté — un seul backend LLM, un seul
  besoin d'embedding, échelle modeste. L'abstraction coûte de la transparence exactement là où on
  en a besoin (debug de la fidélité au contexte, des garde-fous).
- **Vector store** : Qdrant vs Postgres+pgvector vs Postgres+ParadeDB. Qdrant apporte de la
  performance à un volume (dizaines de millions de vecteurs) largement hors de portée ici.
  ParadeDB ajoute le BM25 (Tantivy) dans les mêmes segments que pgvector — hybride natif en une
  seule requête, pertinent pour de la doc technique où les termes exacts comptent autant que le
  sens. Retenu.
- **LLM de génération** : comparé Qwen3-30B-A3B, Granite-4.0-H-Tiny, Nemotron-Nano-9B-v2 en
  conditions réelles (CPU, contexte long). Granite-4.0-H-Tiny (hybride Mamba, 1B actif/7B total)
  retenu pour le RAG : vitesse quasi constante avec la longueur du contexte (~23-25 tok/s de 1k à
  8k tokens, contre une chute de 12 à 6 tok/s pour Qwen3-30B-A3B), qualité validée sur un test à 5
  scénarios (extraction, synthèse, hors-contexte, portfolio, détournement).
- **Embedding** : Qwen3-Embedding-0.6B (1ère place MTEB multilingue à sa sortie), GGUF officiel,
  servi par la même stack llama.cpp que la génération.
- **Langage/runtime** : TypeScript + Bun. Aucune brique de la stack n'exige Python/CUDA (embeddings
  via llama.cpp, ParadeDB en SQL pur) — le choix suit la préférence et l'outillage déjà en place
  (Elysia, Biome, Drizzle, conventions `atelier`/`code-conform`).

## Décision

Elysia (HTTP) + TypeBox (validation, SSOT Elysia) + Drizzle (accès Postgres) + Postgres/ParadeDB
(stockage hybride BM25+vecteur) + llama-server (llama.cpp) servant Granite-4.0-H-Tiny (génération)
et Qwen3-Embedding-0.6B (embedding), sur Bun.

## Conséquences

- Pas de reranker ni de webhook d'ingestion en v1 — ajoutés sur signal réel (cf.
  `docs-internal/conventions.md`).
- Le choix de Granite-4.0-H-Tiny est spécifique au RAG ; l'agent MCP Directus (usage distinct, mis
  de côté pour l'instant) pourrait retenir un autre modèle (gpt-oss-20b évoqué, non tranché).
