/**
 * Legacy card (`card`) and multi-row card (`multiRowCard`) models.
 *
 * Legacy card: one callout value (`labels` object — theme text class "callout": DIN 45pt by
 * default) with the field name underneath (`categoryLabels`). Power BI shrinks the callout font
 * so the text fits the visual's width (and height) — `fitFontSize` reproduces that.
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { ValueFormatter } from '@core/engine/api'
import type { ResolvedTheme } from '@core/report/theme'
import { formatWithUnits } from '../common/displayUnits'
import { ptToPx, type FontSpec } from '../common/textStyle'
import { CardProps, cardPrecision, cardTextDefaults, legacyAutoUnit, toPt } from './cardProps'
import { kpiIconFor } from '../tables/iconSet'

export interface LegacyCardModel {
  text: string
  raw: Scalar
  font: FontSpec
  category: { show: boolean; text: string; font: FontSpec; preserveWhitespace: boolean }
  wordWrap: boolean
  /** "Source spacing": keep runs of spaces / line breaks of text values */
  preserveWhitespace: boolean
  /** KPI status / trend measure: render this icon (cfIcons name) instead of the text, like PBI */
  kpiIcon?: string
}

export interface ResolvedValue {
  value: Scalar
  formatString?: string
  dataType?: DataType
  /** engine.describeField().kpi of the field (AS-style KPI parts) */
  kpi?: { part: string; statusGraphic?: string }
}

export function buildLegacyCardModel(visualJson: any, theme: ResolvedTheme, format: ValueFormatter, label: string, v: ResolvedValue | undefined): LegacyCardModel {
  const p = new CardProps(visualJson, theme)
  const callout = theme.textClasses?.callout ?? {}
  const raw = v?.value ?? null
  const unitsProp = p.optNum('labels', 'labelDisplayUnits') ?? 0
  const units = unitsProp === 0 ? legacyAutoUnit(raw) : unitsProp
  const precision = p.optNum('labels', 'labelPrecision')
  const text = raw === null ? '(Blank)' : formatWithUnits(raw, format, { formatString: v?.formatString, dataType: v?.dataType, units, precision: cardPrecision(units, precision, v?.formatString) })
  // category label = the "large and light" label class: label face, label size + 2pt (12pt on the classic theme)
  const categoryText = cardTextDefaults(theme).label
  return {
    text,
    raw,
    font: {
      family: p.str('labels', 'fontFamily', callout.fontFace ?? 'DIN'),
      size: toPt(p.get('labels', 'fontSize', callout.fontSize ?? 45), callout.fontSize ?? 45),
      color: p.color('labels', 'color', callout.color ?? theme.foreground),
      bold: p.bool('labels', 'bold', false),
      italic: p.bool('labels', 'italic', false),
      underline: p.bool('labels', 'underline', false)
    },
    category: {
      show: p.bool('categoryLabels', 'show', true),
      text: label,
      font: {
        family: p.str('categoryLabels', 'fontFamily', categoryText.family),
        size: toPt(p.get('categoryLabels', 'fontSize', categoryText.size), categoryText.size),
        color: p.color('categoryLabels', 'color', theme.foregroundNeutralSecondary),
        bold: p.bool('categoryLabels', 'bold', false),
        italic: p.bool('categoryLabels', 'italic', false),
        underline: p.bool('categoryLabels', 'underline', false)
      },
      preserveWhitespace: p.bool('categoryLabels', 'preserveWhitespace', false)
    },
    // theme '*' wildcard default: wordWrap true
    wordWrap: p.bool('wordWrap', 'show', true),
    preserveWhitespace: p.bool('labels', 'preserveWhitespace', false),
    kpiIcon: kpiIconFor(v?.kpi, raw)
  }
}

/**
 * Greedy word wrap of `text` into lines no wider than `width` px at `pt` points. Words longer than
 * the width stay on their own line (they're shrunk by the caller).
 */
