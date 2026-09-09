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

   **Calibré pour `mdn` à `0.55`** (2026-09-09, 4925 chunks) : légitimes de 0.6019 à 0.7356, hors
   sujet de 0.3085 à 0.5038, milieu à 0.553 — 0 erreur dans les deux sens. Le seuil est nettement
   plus haut que celui de `docs`, et la marge deux fois plus fine (0.098 contre 0.176) : MDN est
   vaste et généraliste, donc une question quelconque (« Quel temps fera-t-il demain ? », 0.5038)
   y trouve toujours une page qui évoque vaguement un écran ou une valeur. **Un seuil ne se
   transpose donc pas d'un corpus à l'autre** : chaque corpus se calibre avec `bun run eval
   <corpus> --fast`, dont la sortie donne directement le point milieu.
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

## Serveurs llama.cpp (services `llama-embedding` et `llama-chat`)

Image officielle `ghcr.io/ggml-org/llama.cpp:server`, un service par modèle. Points à connaître :

- `--host 0.0.0.0` est obligatoire : par défaut le serveur n'écoute que la loopback du conteneur,
  donc reste injoignable depuis les autres services.
- Les modèles GGUF (plusieurs Go) ne sont pas dans l'image ni versionnés : montés en lecture seule
  depuis l'hôte via `LLAMA_MODELS_DIR`.
- Ports publiés sur ceux que déclare `.env` (8081 embedding, 8083 génération), pour que le
  développement sur l'hôte (`bun run dev`) et l'exécution en conteneur visent les mêmes serveurs.
  Le service `app`, lui, surcharge ces URL vers les noms de services : dans un conteneur,
  `localhost` désigne le conteneur lui-même.
- Plafond `cpus: 4` aligné sur `--threads 4`, pour que l'inférence ne monopolise pas la machine
  face aux autres services de l'hôte en cas de rafale de requêtes.
- Le passage des binaires locaux aux conteneurs a été vérifié à l'identique : `bun run eval` rend
  exactement les mêmes similarités (5/7, MRR 0,429).

### Budget de tokens (serveur `llama-chat`)

Le serveur a d'abord tourné avec `-c 4096`. Sur un contexte de 8 chunks, le prompt atteint ~4000
tokens : il ne restait que **82 tokens pour la réponse**, tronquée en plein mot. Aucune erreur n'est
levée — `finish_reason` vaut `length`, comme lors d'un dépassement de `max_tokens`, ce qui égare le
diagnostic. Le signe distinctif : `completion_tokens` très inférieur à `max_tokens`, et identique
qu'on demande 500 ou 2000 tokens. La fenêtre est donc à `-c 8192`.

Mesures sur ce CPU (2026-09-09, 4 threads, sans GPU) :

| Poste | Débit | Ordre de grandeur |
| --- | --- | --- |
| Prefill (lecture du contexte) | ~92 tk/s | 3500 tokens → 38 s |
| Decode (écriture de la réponse) | ~22 tk/s | 400 tokens → 18 s |

Conséquences, contre-intuitives :

- **Agrandir la fenêtre ne coûte pas de temps.** Le prefill se paie sur les tokens réellement
  envoyés, pas sur la taille allouée ; `-c` ne coûte que de la RAM. Passer de 4096 à 8192 n'a rien
  changé à l'empreinte mesurée du conteneur (~6 Go) — Granite 4.0-H est un hybride Mamba dont la
  plupart des couches ont un état de taille constante, indépendant de la longueur du contexte.
- **Ce qui coûte du temps, c'est le nombre de chunks et la longueur de la réponse.** D'où
  `DEFAULT_MAX_TOKENS = 400` et la consigne de concision dans le prompt système : sans elle, une
  réponse libre monte à 756 tokens, soit 30 s de décodage pour du récapitulatif.
- Le nombre de chunks reste néanmoins fixé par la qualité, pas par la vitesse : voir
  `FINAL_CONTEXT_SIZE`, un contexte de 5 divise le temps de prefill mais fait tomber les réponses
  correctes de 10/10 à 8/10 sur `mdn`.

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
corpus `docs` complet (3908 chunks), la configuration retenue mesure hit-rate@8 = 5/7 et
MRR = 0.429, la concurrence entre chunks étant bien plus forte. Le harness `bun run eval` rejoue
cette mesure de production ; toute comparaison de variantes doit se faire à corpus constant.

| Variante (corpus réduit, 79 chunks) | hit-rate@8 | MRR |
| --- | --- | --- |
| Header + pool 20 + reranker | 6/7 | 0.511 |
| Idem, pool 50 | 5/7 | 0.493 |
| Baseline (pool 8, sans reranker) | 6/7 | 0.446 |
| Enrichissement contextuel (1 phrase LLM/chunk) | 6/7 | 0.445 |
| Header exclu de l'embedding vectoriel | 6/7 | 0.433 |
| Pool 20 sans reranker (contrôle) | 5/7 | 0.423 |
| HyPE (4 questions générées par chunk) | 5/7 | 0.299 |

**Ces classements ne se transposent pas au corpus réel.** Remesuré sur `docs` complet (3908 chunks),
le verdict sur le reranking s'inverse, et la configuration retenue est finalement la baseline
d'origine du projet :

