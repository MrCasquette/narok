// Jeux d'évaluation versionnés, un par corpus, mesurés contre le corpus réellement indexé.
//
// Chaque cas porte deux niveaux de vérification, parce que mesurer le seul retrieval induit en
// erreur (constaté le 2026-09-09 : deux configurations manquaient toutes deux le passage attendu,
// donc jugées équivalentes, alors que l'une menait le modèle à répondre juste et l'autre à
// inventer un nom de champ plausible mais faux) :
//
// - `marker` : chaîne présente uniquement dans le passage attendu. Mesure le retrieval, sans
//   dépendre d'identifiants de chunks qui changent à chaque ré-ingestion.
// - `expectedInAnswer` : ce que la réponse générée doit contenir. Mesure ce qui compte vraiment.
//   Un passage manquant ne signifie pas une réponse fausse : les passages voisins et l'en-tête de
//   document suffisent souvent.

export type EvalCase = {
  id: string
  question: string
  marker: string
  // Un groupe par exigence ; à l'intérieur d'un groupe, les variantes acceptables sont séparées
  // par `|`. La réponse est jugée correcte si chaque groupe est satisfait. Insensible à la casse.
  expectedInAnswer: string[]
  // Termes d'une réponse plausible mais fausse, déjà observée. Signalés à part : leur présence
  // sans les termes attendus révèle une régression qu'un simple compteur de succès masquerait.
  wrongAnswerSigns?: string[]
}

export type CorpusEvalSet = {
  inScope: EvalCase[]
  // Doivent être rejetées par le garde-fou. Mélange de hors-sujet francs et de questions
  // techniques mais étrangères au corpus, plus difficiles à écarter.
  outOfScope: string[]
}

const docsCases: EvalCase[] = [
  {
    id: 'm2a',
    question: 'Quel type de champ permet de stocker différentes sections de contenu sur une page ?',
    marker: 'Builder (M2A)',
    expectedInAnswer: ['Many-to-Any|M2A|Builder'],
    wrongAnswerSigns: ['Block Editor'],
  },
  {
    id: '2fa',
    question:
      "Comment sécuriser la connexion des utilisateurs avec un code à usage unique généré par une application externe ?",
    marker: 'otpauth_url',
    expectedInAnswer: ['2FA|deux facteurs|two-factor', 'OTP|usage unique'],
  },
  {
    id: 'static-tokens',
    question: "Quel type de jeton d'accès ne périme jamais et se génère depuis la page profil d'un utilisateur ?",
    marker: 'Static Tokens',
    expectedInAnswer: ['statique|static'],
  },
  {
    id: 'filter-empty',
    question: "Comment écrire une condition de filtre qui vérifie qu'un champ n'est pas vide ?",
    marker: '_nempty',
    expectedInAnswer: ['_nempty'],
  },
  {
    id: 'realtime-auth',
    question: 'Quels sont les différents modes pour authentifier une connexion en temps réel ?',
    marker: 'WEBSOCKETS_REST_AUTH',
    expectedInAnswer: ['handshake', 'strict', 'public'],
  },
  {
    id: 'webhooks',
    question: 'Comment envoyer automatiquement des données vers un outil externe quand un contenu est publié ?',
    marker: 'Import data from Webhook',
    expectedInAnswer: ['webhook', 'Flow'],
  },
  {
    id: 'filter-groups',
    question:
      "Comment combiner plusieurs critères de filtre pour qu'un item corresponde à toutes les conditions à la fois ?",
    marker: 'And / Or Groups',
    expectedInAnswer: ['AND|ET'],
  },
]

// Corpus étalon : documentation CSS de MDN en français. Questions formulées comme les poserait
// quelqu'un qui décrit son besoin sans connaître le nom exact de la fonctionnalité — c'est le cas
// d'usage réel, et celui où le retrieval est le plus sollicité.
const mdnCases: EvalCase[] = [
  {
    id: 'supports',
    question: "Comment n'appliquer des styles que si le navigateur gère une propriété donnée ?",
    marker: 'déclarations CSS qui dépendent du support',
    expectedInAnswer: ['@supports'],
  },
  {
    id: 'font-face',
    question: "Comment utiliser une police d'écriture qui n'est pas installée sur la machine du visiteur ?",
    marker: "définir une police d'écriture particulière",
    expectedInAnswer: ['@font-face'],
  },
  {
    id: 'variables',
    question: 'Comment définir une valeur réutilisable dans ma feuille de style pour éviter de la répéter partout ?',
    marker: 'variables en cascade dans les propriétés CSS',
    expectedInAnswer: ['propriété personnalisée|propriétés personnalisées|variable|--', 'var('],
  },
  {
    id: 'flexbox',
    question: 'Comment répartir des éléments côte à côte de façon souple dans un conteneur ?',
    marker: 'les trois éléments fils deviennent des éléments flexibles',
    expectedInAnswer: ['flex'],
  },
  {
    id: 'layer',
    question: "Comment organiser mes styles en couches pour maîtriser lesquels l'emportent sur les autres ?",
    marker: 'déclarer une couche de cascade',
    expectedInAnswer: ['@layer|couche de cascade'],
  },
  {
    id: 'media',
    question: "Comment changer la mise en page selon la largeur de l'écran ?",
    marker: "appliquer une partie d'une feuille de styles en fonction du résultat",
    expectedInAnswer: ['@media'],
  },
  {
    id: 'keyframes',
    question: "Comment décrire les étapes intermédiaires d'une animation ?",
    marker: 'définir les étapes qui composent la séquence',
    expectedInAnswer: ['@keyframes'],
  },
  {
    id: 'container',
    question: 'Comment adapter un composant à la taille de son conteneur plutôt qu’à celle de la fenêtre ?',
    marker: 'règle conditionnelle de groupe qui applique des styles',
    expectedInAnswer: ['@container'],
    wrongAnswerSigns: ['@media'],
  },
  {
    id: 'nth-child',
    question: 'Comment cibler un élément selon sa position parmi ses voisins ?',
    marker: "en se basant sur l'indice",
    expectedInAnswer: [':nth-child'],
  },
  {
    id: 'attribute-selector',
    question: 'Comment cibler les éléments qui possèdent un attribut particulier ?',
    marker: "en fonction de la présence d'un attribut donné",
    expectedInAnswer: ["sélecteur d'attribut|[attr|crochets"],
  },
]

// Hors-sujet francs pour les deux corpus, plus des questions techniques mais étrangères au corpus
// concerné : ce sont les négatifs difficiles, ceux qui piègent un seuil trop permissif.
const genericOutOfScope = [
  'Quelle est la recette de la tarte tatin ?',
  'Qui a gagné la Coupe du monde 2022 ?',
  'Comment changer une roue de voiture ?',
  'Quelle est la meilleure race de chien pour un appartement ?',
  'Explique-moi la théorie de la relativité générale',
  'Quel temps fera-t-il demain à Nice ?',
]

export const evalSets: Record<string, CorpusEvalSet> = {
  docs: {
    inScope: docsCases,
    outOfScope: [...genericOutOfScope, 'Comment centrer une div en CSS ?'],
  },
  mdn: {
    inScope: mdnCases,
    outOfScope: [...genericOutOfScope, "Comment configurer la réplication d'une base PostgreSQL ?"],
  },
}
