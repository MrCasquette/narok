# Conventions projet

Capture ce qui est spécifique à ce repo ou tranche un point contextuel non dérivable du code. Les
décisions structurantes vivent dans les [ADR](./adr/README.md).

## Garde-fou en deux niveaux

1. **Seuil de similarité** (`corpus.minSimilarityThreshold`, dans `corpora.ts`) : si aucun chunk
   récupéré ne dépasse ce seuil, la question est traitée comme hors-périmètre — réponse générique,
   sans appeler le LLM. Seuil de départ : `0.5`, à recalibrer empiriquement une fois un vrai corpus
   indexé (pas de valeur mesurée pour l'instant).
2. **Prompt système** : reste dans le rôle même si le seuil 1 est franchi mais que la question
   dérive (cf. test qualité Granite du 2026-09-04 — résiste à "ignore tes instructions").

## Erreurs

- Erreur métier attendue (corpus inconnu) → `status(4xx, …)` à la frontière Elysia.
- Hors-périmètre du corpus n'est **pas** une erreur HTTP — c'est une réponse 200 avec un message
  générique (`chatDefaults.OUT_OF_SCOPE_ANSWER`), le comportement est nominal.
- Erreur exceptionnelle (llama-server injoignable, DB down) → `throw`, remonte au handler global.

## Ingestion

Script CLI (`bun run ingest <corpus>`) pour la v1, incrémental par hash de contenu (pattern Arona/
ElysiaJS). Un webhook + cron de sécurité (comme Arona) est la cible si une source déclenchante
apparaît (ex : commit sur un repo de doc) — pas construit avant ce signal.
