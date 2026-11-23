/** Commands for sample data on empty visuals (View ▸ Sample data, the visual context menu, command search). */
import { reportSampleDataOn, setReportSampleData, setVisualSampleOff } from '@core/sample/spec'
import { useApp } from '../state/store'
import { findPage, findVisual } from './pbir'

export function reportShowsSampleData(): boolean {
  return reportSampleDataOn(useApp.getState().project?.report?.report)
}

/** Turn sample data on empty visuals on or off for the whole report (undoable). */
export function setSampleData(on: boolean): void {
  const app = useApp.getState()
  if (!app.project?.report) return
  app.mutateReport(on ? 'Show sample data' : 'Hide sample data', (r) => setReportSampleData(r.report, on))
}

export function toggleSampleData(): void {
  setSampleData(!reportShowsSampleData())
}

/** "Clear sample data" / "Show sample data" on one visual (undoable). */
export function setVisualSampleData(page: string, visual: string, show: boolean): void {
  useApp.getState().mutateReport(show ? 'Show sample data' : 'Clear sample data', (r) => {
    const v = findVisual(findPage(r, page), visual)
    if (v) setVisualSampleOff(v.json, !show)
  })
}
