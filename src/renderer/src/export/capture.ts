/**
 * Page rendering for exports through the '#/print' route (export/PrintLayout.tsx), which uses the
 * canvas' non-interactive PrintLayout — independent of the interactive canvas, its zoom and chrome.
 *   capturePagesPng → each page alone at native size (scaled down only if larger than the window) → PNG
 *   printPagesPdf   → all pages, one named @page box each → printToPDF (vector text)
 * Both take the page names chosen in the export dialog (export/pageSelection.ts) and render them in report order.
 * Hidden pages and pages never opened in this session render the same way as any other: the print route mounts a
 * fresh PageCanvas per page (it does not depend on the interactive canvas having visited the page) and each job
 * resolves on the canvas' own readiness callback (every visual rendered), with the model's data already in memory.
 */
import { useApp } from '../state/store'
import { cardsFilters } from '../report/filters'
import type { ExportedPage } from './builders'
import { describeFilterCards } from './filterText'
import { usePrintJob, CAPTURE_ROOT_CLASS, type PrintJob } from './PrintLayout'
import { defaultSelection, exportPageEntries, orderedSelection, type PageExportOptions } from './pageSelection'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Canvas PageCanvas has its own 12 s ready timeout; this is a safety net above it. */
const JOB_TIMEOUT_MS = 20000
let jobKey = 1

export interface ExportPageInfo {
  name: string
  displayName: string
  width: number
  height: number
}

/**
 * Pages to export, in report order: the given page names (unknown names ignored), or by default every page except
 * tooltip pages, hidden pages included.
 */
export function exportablePages(names?: readonly string[]): ExportPageInfo[] {
  const entries = exportPageEntries(useApp.getState().project?.report)
  const chosen = new Set(orderedSelection(entries, names ?? defaultSelection(entries)))
  return entries.filter((p) => chosen.has(p.name)).map((p) => ({ name: p.name, displayName: p.displayName, width: p.width, height: p.height }))
}

/** Report + page filter summaries for slide notes. */
function filterNotes(pageName: string): string[] {
  const report = useApp.getState().project?.report
  if (!report) return []
  const page = report.pages.find((p) => p.name === pageName)
  const cards = [...(report.report?.filterConfig?.filters ?? []), ...(page?.json?.filterConfig?.filters ?? [])]
  return cardsFilters(cards).length ? describeFilterCards(cards) : []
}

/** Run one print job: render it in the print route and resolve when every visual reported ready. */
function runJob(job: Omit<PrintJob, 'key' | 'onReady'>): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(done, JOB_TIMEOUT_MS)
    usePrintJob.getState().set({ ...job, key: jobKey++, onReady: done })
  })
}

/** Switch to '#/print' for the duration of `fn`, then restore the previous route and clear the job. */
async function inPrintRoute<T>(fn: () => Promise<T>): Promise<T> {
  const prevHash = location.hash
  const prevSelection = useApp.getState().selectedVisuals
  try {
    location.hash = '#/print'
    await frame()
    return await fn()
  } finally {
    usePrintJob.getState().set(null)
    location.hash = prevHash || '#/'
    if (prevSelection.length) useApp.getState().selectVisuals(prevSelection)
  }
}

function ensurePages(names?: readonly string[]): ExportPageInfo[] {
  if (!useApp.getState().project?.report) throw new Error('There is no report to export.')
  const pages = exportablePages(names)
  if (!pages.length) throw new Error(names ? 'No pages are selected for export.' : 'The report has no pages to export.')
  return pages
}

/** Render each selected page alone and capture it as PNG (report order). */
export async function capturePagesPng(onProgress?: (done: number, total: number, page: string) => void, opts: { resolution?: number } & PageExportOptions = {}): Promise<ExportedPage[]> {
  const pages = ensurePages(opts.pages)
  const resolution = Math.max(1, Math.min(4, opts.resolution ?? 1))
  return inPrintRoute(async () => {
    const out: ExportedPage[] = []
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      onProgress?.(i, pages.length, p.displayName)
      if (resolution === 1 && p.width <= window.innerWidth && p.height <= window.innerHeight) {
        // native size in one capture
        await runJob({ mode: 'capture', pages: [p.name], scale: 1 })
        await sleep(300)
        await frame()
        const el = captureRoot(p.name)
        const r = el.getBoundingClientRect()
        const png = await window.wbi.exporter.capturePng({ x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) })
        out.push({ ...p, png, notes: filterNotes(p.name) })
        continue
      }
      // larger than the window and/or high resolution (2× / 3×): render the page CSS-scaled (re-rasterized, sharp),
      // capture it in window-sized tiles and stitch them
      await runJob({ mode: 'capture', pages: [p.name], scale: resolution })
      await sleep(300)
      await frame()
      const png = await captureTiled(p, resolution)
      out.push({ ...p, png, notes: filterNotes(p.name) })
    }
    onProgress?.(pages.length, pages.length, '')
    return out
  })
}

function captureRoot(pageName: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.${CAPTURE_ROOT_CLASS} [data-page="${CSS.escape(pageName)}"]`) ?? document.querySelector<HTMLElement>(`.${CAPTURE_ROOT_CLASS}`)
  if (!el) throw new Error('Could not render the report page for export.')
  return el
}

/** Capture the scaled page in tiles (translating the capture root) and stitch them into one PNG. */
async function captureTiled(p: ExportPageInfo, scale: number): Promise<Uint8Array> {
  const root = document.querySelector<HTMLElement>(`.${CAPTURE_ROOT_CLASS}`)
  if (!root) throw new Error('Could not render the report page for export.')
  const W = Math.round(p.width * scale)
  const H = Math.round(p.height * scale)
  const tw = Math.max(64, Math.floor(window.innerWidth))
  const th = Math.max(64, Math.floor(window.innerHeight))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas 2D is not available for the export.')
  const base = `scale(${scale})`
  root.style.transform = base
  await frame()
  // the page may sit at an offset inside the capture root
  const pr = captureRoot(p.name).getBoundingClientRect()
  const ox = pr.left
  const oy = pr.top
  try {
    for (let ty = 0; ty < H; ty += th) {
      for (let tx = 0; tx < W; tx += tw) {
        root.style.transform = `translate(${-(tx + ox)}px, ${-(ty + oy)}px) ${base}`
        await frame()
        await frame()
        await sleep(60)
        const w = Math.min(tw, W - tx)
        const h = Math.min(th, H - ty)
        const bytes = await window.wbi.exporter.capturePng({ x: 0, y: 0, width: w, height: h })
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
        // the capture is in device pixels: draw it into the tile's CSS-px box
        g.drawImage(bmp, 0, 0, bmp.width, bmp.height, tx, ty, w, h)
        bmp.close()
      }
    }
  } finally {
    root.style.transform = base
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Render the selected pages (report order) in the print layout and print the window to PDF bytes (vector). */
export async function printPagesPdf(opts: PageExportOptions = {}): Promise<Uint8Array> {
  const pages = ensurePages(opts.pages)
  return inPrintRoute(async () => {
    await runJob({ mode: 'pdf', pages: pages.map((p) => p.name), scale: 1 })
    await sleep(300)
    await frame()
    const first = pages[0]
    return window.wbi.exporter.printToPDF({ width: first.width / 96, height: first.height / 96, preferCSSPageSize: true, printBackground: true, landscape: false })
  })
}
