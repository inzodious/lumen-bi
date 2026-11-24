#!/usr/bin/env node
/** Lumen Server entry point: configuration from the environment (see README.md). */
import { chownSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createLumenServer, VERSION } from './server.mjs'
import { parseAllowed } from './auth.mjs'

const env = process.env
const port = Number(env.PORT || 8080)
const dataDir = env.LUMEN_SERVER_DATA || '/data'

/** Started as root (the Docker image): hand the data folder to the unprivileged user, then become that user. */
function dropPrivileges() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return
  const uid = Number(env.LUMEN_SERVER_UID || 1000)
  const gid = Number(env.LUMEN_SERVER_GID || uid)
  if (uid === 0) return
  mkdirSync(dataDir, { recursive: true })
  const walk = (p) => {
    const st = lstatSync(p)
    if (st.uid !== uid || st.gid !== gid) chownSync(p, uid, gid)
    if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n))
  }
  walk(dataDir)
  process.setgroups?.([])
  process.setgid(gid)
  process.setuid(uid)
}

try {
  dropPrivileges()
  const server = createLumenServer({
    dataDir,
    token: env.LUMEN_SERVER_TOKEN,
    title: env.LUMEN_SERVER_TITLE,
    listing: (env.LUMEN_SERVER_LISTING || 'on').toLowerCase() !== 'off',
    maxBytes: Number(env.LUMEN_SERVER_MAX_MB || 200) * 1024 * 1024,
    secureCookies: (env.LUMEN_SERVER_SECURE_COOKIES || '').toLowerCase() === 'true',
    google: {
      clientId: env.LUMEN_SERVER_GOOGLE_CLIENT_ID,
      clientSecret: env.LUMEN_SERVER_GOOGLE_CLIENT_SECRET,
      publicUrl: env.LUMEN_SERVER_PUBLIC_URL,
      allowed: parseAllowed(env.LUMEN_SERVER_ALLOWED_EMAILS)
    },
    trustProxy: { true: true, on: true, false: false, off: false }[(env.LUMEN_SERVER_TRUST_PROXY || '').toLowerCase()] ?? 'auto'
  })
  server.listen(port, () => console.log(`Lumen Server ${VERSION} listening on port ${port}`))
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
