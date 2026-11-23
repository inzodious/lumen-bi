import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import type { DestinationEntry } from '../destinations'
import { DestinationStore } from '../destinations'
import type { SiteFiles } from '../site'
import { githubPages, gitBlobSha, githubPagesUrl } from '../targets/github'
import { netlify } from '../targets/netlify'
import { cloudflarePages, pagesHash } from '../targets/cloudflare'
import { slugify, type DeployContext } from '../targets/common'

interface Call {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

type Route = (call: Call) => { status?: number; json?: unknown } | undefined

/** A fake fetch: the first route that answers wins; unanswered requests are 404. */
function fakeFetch(routes: Route[]): { ctx: DeployContext; calls: Call[]; progress: string[] } {
  const calls: Call[] = []
  const progress: string[] = []
  const fetch = async (url: string, init: RequestInit = {}) => {
    let body: unknown = init.body
    if (typeof init.body === 'string') body = JSON.parse(init.body)
    else if (init.body instanceof Blob) body = new Uint8Array(await init.body.arrayBuffer())
    const call: Call = { method: init.method ?? 'GET', url, body, headers: (init.headers ?? {}) as Record<string, string> }
    calls.push(call)
    for (const r of routes) {
      const out = r(call)
      if (out) return new Response(out.json === undefined ? '' : JSON.stringify(out.json), { status: out.status ?? 200 })
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
  }
  return { ctx: { fetch, progress: (p) => progress.push(p.message), sleep: async () => undefined }, calls, progress }
}

const enc = (s: string) => new TextEncoder().encode(s)

function site(): SiteFiles {
  return { 'index.html': enc('<html>'), 'assets/app-1.js': enc('js'), 'report.wbi': enc('wbi'), 'lumen-publish.json': enc('{}') }
}

function dest(kind: DestinationEntry['kind'], settings: Record<string, string>, secrets: Record<string, string> = { token: 't0k' }): DestinationEntry {
  return { id: 'd1', kind, name: 'Mine', settings, secrets, updatedAt: 0 }
}

describe('helpers', () => {
  it('slugs site names', () => {
    expect(slugify('Sales & Customers — 2025')).toBe('sales-customers-2025')
    expect(slugify('Ünïcode Dash')).toBe('unicode-dash')
    expect(slugify('***')).toBe('dashboard')
  })

  it('computes git blob ids and Pages URLs', () => {
    expect(gitBlobSha(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(gitBlobSha(enc('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(githubPagesUrl('Joe', 'dash', 'sales')).toBe('https://joe.github.io/dash/sales/')
    expect(githubPagesUrl('joe', 'joe.github.io', '')).toBe('https://joe.github.io/')
    expect(githubPagesUrl('joe', 'dash', 'a b', 'https://dash.example.com/')).toBe('https://dash.example.com/a%20b/')
  })

  it('hashes Cloudflare assets from base64 content plus extension', () => {
    const a = pagesHash('index.html', enc('x'))
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(pagesHash('other/index.html', enc('x'))).toBe(a)
    expect(pagesHash('index.htm', enc('x'))).not.toBe(a)
  })
})

describe('GitHub Pages', () => {
  const repo = 'https://api.github.com/repos/joe/dash'

  it('commits changed files into the existing branch and deletes stale assets of the same dashboard only', async () => {
    const files = site()
    const unchanged = gitBlobSha(files['report.wbi'])
    const f = fakeFetch([
      (c) => (c.url === repo ? { json: { full_name: 'joe/dash' } } : undefined),
      (c) => (c.url.endsWith('/git/ref/heads/gh-pages') ? { json: { object: { sha: 'parent' } } } : undefined),
      (c) => (c.url.endsWith('/git/commits/parent') ? { json: { tree: { sha: 'base' } } } : undefined),
      (c) =>
        c.url.endsWith('/git/trees/base?recursive=1')
          ? {
              json: {
                tree: [
                  { path: '.nojekyll', type: 'blob', sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' },
                  { path: 'dashboards/sales/report.wbi', type: 'blob', sha: unchanged },
                  { path: 'dashboards/sales/assets/app-0.js', type: 'blob', sha: 'old' },
                  { path: 'dashboards/other/assets/app-0.js', type: 'blob', sha: 'keep' }
                ]
              }
            }
          : undefined,
      (c) => (c.url.endsWith('/git/blobs') ? { status: 201, json: { sha: gitBlobSha(Buffer.from((c.body as { content: string }).content, 'base64')) } } : undefined),
      (c) => (c.url.endsWith('/git/trees') && c.method === 'POST' ? { status: 201, json: { sha: 'tree2' } } : undefined),
      (c) => (c.url.endsWith('/git/commits') && c.method === 'POST' ? { status: 201, json: { sha: 'commit2' } } : undefined),
      (c) => (c.url.endsWith('/git/refs/heads/gh-pages') && c.method === 'PATCH' ? { json: {} } : undefined),
      (c) => (c.url === `${repo}/pages` ? { json: { html_url: 'https://joe.github.io/dash/', source: { branch: 'gh-pages' } } } : undefined)
    ])
    const out = await githubPages.deploy(dest('github-pages', { owner: 'joe', repo: 'dash', folder: 'dashboards' }), 'sales', files, 'Sales', f.ctx)
    expect(out.url).toBe('https://joe.github.io/dash/dashboards/sales/')
    const blobs = f.calls.filter((c) => c.url.endsWith('/git/blobs'))
    expect(blobs).toHaveLength(3)
    const tree = f.calls.find((c) => c.url.endsWith('/git/trees') && c.method === 'POST')!.body as { base_tree: string; tree: Array<{ path: string; sha: string | null }> }
    expect(tree.base_tree).toBe('base')
    expect(tree.tree.map((e) => [e.path, e.sha === null]).sort()).toEqual(
      [
        ['dashboards/sales/assets/app-0.js', true],
        ['dashboards/sales/assets/app-1.js', false],
        ['dashboards/sales/index.html', false],
        ['dashboards/sales/lumen-publish.json', false],
        ['dashboards/sales/report.wbi', false]
      ].sort()
    )
    const commit = f.calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')!.body as { parents: string[]; message: string }
    expect(commit).toMatchObject({ parents: ['parent'], message: 'Publish Sales' })
    expect(f.calls.every((c) => c.headers.authorization === 'Bearer t0k')).toBe(true)
  })

  it('creates the branch and turns Pages on when neither exists', async () => {
    const f = fakeFetch([
      (c) => (c.url === repo ? { json: { full_name: 'joe/dash' } } : undefined),
      (c) => (c.url.endsWith('/commits?per_page=1') ? { json: [{ sha: 'x' }] } : undefined),
      (c) => (c.url.endsWith('/git/blobs') ? { status: 201, json: { sha: c.body && (c.body as { encoding: string }).encoding === 'utf-8' ? 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' : gitBlobSha(Buffer.from((c.body as { content: string }).content, 'base64')) } } : undefined),
      (c) => (c.url.endsWith('/git/trees') ? { status: 201, json: { sha: 'tree' } } : undefined),
      (c) => (c.url.endsWith('/git/commits') && c.method === 'POST' ? { status: 201, json: { sha: 'c1' } } : undefined),
      (c) => (c.url.endsWith('/git/refs') && c.method === 'POST' ? { status: 201, json: {} } : undefined),
      (c) => (c.url === `${repo}/pages` && c.method === 'POST' ? { status: 201, json: { html_url: 'https://joe.github.io/dash/' } } : undefined)
    ])
    const out = await githubPages.deploy(dest('github-pages', { owner: 'joe', repo: 'dash' }), '', site(), 'Sales', f.ctx)
    expect(out.url).toBe('https://joe.github.io/dash/')
    expect((f.calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')!.body as { parents: string[] }).parents).toEqual([])
    expect(f.calls.find((c) => c.url.endsWith('/git/refs'))!.body).toEqual({ ref: 'refs/heads/gh-pages', sha: 'c1' })
    expect(f.calls.find((c) => c.url === `${repo}/pages` && c.method === 'POST')!.body).toEqual({ source: { branch: 'gh-pages', path: '/' } })
    const tree = f.calls.find((c) => c.url.endsWith('/git/trees'))!.body as { tree: Array<{ path: string }> }
    expect(tree.tree.map((e) => e.path)).toContain('.nojekyll')
  })

  it('explains a token without push access', async () => {
    const f = fakeFetch([(c) => (c.url === repo ? { json: { full_name: 'joe/dash', permissions: { push: false } } } : undefined)])
    await expect(githubPages.test(dest('github-pages', { owner: 'joe', repo: 'dash' }), undefined, f.ctx)).rejects.toThrow(/cannot push/)
    const g = fakeFetch([(c) => (c.url === repo ? { status: 401, json: { message: 'Bad credentials' } } : undefined)])
    await expect(githubPages.test(dest('github-pages', { owner: 'joe', repo: 'dash' }), undefined, g.ctx)).rejects.toThrow('GitHub: the token was not accepted (Bad credentials)')
    await expect(githubPages.test(dest('github-pages', { owner: 'joe' }), undefined, g.ctx)).rejects.toThrow(/repository is not set/)
  })
})

describe('Netlify', () => {
  it('creates the site on first publish and uploads a zip deploy', async () => {
    let polls = 0
    const f = fakeFetch([
      (c) => (c.url.includes('/sites?name=sales') ? { json: [{ id: 'other', name: 'sales-old' }] } : undefined),
      (c) => (c.url.endsWith('/api/v1/sites') && c.method === 'POST' ? { status: 201, json: { id: 's1', name: 'sales', ssl_url: 'https://sales.netlify.app' } } : undefined),
      (c) => (c.url.endsWith('/sites/s1/deploys') ? { json: { id: 'd1', state: 'uploading' } } : undefined),
      (c) => (c.url.endsWith('/deploys/d1') ? { json: { id: 'd1', state: ++polls > 1 ? 'ready' : 'processing' } } : undefined)
    ])
    const out = await netlify.deploy(dest('netlify', {}), 'sales', site(), 'Sales', f.ctx)
    expect(out.url).toBe('https://sales.netlify.app/')
    expect(f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v1/sites'))!.body).toEqual({ name: 'sales' })
    const upload = f.calls.find((c) => c.url.endsWith('/deploys') && c.method === 'POST')!
    expect(upload.headers['content-type']).toBe('application/zip')
    expect(Object.keys(unzipSync(upload.body as Uint8Array)).sort()).toEqual(['assets/app-1.js', 'index.html', 'lumen-publish.json', 'report.wbi'])
    expect(polls).toBe(2)
  })

  it('reports a site name taken by someone else', async () => {
    const f = fakeFetch([(c) => (c.url.includes('/sites?name=') ? { json: [] } : undefined), (c) => (c.method === 'POST' ? { status: 422, json: { errors: { subdomain: ['must be unique'] } } } : undefined)])
    await expect(netlify.deploy(dest('netlify', {}), 'sales', site(), 'Sales', f.ctx)).rejects.toThrow(/taken by another account/)
  })
})

describe('Cloudflare Pages', () => {
  it('uploads only missing files and deploys the manifest', async () => {
    const files = site()
    const known = pagesHash('report.wbi', files['report.wbi'])
    const base = 'https://api.cloudflare.com/client/v4'
    const ok = (result: unknown) => ({ json: { success: true, errors: [], result } })
    const f = fakeFetch([
      (c) => (c.url === `${base}/accounts/acc/pages/projects/sales` ? { status: 404, json: { success: false, errors: [{ code: 8000007, message: 'Project not found' }] } } : undefined),
      (c) => (c.url === `${base}/accounts/acc/pages/projects` && c.method === 'POST' ? ok({ subdomain: 'sales-x1.pages.dev' }) : undefined),
      (c) => (c.url.endsWith('/upload-token') ? ok({ jwt: 'JWT' }) : undefined),
      (c) => (c.url.endsWith('/check-missing') ? ok((c.body as { hashes: string[] }).hashes.filter((h) => h !== known)) : undefined),
      (c) => (c.url.endsWith('/assets/upload') ? ok(null) : undefined),
      (c) => (c.url.endsWith('/upsert-hashes') ? ok(null) : undefined),
      (c) => (c.url.endsWith('/deployments') ? ok({ url: 'https://abc.sales-x1.pages.dev' }) : undefined)
    ])
    const out = await cloudflarePages.deploy(dest('cloudflare-pages', { accountId: 'acc' }), 'sales', files, 'Sales', f.ctx)
    expect(out.url).toBe('https://sales-x1.pages.dev/')
    expect(f.calls.find((c) => c.url.endsWith('/projects') && c.method === 'POST')!.body).toEqual({ name: 'sales', production_branch: 'main' })
    const upload = f.calls.find((c) => c.url.endsWith('/assets/upload'))!
    expect(upload.headers.authorization).toBe('Bearer JWT')
    const items = upload.body as Array<{ key: string; value: string; base64: boolean; metadata: { contentType: string } }>
    expect(items).toHaveLength(3)
    expect(items.find((i) => i.key === pagesHash('index.html', files['index.html']))).toMatchObject({ value: Buffer.from('<html>').toString('base64'), base64: true, metadata: { contentType: 'text/html; charset=utf-8' } })
    const deploy = f.calls.find((c) => c.url.endsWith('/deployments'))!
    expect(deploy.headers.authorization).toBe('Bearer t0k')
    const manifest = JSON.parse(String((deploy.body as FormData).get('manifest')))
    expect(manifest['/report.wbi']).toBe(known)
    expect(Object.keys(manifest).sort()).toEqual(['/assets/app-1.js', '/index.html', '/lumen-publish.json', '/report.wbi'])
  })
})

describe('destination store', () => {
  const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`enc:${s}`), decrypt: (b: Buffer) => b.toString().slice(4) }

  it('keeps secrets encrypted on disk and out of what the renderer sees', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lumen-dest-')), 'd.json')
    const s = new DestinationStore(file, cipher, () => 5)
    const info = s.set({ kind: 'github-pages', name: ' Pages ', settings: { owner: 'joe', repo: ' dash ', branch: '' }, secrets: { token: 'ghp_secret' } })
    expect(info).toMatchObject({ name: 'Pages', settings: { owner: 'joe', repo: 'dash' }, secrets: ['token'] })
    expect(readFileSync(file, 'utf8')).not.toContain('ghp_secret')
    const again = new DestinationStore(file, cipher)
    expect(again.get(info.id)!.secrets.token).toBe('ghp_secret')
    // undefined keeps a secret, '' clears it
    again.set({ id: info.id, kind: 'github-pages', name: 'Pages', settings: { owner: 'joe', repo: 'dash' }, secrets: { token: undefined } })
    expect(again.get(info.id)!.secrets.token).toBe('ghp_secret')
    again.set({ id: info.id, kind: 'github-pages', name: 'Pages', settings: { owner: 'joe', repo: 'dash' }, secrets: { token: '' } })
    expect(again.list()[0].secrets).toEqual([])
    again.remove(info.id)
    expect(new DestinationStore(file, cipher).list()).toEqual([])
  })

  it('keeps secrets for the session only without a keyring', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lumen-dest-')), 'd.json')
    const s = new DestinationStore(file, { ...cipher, available: () => false })
    const info = s.set({ kind: 'netlify', name: 'N', settings: {}, secrets: { token: 'nfp_x' } })
    expect(s.get(info.id)!.secrets.token).toBe('nfp_x')
    expect(readFileSync(file, 'utf8')).not.toContain('nfp_x')
    expect(new DestinationStore(file, { ...cipher, available: () => false }).get(info.id)!.secrets.token).toBeUndefined()
  })
})
