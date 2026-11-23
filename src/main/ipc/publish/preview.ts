/**
 * Page previews for a published dashboard: the assembled site is opened in a hidden window (served from memory on a
 * private loopback port), each visible page is rendered the way a visitor sees it, and a JPEG of the page goes into
 * the site as `previews/<n>.jpg`, listed in the manifest as `previews`. Lumen Server shows them on its home page.
 *
 * Best effort: a preview that cannot be made never fails the publish; the site is returned without previews.
 */
import { BrowserWindow, session } from 'electron'
import { createServer, type Server } from 'node:http'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SITE_MANIFEST, type SiteFiles } from './site'

export interface PreviewEntry {
  page: string
  displayName: string
  src: string
  width: number
  height: number
}

const MAX_PAGES = 8
const WIDTH = 960

const TYPES: Record<string, string> = {
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
  '.jpg': 'image/jpeg'
}

function serve(files: SiteFiles): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const data = files[rel]
    if (!data) return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream' }).end(data)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/` })
    })
  })
}

const READY = `new Promise((resolve) => {
  const t0 = Date.now()
  const tick = () => {
    const b = document.body
    if ((b && b.dataset.wbiReady === '1' && b.dataset.wbiBusy !== '1') || Date.now() - t0 > 45000) {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(!!document.querySelector('.wbi-page')), 400)))
    } else setTimeout(tick, 100)
  }
  tick()
})`

/** Adds previews/<n>.jpg and the manifest's `previews` list to the site. Returns the files unchanged on failure. */
export async function withPreviews(files: SiteFiles, onProgress?: (fraction: number) => void): Promise<SiteFiles> {
  let host: { server: Server; url: string } | null = null
  let win: BrowserWindow | null = null
  try {
    const manifest = JSON.parse(new TextDecoder().decode(files[SITE_MANIFEST])) as Record<string, unknown>
    host = await serve(files)
    const ses = session.fromPartition(`lumen-preview-${randomBytes(6).toString('hex')}`, { cache: false })
    win = new BrowserWindow({ show: false, width: 1600, height: 1000, paintWhenInitiallyHidden: true, webPreferences: { session: ses, sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.setFrameRate(30)
    await win.loadURL(host.url)
    if (!(await win.webContents.executeJavaScript(READY))) return files
    const pages = (await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.wbi-tabs [role=tab]')].filter((t) => !t.classList.contains('hidden')).map((t) => ({ page: t.dataset.pageName || '', displayName: (t.getAttribute('title') || t.textContent || '').trim() }))`
    )) as Array<{ page: string; displayName: string }>
    const list = (pages.length ? pages : [{ page: '', displayName: '' }]).slice(0, MAX_PAGES)
    const out: SiteFiles = { ...files }
    const previews: PreviewEntry[] = []
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (i > 0 && p.page) {
        await win.webContents.executeJavaScript(`document.querySelector('.wbi-tabs [role=tab][data-page-name=${JSON.stringify(p.page)}]')?.click()`)
        await win.webContents.executeJavaScript(READY)
      }
      const r = (await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('.wbi-page'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.floor(Math.min(r.width, innerWidth - r.left)), height: Math.floor(Math.min(r.height, innerHeight - r.top)) } })()`
      )) as { x: number; y: number; width: number; height: number } | null
      if (!r || r.width < 40 || r.height < 40) continue
      const shot = await win.webContents.capturePage(r)
      if (shot.isEmpty()) continue
      const img = shot.getSize().width > WIDTH ? shot.resize({ width: WIDTH, quality: 'best' }) : shot
      const src = `previews/${previews.length}.jpg`
      out[src] = new Uint8Array(img.toJPEG(82))
      const size = img.getSize()
      previews.push({ page: p.page, displayName: p.displayName, src, width: size.width, height: size.height })
      onProgress?.((i + 1) / list.length)
    }
    if (!previews.length) return files
    out[SITE_MANIFEST] = new TextEncoder().encode(JSON.stringify({ ...manifest, previews }, null, 2))
    return out
  } catch (e) {
    console.warn('[publish] page previews skipped:', e instanceof Error ? e.message : e)
    return files
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    host?.server.close()
  }
}
