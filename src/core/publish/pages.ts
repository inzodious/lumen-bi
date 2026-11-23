import type { ReportDocument } from '../report/types'

/** Pages a viewer can navigate to, in report order: hidden pages (tooltip and drillthrough targets) are left out. */
export function orderedPageList(report: ReportDocument): Array<{ name: string; displayName: string }> {
  const byName = new Map(report.pages.map((p) => [p.name, p]))
  const order = [...(report.pagesMeta?.pageOrder ?? []), ...report.pages.map((p) => p.name)]
  const seen = new Set<string>()
  const out: Array<{ name: string; displayName: string }> = []
  for (const n of order) {
    const p = byName.get(n)
    if (!p || seen.has(n)) continue
    seen.add(n)
    if (p.json?.visibility === 'HiddenInViewMode') continue
    out.push({ name: p.name, displayName: String(p.json?.displayName ?? p.name) })
  }
  return out
}
