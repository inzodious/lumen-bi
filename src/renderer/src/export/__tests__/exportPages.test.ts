// @vitest-environment node
/**
 * The exporters take the selected pages (report order) instead of deciding by visibility. The print route is not
 * mounted here: a stub answers each print job (records its pages, reports ready) and the host bridge is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { useApp } from '../../state/store'
import { FIXTURE, fixtureProject } from '../../report/dev/fixture'
import { usePrintJob } from '../PrintLayout'
import { capturePagesPng, exportablePages, printPagesPdf } from '../capture'
import { exportReport, exportReportWithResult } from '../index'

const toasts: Array<{ kind?: string; message?: unknown }> = []
vi.mock('../../app/ui/Notify', () => ({ toast: (t: { kind?: string; message?: unknown }) => void toasts.push(t) }))

// 1×1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

const jobs: string[][] = []
/** pages whose print job never reports ready (a page that never finishes rendering) */
const never = new Set<string>()
/** pages whose canvas reports its own readiness timeout with pending visuals */
const canvasTimeout = new Map<string, Array<{ name: string; type: string }>>()
const written = new Map<string, Uint8Array | string>()
const g = globalThis as any
const saved: Record<string, unknown> = {}

beforeAll(() => {
  for (const k of ['window', 'location', 'document', 'requestAnimationFrame', 'CSS', 'createImageBitmap']) saved[k] = g[k]
  g.location = { hash: '#/' }
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)
  g.CSS = { escape: (s: string) => s }
  const el = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }
  // high-resolution captures (PowerPoint / HTML embed 2× images) are tiled and stitched on a canvas
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: (cb: (b: Blob) => void) => cb(new Blob([PNG])) }
  g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
  g.document = { querySelector: () => el, querySelectorAll: () => [], createElement: () => canvas, body: { dataset: {} } }
  g.window = Object.assign(globalThis, {
    innerWidth: 1920,
    innerHeight: 1080,
    wbi: {
      exporter: { printToPDF: vi.fn(async () => new TextEncoder().encode('%PDF-1.4')), capturePng: vi.fn(async () => PNG) },
      fs: {
        writeFile: vi.fn(async (p: string, d: Uint8Array | string) => void written.set(p, d)),
        mkdirp: vi.fn(async () => undefined)
      },
      app: { getPath: async () => '/tmp', showItemInFolder: async () => undefined }
    }
  })
  usePrintJob.subscribe((s) => {
    const job = s.job
    if (job) {
      jobs.push(job.pages)
      if (job.pages.some((p) => never.has(p))) return
      const incomplete = job.pages.filter((p) => canvasTimeout.has(p)).map((p) => ({ name: p, displayName: p, pending: canvasTimeout.get(p)! }))
      setTimeout(() => job.onReady({ incomplete }), 0)
    }
  })
})

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) g[k] = v
})

beforeEach(() => {
  jobs.length = 0
  never.clear()
  canvasTimeout.clear()
  toasts.length = 0
  written.clear()
  useApp.getState().setProject(fixtureProject())
})

const order = () => useApp.getState().project!.report!.pagesMeta.pageOrder

describe('exportablePages', () => {
  it('defaults to every page except tooltip pages, hidden pages included, report order', () => {
    const expected = order().filter((n) => n !== FIXTURE.tooltip)
    expect(exportablePages().map((p) => p.name)).toEqual(expected)
    expect(expected).toContain(FIXTURE.hidden)
  })
  it('honours a page list (report order, unknown names dropped, tooltip pages when asked for)', () => {
    const pick = [FIXTURE.tooltip, FIXTURE.hidden, 'ghost', FIXTURE.overview]
    expect(exportablePages(pick).map((p) => p.name)).toEqual(order().filter((n) => pick.includes(n)))
  })
})

