import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { createLumenServer } from './server.mjs'
import { isAllowed, isLoopbackCallback, parseAllowed } from './auth.mjs'

const CLIENT = 'client-123.apps.googleusercontent.com'
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
let nextEmail = 'owner@example.com'
const googleFetch = async (url, init) => {
  if (url !== 'https://oauth2.googleapis.com/token') throw new Error(`unexpected ${url}`)
  const form = new URLSearchParams(init.body)
  if (form.get('code') !== 'good-code' || form.get('client_secret') !== 'shh') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 3600, email: nextEmail, email_verified: true, name: 'Owner' }
  return new Response(JSON.stringify({ id_token: `${b64u({ alg: 'RS256' })}.${b64u(claims)}.sig`, access_token: 'a' }))
}

function site(title) {
  return zipSync({ 'index.html': strToU8('<!doctype html><title>viewer</title>'), 'lumen-publish.json': strToU8(JSON.stringify({ format: 'lumen-publish', title, pages: [] })) })
}

const cookiesOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))

describe('Google sign-in', () => {
  let server
  let base
  beforeAll(async () => {
    server = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-auth-')), google: { clientId: CLIENT, clientSecret: 'shh', publicUrl: 'https://dash.example.com', allowed: ['owner@example.com'] }, fetch: googleFetch })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => server.close())

  async function signIn(email = 'owner@example.com', next = '/') {
    nextEmail = email
    const start = await fetch(`${base}/auth/login?next=${encodeURIComponent(next)}`, { redirect: 'manual' })
    expect(start.status).toBe(302)
    const to = new URL(start.headers.get('location'))
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(to.searchParams.get('redirect_uri')).toBe('https://dash.example.com/auth/callback')
    const state = to.searchParams.get('state')
    return fetch(`${base}/auth/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie: cookiesOf(start).join('; ') } })
  }

  it('parses the approved list', () => {
    const allowed = parseAllowed('Owner@Example.com, @team.example.org')
    expect(isAllowed(allowed, 'owner@example.com')).toBe(true)
    expect(isAllowed(allowed, 'anyone@team.example.org')).toBe(true)
    expect(isAllowed(allowed, 'other@example.com')).toBe(false)
    expect(isLoopbackCallback('http://127.0.0.1:5123/cb')).toBe(true)
    expect(isLoopbackCallback('https://evil.example/cb')).toBe(false)
    expect(isLoopbackCallback('http://127.0.0.1/cb')).toBe(false)
  })

  it('reports Google sign-in and refuses the API without a key', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ signIn: 'google' })
    expect((await fetch(`${base}/api/dashboards`)).status).toBe(401)
  })

  it('signs in an approved account and returns to the page it came from', async () => {
    const r = await signIn('owner@example.com', '/account')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/account')
    const session = cookiesOf(r).find((c) => c.startsWith('lumen_session='))
    const account = await fetch(`${base}/account`, { headers: { cookie: session } })
    expect(await account.text()).toContain('owner@example.com')
  })

  it('turns away accounts that are not approved and bad states', async () => {
    const r = await signIn('stranger@example.com')
    expect(r.status).toBe(403)
    expect(cookiesOf(r).some((c) => c.startsWith('lumen_session='))).toBe(false)
    expect((await fetch(`${base}/auth/callback?code=good-code&state=forged`, { redirect: 'manual' })).status).toBe(400)
    expect((await fetch(`${base}/account`, { redirect: 'manual', headers: { cookie: 'lumen_session=e30.forged' } })).status).toBe(302)
  })

  it('connects Lumen through the browser, publishes with the key, and disconnects it', async () => {
    const session = cookiesOf(await signIn()).find((c) => c.startsWith('lumen_session='))
    const cb = 'http://127.0.0.1:5999/lumen-callback'
    const pageRes = await fetch(`${base}/connect?callback=${encodeURIComponent(cb)}&state=s1&name=Horizon`, { headers: { cookie: session } })
    const html = await pageRes.text()
    expect(html).toContain('Horizon')
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1]
    const bad = await fetch(`${base}/connect`, { method: 'POST', redirect: 'manual', headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ callback: cb, state: 's1', name: 'Horizon', csrf: 'nope' }) })
    expect(bad.status).toBe(400)
    const ok = await fetch(`${base}/connect`, { method: 'POST', redirect: 'manual', headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ callback: cb, state: 's1', name: 'Horizon', csrf }) })
    expect(ok.status).toBe(303)
    const back = new URL(ok.headers.get('location'))
    expect(back.origin + back.pathname).toBe(cb)
    expect(back.searchParams.get('state')).toBe('s1')
    const key = back.searchParams.get('key')
    expect(key).toMatch(/^lsk_/)
    const auth = { authorization: `Bearer ${key}` }
    expect(await (await fetch(`${base}/api/me`, { headers: auth })).json()).toMatchObject({ email: 'owner@example.com', via: 'google' })

    expect((await fetch(`${base}/api/dashboards/team`, { method: 'PUT', body: site('Team only'), headers: { ...auth, 'x-lumen-access': 'users' } })).status).toBe(201)
    const anon = await fetch(`${base}/d/team/`, { redirect: 'manual' })
    expect(anon.status).toBe(302)
    expect(anon.headers.get('location')).toBe('/auth/login?next=%2Fd%2Fteam%2F')
    expect((await fetch(`${base}/d/team/lumen-publish.json`)).status).toBe(401)
    expect((await fetch(`${base}/d/team/`, { headers: { cookie: session } })).status).toBe(200)
    expect(await (await fetch(`${base}/`)).text()).not.toContain('Team only')
    expect(await (await fetch(`${base}/`, { headers: { cookie: session } })).text()).toContain('Team only')

    const acct = await (await fetch(`${base}/account`, { headers: { cookie: session } })).text()
    const id = /name="id" value="([^"]+)"/.exec(acct)[1]
    const csrf2 = /name="csrf" value="([^"]+)"/.exec(acct)[1]
    await fetch(`${base}/account/revoke`, { method: 'POST', redirect: 'manual', headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id, csrf: csrf2 }) })
    expect((await fetch(`${base}/api/me`, { headers: auth })).status).toBe(401)
  })

  it('refuses to send a key anywhere but this computer', async () => {
    const session = cookiesOf(await signIn()).find((c) => c.startsWith('lumen_session='))
    expect((await fetch(`${base}/connect?callback=${encodeURIComponent('https://evil.example/cb')}`, { headers: { cookie: session } })).status).toBe(400)
  })
})

describe('Lumen Server without Google sign-in', () => {
  it('needs a token or Google sign-in', () => {
    expect(() => createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-auth-')) })).toThrow(/Google sign-in/)
  })
})
