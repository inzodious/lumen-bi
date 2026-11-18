/**
 * In-app sweep mode: `#/?sweep=<outdir>&open=<path>[&synthetic=1[&private=1]][&blockCache=1][&pages=a,b][&start=0]`
 * (driven by scripts/sweep.sh with WBI_SWEEP=1 so the main process keeps the hidden window alive).
 *
 *  1. refuses to start when `blockCache=1` is requested but the WBI_BLOCK_CACHE guard is not active;
 *  2. opens the project (awaits the whole open flow, incl. data decoding), optionally fills empty
 *     tables with synthetic sample data;
 *  3. for every page (hidden, tooltip and drill-through pages included, in pages.json order): activates
 *     it in reading view at 100% zoom (fit when larger than the viewport), waits for canvas readiness
 *     and then for the DOM to settle (no "Loading…" visuals, stable markup), captures a PNG of the page
 *     and classifies every visual from the DOM (ok / error / no-data / loading-stuck / unsupported /
 *     empty / hidden) with its displayed text, plus an engine probe (query time, warnings, totals);
 *  4. writes `<outdir>/<NN>-<page>.png` + `<outdir>/report.json` (rewritten after every page so a crash
 *     keeps partial results), then closes the window.
 */
import { useApp } from '../../state/store'
import { useShell, PANE_ORDER } from '../shellState'
import { openPath } from '../commands'
import { generateSyntheticData } from '@core/data/synthetic'
import { orderedPages, pageInfo, visualTypeOf, isGroup, isEffectivelyHidden, absoluteRect, positionOf } from '../../report/pbir'
import { liveContext } from '../../report/host'
import { probeVisual, CARD_TYPES, type VisualProbe } from './probe'
import { BLOCK_CACHE_GLOBAL } from '@shared/cacheGuard'
import { holdBusy, isBusy } from '../readiness'

/** `blank`: a card-like visual that renders but shows (Blank) — a data / synthetic-data coverage signal. */
export type VisualState = 'ok' | 'blank' | 'error' | 'nodata' | 'loading-stuck' | 'unsupported' | 'empty' | 'hidden' | 'not-rendered'

export interface SweepVisual {
  name: string
  visualType: string
  title?: string
  state: VisualState
  message?: string
  /** visible text of the visual (trimmed) — card values, totals, axis labels */
  text?: string
  /** number of drawn SVG/canvas marks (0 for a blank chart) */
  marks: number
  /** live filter context (JSON, truncated) for visuals that came out empty or broken — triage aid */
  filters?: string
  probe?: Omit<VisualProbe, 'page' | 'pageDisplayName' | 'visual' | 'visualType' | 'title' | 'hidden'>
  /** the visual's rectangle in page units, from the definition (group offsets applied) — used by scripts/compare.sh */
  rect?: { x: number; y: number; w: number; h: number }
  /** stacking order from the definition */
  z?: number
}

export interface SweepPage {
  name: string
  displayName: string
  kind: 'normal' | 'tooltip' | 'drillthrough'
  hidden: boolean
  width: number
  height: number
  png?: string
  /** where the page sits in `png`: page origin (x, y) in PNG pixels and PNG pixels per page unit */
  pngPage?: { x: number; y: number; scale: number }
  renderMs: number
  readyTimedOut: boolean
  visuals: SweepVisual[]
  counts: Record<string, number>
  consoleErrors: string[]
}

export interface SweepReport {
  path: string
  name?: string
  startedAt: string
  cacheBlocked: boolean
  sampleData: boolean
  openMs?: number
  synthetic?: { tables: number; ms: number }
  tables?: Array<{ name: string; rows: number }>
  diagnostics: Array<{ level: string; message: string }>
  engineError?: string
  /** `&dax=<query>` (repeatable): DAX queries run after loading — triage aid for app-vs-engine differences */
  dax?: Array<{ query: string; rows?: unknown[][]; error?: string }>
  pages: SweepPage[]
  totals: Record<string, number>
  error?: string
  /** page being rendered when report.json was last written (set while a page renders: a hang leaves it behind) */
  inProgress?: string
  finishedAt?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function host() {
  if (!window.wbi) throw new Error('sweep needs the Electron host (window.wbi)')
  return window.wbi
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'page'
}

async function waitFor(cond: () => boolean, timeoutMs: number, step = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(step)
  }
  return cond()
}

