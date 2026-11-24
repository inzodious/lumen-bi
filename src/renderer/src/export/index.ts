/**
 * Report and data exports.
 *
 *   openExportDialog('pdf' | 'pptx' | 'png' | 'html')          — File ▸ Export, menu, command search: the page
 *                                                                selection dialog (dialogs/ExportPagesDialog.tsx)
 *   exportReport(format, { pages?, path?, resolution? })        — runs the export (the dialog, scripts, e2e)
 *   exportReportWithResult(format, opts)                       — the same, returning the path and the pages that
 *                                                                were not fully rendered (scripted exports)
 *   exportVisualData(req)                                      — a visual's "Export data" (register
 *                                                                with useApp().setExportVisualDataHandler)
 *   PrintLayout (./PrintLayout)                                — '#/print' route (renders the current print job)
 */
import { create } from 'zustand'
import type { ExportVisualDataRequest } from '../state/store'
import { useApp } from '../state/store'
import { toast } from '../app/ui/Notify'
import { capturePagesPng, printPagesPdf, type IncompleteExportPage } from './capture'
import { buildHtml, buildPptx, type ExportedPage, type ExportMeta } from './builders'
import { pageTransition, reportMotion } from '@core/report/motion'
import { buildXlsx, toCsv, type TabularData } from './data'
import type { PageExportOptions } from './pageSelection'

export { capturePagesPng, printPagesPdf, exportablePages, type IncompleteExportPage } from './capture'
export * from './pageSelection'
export { buildHtml, buildPptx, type ExportedPage } from './builders'
export { buildXlsx, toCsv } from './data'
export { describeFilterCards } from './filterText'
export { PrintLayout, usePrintJob, type PrintJob } from './PrintLayout'

export type ReportExportFormat = 'pdf' | 'pptx' | 'png' | 'html'

