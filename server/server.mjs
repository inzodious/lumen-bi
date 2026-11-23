/**
 * Lumen Server: hosts dashboards published from Lumen (File ▸ Publish ▸ Lumen Server).
 *
 *   GET  /                          list of dashboards (LUMEN_SERVER_LISTING=off hides it)
 *   GET  /d/<slug>/…                a dashboard; password-protected ones ask for the password first
 *   POST /d/<slug>/login            password form
 *   GET  /api/health                { ok, name, version } (no sign-in)
 *   GET  /api/dashboards            list (Bearer token)
 *   PUT  /api/dashboards/<slug>     upload: the site as a zip; x-lumen-access: public | password, x-lumen-password
 *   DELETE /api/dashboards/<slug>   remove
 *
 * Storage: <data>/dashboards/<slug>/site/* and meta.json; <data>/secret.key signs the password cookies. No database,
 * no dependencies: Node's own http, fs, crypto and zlib.
 */
import { createServer } from 'node:http'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { promises as fsp, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { isSafePath, readZip } from './zip.mjs'
import { homePage, readPreviews } from './home.mjs'

export const VERSION = '1.0.1'
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const COOKIE_DAYS = 30

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wbi': 'application/octet-stream'
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(password), salt, 32).toString('hex') }
}

