import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
// @ts-expect-error plain ES module without types (server/ runs on Node alone)
import { createLumenServer } from '../../../../../server/server.mjs'
import { connectLumenServer } from '../lumenConnect'

const CLIENT = 'cid.apps.googleusercontent.com'
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const google = async () =>
  new Response(JSON.stringify({ id_token: `${b64u({})}.${b64u({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, email: 'owner@example.com', email_verified: true })}.x` }))

let server: Server
let base = ''
beforeAll(async () => {
  server = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-connect-')), google: { clientId: CLIENT, clientSecret: 's', publicUrl: 'https://dash.example.com', allowed: ['owner@example.com'] }, fetch: google })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const firstCookie = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0])

/** Plays the browser: signs in with (fake) Google, confirms Connect, follows the redirect back to Lumen. */
async function browser(url: string): Promise<void> {
  const start = await fetch(`${base}/auth/login`, { redirect: 'manual' })
  const state = new URL(start.headers.get('location')!).searchParams.get('state')
  const cb = await fetch(`${base}/auth/callback?code=c&state=${state}`, { redirect: 'manual', headers: { cookie: firstCookie(start).join('; ') } })
  const session = firstCookie(cb).find((c) => c.startsWith('lumen_session='))!
  const page = await (await fetch(url.replace('https://dash.example.com', base).replace(/^http:\/\/127\.0\.0\.1:\d+/, base), { headers: { cookie: session } })).text()
  const field = (n: string) => new RegExp(`name="${n}" value="([^"]*)"`).exec(page)![1].replace(/&amp;/g, '&')
  const ok = await fetch(`${base}/connect`, { method: 'POST', redirect: 'manual', headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ callback: field('callback'), state: field('state'), name: field('name'), csrf: field('csrf') }) })
  await fetch(ok.headers.get('location')!)
}

describe('Sign in with Google for Lumen Server', () => {
  it('gets a publishing key through the browser', async () => {
    const out = await connectLumenServer(base, (u) => void browser(u), { computerName: 'test-box' })
    expect(out.email).toBe('owner@example.com')
    expect(out.key).toMatch(/^lsk_/)
    const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${out.key}` } })).json()
    expect(me).toMatchObject({ email: 'owner@example.com' })
  })

  it('explains a server without Google sign-in', async () => {
    const plain: Server = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-connect-')), token: 'plain-token-0123456789' })
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`
    await expect(connectLumenServer(url, () => undefined)).rejects.toThrow(/Paste its server token/)
    plain.close()
  })
})
