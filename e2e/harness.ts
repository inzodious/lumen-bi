/**
 * Lumen end-to-end harness: launches the BUILT app (`out/e2e/`, built by e2e/run.sh) with Playwright's Electron
 * driver and offers DOM-level helpers the journeys share.
 *
 *  - `useLumen(opts)` registers beforeAll/afterAll hooks for one app instance per test file and saves a screenshot
 *    plus the renderer error log to `$LUMEN_E2E_OUT` (default: a temp dir) whenever a test fails.
 *  - Waits never sleep for a fixed time: they poll `body[data-wbi-ready]` / `[data-wbi-busy]` (app/readiness.ts),
 *    DOM conditions, or the stores exposed on `window.__lumen` (app/e2eHooks.ts, enabled by the `e2e=1` route option).
 *  - Native dialogs (open/save) are stubbed in the main process (`stubSaveDialog`, `stubOpenDialog`).
 *
 * Environment: needs a display — run through `e2e/run.sh` (xvfb-run) or set DISPLAY yourself.
 * `LUMEN_SAMPLES_DIR` points at Microsoft's public sample PBIX files (journeys needing them are skipped without it).
 */
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, onTestFailed, expect } from 'vitest'

export const ROOT = resolve(import.meta.dirname, '..')
/** Built app entry (e2e/run.sh builds into out/e2e; LUMEN_E2E_APP overrides, e.g. `out/main/index.js`). */
export const APP_ENTRY = resolve(ROOT, process.env['LUMEN_E2E_APP'] ?? 'out/e2e/main/index.js')
export const SAMPLES_DIR = process.env['LUMEN_SAMPLES_DIR'] ?? ''
export const OUT_DIR = process.env['LUMEN_E2E_OUT'] || mkdtempSync(join(tmpdir(), 'lumen-e2e-'))
mkdirSync(OUT_DIR, { recursive: true })

export interface LaunchOptions {
  /** file or folder to open at launch (like `lumen <path>`) */
  open?: string
  /** extra `#/?…` route options (see app/App.tsx applyRouteOptions), e.g. { sample: '1' } */
  route?: Record<string, string>
  /** window size, default 1600x1000 */
  size?: string
  /** keep showing the start screen (default: start=0 unless route.start is given) */
}

export interface Lumen {
  app: ElectronApplication
  page: Page
  /** scratch directory private to this app instance (saves, exports, generated data) */
  tmp: string
}

export async function launchLumen(opts: LaunchOptions = {}): Promise<Lumen> {
  const tmp = mkdtempSync(join(OUT_DIR, 'run-'))
  const route = new URLSearchParams({ e2e: '1', ...(opts.route ?? {}) })
  if (!route.has('start') && !route.has('sample')) route.set('start', '0')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  Object.assign(env, {
    LUMEN_E2E: '1',
    LUMEN_USER_DATA: join(tmp, 'profile'),
    WBI_BLOCK_CACHE: '1',
    WBI_ROUTE: `#/?${route.toString()}`,
    WBI_SIZE: opts.size ?? '1600x1000',
    ...(opts.open ? { WBI_OPEN: opts.open } : {})
  })
  if (!opts.open) delete env['WBI_OPEN']
  const app = await _electron.launch({ executablePath: join(ROOT, 'node_modules/.bin/electron'), args: [APP_ENTRY], cwd: ROOT, env, timeout: 60_000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  await waitIdle(page, 90_000)
  return { app, page, tmp }
}

/** One app per test file. Returns a getter (the instance exists only after beforeAll). */
export function useLumen(opts: LaunchOptions = {}): () => Lumen {
  let lumen: Lumen | undefined
  beforeAll(async () => {
    lumen = await launchLumen(opts)
  }, 120_000)
  afterAll(async () => {
    await lumen?.app.close().catch(() => undefined)
  }, 30_000)
  return () => {
    if (!lumen) throw new Error('Lumen did not launch')
    const l = lumen
    onTestFailed(async ({ task }) => {
      const base = join(OUT_DIR, `${task.name.replace(/[^\w.-]+/g, '_').slice(0, 80)}`)
      await l.page.screenshot({ path: `${base}.png` }).catch(() => undefined)
      const errors = await l.page.evaluate(() => window.__lumen?.errors ?? []).catch(() => [])
      writeFileSync(`${base}.log`, errors.join('\n\n'))
      console.error(`[e2e] failure artifacts: ${base}.png / .log`)
    })
    return l
  }
}

// ---------------------------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------------------------

/** Wait until the app is ready (`wbiReady === '1'`) and not busy, stable across two animation-frame-spaced polls. */
export async function waitIdle(page: Page, timeout = 60_000): Promise<void> {
  // predicates must be synchronous (a returned Promise is truthy): keep the stability counter on window
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __e2eIdle?: number }
      const ok = document.body?.dataset.wbiReady === '1' && document.body.dataset.wbiBusy !== '1'
      w.__e2eIdle = ok ? (w.__e2eIdle ?? 0) + 1 : 0
      return w.__e2eIdle >= 2
    },
    null,
    { timeout, polling: 100 }
  )
}

