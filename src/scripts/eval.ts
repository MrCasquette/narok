import '../env.js'

import { getCorpus } from '../domain/corpus/corpora.js'
import { FINAL_CONTEXT_SIZE, Retrieval } from '../domain/retrieval/Retrieval.js'
import { hybridSearch } from '../domain/retrieval/retrieval.repository.js'
import { client } from '../infrastructure/db/client.js'
import { embedQuery } from '../infrastructure/llama/llamaClient.js'
import { answerQuestion } from '../modules/chat/service.js'
import { type EvalCase, evalSets } from './eval.cases.js'

// Mesure la qualité de la chaîne sur le corpus réellement indexé, en rejouant le chemin de
// production. Sert à comparer une modification à l'état antérieur : mesurer, modifier, remesurer.
//
// Deux niveaux, volontairement distincts :
// - le retrieval (un document qui répond est-il dans les extraits envoyés au modèle) ;
// - la réponse (le texte généré contient-il ce qu'on attend).
//
// Ne juger que le premier induit en erreur : deux configurations peuvent manquer toutes deux le
// passage attendu, donc paraître équivalentes, alors que l'une mène à une bonne réponse et l'autre
// à une réponse fausse. C'est arrivé le 2026-09-09 et ça a fait retenir la mauvaise configuration.
//
// Usage : `bun run eval [corpus] [--fast] [--pool=N]`
//   --fast   : saute la génération (retrieval seul, quelques secondes au lieu de plusieurs minutes)
//   --pool=N : récupère N candidats avant troncature. Attention, N change aussi les limites
//              internes de la requête hybride, donc la fusion RRF : un pool large n'est pas un
//              sur-ensemble d'un pool étroit.

const skipAnswers = process.argv.includes('--fast')
const poolArg = process.argv.find((arg) => arg.startsWith('--pool='))
const poolSize = poolArg ? Number(poolArg.split('=')[1]) : FINAL_CONTEXT_SIZE

function normalize(text: string): string {
  return text.toLowerCase()
}

// Un groupe est satisfait si l'une de ses variantes (séparées par `|`) apparaît dans la réponse.
function groupMatches(answer: string, group: string): boolean {
  return group.split('|').some((variant) => normalize(answer).includes(normalize(variant)))
}

async function retrieve(question: string, corpusKey: string) {
  const queryEmbedding = await embedQuery(question)
  const candidates = await hybridSearch(corpusKey, question, queryEmbedding, poolSize)
  return {
    candidates,
    finalChunks: candidates.slice(0, FINAL_CONTEXT_SIZE),
    bestSimilarity: Math.max(0, ...candidates.map((chunk) => chunk.similarity)),
  }
}

type CaseOutcome = {
  rank: number | null
  rejected: boolean
  bestSimilarity: number
  answerOk: boolean | null
  wrongSigns: string[]
}

async function runCase(testCase: EvalCase, corpusKey: string, threshold: number): Promise<CaseOutcome> {
  const { finalChunks, candidates, bestSimilarity } = await retrieve(testCase.question, corpusKey)

  const index = finalChunks.findIndex((chunk) => groupMatches(chunk.documentId, testCase.expectedDoc))
  const rejected = !Retrieval.isInScope(candidates, threshold)

  if (skipAnswers) {
    return { rank: index >= 0 ? index + 1 : null, rejected, bestSimilarity, answerOk: null, wrongSigns: [] }
  }

  const result = await answerQuestion(corpusKey, testCase.question)
  const answer = result.ok ? result.answer : ''
  return {
    rank: index >= 0 ? index + 1 : null,
    rejected,
    bestSimilarity,
    answerOk: result.ok && testCase.expectedInAnswer.every((group) => groupMatches(answer, group)),
    wrongSigns: (testCase.wrongAnswerSigns ?? []).filter((sign) => groupMatches(answer, sign)),
  }
}

