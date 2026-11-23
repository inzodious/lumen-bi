/**
 * Google sign-in for Lumen Server.
 *
 *   GET  /auth/login?next=/…     to Google's sign-in page
 *   GET  /auth/callback          back from Google: approved accounts get a session cookie
 *   GET  /auth/logout            clears the session
 *   GET  /connect?callback=…     Lumen's "Sign in with Google": after sign-in and a confirmation, the browser goes back
 *   POST /connect                to Lumen on this computer (a loopback address) with a key for publishing
 *   GET  /account                the signed-in account and the computers connected with it (remove one to revoke it)
 *
 * Only accounts in the approved list (LUMEN_SERVER_ALLOWED_EMAILS: addresses, or `@domain` for a whole domain) get a
 * session or a key. Taking an account off the list also stops its keys. Keys are stored as SHA-256 hashes in
 * <data>/keys.json. The ID token comes straight from Google's token endpoint over TLS, so its claims are read without a
 * signature check (OpenID Connect Core 3.1.3.7).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { promises as fsp, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { esc, page, parseCookies, safeEqual } from './server.mjs'

const SESSION_DAYS = 30
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

/** Approved-list entries from a comma or space separated string. */
export function parseAllowed(raw) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowed(allowed, email) {
  const e = String(email ?? '').toLowerCase()
  if (!e.includes('@')) return false
  return allowed.some((a) => (a.startsWith('@') ? e.endsWith(a) : a === e))
}

/** A loopback http address (Lumen's one-time listener), the only place /connect sends a key. */
export function isLoopbackCallback(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') && !!u.port && !u.username && !u.password
  } catch {
    return false
  }
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url')
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8')

/**
 * opts: { dataDir, secret, clientId, clientSecret, publicUrl, allowed: string[], now, fetch, secureCookies }
 * Returns { enabled, currentUser(req), keyUser(req), handle(req, res, path, url, h) → Promise<boolean> }.
 */