/**
 * Wait until the report canvas settled after an interaction: not busy, no visual shows "Loading…", and the page DOM
 * signature is unchanged over three consecutive polls (cross-filter / slicer re-queries are async).
 */
export async function settle(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __e2eSettle?: { sig: string; n: number } }
      const pageEl = document.querySelector('.wbi-main') as HTMLElement | null
      const busy = document.body.dataset.wbiBusy === '1'
      const loading = Array.from(document.querySelectorAll<HTMLElement>('.wbi-vc-content')).some((c) => /\bLoading\b[^\n]*…|\bLoading\.\.\./.test(c.innerText))
      const sig = pageEl ? `${pageEl.querySelectorAll('*').length}:${pageEl.innerText.length}:${pageEl.innerText.slice(0, 4000)}` : ''
      const prev = w.__e2eSettle
      w.__e2eSettle = { sig, n: prev && prev.sig === sig ? prev.n + 1 : 0 }
      return !busy && !loading && w.__e2eSettle.n >= 3
    },
    null,
    { timeout, polling: 120 }
  )
}

/** Poll a function in the page until it returns a truthy value; returns that value. */
export async function until<T>(page: Page, fn: () => T | Promise<T>, timeout = 30_000): Promise<T> {
  const h = await page.waitForFunction(fn, null, { timeout, polling: 100 })
  return (await h.jsonValue()) as T
}

