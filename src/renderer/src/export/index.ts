/**
 * Report and data exports.
 *
 *   exportReport('pdf' | 'pptx' | 'png' | 'html', { path? })  — File ▸ Export, ribbon, menu
 *   exportVisualData(req)                                      — a visual's "Export data" (register
 *                                                                with useApp().setExportVisualDataHandler)
 *   PrintLayout (./PrintLayout)                                — '#/print' route (renders the current print job)
 */
import { create } from 'zustand'
import type { ExportVisualDataRequest } from '../state/store'
import { useApp } from '../state/store'
import { toast } from '../app/ui/Notify'
import { capturePagesPng, printPagesPdf } from './capture'
import { buildHtml, buildPptx, type ExportedPage } from './builders'
import { buildXlsx, toCsv, type TabularData } from './data'

export { capturePagesPng, printPagesPdf, exportablePages } from './capture'
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

/** Export the report. Returns the written path (file or folder), or null when cancelled/failed. */
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

export async function exportReport(format: ReportExportFormat, opts: { path?: string; resolution?: number } = {}): Promise<string | null> {
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
  try {
    const meta = { reportName, exportedAt: new Date() }
    if (format === 'pdf') {
      const bytes = await printPagesPdf()
      await window.wbi.fs.writeFile(target, bytes)
    } else {
      // PNG files honor the resolution option; PowerPoint/HTML embed 2× images so they stay sharp when enlarged
      const resolution = format === 'png' ? (opts.resolution ?? usePngExportPrefs.getState().resolution) : 2
      const pages: ExportedPage[] = await capturePagesPng(undefined, { resolution })
      if (format === 'png') {
        await window.wbi.fs.mkdirp(target)
        for (let i = 0; i < pages.length; i++) await window.wbi.fs.writeFile(`${target}/${i + 1} - ${safeName(pages[i].displayName)}.png`, pages[i].png)
      } else if (format === 'pptx') {
        await window.wbi.fs.writeFile(target, await buildPptx(pages, meta))
      } else {
        await window.wbi.fs.writeFile(target, buildHtml(pages, meta))
      }
    }
    toast({ kind: 'success', title: 'Export complete', message: target, action: { label: 'Show in folder', onClick: () => void window.wbi.app.showItemInFolder(target!) } })
    return target
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