export function createAuth(opts) {
  const enabled = !!(opts.clientId && opts.clientSecret && opts.publicUrl)
  const allowed = opts.allowed ?? []
  const now = opts.now ?? (() => Date.now())
  const doFetch = opts.fetch ?? ((...a) => fetch(...a))
  const publicUrl = String(opts.publicUrl ?? '').replace(/\/+$/, '')
  const redirectUri = `${publicUrl}/auth/callback`
  const keysFile = join(opts.dataDir, 'keys.json')
  let keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : []
  const saveKeys = () => fsp.writeFile(keysFile, JSON.stringify(keys, null, 2), { mode: 0o600 })

  const mac = (v) => createHmac('sha256', opts.secret).update(v).digest('base64url')
  const secure = (req) => (opts.secureCookies || req.headers['x-forwarded-proto'] === 'https' || publicUrl.startsWith('https:') ? '; Secure' : '')

  function sessionValue(user) {
    const body = b64u(JSON.stringify({ e: user.email, n: user.name ?? '', x: now() + SESSION_DAYS * 86400000 }))
    return `${body}.${mac(`session|${body}`)}`
  }

  /** The signed-in, still-approved account of a browser request, or null. */
  function currentUser(req) {
    if (!enabled) return null
    const v = parseCookies(req.headers.cookie).lumen_session
    if (!v) return null
    const [body, sig] = v.split('.')
    if (!body || !safeEqual(sig ?? '', mac(`session|${body}`))) return null
    try {
      const s = JSON.parse(unb64u(body))
      if (!(s.x > now()) || !isAllowed(allowed, s.e)) return null
      return { email: s.e, name: s.n }
    } catch {
      return null
    }
  }

  /** The account behind a Bearer key issued through /connect, or null. Updates its last use (at most hourly). */
  function keyUser(req) {
    const h = String(req.headers.authorization ?? '')
    if (!h.startsWith('Bearer lsk_')) return null
    const hash = sha256(h.slice(7))
    const k = keys.find((x) => safeEqual(x.hash, hash))
    if (!k || !isAllowed(allowed, k.email)) return null
    if (!k.lastUsedAt || now() - Date.parse(k.lastUsedAt) > 3600000) {
      k.lastUsedAt = new Date(now()).toISOString()
      void saveKeys().catch(() => undefined)
    }
    return { email: k.email, key: k.id }
  }

  const csrf = (req) => mac(`csrf|${parseCookies(req.headers.cookie).lumen_session ?? ''}`)
  const html = (h, res, status, title, body, extra = {}) => h.send(res, status, page(title, body), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra })
  const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/')

  function loginRedirect(res, h, next) {
    return h.send(res, 302, '', { location: `/auth/login?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' })
  }

  async function callback(req, res, url, h) {
    const cookie = parseCookies(req.headers.cookie).lumen_oauth ?? ''
    const [state, nextB64] = cookie.split('.')
    const clear = `lumen_oauth=; Path=/auth/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req)}`
    if (url.searchParams.get('error')) return html(h, res, 400, 'Sign-in cancelled', `<h1>Sign-in cancelled</h1><p class="empty">Google did not sign you in (${esc(url.searchParams.get('error'))}).</p><p><a href="/auth/login">Try again</a></p>`, { 'set-cookie': clear })
    if (!state || !safeEqual(url.searchParams.get('state') ?? '', state))
      return html(h, res, 400, 'Sign-in expired', '<h1>Sign-in expired</h1><p class="empty">The sign-in took too long or came from another browser.</p><p><a href="/auth/login">Sign in again</a></p>', { 'set-cookie': clear })
    const r = await doFetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') ?? '', client_id: opts.clientId, client_secret: opts.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
    })
    const tok = await r.json().catch(() => ({}))
    if (!r.ok || !tok.id_token) return html(h, res, 502, 'Sign-in failed', `<h1>Sign-in failed</h1><p class="empty">Google did not confirm the sign-in${tok.error ? ` (${esc(tok.error)})` : ''}.</p><p><a href="/auth/login">Try again</a></p>`, { 'set-cookie': clear })
    let claims
    try {
      claims = JSON.parse(unb64u(String(tok.id_token).split('.')[1]))
    } catch {
      claims = {}
    }
    const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
    if (!issOk || claims.aud !== opts.clientId || !(claims.exp * 1000 > now()) || claims.email_verified !== true || !claims.email)
      return html(h, res, 403, 'Sign-in failed', '<h1>Sign-in failed</h1><p class="empty">Google did not return a verified email address.</p>', { 'set-cookie': clear })
    if (!isAllowed(allowed, claims.email))
      return html(h, res, 403, 'Not approved', `<h1>Not approved</h1><p class="empty">${esc(claims.email)} is not approved for this server. Ask its owner to add it.</p><p><a href="/auth/logout">Use another account</a></p>`, { 'set-cookie': clear })
    const session = `lumen_session=${sessionValue({ email: String(claims.email).toLowerCase(), name: claims.name })}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(req)}`
    res.setHeader('set-cookie', [session, clear])
    return h.send(res, 303, '', { location: safeNext(nextB64 ? unb64u(nextB64) : '/'), 'cache-control': 'no-store' })
  }

  function connectPage(req, res, url, h, user) {
    const cb = url.searchParams.get('callback') ?? ''
    if (!isLoopbackCallback(cb)) return html(h, res, 400, 'Cannot connect', '<h1>Cannot connect</h1><p class="empty">Start the sign-in from Lumen (File &gt; Publish &gt; Add destination &gt; Lumen Server).</p>')
    const name = String(url.searchParams.get('name') ?? 'this computer').slice(0, 80)
    const field = (k, v) => `<input type="hidden" name="${k}" value="${esc(v)}">`
    return html(
      h,
      res,
      200,
      'Connect Lumen',
      `<h1>Connect Lumen</h1><form method="post" action="/connect"><p>Let Lumen on <b>${esc(name)}</b> publish dashboards to this server as <b>${esc(user.email)}</b>?</p>${field('callback', cb)}${field('state', url.searchParams.get('state') ?? '')}${field('name', name)}${field('csrf', csrf(req))}<button type="submit">Connect</button></form><p class="empty">You can disconnect it any time on <a href="/account">your account page</a>.</p>`,
      { 'x-frame-options': 'DENY' }
    )
  }

  async function connect(req, res, h, user) {
    const form = new URLSearchParams((await h.readBody(req, 8192)).toString('utf8'))
    const cb = form.get('callback') ?? ''
    if (!safeEqual(form.get('csrf') ?? '', csrf(req)) || !isLoopbackCallback(cb)) return html(h, res, 400, 'Cannot connect', '<h1>Cannot connect</h1><p class="empty">Start the sign-in again from Lumen.</p>')
    const key = `lsk_${randomBytes(24).toString('base64url')}`
    keys.push({ id: randomBytes(6).toString('hex'), hash: sha256(key), email: user.email, name: String(form.get('name') ?? '').slice(0, 80), createdAt: new Date(now()).toISOString() })
    await saveKeys()
    const target = new URL(cb)
    target.searchParams.set('key', key)
    target.searchParams.set('email', user.email)
    target.searchParams.set('state', form.get('state') ?? '')
    return h.send(res, 303, '', { location: target.href, 'cache-control': 'no-store' })
  }

  function account(req, res, h, user) {
    const mine = keys.filter((k) => k.email === user.email)
    const rows = mine
      .map((k) => `<li><b>${esc(k.name || 'Lumen')}</b> <span class="empty">connected ${esc(k.createdAt.slice(0, 10))}${k.lastUsedAt ? `, last used ${esc(k.lastUsedAt.slice(0, 10))}` : ''}</span><form method="post" action="/account/revoke" style="display:inline;padding:0;border:0;background:none"><input type="hidden" name="id" value="${esc(k.id)}"><input type="hidden" name="csrf" value="${esc(csrf(req))}"><button type="submit" style="margin:0 0 0 8px;padding:2px 10px">Disconnect</button></form></li>`)
      .join('')
    return html(h, res, 200, 'Account', `<h1>${esc(user.name || user.email)}</h1><p class="empty">Signed in with Google as ${esc(user.email)}. <a href="/auth/logout">Sign out</a> · <a href="/">Dashboards</a></p><h2 style="font-size:16px">Connected computers</h2>${rows ? `<ul>${rows}</ul>` : '<p class="empty">None yet. In Lumen, add a Lumen Server destination and choose Sign in with Google.</p>'}`)
  }

  async function revoke(req, res, h, user) {
    const form = new URLSearchParams((await h.readBody(req, 4096)).toString('utf8'))
    if (!safeEqual(form.get('csrf') ?? '', csrf(req))) return html(h, res, 400, 'Expired', '<h1>That page expired</h1><p><a href="/account">Back</a></p>')
    keys = keys.filter((k) => !(k.id === form.get('id') && k.email === user.email))
    await saveKeys()
    return h.send(res, 303, '', { location: '/account' })
  }

  /** Handles the sign-in routes; false when `path` is not one of them. `h`: { send, readBody }. */
  async function handle(req, res, path, url, h) {
    if (!/^\/(auth\/|connect$|account(\/|$))/.test(path)) return false
    if (!enabled) {
      html(h, res, 404, 'Not set up', '<h1>Google sign-in is not set up on this server</h1>')
      return true
    }
    if (path === '/auth/login') {
      const state = randomBytes(16).toString('base64url')
      const next = safeNext(url.searchParams.get('next') ?? '/')
      const q = new URLSearchParams({ client_id: opts.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' })
      h.send(res, 302, '', { location: `${GOOGLE_AUTH}?${q}`, 'set-cookie': `lumen_oauth=${state}.${b64u(next)}; Path=/auth/; Max-Age=600; HttpOnly; SameSite=Lax${secure(req)}`, 'cache-control': 'no-store' })
      return true
    }
    if (path === '/auth/callback') {
      await callback(req, res, url, h)
      return true
    }
    if (path === '/auth/logout') {
      h.send(res, 303, '', { location: '/', 'set-cookie': `lumen_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req)}` })
      return true
    }
    const user = currentUser(req)
    if (!user) {
      loginRedirect(res, h, `${url.pathname}${url.search}`)
      return true
    }
    if (path === '/connect') await (req.method === 'POST' ? connect(req, res, h, user) : connectPage(req, res, url, h, user))
    else if (path === '/account/revoke' && req.method === 'POST') await revoke(req, res, h, user)
    else if (path === '/account') account(req, res, h, user)
    else html(h, res, 404, 'Not found', '<h1>Not found</h1>')
    return true
  }

  return { enabled, currentUser, keyUser, handle, loginRedirect, csrf }
}
