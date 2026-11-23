import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { clientAddress, createLumenServer, isPrivateAddress } from './server.mjs'
import { isSafePath, readZip } from './zip.mjs'

const TOKEN = 'test-token-0123456789'

function site(title, extra = {}) {
  return zipSync({ 'index.html': strToU8('<!doctype html><title>viewer</title>'), 'assets/app.js': strToU8('console.log(1)'), 'report.wbi': new Uint8Array([1, 2, 3]), 'lumen-publish.json': strToU8(JSON.stringify({ format: 'lumen-publish', title, pages: [{ name: 'p', displayName: 'Overview' }] })), ...extra })
}

describe('zip reader', () => {
  it('reads stored and deflated entries', () => {
    const files = readZip(Buffer.from(zipSync({ 'a.txt': strToU8('hello'), 'd/b.bin': [new Uint8Array(1000).fill(7), { level: 9 }], 'c.txt': [strToU8('x'), { level: 0 }] })))
    expect([...files.keys()].sort()).toEqual(['a.txt', 'c.txt', 'd/b.bin'])
    expect(files.get('a.txt').toString()).toBe('hello')
    expect(files.get('d/b.bin').length).toBe(1000)
  })

  it('refuses paths that leave the folder and oversized archives', () => {
    expect(() => readZip(Buffer.from(zipSync({ '../evil': strToU8('x') })))).toThrow(/Unsafe path/)
    expect(() => readZip(Buffer.from(zipSync({ 'a': new Uint8Array(5000) })), 1000)).toThrow(/larger/)
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/Not a zip/)
    for (const bad of ['/abs', 'a/../b', 'a\\b', 'C:/x', 'a//b']) expect(isSafePath(bad)).toBe(false)
  })
})

