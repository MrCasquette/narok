import '../env.js'

import { getCorpus } from '../domain/corpus/corpora.js'
import { FINAL_CONTEXT_SIZE, Retrieval } from '../domain/retrieval/Retrieval.js'
import { hybridSearch } from '../domain/retrieval/retrieval.repository.js'
import { client } from '../infrastructure/db/client.js'
import { embedQuery } from '../infrastructure/llama/llamaClient.js'
import { inScopeCases, outOfScopeQuestions } from './eval.cases.js'

// Mesure la qualité du retrieval sur le corpus réellement indexé, en rejouant exactement le chemin
// de production (même embedding, même recherche hybride, même troncature). Sert à comparer une
// modification à l'état antérieur : lancer avant, modifier, relancer, comparer.
//
// Deux métriques :
// - hit-rate@N : le chunk attendu est-il dans les N chunks envoyés au LLM (ce qui compte vraiment,
//   le LLM voyant tout le contexte, pas seulement le premier chunk) ;
// - MRR : moyenne des inverses de rang, sensible à la position exacte — utile pour départager deux
//   variantes à hit-rate égal, mais surpondère le rang 1 dont on n'a pas besoin ici.
//
// Référence mesurée le 2026-09-09 sur le corpus `docs` complet (3908 chunks), configuration de
// production : hit-rate@8 = 5/7, MRR = 0,429, garde-fou sans erreur, marge de séparation 0,176.
// Ne pas comparer ces chiffres à ceux obtenus sur un corpus réduit : la concurrence entre chunks y
// est bien plus faible et inverse certains verdicts (le reranking gagnait sur 79 chunks, il perd
// sur 3908). Toute comparaison de variantes exige le même corpus.

// `--pool=N` récupère N candidats avant de tronquer au contexte final. Attention : N ne change pas
// que le nombre de candidats, il change aussi les limites internes de la requête hybride, donc la
// fusion RRF elle-même — un pool plus large n'est donc pas un sur-ensemble d'un pool plus étroit.
const poolArg = process.argv.find((arg) => arg.startsWith('--pool='))
const poolSize = poolArg ? Number(poolArg.split('=')[1]) : FINAL_CONTEXT_SIZE

async function retrieveFinalChunks(question: string, corpusKey: string) {
  const queryEmbedding = await embedQuery(question)
  const candidates = await hybridSearch(corpusKey, question, queryEmbedding, poolSize)

  return {
    candidates,
    finalChunks: candidates.slice(0, FINAL_CONTEXT_SIZE),
    bestSimilarity: Math.max(0, ...candidates.map((chunk) => chunk.similarity)),
  }
}

async function main() {
  const corpusKey = process.argv[2] ?? 'docs'
  const corpus = getCorpus(corpusKey)
  if (!corpus) {
    console.error(`corpus inconnu : ${corpusKey}`)
    process.exit(1)
  }

  console.log(`# Évaluation du retrieval — corpus "${corpusKey}"`)
  console.log(
    `  pool=${poolSize} contexte=${FINAL_CONTEXT_SIZE} seuil=${corpus.minSimilarityThreshold}\n`,
  )

  let hits = 0
  let reciprocalRankSum = 0
  let falseRejections = 0
  const inScopeSimilarities: number[] = []

  console.log('## Questions dans le périmètre')
  for (const testCase of inScopeCases) {
    const { finalChunks, candidates, bestSimilarity } = await retrieveFinalChunks(testCase.question, corpusKey)
    inScopeSimilarities.push(bestSimilarity)

    const rank = finalChunks.findIndex((chunk) => chunk.content.includes(testCase.marker))
    if (rank >= 0) {
      hits++
      reciprocalRankSum += 1 / (rank + 1)
    }

    // Le garde-fou doit laisser passer toute question légitime : un rejet ici est un faux négatif.
    const rejected = !Retrieval.isInScope(candidates, corpus.minSimilarityThreshold)
    if (rejected) falseRejections++

    const rankLabel = rank >= 0 ? `rang ${rank + 1}` : `absent du top ${FINAL_CONTEXT_SIZE}`
    console.log(
      `  ${testCase.id.padEnd(16)} ${rankLabel.padEnd(22)} similarité=${bestSimilarity.toFixed(4)}` +
        `${rejected ? '  ⚠ REJETÉ par le garde-fou' : ''}`,
    )
  }

  console.log('\n## Questions hors périmètre (doivent être rejetées)')
  let falseAcceptances = 0
  const outOfScopeSimilarities: number[] = []
  for (const question of outOfScopeQuestions) {
    const queryEmbedding = await embedQuery(question)
    const candidates = await hybridSearch(corpusKey, question, queryEmbedding, poolSize)
    const bestSimilarity = Math.max(0, ...candidates.map((chunk) => chunk.similarity))
    outOfScopeSimilarities.push(bestSimilarity)

    const accepted = Retrieval.isInScope(candidates, corpus.minSimilarityThreshold)
    if (accepted) falseAcceptances++
    console.log(`  similarité=${bestSimilarity.toFixed(4)}${accepted ? '  ⚠ ACCEPTÉ à tort' : ''}  ${question}`)
  }

  const minInScope = Math.min(...inScopeSimilarities)
  const maxOutOfScope = Math.max(...outOfScopeSimilarities)

  console.log('\n## Bilan')
  console.log(`  hit-rate@${FINAL_CONTEXT_SIZE} : ${hits}/${inScopeCases.length}`)
  console.log(`  MRR : ${(reciprocalRankSum / inScopeCases.length).toFixed(3)}`)
  console.log(`  garde-fou : ${falseRejections} rejet(s) à tort, ${falseAcceptances} acceptation(s) à tort`)
  console.log(
    `  marge de séparation : ${(minInScope - maxOutOfScope).toFixed(4)} ` +
      `(min dans le périmètre ${minInScope.toFixed(4)} / max hors périmètre ${maxOutOfScope.toFixed(4)})`,
  )
  if (minInScope > maxOutOfScope) {
    console.log(`  seuil idéal (milieu) : ${((minInScope + maxOutOfScope) / 2).toFixed(3)}`)
  } else {
    console.log('  ⚠ populations chevauchantes : aucun seuil unique ne les sépare proprement')
  }
}

await main()
await client.end()