function checkPassword(password, access) {
  if (!access?.salt || !access?.hash) return false
  return safeEqual(scryptSync(String(password), access.salt, 32).toString('hex'), access.hash)
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** The page shell shared by the listing and the password form. */
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Lumen Server"><title>${esc(title)}</title><style>
:root{--fg:#252423;--fg3:#605e5c;--bg:#f3f2f1;--card:#fff;--line:#e1dfdd;--accent:#117865}
@media (prefers-color-scheme:dark){:root{--fg:#f3f2f1;--fg3:#c8c6c4;--bg:#1b1a19;--card:#252423;--line:#3b3a39;--accent:#4fb7a4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 'Segoe UI','Selawik','Open Sans',system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px}h1{font-size:22px;font-weight:600;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
a.card{display:block;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:inherit;text-decoration:none}
a.card:hover{border-color:var(--accent)}.t{font-weight:600;font-size:15px;margin-bottom:4px}.m{color:var(--fg3);font-size:12px}
.empty{color:var(--fg3)}form{max-width:360px;padding:20px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
label{display:block;font-weight:600;margin-bottom:6px}input{width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;font:inherit;background:var(--card);color:var(--fg)}
button{margin-top:12px;padding:8px 16px;border:0;border-radius:4px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:#d13438;margin-top:8px}
</style></head><body><main>${body}</main></body></html>`
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i]

/** True for loopback and private-network addresses (where a reverse proxy or tunnel connector runs). */
export function isPrivateAddress(addr) {
  const a = String(addr ?? '').replace(/^::ffff:/i, '')
  return PRIVATE.some((re) => re.test(a))
}

/**
 * The visitor's address. Behind a reverse proxy or a Cloudflare Tunnel every request comes from the proxy, so the
 * proxy's CF-Connecting-IP / X-Real-IP / X-Forwarded-For header is used instead: always with trustProxy true, never
 * with false, and with 'auto' (default) only when the request comes from a private address.
 */
export function clientAddress(req, trustProxy = 'auto') {
  const remote = req.socket.remoteAddress ?? ''
  const trusted = trustProxy === true || (trustProxy === 'auto' && isPrivateAddress(remote))
  if (!trusted) return remote
  const h = req.headers
  const forwarded = h['cf-connecting-ip'] ?? h['x-real-ip'] ?? String(h['x-forwarded-for'] ?? '').split(',')[0]
  return String(forwarded ?? '').trim() || remote
}

export function createLumenServer(opts) {
  const dataDir = opts.dataDir
  const token = opts.token
  const maxBytes = opts.maxBytes ?? 200 * 1024 * 1024
  const listing = opts.listing !== false
  const siteTitle = opts.title || 'Dashboards'
  const now = opts.now ?? (() => Date.now())
  const trustProxy = opts.trustProxy ?? 'auto'
  if (!token || String(token).length < 16) throw new Error('Set LUMEN_SERVER_TOKEN to a random value of at least 16 characters.')
  const root = join(dataDir, 'dashboards')
  try {
    mkdirSync(root, { recursive: true })
  } catch (e) {
    if (e?.code === 'EACCES') throw new Error(`Lumen Server cannot write to ${dataDir}. Give the user it runs as write access to that folder.`)
    throw e
  }
  const secretFile = join(dataDir, 'secret.key')
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 })
  const secret = readFileSync(secretFile, 'utf8').trim()
  const failures = new Map()

  const dir = (slug) => join(root, slug)
  async function readMeta(slug) {
    try {
      return JSON.parse(await fsp.readFile(join(dir(slug), 'meta.json'), 'utf8'))
    } catch {
      return null
    }
  }
  async function allMeta() {
    const out = []
    for (const name of await fsp.readdir(root).catch(() => [])) {
      if (!SLUG.test(name)) continue
      const m = await readMeta(name)
      if (m) out.push(m)
    }
    return out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
  }
  const publicMeta = (m) => ({ slug: m.slug, title: m.title, publishedAt: m.publishedAt, access: m.access?.mode ?? 'public', bytes: m.bytes, pages: m.pages ?? [], previews: (m.previews ?? []).map((p) => ({ ...p, src: `/d/${m.slug}/${p.src}` })), url: `/d/${m.slug}/` })

  // password cookies: expiry + HMAC over slug, expiry and the password hash (a new password signs everyone out)
  const sign = (slug, access, exp) => createHmac('sha256', secret).update(`${slug}|${exp}|${access.hash}`).digest('base64url')
  function cookieOk(req, slug, access) {
    const v = parseCookies(req.headers.cookie)[`lumen_${slug}`]
    if (!v) return false
    const [exp, mac] = v.split('.')
    return Number(exp) > now() && safeEqual(mac ?? '', sign(slug, access, exp))
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...headers })
    res.end(body)
  }
  const json = (res, status, value) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  const authed = (req) => {
    const h = String(req.headers.authorization ?? '')
    return h.startsWith('Bearer ') && safeEqual(h.slice(7), token)
  }

  async function readBody(req, limit) {
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > limit) throw Object.assign(new Error('The upload is larger than this server accepts'), { status: 413 })
      chunks.push(c)
    }
    return Buffer.concat(chunks)
  }

  async function upload(req, res, slug) {
    let files
    try {
      files = readZip(await readBody(req, maxBytes), maxBytes * 4)
    } catch (e) {
      return json(res, e?.status ?? 400, { error: e?.message ?? String(e) })
    }
    if (!files.has('index.html') || !files.has('lumen-publish.json')) return json(res, 400, { error: 'The upload is not a published Lumen dashboard (index.html or lumen-publish.json missing).' })
    let manifest
    try {
      manifest = JSON.parse(files.get('lumen-publish.json').toString('utf8'))
    } catch {
      return json(res, 400, { error: 'lumen-publish.json is not valid JSON.' })
    }
    const prev = await readMeta(slug)
    const mode = String(req.headers['x-lumen-access'] ?? prev?.access?.mode ?? 'public')
    if (mode !== 'public' && mode !== 'password') return json(res, 400, { error: 'x-lumen-access must be public or password.' })
    let access = { mode: 'public' }
    if (mode === 'password') {
      const pw = req.headers['x-lumen-password'] ? Buffer.from(String(req.headers['x-lumen-password']), 'base64').toString('utf8') : ''
      if (pw) access = { mode: 'password', ...hashPassword(pw) }
      else if (prev?.access?.mode === 'password' && prev.access.hash) access = prev.access
      else return json(res, 400, { error: 'Give a password for a password-protected dashboard.' })
    }
    // write next to the live copy, then swap, so viewers never see half a dashboard
    const staging = join(root, `.${slug}-${randomBytes(4).toString('hex')}`)
    let bytes = 0
    for (const [p, data] of files) {
      if (!isSafePath(p)) continue
      const target = join(staging, 'site', ...p.split('/'))
      await fsp.mkdir(join(target, '..'), { recursive: true })
      await fsp.writeFile(target, data)
      bytes += data.length
    }
    const meta = { slug, title: String(manifest.title || slug).slice(0, 200), publishedAt: new Date(now()).toISOString(), pages: Array.isArray(manifest.pages) ? manifest.pages.slice(0, 200) : [], previews: readPreviews(manifest, files), bytes, access }
    await fsp.writeFile(join(staging, 'meta.json'), JSON.stringify(meta, null, 2))
    const old = join(root, `.${slug}-old-${randomBytes(4).toString('hex')}`)
    if (existsSync(dir(slug))) await fsp.rename(dir(slug), old)
    await fsp.rename(staging, dir(slug))
    await fsp.rm(old, { recursive: true, force: true })
    return json(res, prev ? 200 : 201, publicMeta(meta))
  }

  function loginPage(slug, title, error) {
    return page(
      title,
      `<h1>${esc(title)}</h1><form method="post" action="/d/${slug}/login"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Open dashboard</button>${error ? `<div class="err">${esc(error)}</div>` : ''}</form>`
    )
  }

  async function login(req, res, slug, meta) {
    const key = `${clientAddress(req, trustProxy)}|${slug}`
    const f = failures.get(key)
    if (f && f.count >= 10 && now() - f.at < 15 * 60 * 1000) return send(res, 429, loginPage(slug, meta.title, 'Too many attempts. Try again in 15 minutes.'), { 'content-type': 'text/html; charset=utf-8' })
    const body = (await readBody(req, 4096)).toString('utf8')
    const password = new URLSearchParams(body).get('password') ?? ''
    if (!checkPassword(password, meta.access)) {
      failures.set(key, { count: (f && now() - f.at < 15 * 60 * 1000 ? f.count : 0) + 1, at: now() })
      return send(res, 401, loginPage(slug, meta.title, 'That password is not right.'), { 'content-type': 'text/html; charset=utf-8' })
    }
    failures.delete(key)
    const exp = String(now() + COOKIE_DAYS * 86400000)
    const secure = opts.secureCookies || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
    send(res, 303, '', { location: `/d/${slug}/`, 'set-cookie': `lumen_${slug}=${exp}.${sign(slug, meta.access, exp)}; Path=/d/${slug}/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}` })
  }

  async function serveDashboard(req, res, slug, rest) {
    const meta = await readMeta(slug)
    if (!meta) return send(res, 404, page('Not found', '<h1>Dashboard not found</h1><p class="empty">It may have been removed or renamed.</p>'), { 'content-type': 'text/html; charset=utf-8' })
    if (rest === 'login' && req.method === 'POST' && meta.access?.mode === 'password') return login(req, res, slug, meta)
    if (meta.access?.mode === 'password' && !cookieOk(req, slug, meta.access)) {
      if (rest === '' || rest === 'index.html') return send(res, 200, loginPage(slug, meta.title), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return json(res, 401, { error: 'Sign in to this dashboard first.' })
    }
    const rel = rest === '' ? 'index.html' : rest
    if (!isSafePath(rel)) return send(res, 400, 'Bad path')
    const file = join(dir(slug), 'site', ...rel.split('/'))
    let data
    try {
      data = await fsp.readFile(file)
    } catch {
      return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' })
    }
    const immutable = rel.startsWith('assets/')
    send(res, 200, req.method === 'HEAD' ? '' : data, {
      'content-type': TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(data.length),
      'cache-control': meta.access?.mode === 'password' ? 'private, no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
  }

  async function index(res) {
    if (!listing) return send(res, 404, page(siteTitle, '<h1>Nothing here</h1>'), { 'content-type': 'text/html; charset=utf-8' })
    const all = (await allMeta()).map(publicMeta)
    send(res, 200, homePage({ title: siteTitle, dashboards: all }), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    if (path === '/api/health') return json(res, 200, { ok: true, name: 'lumen-server', version: VERSION })
    if (path.startsWith('/api/')) {
      if (!authed(req)) return json(res, 401, { error: 'Sign in with the server token.' })
      if (path === '/api/dashboards' && req.method === 'GET') return json(res, 200, (await allMeta()).map(publicMeta))
      const m = /^\/api\/dashboards\/([^/]+)$/.exec(path)
      if (m) {
        if (!SLUG.test(m[1])) return json(res, 400, { error: 'A dashboard name uses lower-case letters, digits and hyphens (up to 63).' })
        if (req.method === 'PUT') return upload(req, res, m[1])
        if (req.method === 'GET') {
          const meta = await readMeta(m[1])
          return meta ? json(res, 200, publicMeta(meta)) : json(res, 404, { error: 'No such dashboard.' })
        }
        if (req.method === 'DELETE') {
          if (!existsSync(dir(m[1]))) return json(res, 404, { error: 'No such dashboard.' })
          await fsp.rm(dir(m[1]), { recursive: true, force: true })
          return json(res, 200, { ok: true })
        }
      }
      return json(res, 404, { error: 'Unknown API route.' })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return send(res, 405, 'Method not allowed')
    if (path === '/' || path === '/index.html') return index(res)
    const d = /^\/d\/([^/]+)(\/(.*))?$/.exec(path)
    if (d && SLUG.test(d[1])) {
      if (d[2] === undefined) return send(res, 301, '', { location: `/d/${d[1]}/` })
      return serveDashboard(req, res, d[1], d[3] ?? '')
    }
    return send(res, 404, page('Not found', '<h1>Not found</h1>'), { 'content-type': 'text/html; charset=utf-8' })
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) json(res, e?.status ?? 500, { error: e?.status ? e.message : `Server error: ${e?.message ?? e}` })
      else res.end()
    })
  })
}
