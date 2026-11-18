/**
 * Analytics-pane reference lines for the scatter (X and Y measures) and waterfall (Y) charts.
 *
 * PBIR objects (one entry per line, keyed by `selector.id`):
 *   xAxisReferenceLine / y1AxisReferenceLine  — constant lines (`value`)
 *   minLine / maxLine / averageLine / medianLine / percentileLine — statistics over the measure
 *     chosen by `selector.metadata` (the X or Y queryRef; Y when absent)
 * Line properties: show, displayName, lineColor, transparency, style (solid|dashed|dotted|custom +
 * dashArray), width, position (front|back), dataLabelShow, dataLabelText (Value|Name|ValueAndName),
 * dataLabelColor, dataLabelHorizontalPosition (left|right), dataLabelVerticalPosition (above|under),
 * dataLabelDisplayUnits, dataLabelDecimalPoints, shadeShow, shadeRegion (before|after), shadeColor,
 * shadeColorMatchStroke, shadeTransparency.
 */
import type { ValueFormatter } from '@core/engine/api'
import { decodeValue, type ObjectEntry } from '@core/report/props'
import type { FormatReader } from '../../common/fmtProps'
import { fontWeightOf, ptToPx, type FontSpec } from '../../common/text'
import { formatWithUnits, resolveDisplayUnit } from '../../common/units'
import { statValue, type StatKind } from './scatterModel'

export type RefLineKind = 'constant' | StatKind

export interface RefLine {
  key: string
  object: string
  kind: RefLineKind
  axis: 'x' | 'y'
  value: number
  name: string
  color: string
  opacity: number
  width: number
  dash?: string
  front: boolean
  label?: { text: string; color: string; font: FontSpec; horizontal: 'left' | 'right'; vertical: 'above' | 'under' }
  shade?: { region: 'before' | 'after'; color: string; opacity: number }
}

export interface LineMeasure {
  queryRef: string
  axis: 'x' | 'y'
  values: number[]
  formatString?: string
}

export interface RefLineObject {
  object: string
  kind: RefLineKind
  /** axis of a constant line */
  axis?: 'x' | 'y'
}

export const SCATTER_LINE_OBJECTS: RefLineObject[] = [
  { object: 'xAxisReferenceLine', kind: 'constant', axis: 'x' },
  { object: 'y1AxisReferenceLine', kind: 'constant', axis: 'y' },
  { object: 'minLine', kind: 'min' },
  { object: 'maxLine', kind: 'max' },
  { object: 'averageLine', kind: 'average' },
  { object: 'medianLine', kind: 'median' },
  { object: 'percentileLine', kind: 'percentile' }
]

export const DEFAULT_LINE_COLOR = '#605E5C'

/** SVG dash array for a PBI line style. */
export function dashFor(style: string | undefined, custom?: string): string | undefined {
  switch (style) {
    case 'solid':
      return undefined
    case 'dotted':
      return '1.5 3'
    case 'custom':
      return custom && /^[\d.\s,]+$/.test(custom) ? custom.replace(/[\s,]+/g, ' ').trim() : '6 4'
    default:
      return '6 4'
  }
}

const TITLES: Record<RefLineKind, string> = {
  constant: 'Constant line',
  min: 'Min line',
  max: 'Max line',
  average: 'Average line',
  median: 'Median line',
  percentile: 'Percentile line'
}

export function readReferenceLines(fmt: FormatReader, objects: RefLineObject[], measures: LineMeasure[], format?: ValueFormatter): RefLine[] {
  const out: RefLine[] = []
  const dec = (e: ObjectEntry, p: string): any => decodeValue(e.properties?.[p], fmt.theme)
  const numOf = (v: any): number | undefined => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : undefined
  }
  for (const spec of objects) {
    const entries = fmt.pc.objects?.[spec.object] ?? []
    entries.forEach((e, ei) => {
      if (dec(e, 'show') !== true) return
      let axis: 'x' | 'y' = spec.axis ?? 'y'
      let value = NaN
      let formatString: string | undefined
      if (spec.kind === 'constant') {
        // an unset constant-line value is 0 in Power BI (the format pane shows 0)
        value = numOf(dec(e, 'value')) ?? 0
        formatString = measures.find((m) => m.axis === axis)?.formatString
      } else {
        const m = measures.find((x) => x.queryRef === e.selector?.metadata) ?? measures.find((x) => x.axis === 'y') ?? measures[0]
        if (!m) return
        axis = m.axis
        formatString = m.formatString
        value = statValue(spec.kind, m.values, numOf(dec(e, 'percentile')) ?? 50)
      }
      if (!Number.isFinite(value)) return
      const colorRaw = dec(e, 'lineColor')
      const color = typeof colorRaw === 'string' ? colorRaw : DEFAULT_LINE_COLOR
      const transparency = numOf(dec(e, 'transparency')) ?? 0
      const nameRaw = dec(e, 'displayName')
      const name = typeof nameRaw === 'string' && nameRaw ? nameRaw : `${TITLES[spec.kind]} ${e.selector?.id ?? ei + 1}`
      const line: RefLine = {
        key: `${spec.object}|${e.selector?.id ?? ei}`,
        object: spec.object,
        kind: spec.kind,
        axis,
        value,
        name,
        color,
        opacity: 1 - Math.max(0, Math.min(100, transparency)) / 100,
        width: Math.max(0.5, numOf(dec(e, 'width')) ?? numOf(dec(e, 'strokeWidth')) ?? 1),
        dash: dashFor(String(dec(e, 'style') ?? 'dashed'), typeof dec(e, 'dashArray') === 'string' ? dec(e, 'dashArray') : undefined),
        front: !/^(back|behind)$/i.test(String(dec(e, 'position') ?? 'front'))
      }
      if (dec(e, 'dataLabelShow') === true) {
        const units = numOf(dec(e, 'dataLabelDisplayUnits')) ?? 0
        const decimals = numOf(dec(e, 'dataLabelDecimalPoints'))
        const v = formatWithUnits(value, { unit: resolveDisplayUnit(units, Math.abs(value)), decimals, formatString, format })
        const textKind = String(dec(e, 'dataLabelText') ?? 'Value')
        const text = textKind === 'Name' ? name : textKind === 'ValueAndName' ? `${name} ${v}` : v
        const lc = dec(e, 'dataLabelColor')
        const family = String(dec(e, 'fontFamily') ?? 'Segoe UI')
        line.label = {
          text,
          color: typeof lc === 'string' ? lc : color,
          font: { size: ptToPx(numOf(dec(e, 'fontSize')) ?? 9), family, weight: fontWeightOf(family, dec(e, 'bold') === true) },
          horizontal: dec(e, 'dataLabelHorizontalPosition') === 'right' ? 'right' : 'left',
          vertical: dec(e, 'dataLabelVerticalPosition') === 'under' ? 'under' : 'above'
        }
      }
      const region = String(dec(e, 'shadeRegion') ?? 'none')
      if (dec(e, 'shadeShow') === true && (region === 'before' || region === 'after')) {
        const sc = dec(e, 'shadeColor')
        const match = dec(e, 'shadeColorMatchStroke') !== false
        line.shade = {
          region,
          color: !match && typeof sc === 'string' ? sc : color,
          opacity: 1 - Math.max(0, Math.min(100, numOf(dec(e, 'shadeTransparency')) ?? 60)) / 100
        }
      }
      out.push(line)
    })
  }
  return out
}
