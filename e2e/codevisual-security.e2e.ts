/**
 * Code visual isolation in the real app: a report whose code visuals try to reach the app, the preload bridge, Node,
 * storage and the network, to escape their box, to navigate, and to hang. Every attempt must fail harmlessly, a local
 * HTTP server must see no request, and the app must stay responsive. The fixture report is built here from the
 * built-in sample (saved as a .wbi bundle) and opened like any file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'
import { useLumen, waitIdle, lumenEval, rendererErrors } from './harness'
import { createSampleProject } from '../src/core/data/sample'
import { saveProject } from '../src/core/io/open'
import { nodeFs } from '../src/core/io/nodefs'
import { CODE_VISUAL_TYPE, newCodeVisualJson } from '../src/core/codevisual/model'

const hits: string[] = []
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    res.setHeader('access-control-allow-origin', '*')
    res.end('leak')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

/** JSX that tries everything and prints what happened. */
function probeJsx(url: string): string {
  return `import { useEffect, useState } from 'react'

export default function Visual() {
  const [r, setR] = useState({ started: true })
  useEffect(() => {
    const out = {}
    const t = (k, f) => {
      try {
        const v = f()
        out[k] = 'OPEN ' + String(v).slice(0, 40)
      } catch (e) {
        out[k] = 'blocked ' + (e && e.name)
      }
    }
    t('parentWbi', () => { const w = window.parent.wbi; if (w === undefined) throw new TypeError('undefined'); return w })
    t('parentDocument', () => window.parent.document.title)
    t('topLocation', () => window.top.location.href)
    t('parentPostToStore', () => window.parent.__lumen.useApp)
    t('require', () => require('fs'))
    t('process', () => process.versions.node)
    t('ownWbi', () => { if (!window.wbi) throw new ReferenceError('none'); return window.wbi })
    t('localStorage', () => { localStorage.setItem('x', '1'); return localStorage.getItem('x') })
    t('indexedDB', () => { const r = indexedDB.open('x'); return r })
    t('cookie', () => { document.cookie = 'a=1'; if (!document.cookie) throw new Error('none'); return document.cookie })
    t('open', () => { const w = window.open('${url}/popup'); if (!w) throw new Error('null'); return w })
    t('websocket', () => new WebSocket('${url.replace('http', 'ws')}/ws'))
    t('worker', () => new Worker('${url}/worker.js'))
    t('beacon', () => { if (!navigator.sendBeacon('${url}/beacon', 'x')) throw new Error('refused'); return 'sent' })
    const img = new Image()
    img.src = '${url}/img.png'
    document.body.appendChild(img)
    const s = document.createElement('script')
    s.src = '${url}/script.js'
    document.head.appendChild(s)
    const st = document.createElement('style')
    st.textContent = "@import url('${url}/import.css'); body { background-image: url('${url}/bg.png'); }"
    document.head.appendChild(st)
    const f = document.createElement('form')
    f.action = '${url}/form'
    f.method = 'post'
    document.body.appendChild(f)
    try { f.submit() } catch (e) {}
    const done = (k, v) => { out[k] = v; setR({ ...out }) }
    fetch('${url}/fetch').then(() => done('fetch', 'OPEN'), (e) => done('fetch', 'blocked ' + e.name))
    new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', '${url}/xhr'); x.onload = res; x.onerror = rej; x.send() }).then(() => done('xhr', 'OPEN'), () => done('xhr', 'blocked'))
    setTimeout(() => done('probed', 'yes'), 300)
    // navigation last (a frame navigating itself loses its document: the visual then shows its error state)
    setTimeout(() => {
      try { window.top.location.href = '${url}/top' } catch (e) {}
      try { location.href = '${url}/self' } catch (e) {}
    }, 3000)
  }, [])
  return <pre id="probe">{JSON.stringify(r)}</pre>
}
`
}

