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
    minSimilarityThreshold: 0.5,
  },
  portfolio: {
    key: 'portfolio',
    label: 'Portfolio de Vincent',
    sourcePath: './content/portfolio',
    systemPromptTopic: 'le parcours, les projets et les compétences de Vincent',
    minSimilarityThreshold: 0.5,
  },
}

export function getCorpus(key: string): Corpus | undefined {
  return corpora[key]
}
