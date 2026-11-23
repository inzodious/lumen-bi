import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
// @ts-expect-error plain ES module without types (server/ runs on Node alone)
import { createLumenServer } from '../../../../../server/server.mjs'
import type { DestinationEntry } from '../destinations'
import type { SiteFiles } from '../site'
import { lumenServer } from '../targets/lumenServer'
import type { DeployContext } from '../targets/common'

const TOKEN = 'test-token-0123456789abcdef'
let server: Server
let base = ''

const ctx: DeployContext = { fetch: (url, init) => fetch(url, init), progress: () => undefined, sleep: async () => undefined }

function dest(token = TOKEN, url = base): DestinationEntry {
  return { id: 'd1', kind: 'lumen-server', name: 'Home', settings: { url }, secrets: { token }, updatedAt: 0 }
}

function site(title: string): SiteFiles {
  const enc = (s: string) => new TextEncoder().encode(s)
  return {
    'index.html': enc('<!doctype html><title>viewer</title>'),
    'assets/app.js': enc('console.log(1)'),
    'report.wbi': new Uint8Array([1, 2, 3]),
    'lumen-publish.json': enc(JSON.stringify({ format: 'lumen-publish', version: 1, title, pages: [{ name: 'p1', displayName: 'Page 1' }] }))
  }
}

beforeAll(async () => {
  server = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-srv-')), token: TOKEN })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('Lumen Server target', () => {
  it('checks the connection and the token', async () => {
    expect(await lumenServer.test(dest(), 'sales', ctx)).toMatch(/Connected to Lumen Server .*0 dashboards.*sales will be created/)
    await expect(lumenServer.test(dest('wrong-token-0123456789'), 'sales', ctx)).rejects.toThrow()
  })

  it('publishes a public dashboard and returns its address', async () => {
    const out = await lumenServer.deployWithAccess(dest(), 'sales', site('Sales'), 'Sales', ctx, { mode: 'public' })
    expect(out.url).toBe(`${base}/d/sales/`)
    const page = await fetch(out.url)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('viewer')
    expect(await lumenServer.test(dest(), 'sales', ctx)).toMatch(/Publishing replaces sales/)
  })

  it('protects a dashboard with a password and keeps it on republish', async () => {
    await lumenServer.deployWithAccess(dest(), 'finance', site('Finance'), 'Finance', ctx, { mode: 'password', password: 'open sesame' })
    const locked = await fetch(`${base}/d/finance/lumen-publish.json`, { redirect: 'manual' })
    expect(locked.status).toBe(401)
    await lumenServer.deploy(dest(), 'finance', site('Finance 2'), 'Finance 2', ctx)
    expect((await fetch(`${base}/d/finance/lumen-publish.json`, { redirect: 'manual' })).status).toBe(401)
    const login = await fetch(`${base}/d/finance/login`, { method: 'POST', body: new URLSearchParams({ password: 'open sesame' }), redirect: 'manual' })
    expect(login.status).toBe(303)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const ok = await fetch(`${base}/d/finance/lumen-publish.json`, { headers: { cookie } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).title).toBe('Finance 2')
    await lumenServer.deployWithAccess(dest(), 'finance', site('Finance 3'), 'Finance 3', ctx, { mode: 'public' })
    expect((await fetch(`${base}/d/finance/lumen-publish.json`)).status).toBe(200)
  })

  it('accepts an address without a scheme or with a trailing slash, and explains a server that is not Lumen', async () => {
    expect(await lumenServer.test(dest(TOKEN, `${base.replace('http://', '')}/`), undefined, ctx)).toMatch(/Connected/)
    const other = { ...ctx, fetch: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) }
    await expect(lumenServer.test(dest(), undefined, other)).rejects.toThrow(/not a Lumen Server/)
  })
})