/** HTML + CSS that try to run script, load remote resources, navigate and cover the page. */
function hostileHtml(url: string): { html: string; css: string } {
  return {
    html: `<div class="cover">covering?</div>
<script>parent.postMessage({ p: 'lumen-code-visual/1', type: 'boot' }, '*')</script>
<img src="${url}/tpl-img.png" onerror="fetch('${url}/onerror')">
<a href="${url}/link" target="_top" id="link">link</a>
<meta http-equiv="refresh" content="0;url=${url}/refresh">
<iframe src="${url}/inner"></iframe>
<object data="${url}/object"></object>
<svg><image href="${url}/svg-image.png"/></svg>
<p id="ok">{{Total Sales}}</p>`,
    css: `@import url('${url}/tpl-import.css');
.cover { position: fixed; inset: -2000px; z-index: 2147483647; background: rgba(255, 0, 0, .5) url('${url}/tpl-bg.png'); }
@font-face { font-family: x; src: url('${url}/font.woff2'); }
p { font-family: x; }`
  }
}

async function buildFixture(dir: string, url: string): Promise<string> {
  const p = createSampleProject()
  const page = p.report!.pages[0]
  page.visuals = page.visuals.slice(0, 6)
  const measure = { field: { Measure: { Expression: { SourceRef: { Entity: '_Measures' } }, Property: 'Total Sales' } }, queryRef: '_Measures.Total Sales' }
  const add = (name: string, src: { html?: string; css?: string; jsx?: string }, x: number) => {
    const j = newCodeVisualJson(name, { html: src.html ?? '', css: src.css ?? '', jsx: src.jsx ?? '' })
    j.position = { x, y: 300, z: 9000, width: 300, height: 200, tabOrder: 9000 }
    j.visual.query.queryState = { Y: { projections: [measure] } }
    page.visuals.push({ name, json: j })
  }
  add('hostilejsx000000000a', { jsx: probeJsx(url) }, 20)
  add('hostilehtml00000000b', hostileHtml(url), 340)
  const target = join(dir, 'Hostile.wbi')
  await saveProject(p, target, nodeFs, { format: 'wbi' })
  return target
}

async function responsive(page: Page): Promise<number> {
  const t0 = Date.now()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1))))
  return Date.now() - t0
}

