/**
 * Pure layout helpers for cartesian axes: category label fitting (horizontal / word-wrapped /
 * rotated with label skipping, like Power BI), value-axis tick formatting with display units,
 * and the PBI title text conventions.
 */
import { ellipsize, lineHeight, measureText, wrapText, type FontSpec } from '../../common/text'
import { decimalsForStep, formatWithUnits, resolveDisplayUnit } from '../../common/units'
import type { ValueAxisModel } from '../../common/scale'
import type { ValueFormatter } from '@core/engine/api'

export interface CategoryLabelLayout {
  mode: 'horizontal' | 'rotated' | 'none'
  /** lines per label (index aligned with input); empty array = label skipped */
  lines: string[][]
  /** height (vertical charts) the labels need */
  size: number
  /** show every k-th label */
  every: number
}

const SIN45 = Math.SQRT1_2

/**
 * Fit category labels under columns. `step` = px per category, `maxSize` = the max-margin budget.
 * PBI: single line when it fits; else word-wrap (≤ 2 lines) when bands are wide enough; else
 * rotate 45° and ellipsize to the margin budget, skipping labels when they would overlap.
 */
export function layoutCategoryLabels(labels: string[], step: number, font: FontSpec, maxSize: number, allowWrap = true): CategoryLabelLayout {
  const lh = lineHeight(font)
  if (!labels.length) return { mode: 'none', lines: [], size: 0, every: 1 }
  const avail = Math.max(0, step - 4)
  const widths = labels.map((l) => measureText(l, font))
  const maxW = Math.max(...widths)
  if (maxW <= avail) return { mode: 'horizontal', lines: labels.map((l) => [l]), size: lh + 4, every: 1 }
  if (allowWrap && avail >= 32) {
    const wrapped = labels.map((l) => wrapText(l, avail, font, 2))
    const truncatedTooMuch = wrapped.some((ls, i) => ls.join(' ').replace(/…$/, '').length < Math.min(labels[i].length, 6))
    if (!truncatedTooMuch) {
      const nLines = Math.max(...wrapped.map((w) => w.length))
      return { mode: 'horizontal', lines: wrapped, size: nLines * lh + 4, every: 1 }
    }
  }
  // rotated 45°
  const every = Math.max(1, Math.ceil((lh * 1.15) / SIN45 / Math.max(1, step)))
  const maxLen = Math.max(lh, (maxSize - lh * SIN45 - 4) / SIN45)
  const lines = labels.map((l, i) => (i % every === 0 ? [ellipsize(l, maxLen, font)] : []))
  const longest = Math.max(...lines.map((ls) => (ls[0] ? measureText(ls[0], font) : 0)))
  return { mode: 'rotated', lines, size: Math.min(maxSize, longest * SIN45 + lh * SIN45 + 6), every }
}

/** Fit labels left of horizontal bars: ellipsize to the margin, wrap to 2 lines when bars are tall enough. */
export function layoutBarLabels(labels: string[], step: number, font: FontSpec, maxWidth: number): { lines: string[][]; width: number; every: number } {
  const lh = lineHeight(font)
  const every = Math.max(1, Math.ceil(lh / Math.max(1, step)))
  const natural = Math.max(0, ...labels.map((l) => measureText(l, font)))
  const width = Math.min(natural, maxWidth)
  const twoLines = step >= lh * 2 + 2
  const lines = labels.map((l, i) => (i % every !== 0 ? [] : twoLines && measureText(l, font) > width ? wrapText(l, width, font, 2) : [ellipsize(l, width, font)]))
  const used = Math.max(0, ...lines.map((ls) => Math.max(0, ...ls.map((x) => measureText(x, font)))))
  return { lines, width: Math.ceil(used) + 6, every }
}

export interface AxisNumberFormat {
  displayUnits?: number
  precision?: number
  formatString?: string
  format?: ValueFormatter
  percent?: boolean
}

/** Tick label formatter: unit from the largest |tick| (PBI auto), decimals from the tick step. */
export function valueTickFormatter(model: ValueAxisModel, f: AxisNumberFormat): (v: number) => string {
  if (f.percent) {
    const d = f.precision ?? decimalsForStep(model.step * 100)
    return (v) => formatWithUnits(v, { unit: 1, decimals: d, formatString: '0%' })
  }
  const ref = Math.max(...model.ticks.map((t) => Math.abs(t)), 0)
  const unit = resolveDisplayUnit(f.displayUnits, ref)
  const pct = /%/.test((f.formatString ?? '').replace(/"[^"]*"|\\./g, ''))
  if (pct) {
    const d = f.precision ?? decimalsForStep(model.step * 100)
    // PBI's axis drops the space of "0.00 %" style formats: "-40%"
    return (v) => formatWithUnits(v, { unit: 1, decimals: d, formatString: f.formatString }).replace(/\s+%/, '%')
  }
  // log axes span decades: each tick gets its own unit (10, 100, 1K, 10K…)
  if (model.scale === 'log')
    return (v) => {
      const u = resolveDisplayUnit(f.displayUnits, v)
      return formatWithUnits(v, { unit: u, decimals: f.precision ?? (Number.isInteger(v / u) ? 0 : decimalsForStep(v / u)), formatString: f.formatString })
    }
  // Format strings that scale by themselves ("$#,##0,,.0M": trailing thousands commas) already
  // produce their own units — PBI then formats ticks with the format string as-is.
  if (f.precision === undefined && hasScalingCommas(f.formatString)) return (v) => formatWithUnits(v, { unit: 1, formatString: f.formatString, format: f.format })
  const d = f.precision ?? decimalsForStep(model.step / unit)
  return (v) => formatWithUnits(v, { unit, decimals: d, formatString: f.formatString, trimAuto: false })
}

/** PBI default value-axis title: "A", "A and B", "A, B and C". */
export function joinTitles(names: string[]): string {
  const u = [...new Set(names.filter(Boolean))]
  if (u.length <= 1) return u[0] ?? ''
  return u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1]
}

/** Largest label width (for value-axis margins). */
export function maxLabelWidth(labels: string[], font: FontSpec): number {
  return labels.reduce((m, l) => Math.max(m, measureText(l, font)), 0)
}

/** "#,##0,," / "0,.0" style scaling commas (a comma right after the last integer digit). */
export function hasScalingCommas(fmt: string | undefined): boolean {
  if (!fmt) return false
  const first = fmt.replace(/"[^"]*"|\\./g, '').split(';')[0]
  return /[0#],+(?=\.|[^0#,.]|$)/.test(first)
}
