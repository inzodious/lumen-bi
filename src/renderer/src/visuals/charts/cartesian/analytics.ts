/**
 * Analytics pane lines for cartesian charts: constant (Y and, on continuous X axes, X), average,
 * min, max, median, percentile and trend lines.
 *
 * PBIR objects: y1AxisReferenceLine / xAxisReferenceLine (constant), averageLine, minLine,
 * maxLine, medianLine, percentileLine, trend — each an array of entries (one per line,
 * `selector.id`), optionally with `selector.metadata` (queryRef) choosing the measure. Stats are
 * computed over the plotted values of that measure (all its legend series), like Power BI.
 * Formatting follows the theme schema: lineColor, transparency, style (incl. custom dashArray),
 * width, position (front/back), dataLabelShow/Text/Color/HorizontalPosition/VerticalPosition/
 * DisplayUnits/DecimalPoints, shadeShow/shadeRegion/shadeColor/shadeTransparency; trend:
 * combineSeries / useHighlightValues.
 */
import { decodeValue } from '@core/report/props'
import type { CategoricalData, Series } from '../../common/categorical'
import type { FormatReader } from '../../common/fmtProps'
import { formatWithUnits, resolveDisplayUnit } from '../../common/units'

export type AnalyticsKind = 'constant' | 'xConstant' | 'average' | 'min' | 'max' | 'median' | 'percentile' | 'trend'

export interface AnalyticsLine {
  kind: AnalyticsKind
  value: number
  secondary: boolean
  color: string
  opacity: number
  width: number
  style: string
  /** custom dash array (style 'custom') */
  dashArray?: string
  label?: string
  labelColor: string
  labelH: 'left' | 'right'
  labelV: 'above' | 'under'
  front: boolean
  /** shade the region before (below/left) or after (above/right) the line */
  shade?: { region: 'before' | 'after'; color: string; opacity: number }
  /** trend: [catIndex, value] endpoints */
  points?: Array<[number, number]>
  /** trend: series index whose axis/positions apply */
  si?: number
  c0?: number
  v0?: number
  c1?: number
  v1?: number
}

const OBJECTS: Array<[string, AnalyticsKind]> = [
  ['y1AxisReferenceLine', 'constant'],
  ['xAxisReferenceLine', 'xConstant'],
  ['averageLine', 'average'],
  ['minLine', 'min'],
  ['maxLine', 'max'],
  ['medianLine', 'median'],
  ['percentileLine', 'percentile'],
  ['trend', 'trend']
]

const KIND_NAME: Record<AnalyticsKind, string> = {
  constant: 'Constant line',
  xConstant: 'X-axis constant line',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  median: 'Median',
  percentile: 'Percentile',
  trend: 'Trend line'
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Least-squares fit y = a + b·x. */
export function linearFit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length
  if (!n) return { a: 0, b: 0 }
  const mx = xs.reduce((s, x) => s + x, 0) / n
  const my = ys.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const b = den ? num / den : 0
  return { a: my - b * mx, b }
}

export interface AnalyticsContext {
  percent: boolean
  /** is this series drawn on the secondary axis */
  isSecondary(s: Series): boolean
  /** continuous X axis: category index → numeric x value (null when categorical) */
  catNumber?: (ci: number) => number | null
}

