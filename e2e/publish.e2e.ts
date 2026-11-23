/**
 * File ▸ Publish: publish the sample report to a folder and a zip, then open the published site in a browser window.
 * `LUMEN_E2E_SHOTS=<dir>` additionally saves screenshots of the Publish dialog and the published dashboard.
 */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { unzipSync } from 'fflate'
import type { Page } from 'playwright-core'
// @ts-expect-error plain ES module without types (server/ runs on Node alone)
import { createLumenServer } from '../server/server.mjs'
import { useLumen, stubOpenDialog, stubSaveDialog, untilNode, rendererErrors } from './harness'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm' }

/** A static file server over `dir` on a free port (plain http, like a home server). */
async function serve(dir: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = normalize(join(dir, rel))
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return { url: `http://127.0.0.1:${port}/`, server }
}

async function openPublish(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'File' }).locator('.wbi-backstage__item', { hasText: /^Publish$/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Publish dashboard' })
  await expect.poll(() => dlg.count()).toBe(1)
  return dlg
}

describe('publish dashboard', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('publishes to a folder that a web server serves as an interactive dashboard', async () => {
    const { page, app, tmp } = lumen()
    const dlg = await openPublish(page)
    await expect.poll(() => dlg.locator('.wbi-pub__summary').innerText()).toMatch(/tables?, [\d,]+ rows/)
    await dlg.getByRole('textbox').first().fill('Sales dashboard')
    await dlg.getByRole('radio', { name: 'Folder' }).click()
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'publish-dialog.png') })
    const site = join(tmp, 'site')
    await stubOpenDialog(app, [site])
    await dlg.getByRole('button', { name: 'Publish', exact: true }).click()
    await untilNode(() => existsSync(join(site, 'report.wbi')) && existsSync(join(site, 'index.html')) && existsSync(join(site, 'lumen-publish.json')), 60_000, 'published site')
    const manifest = JSON.parse(readFileSync(join(site, 'lumen-publish.json'), 'utf8'))
    expect(manifest).toMatchObject({ format: 'lumen-publish', title: 'Sales dashboard', bundle: 'report.wbi' })
    expect(manifest.pages.length).toBeGreaterThan(0)

    const { url, server } = await serve(site)
    try {
      const opened = app.waitForEvent('window')
      await app.evaluate(
        ({ BrowserWindow }, [u, visible]) => {
          // shown (inactive) only for screenshots: a hidden window can't be captured
          const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { backgroundThrottling: false } })
          if (visible) w.showInactive()
          void w.loadURL(u)
        },
        [url, !!SHOTS] as const
      )
      const viewer = await opened
      await viewer.waitForFunction(() => document.body.dataset.wbiReady === '1' && document.body.dataset.wbiBusy !== '1', null, { timeout: 90_000 })
      expect(await viewer.locator('.lv-status--error').count()).toBe(0)
      expect(await viewer.title()).toBe('Sales dashboard')
      expect(await viewer.locator('.lv-title').innerText()).toBe('Sales dashboard')
      expect(await viewer.locator('[data-visual]').count()).toBeGreaterThan(0)
      if (SHOTS) await viewer.screenshot({ path: join(SHOTS, 'publish-viewer.png') })
      // reading view: no edit chrome, page tabs navigate
      expect(await viewer.locator('.wbi-tabs').count()).toBe(1)
      const tabs = viewer.locator('.wbi-tabs [role=tab]')
      if ((await tabs.count()) > 1) {
        await tabs.nth(1).click()
        await viewer.waitForFunction(() => document.body.dataset.wbiReady === '1', null, { timeout: 60_000 })
        expect(await viewer.locator('[data-visual]').count()).toBeGreaterThan(0)
      }
      await viewer.close()
    } finally {
      server.close()
    }
    expect(await rendererErrors(page)).toEqual([])
  })

  it('publishes a zip with the site at its root', async () => {
    const { page, app, tmp } = lumen()
    const dlg = await openPublish(page)
    await dlg.getByRole('radio', { name: 'Zip file' }).click()
    const target = join(tmp, 'dashboard.zip')
    await stubSaveDialog(app, target)
    await dlg.getByRole('button', { name: 'Publish', exact: true }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 10_000, 60_000, 'zip')
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(target))))
    expect(names).toEqual(expect.arrayContaining(['index.html', 'report.wbi', 'lumen-publish.json']))
    expect(names.some((n) => n.startsWith('assets/') && n.endsWith('.js'))).toBe(true)
  })

  it('saves a hosted destination without showing its token again, and removes it', async () => {
    const { page } = lumen()
    let dlg = await openPublish(page)
    await dlg.getByRole('button', { name: 'Add destination' }).click()
    const ed = page.getByRole('dialog', { name: 'Add destination' })
    await expect.poll(() => ed.count()).toBe(1)
    await ed.getByRole('button', { name: /GitHub Pages/ }).click()
    await page.getByRole('option', { name: 'Netlify' }).click()
    await ed.getByLabel('Name').fill('Team Netlify')
    await ed.getByLabel('Personal access token').fill('nfp_e2e_secret')
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'publish-destination-editor.png') })
    await ed.getByRole('button', { name: 'Save', exact: true }).click()
    dlg = page.getByRole('dialog', { name: 'Publish dashboard' })
    await expect.poll(() => dlg.getByRole('radio', { name: 'Team Netlify' }).getAttribute('aria-checked')).toBe('true')
    expect(await dlg.getByLabel('Site name').inputValue()).toMatch(/^[a-z0-9-]+$/)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'publish-dialog-destination.png') })
    const listed = await page.evaluate(() => window.wbi.publish!.destinations.list())
    expect(listed).toEqual([expect.objectContaining({ kind: 'netlify', name: 'Team Netlify', secrets: ['token'] })])
    expect(JSON.stringify(listed)).not.toContain('nfp_e2e_secret')
    await dlg.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit destination' })
    expect(await edit.getByLabel('Personal access token').inputValue()).toBe('')
    expect(await edit.getByLabel('Personal access token').getAttribute('placeholder')).toMatch(/Saved/)
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dlg.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remove destination?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.wbi.publish!.destinations.list())).toEqual([])
    await dlg.getByRole('button', { name: 'Cancel', exact: true }).click()
  })

  it('publishes to a Lumen Server behind a password', async () => {
    const { page, app } = lumen()
    const token = 'e2e-token-0123456789abcdef'
    const server: Server = createLumenServer({ dataDir: mkdtempSync(join(tmpdir(), 'lumen-e2e-srv-')), token })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
    try {
      let dlg = await openPublish(page)
      await dlg.getByRole('button', { name: 'Add destination' }).click()
      const ed = page.getByRole('dialog', { name: 'Add destination' })
      await ed.getByRole('button', { name: /GitHub Pages/ }).click()
      await page.getByRole('option', { name: 'Lumen Server' }).click()
      await ed.getByLabel('Name').fill('Home server')
      await ed.getByLabel('Server address').fill(base)
      await ed.getByLabel('Server token').fill(token)
      await ed.getByRole('button', { name: 'Save', exact: true }).click()
      dlg = page.getByRole('dialog', { name: 'Publish dashboard' })
      await expect.poll(() => dlg.getByRole('radio', { name: 'Home server' }).getAttribute('aria-checked')).toBe('true')
      await dlg.getByLabel('Dashboard name').fill('sales-e2e')
      await dlg.getByRole('button', { name: 'Check connection' }).click()
      await expect.poll(() => dlg.locator('.wbi-pub__ok').innerText().catch(() => '')).toMatch(/Connected to Lumen Server/)
      await dlg.getByRole('radio', { name: 'People with a password' }).click()
      expect(await dlg.getByRole('button', { name: 'Publish', exact: true }).isDisabled()).toBe(true)
      await dlg.getByLabel(/^Password/).fill('e2e pass')
      await dlg.getByRole('button', { name: 'Publish', exact: true }).click()
      let listed: Array<{ slug: string; access: string }> = []
      await untilNode(
        async () => {
          listed = await (await fetch(`${base}/api/dashboards`, { headers: { authorization: `Bearer ${token}` } })).json()
          return listed.length > 0
        },
        90_000,
        'dashboard on the server'
      )
      expect(listed).toEqual([expect.objectContaining({ slug: 'sales-e2e', access: 'password' })])
      expect((await fetch(`${base}/d/sales-e2e/report.wbi`)).status).toBe(401)
      // page previews rendered while publishing: one per visible page, shown on the home page only after sign-in
      const meta = (await (await fetch(`${base}/api/dashboards/sales-e2e`, { headers: { authorization: `Bearer ${token}` } })).json()) as { previews: Array<{ src: string; displayName: string }> }
      expect(meta.previews.length).toBeGreaterThan(0)
      expect(meta.previews[0].displayName).toBeTruthy()
      expect((await fetch(`${base}${meta.previews[0].src}`)).status).toBe(401)
      expect(await (await fetch(`${base}/`)).text()).toContain(`data-src="${meta.previews[0].src}"`)

      const opened = app.waitForEvent('window')
      await app.evaluate(({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { backgroundThrottling: false } })
        void w.loadURL(u)
      }, `${base}/d/sales-e2e/`)
      const viewer = await opened
      await viewer.locator('input[type=password]').fill('e2e pass')
      await viewer.locator('input[type=password]').press('Enter')
      await viewer.waitForFunction(() => document.body.dataset.wbiReady === '1' && document.body.dataset.wbiBusy !== '1', null, { timeout: 90_000 })
      expect(await viewer.locator('.lv-status--error').count()).toBe(0)
      expect(await viewer.locator('[data-visual]').count()).toBeGreaterThan(0)
      await viewer.close()
    } finally {
      server.close()
    }
    expect(await rendererErrors(page)).toEqual([])
  })
})
