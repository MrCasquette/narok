import './env.js' // fail-fast avant tout autre import

import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { env } from './env.js'
import { chat } from './modules/chat/index.js'

const app = new Elysia()
  .use(cors())
  .use(openapi())
  .get('/health', () => ({ status: 'ok' }))
  .use(chat)
  .listen(env.API_PORT)

console.log(`[narok] écoute sur http://localhost:${env.API_PORT}`)

export type App = typeof app