/** Poll a Node-side check (e.g. a file appearing) without fixed sleeps longer than the poll interval. */
export async function untilNode<T>(fn: () => T | Promise<T>, timeout = 30_000, what = 'condition'): Promise<T> {
  const end = Date.now() + timeout
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`)
}

// ---------------------------------------------------------------------------------------------
// Canvas inspection
// ---------------------------------------------------------------------------------------------

export interface VisualStatus {
  name: string
  type: string
  state: 'ok' | 'error' | 'unsupported' | 'nodata' | 'loading' | 'empty'
  title: string
  text: string
  message?: string
}

/** Classify every visual container on the visible page (same rules as the sweep's classifyVisual). */
export async function visualStatuses(page: Page): Promise<VisualStatus[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.wbi-page .wbi-vc')).map((el) => {
      const content = el.querySelector<HTMLElement>('.wbi-vc-content') ?? el
      const text = (content.innerText ?? '').trim()
      const marks = content.querySelectorAll('svg path, svg rect, svg circle, svg line, svg text, canvas, img, iframe').length
      const base = { name: el.dataset.visual ?? '', type: el.dataset.type ?? '', title: el.getAttribute('aria-label') ?? '', text }
      if (el.querySelector('.wbi-unknown')) return { ...base, state: 'unsupported' as const }
      if (el.querySelector('.wbi-vmsg') || /Can't display (the|this) visual/.test(text))
        return { ...base, state: 'error' as const, message: el.querySelector('.wbi-vmsg')?.textContent ?? text }
      if (/\bLoading\b[^\n]*…|\bLoading\.\.\./.test(text)) return { ...base, state: 'loading' as const }
      if (/^No data available\b/m.test(text) && text.length < 60) return { ...base, state: 'nodata' as const }
      if (!text && marks === 0) return { ...base, state: 'empty' as const }
      return { ...base, state: 'ok' as const }
    })
  )
}

/** Page tabs (display names) in order. */
export async function pageTabs(page: Page): Promise<string[]> {
  return page.locator('.wbi-tabs [role="tab"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).title.replace(/ \((tooltip|drillthrough) page\)$/, '')))
}

/** Click a page tab (by index or display name) and wait until the page rendered. */
export async function goToPage(page: Page, which: number | string): Promise<void> {
  const tabs = page.locator('.wbi-tabs [role="tab"]')
  const tab = typeof which === 'number' ? tabs.nth(which) : tabs.filter({ has: page.locator('.wbi-tab-label', { hasText: new RegExp(`^${escapeRe(which)}$`) }) })
  if ((await tab.getAttribute('aria-selected')) === 'true') return
  await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
  await tab.click()
  await waitIdle(page)
  await settle(page)
}

/**
 * Click inside an SVG shape (pie slice, bar, …) at a point that is really inside its fill and on top
 * (bounding-box centers of arcs can fall outside the shape). `selector` is scoped to the visual.
 */
export async function clickShape(page: Page, visual: string, selector: string, index = 0, opts: { button?: 'left' | 'right'; modifiers?: Array<'Control' | 'Shift'> } = {}): Promise<void> {
  const pt = await page.evaluate(
    ([v, sel, i]) => {
      const els = Array.from(document.querySelectorAll<SVGGeometryElement>(`.wbi-page [data-visual="${v}"] ${sel}`))
      const el = els[i as number]
      if (!el) return null
      const bb = el.getBBox()
      const ctm = el.getScreenCTM()
      if (!ctm) return null
      const svg = el.ownerSVGElement!
      let best: { x: number; y: number; d: number } | null = null
      const cx = bb.x + bb.width / 2
      const cy = bb.y + bb.height / 2
      for (let gx = 1; gx < 12; gx++)
        for (let gy = 1; gy < 12; gy++) {
          const p = svg.createSVGPoint()
          p.x = bb.x + (bb.width * gx) / 12
          p.y = bb.y + (bb.height * gy) / 12
          if (!el.isPointInFill(p)) continue
          const sp = p.matrixTransform(ctm)
          const top = document.elementFromPoint(sp.x, sp.y)
          if (top !== el && !el.contains(top)) continue
          const d = Math.hypot(p.x - cx, p.y - cy)
          if (!best || d < best.d) best = { x: sp.x, y: sp.y, d }
        }
      return best ? { x: best.x, y: best.y } : null
    },
    [visual, selector, index] as const
  )
  if (!pt) throw new Error(`no clickable point for ${visual} ${selector}[${index}]`)
  await page.mouse.move(pt.x, pt.y)
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m)
  await page.mouse.click(pt.x, pt.y, { button: opts.button ?? 'left' })
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m)
}

/** Find the visual whose title (aria-label) matches. */
export async function visualByTitle(page: Page, title: string | RegExp): Promise<string> {
  const all = await visualStatuses(page)
  const hit = all.find((v) => (typeof title === 'string' ? v.title === title : title.test(v.title)))
  if (!hit) throw new Error(`no visual titled ${String(title)} (have: ${all.map((v) => v.title).join(' | ')})`)
  return hit.name
}

/** Wait until a visual's text satisfies a predicate (re-queries are async). */
export async function untilVisualText(page: Page, name: string, test: (text: string) => boolean, timeout = 30_000): Promise<string> {
  const end = Date.now() + timeout
  let last = ''
  while (Date.now() < end) {
    last = await page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-content`).innerText().catch(() => '')
    if (test(last)) return last
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`visual ${name} text never matched; last: ${JSON.stringify(last.slice(0, 300))}`)
}

/**
 * Data pane row for a path (`['Product', 'Category']`, `['_Measures', 'Sales', 'Total Sales']`): expands the
 * tables / display folders on the way and returns the row locator.
 */
