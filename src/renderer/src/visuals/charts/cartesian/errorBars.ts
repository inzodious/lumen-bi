/**
 * Error bars (Analytics pane ▸ Error bars) for line / column / bar charts.
 *
 * PBIR: `objects.error[]`, one entry per measure (`selector.metadata` = the measure's queryRef),
 * `enabled` toggles it, formatting uses the documented theme properties (barShow, barColor,
 * barMatchSeriesColor, barWidth, barBorderSize/Color, markerShow, markerShape, markerSize,
 * shadeShow, shadeBandStyle, shadeColor, shadeTransparency, tooltipShow, tooltipFormat).
 *
 * The data-bound bounds aren't part of the published theme schema. We read them from
 * `errorRange.explicit.{upperBound,lowerBound,isRelative}` (the shape Desktop writes) and also
 * accept `upperBound` / `lowerBound` directly on the properties; each bound is a field
 * expression (`{ expr: Measure | Aggregation }`). Relative bounds are offsets from the value.
 */
import { decodeValue } from '@core/report/props'
import type { FormatReader } from '../../common/fmtProps'
import type { Series } from '../../common/categorical'

export interface ErrorBarSpec {
  metadata?: string
  upper?: any
  lower?: any
  relative: boolean
  /** relative bounds expressed as a percentage of the value */
  percent: boolean
  barShow: boolean
  barColor?: string
  barMatchSeriesColor: boolean
  barWidth: number
  barBorderSize: number
  barBorderColor: string
  markerShow: boolean
  markerShape: string
  markerSize: number
  shadeShow: boolean
  shadeBandStyle: 'fill' | 'line' | 'fillLine'
  shadeColor?: string
  shadeMatchSeriesColor: boolean
  shadeTransparency: number
  tooltipShow: boolean
  tooltipFormat: 'absolute' | 'relativeNumeric' | 'relativePercentage' | 'range'
}

function fieldOf(v: any): any {
  if (!v) return undefined
  const e = v.expr ?? v
  return e && (e.Measure || e.Aggregation || e.Column) ? e : undefined
}

export function readErrorBars(fmt: FormatReader): ErrorBarSpec[] {
  const out: ErrorBarSpec[] = []
  for (const e of fmt.pc.objects?.error ?? []) {
    const p = e.properties ?? {}
    const dv = (k: string) => decodeValue(p[k], fmt.theme)
    if (dv('enabled') !== true) continue
    const range = p.errorRange?.explicit ?? p.errorRange ?? {}
    const upper = fieldOf(range.upperBound) ?? fieldOf(p.upperBound)
    const lower = fieldOf(range.lowerBound) ?? fieldOf(p.lowerBound)
    if (!upper && !lower) continue
    const rel = decodeValue(range.isRelative, fmt.theme) ?? dv('isRelative')
    const relKind = String(decodeValue(range.relationship, fmt.theme) ?? dv('relationship') ?? '')
    const str = (k: string, d: string) => {
      const v = dv(k)
      return typeof v === 'string' && v ? v : d
    }
    const num = (k: string, d: number) => {
      const v = Number(dv(k))
      return Number.isFinite(v) ? v : d
    }
    const bool = (k: string, d: boolean) => {
      const v = dv(k)
      return typeof v === 'boolean' ? v : d
    }
    const color = (k: string) => {
      const v = dv(k)
      return typeof v === 'string' && v ? v : undefined
    }
    out.push({
      metadata: e.selector?.metadata,
      upper,
      lower,
      relative: rel === true || /relative/i.test(relKind),
      percent: /percent/i.test(relKind),
      barShow: bool('barShow', true),
      barColor: color('barColor'),
      barMatchSeriesColor: bool('barMatchSeriesColor', false),
      barWidth: num('barWidth', 1),
      barBorderSize: num('barBorderSize', 0),
      barBorderColor: color('barBorderColor') ?? '#FFFFFF',
      markerShow: bool('markerShow', true),
      markerShape: str('markerShape', 'shortDash'),
      markerSize: num('markerSize', 8),
      shadeShow: bool('shadeShow', false),
      shadeBandStyle: str('shadeBandStyle', 'fill') as ErrorBarSpec['shadeBandStyle'],
      shadeColor: color('shadeColor'),
      shadeMatchSeriesColor: bool('shadeMatchSeriesColor', true),
      shadeTransparency: num('shadeTransparency', 80),
      tooltipShow: bool('tooltipShow', true),
      tooltipFormat: str('tooltipFormat', 'absolute') as ErrorBarSpec['tooltipFormat']
    })
  }
  return out
}

/** Absolute [low, high] for a point given the queried bound values. */
export function errorBounds(spec: ErrorBarSpec, value: number, upperRaw: unknown, lowerRaw: unknown): [number | null, number | null] {
  const u = typeof upperRaw === 'number' && Number.isFinite(upperRaw) ? upperRaw : null
  const l = typeof lowerRaw === 'number' && Number.isFinite(lowerRaw) ? lowerRaw : null
  if (!spec.relative) return [l, u]
  const f = (d: number) => (spec.percent ? (value * d) / (Math.abs(d) > 1 ? 100 : 1) : d)
  return [l === null ? null : value - Math.abs(f(l)), u === null ? null : value + Math.abs(f(u))]
}

/** Error-bar spec applying to a series (measure-specific entry, else the first wildcard entry). */
export function errorSpecFor(specs: ErrorBarSpec[], s: Series): ErrorBarSpec | undefined {
  return specs.find((e) => e.metadata === s.metadata) ?? specs.find((e) => !e.metadata)
}

/** Tooltip text for an error range. */
export function errorTooltip(spec: ErrorBarSpec, value: number, lo: number | null, hi: number | null, fmtNum: (v: number) => string): string | undefined {
  if (!spec.tooltipShow || (lo === null && hi === null)) return undefined
  switch (spec.tooltipFormat) {
    case 'relativeNumeric':
      return `${hi !== null ? '+' + fmtNum(hi - value) : ''}${lo !== null && hi !== null ? ' / ' : ''}${lo !== null ? '-' + fmtNum(value - lo) : ''}`
    case 'relativePercentage': {
      const pct = (d: number) => (value ? ((d / Math.abs(value)) * 100).toFixed(1) + '%' : '–')
      return `${hi !== null ? '+' + pct(hi - value) : ''}${lo !== null && hi !== null ? ' / ' : ''}${lo !== null ? '-' + pct(value - lo) : ''}`
    }
    case 'range':
      return `${lo !== null ? fmtNum(lo) : '…'} – ${hi !== null ? fmtNum(hi) : '…'}`
    default:
      return `${hi !== null ? 'Upper: ' + fmtNum(hi) : ''}${lo !== null && hi !== null ? ', ' : ''}${lo !== null ? 'Lower: ' + fmtNum(lo) : ''}`
  }
}