/** Console errors/warnings raised while the sweep runs (attributed to the current page). */
const consoleBuf: string[] = []
function hookConsole(): void {
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      try {
        consoleBuf.push(`[${level}] ` + args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 400))
      } catch {
        /* unserializable */
      }
      orig(...args)
    }
  }
  window.addEventListener('error', (e) => consoleBuf.push(`[uncaught] ${e.message}`))
  window.addEventListener('unhandledrejection', (e) => consoleBuf.push(`[unhandledrejection] ${String((e as PromiseRejectionEvent).reason)}`))
}

const LOADING_RE = /\bLoading\b[^\n]*…|\bLoading\.\.\.|\bLoading map\b/i

/** Classify one rendered visual container from its DOM. */
export function classifyVisual(el: HTMLElement): { state: VisualState; message?: string; text: string; marks: number } {
  const content = el.querySelector<HTMLElement>('.wbi-vc-content') ?? el
  let text = (content.innerText ?? content.textContent ?? '').replace(/\s+\n/g, '\n').trim()
  let marks = content.querySelectorAll('svg path, svg rect, svg circle, svg line, svg polygon, svg polyline, svg text, canvas, img').length
  // sandboxed visuals (HTML content, Deneb) render into same-origin srcdoc iframes
  for (const f of Array.from(content.querySelectorAll('iframe'))) {
    try {
      const body = f.contentDocument?.body
      if (!body) continue
      text = `${text}\n${(body.innerText ?? body.textContent ?? '').trim()}`.trim()
      marks += body.querySelectorAll('*').length
    } catch {
      marks++ // cross-origin: assume it rendered
    }
  }
  if (el.querySelector('.wbi-unknown')) return { state: 'unsupported', text, marks }
  if (el.querySelector('.wbi-vmsg') || /Can't display (the|this) visual/.test(text)) {
    const details = el.querySelector('.wbi-vmsg-details')?.textContent ?? el.querySelector<HTMLElement>('[title]')?.title ?? text
    return { state: 'error', message: details.slice(0, 500), text, marks }
  }
  if (/^No data available\b/m.test(text) && text.length < 60) return { state: 'nodata', text, marks }
  if (LOADING_RE.test(text)) return { state: 'loading-stuck', text, marks }
  if (!text && marks === 0) return { state: 'empty', text, marks }
  return { state: 'ok', text, marks }
}

function domSignature(): string {
  const page = document.querySelector('.wbi-page')
  if (!page) return ''
  // text + element count is cheap and catches late async renders (maps, images, lazy charts)
  return `${page.querySelectorAll('*').length}:${(page as HTMLElement).innerText?.length ?? 0}`
}

function anyLoading(): boolean {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.wbi-page .wbi-vc'))) {
    const t = el.querySelector<HTMLElement>('.wbi-vc-content')?.innerText ?? ''
    if (LOADING_RE.test(t)) return true
  }
  return false
}

/** After canvas readiness: wait until no visual says "Loading…" and the DOM is stable for 3 polls. */
async function settle(maxMs: number): Promise<void> {
  const end = Date.now() + maxMs
  let last = ''
  let stable = 0
  while (Date.now() < end) {
    await sleep(250)
    const sig = domSignature()
    stable = sig === last ? stable + 1 : 0
    last = sig
    if (stable >= 3 && !anyLoading()) return
  }
}

function fitZoom(width: number, height: number): number {
  const vp = document.querySelector<HTMLElement>('.wbi-viewport')
  if (!vp) return 1
  const aw = vp.clientWidth - 40
  const ah = vp.clientHeight - 40
  return Math.min(1, aw / width, ah / height)
}

/** Captures the page; returns the captured rectangle (CSS px) or null. */
async function capturePage(path: string): Promise<{ x: number; y: number; width: number; height: number; pngWidth: number } | null> {
  const el = document.querySelector<HTMLElement>('.wbi-page-outer')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const rect = { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(Math.min(r.width, window.innerWidth - r.left)), height: Math.ceil(Math.min(r.height, window.innerHeight - r.top)) }
  const png = await host().exporter.capturePng(rect)
  await host().fs.writeFile(path, png)
  return { ...rect, pngWidth: pngWidth(png) }
}

