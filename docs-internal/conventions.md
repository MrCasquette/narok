# Conventions projet

Capture ce qui est spécifique à ce repo ou tranche un point contextuel non dérivable du code. Les
décisions structurantes vivent dans les [ADR](./adr/README.md).

## Garde-fou en deux niveaux

1. **Seuil de similarité** (`corpus.minSimilarityThreshold`, dans `corpora.ts`) : si aucun chunk
   récupéré ne dépasse ce seuil, la question est traitée comme hors-périmètre — réponse générique,
   sans appeler le LLM. **Calibré pour `docs` à `0.38`** (2026-09-09, corpus réel de 3908 chunks) :
   7 questions légitimes mesurées entre 0.4365 et 0.6652, 6 questions hors sujet entre 0.2751 et
   0.3313 — populations nettement séparées (marge 0.105), point milieu à 0.384. La valeur de départ
   `0.5`, jamais mesurée, tombait au milieu de la population légitime et rejetait des questions
   valides (ex : « Comment sécuriser la connexion avec un code à usage unique ? » à 0.4899, dont le
   bon chunk était pourtant classé premier). Le corpus `portfolio` reste non calibré.
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

## Version Postgres (image `db`)

Sur `pg18` (`paradedb/paradedb:pg18`), label `wud.tag.include=^pg\d+$` — filtre sur les tags courts
`pgNN` (exclut `latest`, les tags versionnés `x.y.z-pgNN`, etc.) sans figer sur `pg18` précisément.
But : que WUD **détecte et affiche** l'apparition d'un tag `pg19` dès que ParadeDB le publie, sans
rien appliquer automatiquement — le compose de `narok` n'est pas monté dans les triggers Docker
Compose de WUD (`/srv/infra/wud/compose.yaml`, réservés à Immich/Jellyfin/Vaultwarden/Monitoring),
donc aucun auto-update possible ici de toute façon. Le passage effectif à `pg19` reste une décision
manuelle (changer l'image + le label dans ce fichier), prise quand WUD signale la nouveauté.

## Qualité du retrieval — techniques testées et écartées (2026-09-09)

Chaque maillon de la chaîne a été mesuré isolément sur un corpus de test réduit (7 documents,
79 chunks) et 7 questions de contrôle en français avec un chunk cible connu. Métriques : hit-rate@8
(le chunk cible est-il dans les 8 envoyés au LLM) et MRR.

Ces chiffres servent à comparer les variantes **entre elles**, pas à décrire la production : sur le
corpus `docs` complet (3908 chunks), la même configuration retenue mesure hit-rate@8 = 5/7 et
MRR = 0.333, la concurrence entre chunks étant bien plus forte. Le harness `bun run eval` rejoue
cette mesure de production ; toute comparaison de variantes doit se faire à corpus constant.

| Variante | hit-rate@8 | MRR |
| --- | --- | --- |
| **Retenue : header + pool 20 + reranker** | **6/7** | **0.511** |
| Idem, pool 50 | 5/7 | 0.493 |
| Baseline (pool 8, sans reranker) | 6/7 | 0.446 |
| Enrichissement contextuel (1 phrase LLM/chunk) | 6/7 | 0.445 |
| Header exclu de l'embedding vectoriel | 6/7 | 0.433 |
| Pool 20 sans reranker (contrôle) | 5/7 | 0.423 |
| HyPE (4 questions générées par chunk) | 5/7 | 0.299 |

Décisions qui en découlent :

- **Reranker conservé** : c'est le seul ajout à gain net (à pool constant : 5/7 → 6/7, MRR
  0.423 → 0.511). Pool de 20 candidats, tronqué à 8 après reranking — au-delà de 20, dégrade.
- **HyPE (questions hypothétiques indexées) écarté** : dégrade nettement. Multiplier par 4 le
  nombre d'entrées vectorielles injecte surtout des candidats concurrents, une question générée
  depuis un chunk hors-sujet pouvant matcher la question utilisateur mieux que le bon chunk.
- **HyDE (passage hypothétique à la requête) écarté** : le petit modèle de génération ne peut pas
  deviner le vocabulaire d'une doc qu'il n'a jamais lue. Mesuré : sur le prompt de reformulation
  d'origine, il recopiait la question à l'identique.
- **Préfixe titre/description conservé** dans le texte embarqué : son exclusion est neutre à
  légèrement négative. C'est aussi lui qui porte la réponse quand le chunk le plus précis manque.
- **Enrichissement contextuel écarté pour l'instant** : à hit-rate égal pour un coût d'un appel LLM
  par chunk à l'indexation (~9 h sur les 3908 chunks de production). À reconsidérer si le corpus
  ou le modèle de génération change.
- **Taille de chunk** : 300 mots (défaut) et 500 donnent le même résultat — le découpage est
  dominé par les sections Markdown, la plupart plus courtes que le plafond. 150 dégrade (coupe des
  sections cohérentes).

Piège de méthode rencontré, à ne pas reproduire : le cas qui a motivé toute cette investigation
(question abstraite sur les champs Many-to-Any) n'entre dans le top-8 d'aucune variante — mais la
réponse générée est **correcte quand même**, car les chunks frères et le header du document portent
l'information. Juger une technique sur « ce chunk précis est-il récupéré » plutôt que sur la réponse
produite fait conclure à un échec là où le pipeline fonctionne.

## Harness d'évaluation

`bun run eval [corpus]` rejoue le chemin de production (embedding, recherche hybride, reranking,
troncature) sur le corpus indexé et affiche hit-rate@8, MRR, les erreurs du garde-fou et la marge
qui sépare les questions légitimes des questions hors sujet. Le jeu de cas est versionné dans
`src/scripts/eval.cases.ts`. Usage : mesurer avant un changement, modifier, remesurer, comparer.

## Reranker

`bge-reranker-v2-m3` (GGUF Q8_0), servi par une instance `llama-server` dédiée lancée avec
`--reranking --pooling rank -b 4096 -ub 4096` (le batch physique par défaut de 512 est trop petit
pour des chunks de ~300 mots et fait échouer la requête en 500). Endpoint `/v1/rerank`.

`Qwen3-Reranker-0.6B` a été testé et écarté : ce n'est pas un cross-encoder mais un classifieur
oui/non basé sur un template de chat, dont le score sort du ratio des logits `yes`/`no`. Servi via
le `--pooling rank` générique de llama-server, il renvoie des classements inversés (sur un cas de
contrôle : intro générique à 0.99, bon passage à 0.016), y compris en respectant le format
`<Instruct>:/<Query>:` documenté.
