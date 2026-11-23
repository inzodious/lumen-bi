#!/usr/bin/env node
/** Lumen Server entry point: configuration from the environment (see README.md). */
import { createLumenServer, VERSION } from './server.mjs'

const env = process.env
const port = Number(env.PORT || 8080)
try {
  const server = createLumenServer({
    dataDir: env.LUMEN_SERVER_DATA || '/data',
    token: env.LUMEN_SERVER_TOKEN,
    title: env.LUMEN_SERVER_TITLE,
    listing: (env.LUMEN_SERVER_LISTING || 'on').toLowerCase() !== 'off',
    maxBytes: Number(env.LUMEN_SERVER_MAX_MB || 200) * 1024 * 1024,
    secureCookies: (env.LUMEN_SERVER_SECURE_COOKIES || '').toLowerCase() === 'true'
  })
  server.listen(port, () => console.log(`Lumen Server ${VERSION} listening on port ${port}`))
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