/** PNG width in pixels, read from the IHDR chunk (0 when not a PNG). */
function pngWidth(png: Uint8Array): number {
  if (png.length < 24 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return 0
  return ((png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]) >>> 0
}

function countStates(vs: SweepVisual[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const v of vs) c[v.state] = (c[v.state] ?? 0) + 1
  return c
}

/** Start the sweep if the route asks for it. Returns true when sweep mode is active. */
export function maybeStartSweep(): boolean {
  const q = window.location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(q)
  if (!params.get('sweep')) return false
  void runSweep(params)
  return true
}

export async function runSweep(params: URLSearchParams): Promise<void> {
  const outDir = params.get('sweep')!
  const path = params.get('open') ?? ''
  const sample = params.get('synthetic') === '1'
  const wantBlock = params.get('blockCache') === '1'
  const pageFilter = params.get('pages')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const cacheBlocked = (globalThis as Record<string, unknown>)[BLOCK_CACHE_GLOBAL] === true
  const rep: SweepReport = { path, startedAt: new Date().toISOString(), cacheBlocked, sampleData: sample, diagnostics: [], pages: [], totals: {} }
  const fs = host().fs
  const write = () => fs.writeFile(`${outDir}/report.json`, new TextEncoder().encode(JSON.stringify(rep, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1)))
  hookConsole()
  let release: (() => void) | null = null
  try {
    await fs.mkdirp(outDir)
    rep.error = 'interrupted while opening'
    await write()
    if (wantBlock && !cacheBlocked) throw new Error('blockCache=1 requested but the WBI_BLOCK_CACHE guard is not active in this renderer — refusing to open')
    if (!path) throw new Error('missing open=<path>')
    // let the shell finish its own launch before driving it, then keep the app busy for the whole sweep
    await waitFor(() => !isBusy(), 10000)
    release = holdBusy('sweep')
    const t0 = performance.now()
    const ok = await openPath(path, { skipConfirm: true })
    // the open flow is finished only when the busy overlay is gone and the project is set
    await waitFor(() => !useApp.getState().busy, 60000)
    rep.openMs = Math.round(performance.now() - t0)
    rep.error = undefined
    const app = useApp.getState()
    if (!ok || !app.project) throw new Error('open failed')
    rep.name = app.project.name
    rep.diagnostics = app.project.diagnostics.map((d) => ({ level: d.level, message: d.message }))
    if (sample) {
      const t1 = performance.now()
      // The sweep is a rendering oracle over local files: it reuses every literal of the definitions (also names
      // and ids in filters) so that visuals pinned to them render; `private=1` uses the app's default instead,
      // where such literals are never copied into the data and those visuals are empty by design.
      const r = generateSyntheticData(app.project, { onlyEmpty: true, identifyingLiterals: params.get('private') === '1' ? 'never' : 'reuse' })
      useApp.getState().dataChanged()
      rep.synthetic = { tables: r.tables.length, ms: Math.round(performance.now() - t1) }
    }
    const project = useApp.getState().project!
    rep.tables = project.model.tables.map((t) => ({ name: t.name, rows: project.data.tables.get(t.name)?.rowCount ?? 0 }))
    rep.engineError = useApp.getState().engineError
    const daxEngine = useApp.getState().engine
    for (const query of params.getAll('dax')) {
      try {
        rep.dax = [...(rep.dax ?? []), { query, rows: daxEngine?.runDaxQuery(query).tables[0]?.rows.slice(0, 50) }]
      } catch (e) {
        rep.dax = [...(rep.dax ?? []), { query, error: e instanceof Error ? e.message : String(e) }]
      }
    }
    const report = project.report
    if (!report) throw new Error('the project has no report')

    // reading view, no panes, no toasts: the capture shows the page as a consumer sees it
    const shell = useShell.getState()
    for (const id of PANE_ORDER) shell.setPane(id, { open: false })
    shell.setDataNotice(null)
    useApp.getState().setEditMode(false)
    const style = document.createElement('style')
    style.textContent = '.wbi-toasts{display:none!important}'
    document.head.appendChild(style)
    await sleep(300)

    const pages = orderedPages(report)
    let idx = 0
    for (const page of pages) {
      idx++
      const info = pageInfo(page)
      if (pageFilter && !pageFilter.includes(page.name.toLowerCase()) && !pageFilter.includes(info.displayName.toLowerCase()) && !pageFilter.includes(String(idx))) continue
      consoleBuf.length = 0
      rep.inProgress = `${idx} ${info.displayName}`
      await write()
      const t1 = performance.now()
      // the canvas reports readiness on page / project change only: re-arm it unless the page is already shown
      const current = useApp.getState().activePage ?? orderedPages(report)[0]?.name
      if (current !== page.name) {
        document.body.dataset.wbiReady = '0'
        useApp.getState().setActivePage(page.name)
      }
      await sleep(50)
      useApp.getState().setZoom(fitZoom(info.width, info.height))
      const ready = await waitFor(() => document.body.dataset.wbiReady === '1', 30000)
      await settle(15000)
      const renderMs = Math.round(performance.now() - t1)
      const pngName = `${String(idx).padStart(2, '0')}-${safeName(info.displayName)}.png`
      const captured = await capturePage(`${outDir}/${pngName}`).catch(() => null)
      const outerEl = document.querySelector<HTMLElement>('.wbi-page-outer')
      const innerEl = document.querySelector<HTMLElement>('.wbi-page')
      let pngPage: SweepPage['pngPage']
      if (captured && innerEl) {
        // page origin and scale inside the captured PNG (device pixels may differ from CSS px)
        const k = captured.pngWidth > 0 ? captured.pngWidth / captured.width : window.devicePixelRatio || 1
        const ir = innerEl.getBoundingClientRect()
        pngPage = { x: Math.round((ir.left - captured.x) * k * 100) / 100, y: Math.round((ir.top - captured.y) * k * 100) / 100, scale: Math.round(((ir.width * k) / info.width) * 10000) / 10000 }
      }
      const rr = (el: Element | null) => (el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null)
      console.info(`[sweep] page ${info.displayName}: outers=${document.querySelectorAll('.wbi-page-outer').length} outer=${JSON.stringify(rr(outerEl))} inner=${JSON.stringify(rr(innerEl))} zoom=${useApp.getState().zoom} win=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`)
      const engine = useApp.getState().engine
      const visuals: SweepVisual[] = []
      for (const v of page.visuals) {
        if (isGroup(v)) continue
        const type = visualTypeOf(v)
        const el = document.querySelector<HTMLElement>(`.wbi-page [data-visual="${CSS.escape(v.name)}"]`)
        let sv: SweepVisual
        if (isEffectivelyHidden(page, v)) sv = { name: v.name, visualType: type, state: 'hidden', marks: 0 }
        else if (!el) sv = { name: v.name, visualType: type, state: 'not-rendered', marks: 0 }
        else {
          const c = classifyVisual(el)
          sv = { name: v.name, visualType: type, state: c.state, message: c.message, text: c.text.slice(0, CARD_TYPES.has(type) ? 400 : 1200) || undefined, marks: c.marks }
        }
        const title = el?.querySelector<HTMLElement>('.wbi-vc-titles')?.innerText?.trim()
        if (title) sv.title = title.slice(0, 200)
        // hidden visuals (bookmark-toggled) are not on screen: skip the engine probe to keep the sweep fast
        if (engine && sv.state !== 'hidden') {
          const ctx = liveContext(page.name, v.name)
          const { page: _p, pageDisplayName: _d, visual: _v, visualType: _t, title: t, hidden: _h, ...probe } = probeVisual(engine, report, page, v, ctx ? { filtersFor: () => ctx.filters } : {})
          if (!sv.title && t) sv.title = t
          if (probe.groups.length || probe.values.length) sv.probe = probe
        }
        const ar = absoluteRect(page, v)
        sv.rect = { x: ar.x, y: ar.y, w: ar.width, h: ar.height }
        sv.z = positionOf(v).z
        if (sv.state === 'ok' && CARD_TYPES.has(type) && /\(Blank\)/.test(sv.text ?? '')) sv.state = 'blank'
        if (sv.state === 'nodata' || sv.state === 'blank' || sv.state === 'error') {
          const live = liveContext(page.name, v.name)
          if (live) sv.filters = JSON.stringify(live.filters).slice(0, 4000)
        }
        visuals.push(sv)
      }
      rep.pages.push({
        name: page.name,
        displayName: info.displayName,
        kind: info.isTooltip ? 'tooltip' : info.isDrillthrough ? 'drillthrough' : 'normal',
        hidden: info.hidden,
        width: info.width,
        height: info.height,
        png: captured ? pngName : undefined,
        pngPage,
        renderMs,
        readyTimedOut: !ready,
        visuals,
        counts: countStates(visuals),
        consoleErrors: [...new Set(consoleBuf)].slice(0, 40)
      })
      for (const [k, n] of Object.entries(countStates(visuals))) rep.totals[k] = (rep.totals[k] ?? 0) + n
      rep.inProgress = undefined
      await write()
    }
  } catch (e) {
    rep.error = e instanceof Error ? e.message : String(e)
    console.error(`[sweep] ${rep.error}`)
  } finally {
    rep.finishedAt = new Date().toISOString()
    await write().catch(() => undefined)
    release?.()
    console.info(`[sweep] done: ${rep.pages.length} page(s) ${JSON.stringify(rep.totals)}`)
    await host().window.close()
  }
}
