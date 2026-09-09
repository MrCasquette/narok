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