describe('Lumen Server', () => {
  let server
  let base
  let dataDir
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'lumen-server-'))
    server = createLumenServer({ dataDir, token: TOKEN, title: 'Team dashboards' })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => server.close())

  const put = (slug, body, headers = {}) => fetch(`${base}/api/dashboards/${slug}`, { method: 'PUT', body, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/zip', ...headers } })

  it('refuses to start without a real token', () => {
    expect(() => createLumenServer({ dataDir, token: 'short' })).toThrow(/LUMEN_SERVER_TOKEN/)
  })

  it('reports health without sign-in and refuses the API without the token', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, name: 'lumen-server' })
    expect((await fetch(`${base}/api/dashboards`)).status).toBe(401)
    expect((await fetch(`${base}/api/dashboards`, { headers: { authorization: 'Bearer wrong-token-0123456789' } })).status).toBe(401)
  })

  it('publishes, serves, lists, replaces and removes a public dashboard', async () => {
    let r = await put('sales', site('Sales'))
    expect(r.status).toBe(201)
    expect(await r.json()).toMatchObject({ slug: 'sales', title: 'Sales', access: 'public', url: '/d/sales/' })
    r = await fetch(`${base}/d/sales/`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/html/)
    expect(await r.text()).toContain('viewer')
    r = await fetch(`${base}/d/sales/assets/app.js`)
    expect(r.headers.get('cache-control')).toMatch(/immutable/)
    expect((await fetch(`${base}/d/sales/lumen-publish.json`)).headers.get('cache-control')).toBe('no-cache')
    expect((await fetch(`${base}/d/sales`, { redirect: 'manual' })).headers.get('location')).toBe('/d/sales/')
    const home = await (await fetch(`${base}/`)).text()
    expect(home).toContain('Team dashboards')
    expect(home).toContain('href="/d/sales/"')
    // replace: old files go away, status 200
    r = await put('sales', zipSync({ 'index.html': strToU8('v2'), 'lumen-publish.json': strToU8('{"title":"Sales v2"}') }))
    expect(r.status).toBe(200)
    expect((await fetch(`${base}/d/sales/assets/app.js`)).status).toBe(404)
    const list = await (await fetch(`${base}/api/dashboards`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
    expect(list.map((d) => d.title)).toContain('Sales v2')
    expect((await fetch(`${base}/api/dashboards/sales`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200)
    expect((await fetch(`${base}/d/sales/`)).status).toBe(404)
    expect(existsSync(join(dataDir, 'dashboards', 'sales'))).toBe(false)
  })

  it('rejects uploads that are not dashboards or have bad names', async () => {
    expect((await put('x', zipSync({ 'a.txt': strToU8('x') }))).status).toBe(400)
    expect((await put('Bad_Name', site('x'))).status).toBe(400)
    expect((await put('x', Buffer.from('nope'))).status).toBe(400)
  })

  it('protects a dashboard with a password and keeps the browser signed in', async () => {
    expect((await put('finance', site('Finance'), { 'x-lumen-access': 'password' })).status).toBe(400)
    const pw = Buffer.from('s3cret ünïcode').toString('base64')
    expect((await put('finance', site('Finance'), { 'x-lumen-access': 'password', 'x-lumen-password': pw })).status).toBe(201)
    let r = await fetch(`${base}/d/finance/`)
    expect(await r.text()).toContain('type="password"')
    expect((await fetch(`${base}/d/finance/report.wbi`)).status).toBe(401)
    r = await fetch(`${base}/d/finance/login`, { method: 'POST', body: 'password=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' })
    expect(r.status).toBe(401)
    r = await fetch(`${base}/d/finance/login`, { method: 'POST', body: `password=${encodeURIComponent('s3cret ünïcode')}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' })
    expect(r.status).toBe(303)
    const cookie = r.headers.get('set-cookie').split(';')[0]
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/)
    r = await fetch(`${base}/d/finance/report.wbi`, { headers: { cookie } })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-cache')
    // republishing without a password keeps it; a new password signs everyone out
    expect((await put('finance', site('Finance'))).status).toBe(200)
    expect((await fetch(`${base}/d/finance/report.wbi`, { headers: { cookie } })).status).toBe(200)
    await put('finance', site('Finance'), { 'x-lumen-access': 'password', 'x-lumen-password': Buffer.from('other').toString('base64') })
    expect((await fetch(`${base}/d/finance/report.wbi`, { headers: { cookie } })).status).toBe(401)
    expect(await (await fetch(`${base}/`)).text()).toContain('Password protected')
    // a forged cookie is refused
    expect((await fetch(`${base}/d/finance/report.wbi`, { headers: { cookie: `lumen_finance=${Date.now() + 1e9}.forged` } })).status).toBe(401)
  })

  it('slows down password guessing', async () => {
    await put('guess', site('Guess'), { 'x-lumen-access': 'password', 'x-lumen-password': Buffer.from('right').toString('base64') })
    let last
    for (let i = 0; i < 11; i++) last = await fetch(`${base}/d/guess/login`, { method: 'POST', body: 'password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(last.status).toBe(429)
  })

  it('counts wrong passwords per visitor behind a proxy', async () => {
    await put('proxied', site('Proxied'), { 'x-lumen-access': 'password', 'x-lumen-password': Buffer.from('right').toString('base64') })
    const attempt = (ip) => fetch(`${base}/d/proxied/login`, { method: 'POST', body: 'password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip } })
    let last
    for (let i = 0; i < 11; i++) last = await attempt('203.0.113.5')
    expect(last.status).toBe(429)
    expect((await attempt('198.51.100.7')).status).toBe(401)
  })

  it('reads the visitor address from proxy headers only from private addresses', () => {
    const req = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers })
    expect(isPrivateAddress('::ffff:172.18.0.2')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(clientAddress(req('172.18.0.2', { 'cf-connecting-ip': '203.0.113.5' }))).toBe('203.0.113.5')
    expect(clientAddress(req('10.0.0.3', { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9')
    expect(clientAddress(req('8.8.8.8', { 'cf-connecting-ip': '203.0.113.5' }))).toBe('8.8.8.8')
    expect(clientAddress(req('172.18.0.2', { 'cf-connecting-ip': '203.0.113.5' }), false)).toBe('172.18.0.2')
  })

  it('shows each dashboard address on the home page', async () => {
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain('/d/proxied/</span>')
  })

  it('keeps page previews and shows them on the home page, but never a locked dashboard\'s to strangers', async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const manifest = (title) => strToU8(JSON.stringify({ title, pages: [{ name: 'a', displayName: 'Overview' }, { name: 'b', displayName: 'Detail' }], previews: [{ page: 'a', displayName: 'Overview', src: 'previews/0.jpg', width: 960, height: 540 }, { page: 'b', displayName: 'Detail', src: 'previews/1.jpg' }, { src: '../evil.jpg' }, { src: 'previews/9.jpg' }] }))
    let r = await put('pics', site('Pics', { 'lumen-publish.json': manifest('Pics <b>'), 'previews/0.jpg': jpg, 'previews/1.jpg': jpg }))
    const meta = await r.json()
    expect(meta.previews.map((p) => p.src)).toEqual(['/d/pics/previews/0.jpg', '/d/pics/previews/1.jpg'])
    expect((await fetch(`${base}/d/pics/previews/0.jpg`)).headers.get('content-type')).toBe('image/jpeg')
    r = await put('pics-locked', site('Locked pics', { 'lumen-publish.json': manifest('Locked pics'), 'previews/0.jpg': jpg, 'previews/1.jpg': jpg }), { 'x-lumen-access': 'password', 'x-lumen-password': Buffer.from('pw').toString('base64') })
    expect(r.status).toBe(201)
    expect((await fetch(`${base}/d/pics-locked/previews/0.jpg`)).status).toBe(401)
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain(' src="/d/pics/previews/0.jpg"')
    expect(html).toContain('Pics &lt;b&gt;')
    expect(html).not.toContain('Pics <b>')
    // the locked card only probes its preview (the request carries that dashboard's cookie, if any)
    expect(html).not.toContain(' src="/d/pics-locked/previews/0.jpg"')
    expect(html).toContain('data-src="/d/pics-locked/previews/0.jpg"')
  })

  it('hides the listing when asked', async () => {
    const s = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-server-')), token: TOKEN, listing: false })
    await new Promise((r) => s.listen(0, '127.0.0.1', r))
    expect((await fetch(`http://127.0.0.1:${s.address().port}/`)).status).toBe(404)
    s.close()
  })
})