export async function dataPaneRow(page: Page, path: string[]): Promise<Locator> {
  let scope: Locator = page.locator('.wbi-dtree')
  let row: Locator | undefined
  for (let i = 0; i < path.length; i++) {
    const item = scope.locator(':scope > [role="treeitem"], :scope > [role="group"] > [role="treeitem"]').filter({ has: page.locator(':scope > .wbi-dtree__row .wbi-dtree__name', { hasText: new RegExp(`^${escapeRe(path[i])}$`) }) }).first()
    row = item.locator(':scope > .wbi-dtree__row')
    if (i < path.length - 1) {
      if ((await item.getAttribute('aria-expanded')) !== 'true') await row.click()
      scope = item.locator(':scope > [role="group"]')
    }
  }
  return row!
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Click the empty canvas area around the page (deselects every visual, like PBI). */
export async function deselectAll(page: Page): Promise<void> {
  const vp = (await page.locator('.wbi-viewport').boundingBox())!
  const pg = (await page.locator('.wbi-page-outer').boundingBox())!
  // a point in the viewport outside the page: below it if there is room, else to its right
  const x = pg.x + pg.width + 4 < vp.x + vp.width ? pg.x + pg.width + 4 : vp.x + 4
  const y = pg.y + pg.height + 4 < vp.y + vp.height ? pg.y + pg.height + 4 : vp.y + 4
  await page.mouse.click(x, y)
  await until(page, () => window.__lumen!.useApp.getState().selectedVisuals.length === 0)
}

/** Inner text of one visual's content area. */
export async function visualText(page: Page, name: string): Promise<string> {
  return page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-content`).innerText()
}

/** Visual names on the page with a given type (`data-type`). */
export async function visualsOfType(page: Page, type: string | RegExp): Promise<string[]> {
  const all = await visualStatuses(page)
  return all.filter((v) => (typeof type === 'string' ? v.type === type : type.test(v.type))).map((v) => v.name)
}

/** Rendered markup of every visual on the page (detects cross-highlighting, which changes marks but not text). */
export async function pageMarkup(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('.wbi-page .wbi-vc')).map((el) => [el.dataset.visual ?? '', el.querySelector('.wbi-vc-content')?.innerHTML ?? ''])))
}

/** Snapshot of all visuals' text on the page (to detect cross-filter changes). */
export async function pageTexts(page: Page): Promise<Record<string, string>> {
  const all = await visualStatuses(page)
  return Object.fromEntries(all.map((v) => [v.name, v.text]))
}

export function expectAllRendered(statuses: VisualStatus[], allow: Array<VisualStatus['state']> = ['ok']): void {
  const bad = statuses.filter((s) => !allow.includes(s.state))
  expect(bad.map((b) => `${b.name} (${b.type}): ${b.state} ${b.message ?? ''}`)).toEqual([])
}

// ---------------------------------------------------------------------------------------------
// App state (window.__lumen)
// ---------------------------------------------------------------------------------------------

/** Evaluate against the exposed stores: `lumenEval(page, (l) => l.useApp.getState().view)`. */
export async function lumenEval<T, A = undefined>(page: Page, fn: (l: NonNullable<Window['__lumen']>, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  // a CDP-evaluated expression (not in-page eval, which the renderer CSP forbids)
  return page.evaluate(`(${fn.toString()})(window.__lumen, ${JSON.stringify(arg ?? null)})`) as Promise<T>
}

/** Open a file/folder through the app's own open command (the native Open dialog is not under test). */
export async function openFile(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    document.body.dataset.wbiReady = '0'
  })
  const ok = await lumenEval(page, (l, p) => l.openPath(p, { skipConfirm: true }), path)
  expect(ok).toBe(true)
  await waitIdle(page, 120_000)
}

// ---------------------------------------------------------------------------------------------
// Native dialogs (main process)
// ---------------------------------------------------------------------------------------------

/** The next Save dialog(s) answer `filePath` (pass null to cancel). */
export async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: p === null, filePath: p ?? undefined })) as unknown as typeof dialog.showSaveDialog
  }, filePath)
}

/** The next Open dialog(s) answer `paths` (files or a directory). */
export async function stubOpenDialog(app: ElectronApplication, paths: string[] | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: p === null, filePaths: p ?? [] })) as unknown as typeof dialog.showOpenDialog
  }, paths)
}

/** Renderer console errors captured so far (app/e2eHooks.ts). */
export async function rendererErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__lumen?.errors.slice() ?? [])
}

/** Typed `window.__lumen` for the e2e TypeScript project. */
declare global {
  interface Window {
    __lumen?: import('../src/renderer/src/app/e2eHooks').LumenE2EHooks
  }
}