| Variante (corpus `docs`, 3908 chunks) | hit-rate@8 | MRR |
| --- | --- | --- |
| **Retenue : pool 8, sans reranker** | **5/7** | **0.429** |
| Pool 8, avec reranker | 5/7 | 0.414 |
| Pool 12, sans reranker | 5/7 | 0.414 |
| Pool 20, sans reranker | 5/7 | 0.395 |
| Pool 20, avec reranker | 5/7 | 0.333 |
| Pool 40, sans reranker | 4/7 | 0.304 |

Sur 79 chunks, un pool de 20 couvre un quart du corpus et contient beaucoup de candidats faiblement
liés, que le reranker trie utilement. Sur 3908 chunks, ce même pool est déjà très sélectif : tous
les candidats sont plausibles, et le cross-encoder (cross-lingue français/anglais, quantifié) les
rebat sans apporter de signal — parfois en rétrogradant le bon. Leçon de méthode : **une variante
doit être validée à l'échelle réelle du corpus avant d'entrer en production.**

Décisions qui en découlent :

- **Reranker écarté** : gagnant sur le corpus réduit, perdant sur le corpus réel dans toutes les
  configurations testées, pour 15 à 25 s de latence par requête. Code et modèles supprimés — la
  section « Reranker » plus bas garde de quoi refaire l'expérience si le contexte change.
- **Taille de récupération : 8 chunks, sans étage intermédiaire.** Récupérer large pour retrancher
  ensuite dégrade, y compris sans reranking : le nombre demandé change aussi les limites internes
  de la requête hybride, donc la fusion RRF elle-même. Un pool large n'est pas un sur-ensemble d'un
  pool étroit.
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

`bun run eval [corpus] [--fast] [--pool=N]` rejoue le chemin de production sur le corpus indexé.
Jeux de cas versionnés par corpus dans `src/scripts/eval.cases.ts`. Usage : mesurer avant un
changement, modifier, remesurer, comparer — à corpus constant, les verdicts ne se transposent pas
d'une échelle à l'autre.

Deux niveaux de mesure, délibérément séparés :

- **retrieval** : un document qui répond (`expectedDoc`, fragment de chemin, variantes séparées par
  `|`) est-il parmi les extraits envoyés au modèle — hit-rate@8 et MRR ;
- **réponse** : le texte généré contient-il les termes attendus, et pas ceux d'une confusion connue.

Ne mesurer que le retrieval induit en erreur, et l'a effectivement fait : deux configurations
manquaient toutes deux le passage attendu, donc paraissaient équivalentes, alors que l'une menait
le modèle à la bonne réponse et l'autre à inventer un nom de champ plausible mais faux. C'est ce
qui a fait retenir la mauvaise configuration avant que le problème ne soit repéré. `--fast` saute
la génération quand seul le retrieval est en jeu.

**Ancrer le niveau retrieval sur une phrase exacte est un piège.** La première version cherchait une
chaîne présente uniquement dans la page de référence attendue : elle annonçait 2/10 sur `mdn` là où
les réponses étaient bonnes 8 fois sur 10, en comptant comme échec tout retrieval ayant ramené le
guide correspondant — qui répond pourtant aussi bien. Mesuré au niveau du document, le même
retrieval donne 7/10 et MRR 0.517. Une phrase se déplace aussi d'un découpage à l'autre, ce qui
rendrait la mesure incomparable après un changement de chunking. D'où `expectedDoc`. Corollaire :
les fragments doivent rester étroits — `at-rules/@media` attrape les 43 pages de descripteurs et
rend le cas trivialement gagnant, `at-rules/@media/index.md` non.

### Corpus étalon

`mdn` — documentation CSS de MDN en français (guides, how-to, tutoriels, référence des sélecteurs
et des règles @ ; ~353k mots, soit l'échelle du corpus `docs`, choisie pour que les réglages restent
comparables). Retenu pour régler la chaîne sur de la vraie documentation grand public **sans
franchissement de langue** : questions en français contre documentation en français. Le corpus
`docs` (Directus, en anglais) mêlait questions FR et doc EN, ce qui s'est révélé être un facteur
confondant, notamment sur la stabilité du reranking.

Le corpus n'est pas versionné (voir `.gitignore`). Pour le reconstituer : clone partiel de
`mdn/translated-content` limité à `files/fr/web/css`, dont on retient `guides`, `how_to`,
`tutorials` et, sous `reference`, `selectors` et `at-rules`.

## Reranker

Testé puis **entièrement retiré du code** (mesuré perdant, voir ci-dessus). Cette section existe
pour pouvoir refaire l'expérience sans repartir de zéro, pas pour décrire une capacité existante :
il faut réécrire l'appel client et re-télécharger un modèle.

`bge-reranker-v2-m3` (GGUF Q8_0, `gpustack/bge-reranker-v2-m3-GGUF`), servi par une instance
`llama-server` dédiée lancée avec
`--reranking --pooling rank -b 4096 -ub 4096` (le batch physique par défaut de 512 est trop petit
pour des chunks de ~300 mots et fait échouer la requête en 500). Endpoint `/v1/rerank`.

`Qwen3-Reranker-0.6B` a été testé et écarté : ce n'est pas un cross-encoder mais un classifieur
oui/non basé sur un template de chat, dont le score sort du ratio des logits `yes`/`no`. Servi via
le `--pooling rank` générique de llama-server, il renvoie des classements inversés (sur un cas de
contrôle : intro générique à 0.99, bon passage à 0.016), y compris en respectant le format
`<Instruct>:/<Query>:` documenté.
