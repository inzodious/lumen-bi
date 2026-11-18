/**
 * "Show as a table": the visual on top, the data behind it (VisualDefinition.getData) as a grid below —
 * Power BI's see-data layout.
 */
import { useMemo } from 'react'
import type { VisualDocument } from '@core/report/types'
import type { SQFilter } from '@core/report/sq'
import type { Scalar } from '@core/model/data'
import { getVisual } from '../visuals/registry'
import { useCanvasEnv } from './canvasEnv'
import { useVisualHost } from './host'
import { visualTypeOf } from './pbir'
import { VisualContainer } from './VisualContainer'

export function ShowAsTable(props: { visual: VisualDocument; filters: SQFilter[]; highlightFilters: SQFilter[]; size: { width: number; height: number } }) {
  const env = useCanvasEnv()
  const def = getVisual(visualTypeOf(props.visual))
  const ctx = useVisualHost(env, props.visual.name, props.filters, props.highlightFilters, !!def?.isSlicer)
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
        <VisualContainer visual={props.visual} rect={{ x: 0, y: 0, width: props.size.width, height: topH }} z={0} filters={props.filters} highlightFilters={props.highlightFilters} fill />
      </div>
      <div className="wbi-seedata-table">
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