export function wrapLines(text: string, pt: number, width: number, measure: (text: string, pt: number) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return [text]
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (cur && measure(next, pt) > width) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Legacy card callout sizing with "Word wrap" on: text with spaces may break into several lines;
 * the font shrinks (never grows) until the wrapped block fits `width` × `height`. Without spaces
 * (numbers) this is the same as `fitFontSize`.
 */
export function fitWrappedFontSize(text: string, requestedPt: number, width: number, height: number, measure: (text: string, pt: number) => number, minPt = 6): { pt: number; lines: string[] } {
  if (!/\s/.test(text.trim())) return { pt: fitFontSize(text, requestedPt, width, height, measure, minPt), lines: [text] }
  const avail = Math.max(1, width * 0.95)
  const lineH = (p: number) => ptToPx(p) * 1.25
  for (let pt = requestedPt; pt >= minPt; pt -= 0.25) {
    const lines = wrapLines(text, pt, avail, measure)
    const widest = Math.max(...lines.map((l) => measure(l, pt)))
    if (widest <= avail && lines.length * lineH(pt) <= height) return { pt, lines }
  }
  return { pt: minPt, lines: wrapLines(text, minPt, avail, measure) }
}

/**
 * Shrink a font (in points) so `text` fits `width` x `height` px. `measure(text, pt)` returns the
 * text width in px. Never grows beyond the requested size; never below `minPt`.
 */
export function fitFontSize(text: string, requestedPt: number, width: number, height: number, measure: (text: string, pt: number) => number, minPt = 6): number {
  let pt = requestedPt
  const w = measure(text, pt)
  const avail = Math.max(1, width * 0.95)
  if (w > avail) pt = (pt * avail) / w
  const lineH = (p: number) => ptToPx(p) * 1.25
  if (lineH(pt) > height) pt = height / 1.25 / (96 / 72)
  return Math.max(minPt, Math.min(requestedPt, Math.floor(pt * 4) / 4))
}

// ---------------------------------------------------------------------------------------------
// Multi-row card
// ---------------------------------------------------------------------------------------------

export interface MultiRowField {
  queryRef: string
  label: string
  isMeasure: boolean
}

export interface MultiRowItem {
  label: string
  text: string
  /** KPI status / trend icon (cfIcons name) shown instead of the text */
  kpiIcon?: string
}

export interface MultiRowCardRecord {
  key: string
  title?: string
  items: MultiRowItem[]
}

export interface MultiRowStyle {
  data: FontSpec
  category: { show: boolean; font: FontSpec }
  title: { show: boolean; font: FontSpec }
  card: {
    outline: 'None' | 'BottomOnly' | 'TopOnly' | 'LeftOnly' | 'RightOnly' | 'TopBottom' | 'LeftRight' | 'Frame'
    outlineColor: string
    outlineWeight: number
    barShow: boolean
    barColor: string
    barWeight: number
    padding: number
    background?: string
  }
}

export function multiRowStyle(visualJson: any, theme: ResolvedTheme): MultiRowStyle {
  const p = new CardProps(visualJson, theme)
  return {
    data: {
      family: p.str('dataLabels', 'fontFamily', 'Segoe UI'),
      // 10pt: measured on Learn's Store Sales / Competitive Marketing screenshots (glyph advance widths of
      // "$23,132,601" and "7 % ROI (Return on Investment)" match Segoe UI 10pt, category labels 9pt)
      size: toPt(p.get('dataLabels', 'fontSize', 10), 10),
      color: p.color('dataLabels', 'color', theme.foreground),
      bold: p.bool('dataLabels', 'bold', false),
      italic: p.bool('dataLabels', 'italic', false),
      underline: p.bool('dataLabels', 'underline', false)
    },
    category: {
      show: p.bool('categoryLabels', 'show', true),
      font: {
        family: p.str('categoryLabels', 'fontFamily', 'Segoe UI'),
        size: toPt(p.get('categoryLabels', 'fontSize', 9), 9),
        color: p.color('categoryLabels', 'color', theme.foregroundNeutralSecondary),
        bold: p.bool('categoryLabels', 'bold', false),
        italic: p.bool('categoryLabels', 'italic', false),
        underline: p.bool('categoryLabels', 'underline', false)
      }
    },
    title: {
      show: p.bool('cardTitle', 'show', true),
      font: {
        family: p.str('cardTitle', 'fontFamily', 'Segoe UI Semibold'),
        size: toPt(p.get('cardTitle', 'fontSize', 13), 13),
        color: p.color('cardTitle', 'color', theme.foreground),
        bold: p.bool('cardTitle', 'bold', false),
        italic: p.bool('cardTitle', 'italic', false),
        underline: p.bool('cardTitle', 'underline', false)
      }
    },
    card: {
      outline: multiRowOutline(p),
      outlineColor: p.color('card', 'outlineColor', '#E1DFDD'),
      outlineWeight: p.num('card', 'outlineWeight', 1),
      barShow: p.bool('card', 'barShow', true),
      barColor: p.color('card', 'barColor', theme.dataColors[0]),
      barWeight: p.num('card', 'barWeight', 2),
      padding: p.num('card', 'cardPadding', 5),
      background: (() => {
        const c = p.get<any>('card', 'cardBackground', undefined)
        return typeof c === 'string' ? c : undefined
      })()
    }
  }
}

const OUTLINE_NAMES: MultiRowStyle['card']['outline'][] = ['None', 'BottomOnly', 'TopOnly', 'LeftOnly', 'RightOnly', 'TopBottom', 'LeftRight', 'Frame']

/**
 * Card outline: the schema's `outlineStyle` (integer 0..7, same enum as the slicer outline) or the
 * older string `outline` ('BottomOnly'…). Default "Bottom only" (PBI multi-row card).
 */
function multiRowOutline(p: CardProps): MultiRowStyle['card']['outline'] {
  const n = p.optNum('card', 'outlineStyle')
  if (n !== undefined && OUTLINE_NAMES[n]) return OUTLINE_NAMES[n]
  const s = p.str('card', 'outline', 'BottomOnly').replace(/[^A-Za-z]/g, '').toLowerCase()
  return OUTLINE_NAMES.find((o) => o.toLowerCase() === s) ?? 'BottomOnly'
}

/**
 * Turn query rows into card records. `cells[r][f]` = resolved value of field f in row r.
 * When the first field is a column (text-like), it becomes the card title (PBI "Card title").
 */
export function buildMultiRowRecords(fields: MultiRowField[], cells: ResolvedValue[][], format: ValueFormatter, titleFromFirst: boolean): MultiRowCardRecord[] {
  const useTitle = titleFromFirst && fields.length > 1 && !fields[0].isMeasure
  return cells.map((row, r) => {
    const text = (i: number) => {
      const v = row[i]
      if (!v || v.value === null) return '(Blank)'
      // The multi-row card has no display-units option (theme schema `multiRowCard.dataLabels`): values use
      // their format string as-is (Store Sales sample, current PBI: "$23,132,601" for "\$#,0").
      return formatWithUnits(v.value, format, { formatString: v.formatString, dataType: v.dataType, units: 1 })
    }
    const items: MultiRowItem[] = []
    fields.forEach((f, i) => {
      if (useTitle && i === 0) return
      const kpiIcon = kpiIconFor(row[i]?.kpi, row[i]?.value)
      items.push(kpiIcon ? { label: f.label, text: text(i), kpiIcon } : { label: f.label, text: text(i) })
    })
    return { key: `${r}|${useTitle ? text(0) : ''}`, title: useTitle ? text(0) : undefined, items }
  })
}