const FORMAT_INFO: Record<Exclude<ReportExportFormat, 'png'>, { ext: string; filter: string; title: string }> = {
  pdf: { ext: 'pdf', filter: 'PDF', title: 'Export to PDF' },
  pptx: { ext: 'pptx', filter: 'PowerPoint presentation', title: 'Export to PowerPoint' },
  html: { ext: 'html', filter: 'Web page', title: 'Export to HTML' }
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Report'
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

let exporting = false

/** PNG export resolution (1 = native page size, 2 / 3 = high-DPI). Persisted per user. */
export const usePngExportPrefs = create<{ resolution: number; set(resolution: number): void }>((set) => ({
  resolution: (() => {
    try {
      return Number(localStorage.getItem('lumen.pngResolution')) || 1
    } catch {
      return 1
    }
  })(),
  set: (resolution) => {
    try {
      localStorage.setItem('lumen.pngResolution', String(resolution))
    } catch {
      /* ignore */
    }
    set({ resolution })
  }
}))

/** The page-selection export dialog (rendered by dialogs/DialogsHost). */
export const useReportExportDialog = create<{ format: ReportExportFormat | null; open(format: ReportExportFormat | null): void }>((set) => ({
  format: null,
  open: (format) => set({ format })
}))

/** Ask which pages to export (and the format's options), then export. */
export function openExportDialog(format: ReportExportFormat): void {
  if (!useApp.getState().project?.report) {
    toast({ kind: 'warning', message: 'Open a report to export it.' })
    return
  }
  useReportExportDialog.getState().open(format)
}

export interface ReportExportOptions extends PageExportOptions {
  /** target file (folder for PNG); asked with a save dialog when absent */
  path?: string
  /** PNG only: 1 = page size, 2 / 3 = high-DPI */
  resolution?: number
  /** safety timeout per rendered page / print job (ms); tests inject a short one */
  jobTimeoutMs?: number
}

export interface ReportExportResult {
  /** written file (folder for PNG) */
  path: string
  /** pages exported before they finished rendering (drawn partly), in report order; empty when all were complete */
  incomplete: IncompleteExportPage[]
}

/** "Sales, Overview (2 visuals still loading)" — for the completion message. */
export function describeIncompletePages(pages: IncompleteExportPage[]): string {
  return pages.map((p) => (p.pending.length ? `${p.displayName} (${p.pending.length} visual${p.pending.length === 1 ? '' : 's'} still loading)` : p.displayName)).join(', ')
}

/**
 * Export the report pages in `opts.pages` (report order; default: every page except tooltip pages, hidden pages
 * included). Returns the written path (file or folder), or null when cancelled/failed. Pages that did not finish
 * rendering in time are still exported as drawn, and the completion message names them (exportReportWithResult
 * returns them).
 */
export async function exportReport(format: ReportExportFormat, opts: ReportExportOptions = {}): Promise<string | null> {
  return (await exportReportWithResult(format, opts))?.path ?? null
}

/** exportReport, returning the written path and the pages that were not fully rendered (null when cancelled/failed). */
export async function exportReportWithResult(format: ReportExportFormat, opts: ReportExportOptions = {}): Promise<ReportExportResult | null> {
  const project = useApp.getState().project
  if (!project?.report) {
    toast({ kind: 'warning', message: 'Open a report to export it.' })
    return null
  }
  if (exporting) return null
  const reportName = project.name || 'Report'
  const baseDir = project.source.path ? project.source.path.replace(/\/[^/]*\/?$/, '') : await window.wbi.app.getPath('documents').catch(() => '')
  let target = opts.path ?? null
  if (!target) {
    if (format === 'png') target = await window.wbi.dialog.openDirectory({ title: 'Export pages as PNG images — choose a folder', defaultPath: baseDir })
    else {
      const info = FORMAT_INFO[format]
      target = await window.wbi.dialog.saveFile({ title: info.title, defaultPath: `${baseDir}/${safeName(reportName)}.${info.ext}`, filters: [{ name: info.filter, extensions: [info.ext] }] })
      if (target && !target.toLowerCase().endsWith(`.${info.ext}`)) target += `.${info.ext}`
    }
  }
  if (!target) return null
  exporting = true
  const incomplete: IncompleteExportPage[] = []
  try {
    const meta: ExportMeta = { reportName, exportedAt: new Date(), ...htmlTransitions(project.report) }
    const run = { pages: opts.pages, incomplete, jobTimeoutMs: opts.jobTimeoutMs }
    if (format === 'pdf') {
      const bytes = await printPagesPdf(run)
      await window.wbi.fs.writeFile(target, bytes)
    } else {
      // PNG files honor the resolution option; PowerPoint/HTML embed 2× images so they stay sharp when enlarged
      const resolution = format === 'png' ? (opts.resolution ?? usePngExportPrefs.getState().resolution) : 2
      const pages: ExportedPage[] = await capturePagesPng(undefined, { ...run, resolution })
      if (format === 'png') {
        await window.wbi.fs.mkdirp(target)
        for (let i = 0; i < pages.length; i++) await window.wbi.fs.writeFile(`${target}/${i + 1} - ${safeName(pages[i].displayName)}.png`, pages[i].png)
      } else if (format === 'pptx') {
        await window.wbi.fs.writeFile(target, await buildPptx(pages, meta))
      } else {
        await window.wbi.fs.writeFile(target, buildHtml(pages, meta))
      }
    }
    const show = { label: 'Show in folder', onClick: () => void window.wbi.app.showItemInFolder(target!) }
    if (incomplete.length) {
      // never silent: the file shows these pages as far as they were drawn when the wait ran out
      toast({
        kind: 'warning',
        title: 'Export complete, but some pages were not fully rendered',
        message: `${incomplete.length === 1 ? 'This page was' : 'These pages were'} exported before every visual finished drawing: ${describeIncompletePages(incomplete)}. ${target}`,
        duration: 0,
        action: show
      })
    } else toast({ kind: 'success', title: 'Export complete', message: target, action: show })
    return { path: target, incomplete }
  } catch (e) {
    toast({ kind: 'error', title: 'Export failed', message: errText(e) })
    return null
  } finally {
    exporting = false
  }
}

// ---------------------------------------------------------------------------------------------
// Visual "Export data"
// ---------------------------------------------------------------------------------------------

export interface PendingDataExport {
  req: ExportVisualDataRequest
}

/** State for the Export data dialog (rendered by dialogs/DialogsHost). */
export const useDataExport = create<{ pending: PendingDataExport | null; set(p: PendingDataExport | null): void }>((set) => ({
  pending: null,
  set: (pending) => set({ pending })
}))

/** Open PBI's "Export data" dialog for a visual. */
export function exportVisualData(req: ExportVisualDataRequest): void {
  if (!req.data || !req.data.columns.length) {
    toast({ kind: 'warning', message: "This visual doesn't have data that can be exported." })
    return
  }
  useDataExport.getState().set({ req })
}

/** PBI limits: .xlsx 150,000 rows, .csv 30,000 rows (summarized data). */
export const EXPORT_ROW_LIMITS = { xlsx: 150000, csv: 30000 } as const

/** Write the visual data to a file chosen by the user. Returns the path or null. */
export async function writeVisualData(req: ExportVisualDataRequest, format: 'xlsx' | 'csv'): Promise<string | null> {
  const data = req.data as TabularData
  const project = useApp.getState().project
  const baseDir = project?.source.path ? project.source.path.replace(/\/[^/]*\/?$/, '') : await window.wbi.app.getPath('documents').catch(() => '')
  let path = await window.wbi.dialog.saveFile({ title: 'Export data', defaultPath: `${baseDir}/${safeName(req.title || 'data')}.${format}`, filters: [format === 'xlsx' ? { name: 'Excel workbook', extensions: ['xlsx'] } : { name: 'CSV (comma separated)', extensions: ['csv'] }] })
  if (!path) return null
  if (!path.toLowerCase().endsWith(`.${format}`)) path += `.${format}`
  const limited: TabularData = { columns: data.columns, rows: data.rows.slice(0, EXPORT_ROW_LIMITS[format]) }
  try {
    if (format === 'xlsx') await window.wbi.fs.writeFile(path, await buildXlsx(limited, { sheetName: req.title || 'Export' }))
    else await window.wbi.fs.writeFile(path, toCsv(limited, { bom: true }))
    const truncated = data.rows.length > limited.rows.length
    toast({ kind: truncated ? 'warning' : 'success', title: 'Data exported', message: truncated ? `Only the first ${limited.rows.length.toLocaleString()} rows were exported (${format.toUpperCase()} limit).` : path, action: { label: 'Show in folder', onClick: () => void window.wbi.app.showItemInFolder(path!) } })
    return path
  } catch (e) {
    toast({ kind: 'error', title: 'Export failed', message: errText(e) })
    return null
  }
}

/** Alias kept for callers that registered the placeholder name. */
export const exportVisualDataHandler = exportVisualData

/** The report's page transitions for the HTML viewer (Lumen_Motion; visual animations can't play on page images). */
function htmlTransitions(report: NonNullable<ReturnType<typeof useApp.getState>['project']>['report']): Pick<ExportMeta, 'transitions' | 'transitionDuration'> {
  if (!report) return {}
  const transitions: Record<string, string> = {}
  for (const p of report.pages) {
    const t = pageTransition(report.report, p.json)
    if (t !== 'none') transitions[p.name] = t
  }
  return Object.keys(transitions).length ? { transitions, transitionDuration: reportMotion(report.report).transitionDuration } : {}
}