describe('code visual isolation', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('opens a report with hostile code visuals: nothing reaches the app, Node, storage or the network', async () => {
    const { page, tmp } = lumen()
    const file = await buildFixture(tmp, base)
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await lumenEval(page, (l, f) => l.openPath(f, { skipConfirm: true }), file)
    await waitIdle(page)
    const probe = page.frameLocator('.wbi-page [data-visual="hostilejsx000000000a"] iframe')
    await expect.poll(async () => JSON.parse((await probe.locator('#probe').innerText()) || '{}').probed, { timeout: 30_000 }).toBe('yes')
    const r = JSON.parse(await probe.locator('#probe').innerText())
    // every attempt was refused
    for (const k of ['parentWbi', 'parentDocument', 'topLocation', 'parentPostToStore', 'require', 'process', 'ownWbi', 'localStorage', 'indexedDB', 'cookie', 'open', 'fetch', 'xhr']) {
      expect(String(r[k]), k).toMatch(/^blocked/)
    }
    // WebSocket, Worker and sendBeacon fail asynchronously (CSP): the server log below proves nothing left the frame
    console.log('[security] probe results', r)
    // the app was not navigated (top navigation is refused)
    expect(await page.evaluate(() => location.protocol)).toBe('file:')
    // the template visual: no script ran, nothing loaded, and its fixed "cover" stays inside its own box
    const html = page.frameLocator('.wbi-page [data-visual="hostilehtml00000000b"] iframe')
    await expect.poll(() => html.locator('#ok').count()).toBe(1)
    // the template output was sanitised before it reached the frame (DOMPurify in the app)
    const dom = await html.locator('#lumen-root').evaluate((root) => ({
      tags: Array.from(root.querySelectorAll('script, meta, iframe, object, embed, base, form')).map((e) => e.tagName),
      handlers: Array.from(root.querySelectorAll('*')).flatMap((e) => Array.from(e.attributes).filter((a) => /^on/i.test(a.name)).map((a) => a.name)),
      remote: Array.from(root.querySelectorAll('[src], [href]')).map((e) => e.getAttribute('src') ?? e.getAttribute('href') ?? '').filter((u) => /^(https?:|\/\/)/i.test(u))
    }))
    expect(dom).toEqual({ tags: [], handlers: [], remote: [] })
    const box = (await page.locator('.wbi-page [data-visual="hostilehtml00000000b"]').boundingBox())!
    const outside = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? '', [box.x - 30, box.y + box.height / 2])
    expect(outside).not.toBe('IFRAME')
    // the app is untouched and responsive
    expect(await responsive(page)).toBeLessThan(1000)
    expect(await lumenEval(page, (l) => typeof l.useApp.getState().project)).toBe('object')
    // after the navigation attempts the app is still on its own page, nothing reached the server, and the probe
    // visual either still shows its result or (its frame navigated itself and lost its document) its error state
    const probeVc = page.locator('.wbi-page [data-visual="hostilejsx000000000a"] .wbi-codevisual')
    await page.waitForTimeout(4000)
    expect(await page.evaluate(() => location.protocol)).toBe('file:')
    expect(['rendered', 'error']).toContain(await probeVc.getAttribute('data-code-state'))
    expect(hits).toEqual([])
    expect((await rendererErrors(page)).filter((e) => /lumen-frame|code visual/i.test(e))).toEqual([])
  })

  it('a runaway script is stopped by the watchdog; the canvas stays responsive; Run again restarts it', async () => {
    const { page } = lumen()
    // an endless loop in a new JSX visual (setup)
    await lumenEval(
      page,
      (l, t) => {
        const s = l.useApp.getState()
        s.mutateReport('add loop', (r: any) => {
          const p = r.pages.find((x: any) => x.name === s.activePage)
          p.visuals.push({
            name: 'loopvisual0000000000',
            json: {
              name: 'loopvisual0000000000',
              position: { x: 660, y: 300, z: 9100, width: 300, height: 200, tabOrder: 9100 },
              visual: { visualType: t, query: { queryState: {} }, objects: { lumenCode: [{ properties: { version: { expr: { Literal: { Value: '1L' } } }, jsx: { expr: { Literal: { Value: "'export default function Visual() { while (true) {} }'" } } } } }] } }
            }
          })
        })
      },
      CODE_VISUAL_TYPE
    )
    const vc = page.locator('.wbi-page [data-visual="loopvisual0000000000"] .wbi-codevisual')
    // while it loops (in its own renderer process) the app answers frames and clicks
    for (let i = 0; i < 5; i++) expect(await responsive(page)).toBeLessThan(1000)
    await page.locator('.wbi-tabs [role="tab"]').nth(1).click()
    await waitIdle(page)
    await page.locator('.wbi-tabs [role="tab"]').first().click()
    await waitIdle(page)
    // the watchdog stops it and says so
    await expect.poll(() => vc.getAttribute('data-code-state'), { timeout: 30_000 }).toBe('error')
    expect(await vc.innerText()).toMatch(/stopped responding/)
    await expect.poll(() => vc.getByRole('button', { name: 'Run again' }).count()).toBe(1)
    // the template visual next to it still works
    const tpl = page.frameLocator('.wbi-page [data-visual="hostilehtml00000000b"] iframe')
    expect(await tpl.locator('#ok').count()).toBe(1)
    // Run again restarts it (and the watchdog stops it again)
    await vc.getByRole('button', { name: 'Run again' }).click()
    await expect.poll(() => vc.getAttribute('data-code-state')).not.toBe('error')
    await expect.poll(() => vc.getAttribute('data-code-state'), { timeout: 30_000 }).toBe('error')
    expect(hits).toEqual([])
  })
})
