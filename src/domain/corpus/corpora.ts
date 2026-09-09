export type Corpus = {
  key: string
  label: string
  sourcePath: string
  systemPromptTopic: string
  minSimilarityThreshold: number
}

// Registre ouvert plutôt qu'une union fermée `'docs' | 'portfolio'` : un futur corpus (nouveau
// client, nouvelle base de connaissance) s'ajoute ici sans toucher au reste du code.
export const corpora: Record<string, Corpus> = {
  docs: {
    key: 'docs',
    label: 'Documentation technique',
    sourcePath: './content/docs',
    systemPromptTopic: 'la documentation technique fournie',
    // Calibré sur le corpus réel (2026-09-09, 3908 chunks) : questions légitimes mesurées entre
    // 0.4365 et 0.6652, questions hors sujet entre 0.2751 et 0.3313 — les deux populations sont
    // nettement séparées, le point milieu est à ~0.384. L'ancienne valeur de départ (0.5, jamais
    // mesurée) tombait au milieu de la population légitime et rejetait des questions valides.
    minSimilarityThreshold: 0.38,
  },
  // Corpus étalon : documentation MDN en français (guides, how-to, tutoriels, et référence des
  // sélecteurs et règles @). Choisi pour régler la chaîne sur de la vraie documentation grand
  // public, sans franchissement de langue (questions FR contre doc FR), à une échelle comparable
  // au corpus `docs` — les réglages ne se transposent pas d'une échelle à l'autre, cf. conventions.
  mdn: {
    key: 'mdn',
    label: 'MDN Web Docs — CSS (français)',
    sourcePath: './content/mdn',
    systemPromptTopic: 'la documentation CSS de MDN Web Docs',
    // Calibré sur le corpus indexé (2026-09-09, 4925 chunks) : questions légitimes de 0.6019 à
    // 0.7356, hors sujet de 0.3085 à 0.5038, milieu à 0.553. Marge deux fois plus fine que sur
    // `docs` (0.098 contre 0.176) : MDN est vaste et généraliste, une question quelconque y trouve
    // toujours une page qui parle vaguement d'écran ou de valeur. D'où un seuil bien plus haut —
    // le reprendre par analogie d'un corpus à l'autre serait une erreur.
    minSimilarityThreshold: 0.55,
  },

  portfolio: {
    key: 'portfolio',
    label: 'Portfolio de Vincent',
    sourcePath: './content/portfolio',
    systemPromptTopic: 'le parcours, les projets et les compétences de Vincent',
    // Non calibré : aucun corpus portfolio indexé pour l'instant. À mesurer comme pour `docs`
    // (voir docs-internal/conventions.md) plutôt que de reprendre 0.38 par analogie.
    minSimilarityThreshold: 0.5,
  },
}

export function getCorpus(key: string): Corpus | undefined {
  return corpora[key]
}
