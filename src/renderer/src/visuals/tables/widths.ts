/**
 * Column auto-sizing (PBI "Auto-size width" / "Column adjustment"): widths from measured header
 * and value text, explicit per-column widths (columnWidth selector), default width for the
 * fixed-width mode, and grow-to-fit distribution of spare space.
 */
import { measureText, type FontSpec } from '../common/textStyle'

export const CELL_PAD_X = 6

export interface WidthInput {
  header: string
  headerFont: FontSpec
  texts: string[]
  valueFont: FontSpec
  explicit?: number
  /** extra px (sort caret, expand buttons + indentation, icons) */
  extra?: number
  /** minimum content width (sparklines: PBI's default sparkline width) */
  minWidth?: number
}

export interface WidthOptions {
  autoSize: boolean
  defaultWidth?: number
  wrapHeader: boolean
  available: number
  adjustment: 'growToFit' | 'fixedWidth' | 'fitToContent' | 'auto'
  /** cap for auto widths */
  max?: number
}

/** Max width of up to `sample` texts (measured with canvas when available). */
export function maxTextWidth(texts: string[], font: FontSpec, sample = 400): number {
  let best = 0
  const seen = new Set<string>()
  const n = Math.min(texts.length, sample)
  // long strings first: cheap way to make sure the widest value is measured
  const pool = texts.length > n ? [...texts].sort((a, b) => b.length - a.length).slice(0, n) : texts
  for (const t of pool) {
    if (!t || seen.has(t)) continue
    seen.add(t)
    const w = measureText(t, font)
    if (w > best) best = w
  }
  return best
}

export function computeWidths(cols: WidthInput[], opts: WidthOptions): number[] {
  const max = opts.max ?? Math.max(320, opts.available * 0.6)
  const widths = cols.map((c) => {
    if (c.explicit !== undefined) return c.explicit
    // "Fixed width" column adjustment uses the default width. With "Auto-size width" off and no saved
    // width PBI keeps the width the column got when it was added, i.e. its content width — measure it.
    if (opts.adjustment === 'fixedWidth' || (!opts.autoSize && opts.defaultWidth !== undefined)) return opts.defaultWidth ?? 120
    // fitToContent / growToFit / auto: measured content (PBI samples the first 50 rows; callers pass those)
    const valueW = maxTextWidth(c.texts, c.valueFont)
    const headerFull = measureText(c.header, c.headerFont)
    const longestWord = Math.max(0, ...c.header.split(/\s+/).map((w) => measureText(w, c.headerFont)))
    const headerW = opts.wrapHeader ? Math.max(longestWord, Math.min(headerFull, Math.max(valueW, 90))) : headerFull
    return Math.ceil(Math.min(max, Math.max(valueW, headerW, c.minWidth ?? 0) + 2 * CELL_PAD_X + (c.extra ?? 0)) + 1)
  })
  if (opts.adjustment === 'growToFit' || opts.adjustment === 'auto') {
    const total = widths.reduce((a, b) => a + b, 0)
    if (opts.adjustment === 'growToFit' && total < opts.available && total > 0) {
      // Learn: "Any leftover horizontal space is distributed evenly to each column."
      const auto = widths.map((_, i) => i).filter((i) => cols[i].explicit === undefined)
      if (!auto.length) return widths
      const extra = Math.floor((opts.available - total) / auto.length)
      return widths.map((w, i) => (cols[i].explicit !== undefined ? w : w + extra))
    }
  }
  return widths
}
