import type { Static } from 'elysia'
import type { ChunkSchema } from './Chunk.schema.js'

export type Chunk = Static<typeof ChunkSchema>