describe('exporters receive and honour the page list', () => {
  it('PDF prints exactly the selected pages in one job, report order', async () => {
    await printPagesPdf({ pages: [FIXTURE.hidden, FIXTURE.overview] })
    expect(jobs).toEqual([order().filter((n) => n === FIXTURE.hidden || n === FIXTURE.overview)])
  })

  it('PNG capture renders each selected page alone, report order', async () => {
    const out = await capturePagesPng(undefined, { pages: [FIXTURE.hidden, FIXTURE.details] })
    const expected = order().filter((n) => n === FIXTURE.hidden || n === FIXTURE.details)
    expect(jobs).toEqual(expected.map((n) => [n]))
    expect(out.map((p) => p.name)).toEqual(expected)
  })

  it('an empty selection is an error, not an export of everything', async () => {
    await expect(printPagesPdf({ pages: [] })).rejects.toThrow(/No pages are selected/)
    expect(jobs).toEqual([])
  })

  it('exportReport: images are written per selected page, numbered in report order', async () => {
    const out = await exportReport('png', { path: '/x/png', pages: [FIXTURE.hidden, FIXTURE.overview] })
    expect(out).toBe('/x/png')
    const label: Record<string, string> = { [FIXTURE.hidden]: 'Notes', [FIXTURE.overview]: 'Overview' }
    const expected = order().filter((n) => n in label).map((n, i) => `/x/png/${i + 1} - ${label[n]}.png`)
    expect([...written.keys()]).toEqual(expected)
  })

  it('exportReport: HTML navigation lists exactly the exported pages', async () => {
    await exportReport('html', { path: '/x/r.html', pages: [FIXTURE.hidden, FIXTURE.overview] })
    expect(toasts.filter((t) => t.kind === 'error')).toEqual([])
    const html = String(written.get('/x/r.html'))
    const tabs = [...html.matchAll(/<button type="button" class="tab[^"]*" data-i="\d+">([^<]*)<\/button>/g)].map((m) => m[1])
    expect(tabs.sort()).toEqual(['Notes', 'Overview'])
    expect(html).not.toContain('Category tooltip')
    expect(html).toContain('Page 1 of 2')
  })

  it('exportReport: PowerPoint has a title slide plus one slide per selected page', async () => {
    await exportReport('pptx', { path: '/x/r.pptx', pages: [FIXTURE.hidden] })
    const zip = unzipSync(written.get('/x/r.pptx') as Uint8Array)
    const slides = Object.keys(zip).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    expect(slides.length).toBe(2)
    expect(strFromU8(zip['ppt/slides/slide1.xml'])).toContain('1 page')
  })
})

describe('a page that does not finish rendering is reported, never exported silently', () => {
  const displayName = (n: string) => useApp.getState().project!.report!.pages.find((p) => p.name === n)!.json.displayName as string

  it('PNG: the export finishes, the completion message names the page, scripts get it in the result', async () => {
    never.add(FIXTURE.details)
    const res = await exportReportWithResult('png', { path: '/x/png', pages: [FIXTURE.overview, FIXTURE.details], jobTimeoutMs: 30 })
    expect(res?.path).toBe('/x/png')
    // both pages were written (the slow one as drawn so far)
    expect(written.size).toBe(2)
    expect(res?.incomplete).toEqual([{ name: FIXTURE.details, displayName: displayName(FIXTURE.details), pending: [], reason: 'job' }])
    const warn = toasts.find((t) => t.kind === 'warning')
    expect(warn).toBeDefined()
    expect(String(warn!.message)).toContain(displayName(FIXTURE.details))
    expect(String(warn!.message)).not.toContain(displayName(FIXTURE.overview))
    expect(toasts.some((t) => t.kind === 'success')).toBe(false)
  })

  it('PDF: the canvas readiness timeout (pending visuals) is reported too', async () => {
    canvasTimeout.set(FIXTURE.overview, [{ name: 'v1', type: 'lineChart' }])
    const res = await exportReportWithResult('pdf', { path: '/x/r.pdf', pages: [FIXTURE.overview, FIXTURE.hidden] })
    expect(res?.incomplete).toEqual([{ name: FIXTURE.overview, displayName: FIXTURE.overview, pending: [{ name: 'v1', type: 'lineChart' }], reason: 'canvas' }])
    expect(String(toasts.find((t) => t.kind === 'warning')?.message)).toMatch(/1 visual still loading/)
  })

  it('a complete export reports nothing', async () => {
    const res = await exportReportWithResult('pdf', { path: '/x/r.pdf', pages: [FIXTURE.overview] })
    expect(res?.incomplete).toEqual([])
    expect(toasts.map((t) => t.kind)).toEqual(['success'])
  })
})
