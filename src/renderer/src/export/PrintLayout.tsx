/**
 * '#/print' route (rendered by the App without any shell chrome). Shows the current print job using
 * the report canvas' non-interactive PrintLayout:
 *   - mode 'pdf'     → every job page at native size, each in its own named @page box (vector PDF)
 *   - mode 'capture' → one page at native size, CSS-scaled to fit the window, for PNG capture
 * The job's onReady fires once every visual has rendered.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { PrintLayout as CanvasPrintLayout } from '../report'

export interface PrintJob {
  mode: 'pdf' | 'capture'
  /** page names, in order */
  pages: string[]
  /** capture mode: CSS scale applied so the page fits the window */
  scale: number
  /** unique per job so the canvas layout remounts and reports readiness again */
  key: number
  onReady(): void
}

export const usePrintJob = create<{ job: PrintJob | null; set(job: PrintJob | null): void }>((set) => ({
  job: null,
  set: (job) => set({ job })
}))

/** Class of the element wrapping a captured page (capture mode). */
export const CAPTURE_ROOT_CLASS = 'wbi-export-capture'

export function PrintLayout() {
  const job = usePrintJob((s) => s.job)
  useEffect(() => {
    // a bare '#/print' (no job, e.g. headless capture of the route) still signals readiness
    if (!job) document.body.dataset.wbiReady = '1'
  }, [job])
  if (!job) return <div style={{ padding: 24, fontFamily: 'var(--wbi-font)', color: '#605E5C' }}>Nothing to print.</div>
  if (job.mode === 'pdf') {
    return (
      <div className="wbi-export-print" style={{ background: '#fff' }}>
        <CanvasPrintLayout key={job.key} pages={job.pages} onReady={job.onReady} />
      </div>
    )
  }
  return (
    <div className={CAPTURE_ROOT_CLASS} style={{ position: 'fixed', left: 0, top: 0, transformOrigin: '0 0', transform: job.scale !== 1 ? `scale(${job.scale})` : undefined, background: '#fff' }}>
      <CanvasPrintLayout key={job.key} pages={job.pages} onReady={job.onReady} />
    </div>
  )
}
