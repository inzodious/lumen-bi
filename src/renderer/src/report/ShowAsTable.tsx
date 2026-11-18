/**
 * "Show as a table": the visual on top, the data behind it (VisualDefinition.getData) as a grid below —
 * Power BI's see-data layout.
 *
 * "Show data point as a table" (`point`): the same layout restricted to one data point. Approximation: Power BI
 * lists the underlying records of the point; here the visual's own (summarized) data for the point is shown, and
 * the caption above the grid says which point it is.
 */
import { useMemo } from 'react'
import type { VisualDocument } from '@core/report/types'
import { identitiesToFilter, type DataPointIdentity, type SQFilter } from '@core/report/sq'
import type { Scalar } from '@core/model/data'
import { getVisual } from '../visuals/registry'
import { useCanvasEnv } from './canvasEnv'
import { useVisualHost } from './host'
import { visualTypeOf } from './pbir'
import { VisualContainer } from './VisualContainer'

export function ShowAsTable(props: { visual: VisualDocument; filters: SQFilter[]; highlightFilters: SQFilter[]; size: { width: number; height: number }; point?: DataPointIdentity }) {
  const env = useCanvasEnv()
  const def = getVisual(visualTypeOf(props.visual))
  const filters = useMemo(() => {
    const pf = props.point ? identitiesToFilter([props.point]) : undefined
    return pf ? [...props.filters, pf] : props.filters
  }, [props.filters, props.point])
  const ctx = useVisualHost(env, props.visual.name, filters, props.highlightFilters, !!def?.isSlicer)
  const pointText = props.point && ctx ? props.point.fields.map((f) => `${describeField(ctx, f.expr)} = ${f.value === null ? '(Blank)' : ctx.format(f.value)}`).join(', ') : undefined
  const data = useMemo(() => {
    if (!def?.getData || !ctx) return undefined
    try {
      return def.getData(props.visual, ctx)
    } catch (e) {
      return { columns: ['Error'], rows: [[e instanceof Error ? e.message : String(e)]] as Scalar[][] }
    }
  }, [def, ctx, props.visual])
  const topH = Math.round(props.size.height * 0.5)
  return (
    <div className="wbi-seedata">
      <div style={{ position: 'relative', height: topH }}>
        <VisualContainer visual={props.visual} rect={{ x: 0, y: 0, width: props.size.width, height: topH }} z={0} filters={filters} highlightFilters={props.highlightFilters} fill />
      </div>
      <div className="wbi-seedata-table">
        {pointText ? <div className="wbi-seedata-point">Data point: {pointText}</div> : null}
        {!data ? (
          <div className="wbi-seedata-empty">This visual doesn't expose its data.</div>
        ) : (
          <table>
            <thead>
              <tr>
                {data.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 5000).map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={typeof v === 'number' ? 'num' : undefined}>
                      {v === null ? '' : ctx ? ctx.format(v, typeof v === 'number' ? (Number.isInteger(v) ? '#,0' : '#,0.00') : undefined) : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function describeField(ctx: NonNullable<ReturnType<typeof useVisualHost>>, expr: DataPointIdentity['fields'][number]['expr']): string {
  try {
    return ctx.engine.describeField(expr)?.displayName ?? 'Value'
  } catch {
    return 'Value'
  }
}