export function computeAnalytics(fmt: FormatReader, data: CategoricalData, actx: AnalyticsContext | boolean): AnalyticsLine[] {
  const ax: AnalyticsContext = typeof actx === 'boolean' ? { percent: actx, isSecondary: () => false } : actx
  const out: AnalyticsLine[] = []
  for (const [obj, kind] of OBJECTS) {
    const entries = fmt.pc.objects?.[obj] ?? []
    for (const e of entries) {
      const p = e.properties ?? {}
      const dv = (k: string) => decodeValue(p[k], fmt.theme)
      if (dv('show') !== true) continue
      const meta = e.selector?.metadata
      const targets: Series[] = meta ? data.series.filter((s) => s.metadata === meta) : data.series.length ? data.series.filter((s) => s.metadata === data.series[0].metadata) : []
      if (!targets.length && kind !== 'constant' && kind !== 'xConstant') continue
      const useHl = dv('useHighlightValues') === true && data.hasHighlights
      const valsOf = (s: Series) => ((useHl ? s.highlights : undefined) ?? s.values).filter((v): v is number => v !== null && Number.isFinite(v))
      const vals = targets.flatMap(valsOf)
      const color = typeof dv('lineColor') === 'string' ? (dv('lineColor') as string) : '#605E5C'
      const transparency = Number(dv('transparency') ?? 0)
      const style = String(dv('style') ?? (kind === 'trend' ? 'dashed' : 'dashed'))
      const dashArray = style === 'custom' && typeof dv('dashArray') === 'string' ? (dv('dashArray') as string) : undefined
      const width = Number(dv('width') ?? dv('strokeWidth') ?? (kind === 'trend' ? 2 : 1)) || 1
      const front = String(dv('position') ?? 'front').toLowerCase() !== 'back' && String(dv('position') ?? '').toLowerCase() !== 'behind'
      const secondary = kind !== 'constant' && kind !== 'xConstant' && targets.length > 0 && ax.isSecondary(targets[0])
      const base = { secondary, color, opacity: 1 - transparency / 100, width, style, dashArray, front, labelColor: typeof dv('dataLabelColor') === 'string' ? (dv('dataLabelColor') as string) : color, labelH: (String(dv('dataLabelHorizontalPosition') ?? (kind === 'xConstant' ? 'right' : 'right')) === 'left' ? 'left' : 'right') as 'left' | 'right', labelV: (String(dv('dataLabelVerticalPosition') ?? 'above') === 'under' ? 'under' : 'above') as 'above' | 'under' }
      if (kind === 'trend') {
        if (ax.percent) continue
        const combine = dv('combineSeries') !== false
        const groups: Series[][] = combine ? [targets] : targets.map((t) => [t])
        for (const g of groups) {
          const xs: number[] = []
          const ys: number[] = []
          const nCat = data.categories.length
          for (let ci = 0; ci < nCat; ci++) {
            let sum = 0
            let any = false
            for (const s of g) {
              const v = (useHl ? s.highlights?.[ci] : undefined) ?? s.values[ci]
              if (v !== null && v !== undefined && Number.isFinite(v)) {
                sum += v
                any = true
              }
            }
            if (!any) continue
            const x = ax.catNumber?.(ci) ?? ci
            xs.push(x)
            ys.push(combine && g.length > 1 ? sum / g.filter((s) => s.values[ci] !== null).length : sum)
          }
          if (xs.length < 2) continue
          const { a, b } = linearFit(xs, ys)
          // endpoints in category-index space (positions are mapped by the renderer)
          const firstCi = data.categories.findIndex((_, ci) => g.some((s) => s.values[ci] !== null))
          let lastCi = -1
          for (let ci = nCat - 1; ci >= 0; ci--)
            if (g.some((s) => s.values[ci] !== null)) {
              lastCi = ci
              break
            }
          const xAt = (ci: number) => ax.catNumber?.(ci) ?? ci
          const si = data.series.indexOf(g[0])
          out.push({
            kind,
            value: NaN,
            ...base,
            color: typeof dv('lineColor') === 'string' ? (dv('lineColor') as string) : combine ? '#605E5C' : g[0].color,
            secondary: ax.isSecondary(g[0]),
            si,
            points: [
              [firstCi, a + b * xAt(firstCi)],
              [lastCi, a + b * xAt(lastCi)]
            ]
          })
        }
        continue
      }
      let value = NaN
      switch (kind) {
        case 'constant':
        case 'xConstant':
          value = Number(dv('value'))
          break
        case 'average':
          value = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
          break
        case 'min':
          value = vals.length ? Math.min(...vals) : NaN
          break
        case 'max':
          value = vals.length ? Math.max(...vals) : NaN
          break
        case 'median':
          value = quantile([...vals].sort((a, b) => a - b), 0.5)
          break
        case 'percentile': {
          const pct = Number(dv('percentile') ?? 50) / 100
          value = quantile([...vals].sort((a, b) => a - b), pct)
          break
        }
      }
      if (!Number.isFinite(value)) continue
      let label: string | undefined
      if (dv('dataLabelShow') === true) {
        const target = targets[0]
        const dec = dv('dataLabelDecimalPoints')
        const v =
          kind === 'xConstant' && data.categoryType === 'date'
            ? new Date(value).toISOString().slice(0, 10)
            : formatWithUnits(value, { unit: resolveDisplayUnit(Number(dv('dataLabelDisplayUnits') ?? 0), Math.abs(value)), decimals: typeof dec === 'number' ? dec : undefined, formatString: kind === 'xConstant' ? data.levels[0]?.formatString : target?.measure.formatString })
        const nm = typeof dv('displayName') === 'string' && dv('displayName') ? (dv('displayName') as string) : KIND_NAME[kind]
        const text = String(dv('dataLabelText') ?? 'Value')
        label = text === 'Name' ? nm : text === 'ValueAndName' ? `${nm} ${v}` : v
      }
      const shade = dv('shadeShow') === true && String(dv('shadeRegion') ?? 'none') !== 'none' ? { region: (String(dv('shadeRegion')) === 'before' ? 'before' : 'after') as 'before' | 'after', color: dv('shadeColorMatchStroke') === false && typeof dv('shadeColor') === 'string' ? (dv('shadeColor') as string) : color, opacity: 1 - Number(dv('shadeTransparency') ?? 70) / 100 } : undefined
      out.push({ kind, value, ...base, label, shade })
    }
  }
  return out
}
