/**
 * Code visual: the root context of the HTML template. Besides the CodeData fields (rows, columns, totals, drill,
 * params…) it offers names that do not depend on which fields are bound, so starter templates work with any fields:
 *   measure1, measure2 …        the Values well's measures at the grand total (cells), in well order
 *   measureName1 …              their display names
 *   categoryName                the innermost Rows field shown
 *   rowCount, level, breadcrumb
 *   every value field by name   ("Total Sales" → its total)
 * and on each row: value1, value2 … (the row's measures in well order) and category (the row's innermost grouping cell).
 */
import type { CodeData } from './types'

export function templateContext(data: CodeData): Record<string, unknown> {
  const measures = data.columns.filter((c) => c.kind === 'value' && c.role === 'values')
  const groups = data.columns.filter((c) => c.role === 'rows')
  const rows = data.rows.map((r) => {
    const o: Record<string, unknown> = { ...r }
    measures.forEach((m, i) => (o[`value${i + 1}`] = r.cells[m.name]))
    for (let g = groups.length - 1; g >= 0; g--) {
      const cell = r.cells[groups[g].name]
      if (cell) {
        o.category = cell
        break
      }
    }
    return o
  })
  const root: Record<string, unknown> = {}
  for (const c of data.columns) if (c.kind === 'value' && data.totals[c.name]) root[c.name] = data.totals[c.name]
  Object.assign(root, data, {
    rows,
    level: data.drill.level,
    breadcrumb: data.drill.breadcrumb,
    rowCount: rows.length,
    categoryName: data.drill.levelName || groups[groups.length - 1]?.name || ''
  })
  measures.forEach((m, i) => {
    root[`measure${i + 1}`] = data.totals[m.name]
    root[`measureName${i + 1}`] = m.name
  })
  return root
}
