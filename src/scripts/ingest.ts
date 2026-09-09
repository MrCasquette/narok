import '../env.js'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { chunkDocument } from '../domain/chunk/chunking.js'
import { getCorpus } from '../domain/corpus/corpora.js'
import type { Document } from '../domain/document/Document.js'
import { client, db } from '../infrastructure/db/client.js'
import { chunks, documents } from '../infrastructure/db/schema.js'
import { embed } from '../infrastructure/llama/llamaClient.js'

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function ingestFile(corpusKey: string, sourcePath: string): Promise<void> {
  const content = await readFile(sourcePath, 'utf-8')
  const contentHash = hashContent(content)
  const id = `${corpusKey}:${sourcePath}`

  const [existing] = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
  if (existing && existing.contentHash === contentHash) {
    console.log(`[ingest] inchangé, ignoré : ${sourcePath}`)
    return
  }

  const document: Document = {
    id,
    corpus: corpusKey,
    sourcePath,
    content,
    contentHash,
    updatedAt: new Date().toISOString(),
  }

  const row = { ...document, updatedAt: new Date(document.updatedAt) }
  await db.insert(documents).values(row).onConflictDoUpdate({ target: documents.id, set: row })

  await db.delete(chunks).where(eq(chunks.documentId, id))

  const documentChunks = chunkDocument(document)
  for (const chunk of documentChunks) {
    const embedding = await embed(chunk.content)
    await db.insert(chunks).values({ ...chunk, embedding })
  }

  console.log(`[ingest] indexé (${documentChunks.length} chunks) : ${sourcePath}`)
}

async function main() {
  const corpusKey = process.argv[2]
  if (!corpusKey) {
    console.error('usage : bun run ingest <corpus>')
    process.exit(1)
  }

  const corpus = getCorpus(corpusKey)
  if (!corpus) {
    console.error(`corpus inconnu : ${corpusKey}`)
    process.exit(1)
  }

  const glob = new Bun.Glob('**/*.md')
  for await (const relativePath of glob.scan(corpus.sourcePath)) {
    await ingestFile(corpusKey, `${corpus.sourcePath}/${relativePath}`)
  }
}

await main()
await client.end()
