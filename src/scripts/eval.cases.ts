// Jeux d'évaluation versionnés, un par corpus, mesurés contre le corpus réellement indexé.
//
// Chaque cas porte deux niveaux de vérification, parce que mesurer le seul retrieval induit en
// erreur (constaté le 2026-09-09 : deux configurations manquaient toutes deux le passage attendu,
// donc jugées équivalentes, alors que l'une menait le modèle à répondre juste et l'autre à
// inventer un nom de champ plausible mais faux) :
//
// - `expectedDoc` : fragment du chemin d'un document qui répond à la question. Mesure le retrieval
//   sans dépendre d'identifiants de chunks, qui changent à chaque ré-ingestion, ni d'une phrase
//   exacte, qui se déplace d'un découpage à l'autre. Plusieurs documents répondent souvent
//   légitimement (sur MDN, la page de référence et le guide correspondant) : les variantes
//   acceptables se séparent par `|`. Une première version ancrait le marqueur sur une phrase de la
//   seule page de référence : elle affichait 2/10 le 2026-09-09 là où les réponses étaient bonnes
//   8 fois sur 10, en comptant comme échec un retrieval qui avait ramené le bon guide.
// - `expectedInAnswer` : ce que la réponse générée doit contenir. Mesure ce qui compte vraiment.
//   Un passage manquant ne signifie pas une réponse fausse : les passages voisins et l'en-tête de
//   document suffisent souvent.

export type EvalCase = {
  id: string
  question: string
  expectedDoc: string
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
    expectedDoc: 'many-to-any-relationships|3.interfaces|5.relationships',
    expectedInAnswer: ['Many-to-Any|M2A|Builder'],
    wrongAnswerSigns: ['Block Editor'],
  },
  {
    id: '2fa',
    question:
      "Comment sécuriser la connexion des utilisateurs avec un code à usage unique généré par une application externe ?",
    expectedDoc: '03.auth/5.2fa',
    expectedInAnswer: ['2FA|deux facteurs|two-factor', 'OTP|usage unique'],
  },
  {
    id: 'static-tokens',
    question: "Quel type de jeton d'accès ne périme jamais et se génère depuis la page profil d'un utilisateur ?",
    expectedDoc: 'tokens-cookies|_partials/authentication',
    expectedInAnswer: ['statique|static'],
  },
  {
    id: 'filter-empty',
    question: "Comment écrire une condition de filtre qui vérifie qu'un champ n'est pas vide ?",
    expectedDoc: 'filter-rules',
    expectedInAnswer: ['_nempty'],
  },
  {
    id: 'realtime-auth',
    question: 'Quels sont les différents modes pour authentifier une connexion en temps réel ?',
    expectedDoc: 'configuration/realtime|07.realtime/1.authentication',
    expectedInAnswer: ['handshake', 'strict', 'public'],
  },
  {
    id: 'webhooks',
    question: 'Comment envoyer automatiquement des données vers un outil externe quand un contenu est publié ?',
    expectedDoc: 'use-directus-webhooks-with-clay',
    expectedInAnswer: ['webhook', 'Flow'],
  },
  {
    id: 'filter-groups',
    question:
      "Comment combiner plusieurs critères de filtre pour qu'un item corresponde à toutes les conditions à la fois ?",
    expectedDoc: '02.content/1.explore',
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
    expectedDoc: 'at-rules/@supports',
    expectedInAnswer: ['@supports'],
  },
  {
    id: 'font-face',
    question: "Comment utiliser une police d'écriture qui n'est pas installée sur la machine du visiteur ?",
    expectedDoc: 'at-rules/@font-face/index.md|guides/fonts',
    expectedInAnswer: ['@font-face'],
  },
  {
    id: 'variables',
    question: 'Comment définir une valeur réutilisable dans ma feuille de style pour éviter de la répéter partout ?',
    expectedDoc: 'cascading_variables',
    expectedInAnswer: ['propriété personnalisée|propriétés personnalisées|variable|--', 'var('],
  },
  {
    id: 'flexbox',
    question: 'Comment répartir des éléments côte à côte de façon souple dans un conteneur ?',
    expectedDoc: 'flexible_box_layout',
    expectedInAnswer: ['flex'],
  },
  {
    id: 'layer',
    question: "Comment organiser mes styles en couches pour maîtriser lesquels l'emportent sur les autres ?",
    expectedDoc: 'at-rules/@layer',
    expectedInAnswer: ['@layer|couche de cascade'],
  },
  {
    id: 'media',
    question: "Comment changer la mise en page selon la largeur de l'écran ?",
    expectedDoc: 'at-rules/@media/index.md',
    expectedInAnswer: ['@media'],
  },
  {
    id: 'keyframes',
    question: "Comment décrire les étapes intermédiaires d'une animation ?",
    expectedDoc: 'at-rules/@keyframes|guides/animations',
    expectedInAnswer: ['@keyframes'],
  },
  {
    id: 'container',
    question: 'Comment adapter un composant à la taille de son conteneur plutôt qu’à celle de la fenêtre ?',
    expectedDoc: 'at-rules/@container|guides/containment',
    expectedInAnswer: ['@container'],
    wrongAnswerSigns: ['@media'],
  },
  {
    id: 'nth-child',
    question: 'Comment styliser un élément selon son rang parmi les enfants de son parent, par exemple une ligne sur deux ?',
    expectedDoc: 'selectors/_colon_nth-child|guides/selectors',
    expectedInAnswer: [':nth-child'],
  },
  {
    id: 'attribute-selector',
    question: 'Comment cibler les éléments qui possèdent un attribut particulier ?',
    expectedDoc: 'attribute_selectors|selectors/attribute',
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
