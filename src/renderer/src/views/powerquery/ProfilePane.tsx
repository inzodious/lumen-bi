/**
 * View ▸ Column profile: bottom pane for the selected column with "Column statistics" (Count, Error,
 * Empty, Distinct, Unique, Empty string, Min, Max, and Average / Standard deviation / Zero / NaN /
 * Odd / Even for numbers) and "Value distribution" (bar per value, most frequent first).
 * Computed over the preview rows (see logic/profile.ts — approximation documented there).
 */
import type { PreviewCell } from '@core/m/engine.ts'
import { cellText } from './logic/format'
import { columnDistribution, columnStats, columnValues } from './logic/profile'
import { formatNumber } from './logic/format'
import type { TablePreviewData } from './Grid'
import { usePq } from './pqStore'

function statRows(values: PreviewCell[], type: string): Array<[string, string]> {
  const s = columnStats(values, type)
  const v = (x: PreviewCell) => (x === null ? '' : cellText(x, type))
  const rows: Array<[string, string]> = [
    ['Count', String(s.total)],
    ['Error', String(s.error)],
    ['Empty', String(s.empty)],
    ['Distinct', String(s.distinct)],
    ['Unique', String(s.unique)],
    ['Empty string', String(s.emptyString)],
    ['Min', v(s.min)],
    ['Max', v(s.max)]
  ]
  if (s.average !== undefined || s.zero !== undefined) {
    rows.push(['Average', s.average === undefined ? '' : formatNumber(s.average)])
    rows.push(['Standard deviation', s.stdDev === undefined ? '' : formatNumber(s.stdDev)])
    rows.push(['Zero', String(s.zero ?? 0)], ['NaN', String(s.nan ?? 0)], ['Even', String(s.even ?? 0)], ['Odd', String(s.odd ?? 0)])
  }
  return rows
}

export function ProfilePane({ data }: { data: TablePreviewData }) {
  const selected = usePq((s) => s.selectedCols)
  const col = data.columns.find((c) => c.name === selected[0])
  if (!col)
    return (
      <div className="wbi-pq-profile">
        <div className="wbi-pq-profile__hint">Select a column to see its profile.</div>
      </div>
    )
  const values = columnValues(data.rows, data.columns.indexOf(col))
  const dist = columnDistribution(values)
  const bars = dist.values.slice(0, 60)
  const max = bars[0]?.count ?? 1
  return (
    <div className="wbi-pq-profile">
      <div className="wbi-pq-profile__card wbi-pq-profile__stats">
        <div className="wbi-pq-profile__title">Column statistics</div>
        <table>
          <tbody>
            {statRows(values, col.type).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="wbi-selectable">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wbi-pq-profile__card wbi-pq-profile__dist">
        <div className="wbi-pq-profile__title">Value distribution</div>
        <div className="wbi-pq-profile__chart">
          {bars.map((b, i) => {
            const label = b.value === null ? '(null)' : b.value === '' ? '(blank)' : cellText(b.value, col.type)
            return (
              <div key={i} className="wbi-pq-profile__col" title={`${label}: ${b.count}`}>
                <div className="wbi-pq-profile__barwrap">
                  <span className="wbi-pq-profile__count">{b.count}</span>
                  <div className="wbi-pq-profile__bar" style={{ height: `${(b.count / max) * 100}%` }} />
                </div>
                <div className="wbi-pq-profile__label">{label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