async function main() {
  const corpusKey = process.argv[2]?.startsWith('--') ? 'docs' : (process.argv[2] ?? 'docs')
  const corpus = getCorpus(corpusKey)
  const evalSet = evalSets[corpusKey]
  if (!corpus) {
    console.error(`corpus inconnu : ${corpusKey}`)
    process.exit(1)
  }
  if (!evalSet) {
    console.error(`aucun jeu d'évaluation pour le corpus "${corpusKey}" (voir eval.cases.ts)`)
    process.exit(1)
  }

  console.log(`# Évaluation — corpus "${corpusKey}"`)
  console.log(
    `  pool=${poolSize} contexte=${FINAL_CONTEXT_SIZE} seuil=${corpus.minSimilarityThreshold}` +
      `${skipAnswers ? ' (retrieval seul)' : ''}\n`,
  )

  let hits = 0
  let reciprocalRankSum = 0
  let falseRejections = 0
  let answersOk = 0
  let answersEvaluated = 0
  const inScopeSimilarities: number[] = []

  console.log('## Questions dans le périmètre')
  for (const testCase of evalSet.inScope) {
    const outcome = await runCase(testCase, corpusKey, corpus.minSimilarityThreshold)
    inScopeSimilarities.push(outcome.bestSimilarity)

    if (outcome.rank !== null) {
      hits++
      reciprocalRankSum += 1 / outcome.rank
    }
    if (outcome.rejected) falseRejections++
    if (outcome.answerOk !== null) {
      answersEvaluated++
      if (outcome.answerOk) answersOk++
    }

    const rankLabel = outcome.rank !== null ? `rang ${outcome.rank}` : `absent du top ${FINAL_CONTEXT_SIZE}`
    const answerLabel =
      outcome.answerOk === null ? '' : outcome.answerOk ? '  réponse OK' : '  RÉPONSE INCORRECTE'
    const wrongLabel = outcome.wrongSigns.length ? `  (contient : ${outcome.wrongSigns.join(', ')})` : ''
    console.log(
      `  ${testCase.id.padEnd(20)} ${rankLabel.padEnd(22)} sim=${outcome.bestSimilarity.toFixed(4)}` +
        `${outcome.rejected ? '  REJETÉ À TORT' : ''}${answerLabel}${wrongLabel}`,
    )
  }

  console.log('\n## Questions hors périmètre (doivent être rejetées)')
  let falseAcceptances = 0
  const outOfScopeSimilarities: number[] = []
  for (const question of evalSet.outOfScope) {
    const { candidates, bestSimilarity } = await retrieve(question, corpusKey)
    outOfScopeSimilarities.push(bestSimilarity)

    const accepted = Retrieval.isInScope(candidates, corpus.minSimilarityThreshold)
    if (accepted) falseAcceptances++
    console.log(`  sim=${bestSimilarity.toFixed(4)}${accepted ? '  ACCEPTÉ À TORT' : ''}  ${question}`)
  }

  const minInScope = Math.min(...inScopeSimilarities)
  const maxOutOfScope = Math.max(...outOfScopeSimilarities)

  console.log('\n## Bilan')
  console.log(`  hit-rate@${FINAL_CONTEXT_SIZE} : ${hits}/${evalSet.inScope.length}`)
  console.log(`  MRR : ${(reciprocalRankSum / evalSet.inScope.length).toFixed(3)}`)
  if (answersEvaluated > 0) {
    console.log(`  réponses correctes : ${answersOk}/${answersEvaluated}`)
  }
  console.log(`  garde-fou : ${falseRejections} rejet(s) à tort, ${falseAcceptances} acceptation(s) à tort`)
  console.log(
    `  marge de séparation : ${(minInScope - maxOutOfScope).toFixed(4)} ` +
      `(min dans le périmètre ${minInScope.toFixed(4)} / max hors périmètre ${maxOutOfScope.toFixed(4)})`,
  )
  if (minInScope > maxOutOfScope) {
    console.log(`  seuil idéal (milieu) : ${((minInScope + maxOutOfScope) / 2).toFixed(3)}`)
  } else {
    console.log('  populations chevauchantes : aucun seuil unique ne les sépare proprement')
  }
}

await main()
await client.end()
