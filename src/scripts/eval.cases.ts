// Jeu d'évaluation versionné du retrieval, mesuré contre le corpus `docs` réellement indexé.
//
// `marker` est une chaîne présente UNIQUEMENT dans le chunk attendu pour cette question : c'est ce
// qui permet de dire si le bon passage est bien arrivé dans le contexte envoyé au LLM, sans avoir
// à figer des identifiants de chunks (qui changent à chaque ré-ingestion).
//
// Attention à l'interprétation : « le chunk attendu n'est pas récupéré » ne signifie pas « la
// réponse est fausse ». Mesuré le 2026-09-09, le cas `m2a` échoue sur ce critère alors que la
// réponse générée est correcte, parce que les chunks voisins et l'en-tête du document portent
// l'information. Cette métrique sert à comparer des variantes entre elles, pas à juger seule de la
// qualité du produit — voir docs-internal/conventions.md.

export type EvalCase = {
  id: string
  question: string
  marker: string
}

export const inScopeCases: EvalCase[] = [
  {
    id: 'm2a',
    question: 'Quel type de champ permet de stocker différentes sections de contenu sur une page ?',
    marker: 'Builder (M2A)',
  },
  {
    id: '2fa',
    question:
      "Comment sécuriser la connexion des utilisateurs avec un code à usage unique généré par une application externe ?",
    marker: 'otpauth_url',
  },
  {
    id: 'static-tokens',
    question: "Quel type de jeton d'accès ne périme jamais et se génère depuis la page profil d'un utilisateur ?",
    marker: 'Static Tokens',
  },
  {
    id: 'filter-empty',
    question: "Comment écrire une condition de filtre qui vérifie qu'un champ n'est pas vide ?",
    marker: '_nempty',
  },
  {
    id: 'realtime-auth',
    question: 'Quels sont les différents modes pour authentifier une connexion en temps réel ?',
    marker: 'WEBSOCKETS_REST_AUTH',
  },
  {
    id: 'webhooks',
    question: 'Comment envoyer automatiquement des données vers un outil externe quand un contenu est publié ?',
    marker: 'Import data from Webhook',
  },
  {
    id: 'filter-groups',
    question:
      "Comment combiner plusieurs critères de filtre pour qu'un item corresponde à toutes les conditions à la fois ?",
    marker: 'And / Or Groups',
  },
]

// Questions volontairement hors sujet : servent à vérifier que le garde-fou de similarité les
// rejette, et à surveiller la marge qui les sépare des questions légitimes. Sans elles, on peut
// abaisser le seuil jusqu'à tout accepter sans s'en rendre compte.
export const outOfScopeQuestions: string[] = [
  'Quelle est la recette de la tarte tatin ?',
  'Qui a gagné la Coupe du monde 2022 ?',
  'Comment changer une roue de voiture ?',
  'Quelle est la meilleure race de chien pour un appartement ?',
  'Explique-moi la théorie de la relativité générale',
  'Quel temps fera-t-il demain à Nice ?',
]
