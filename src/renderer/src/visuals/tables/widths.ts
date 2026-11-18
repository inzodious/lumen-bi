/**
 * Column sizing of the table and matrix visuals (Power BI: Format ▸ Visual ▸ Layout ▸ Column width).
 *
 * Auto-size behavior (`columnHeaders.columnAdjustment`):
 *  - Fit to content: every column is as wide as its header and values need (first 50 rows);
 *  - Grow to fit: as Fit to content, then the leftover horizontal space of the visual is shared by the
 *    columns (Learn: "distributed evenly to each column");
 *  - Fixed width: every column uses the Default width (`columnHeaders.defaultColumnWidth`).
 * A custom width (a `columnWidth` object entry, written by dragging a header edge, by "Set column width" or
 * from the Custom widths inputs) overrides the behavior for that column in every mode.
 *
 * Approximations (Microsoft does not publish them): Grow to fit leaves columns with a custom width alone and
 * shares the leftover between the other columns; the Fixed width default is 120 px when no Default width is
 * set; a legacy "Auto-size width: off" visual keeps the content width for a column without a stored width.
 */
import type { CSSProperties } from 'react'
import { measureText, type FontSpec } from '../common/textStyle'

/**
 * Horizontal padding of table / matrix cells (headers, row headers, values), px per side. Not published by Microsoft;
 * inferred from Power BI Desktop renders of two tables (10pt text): a header exactly 8.6px narrower than its stored
 * column width (and dates 11px narrower) stay on one line, while a header 3.5px narrower than its column wraps — so
 * the padding is between 2 and 4px per side; 3px is used.
 */
export const CELL_PAD_X = 3

/**
 * Word wrap in table / matrix cells: lines break at spaces only; a single word wider than the column is clipped at the
 * cell's padding, never split mid-word (Power BI behaviour: "word wrap" does not break words).
 */
export const WRAP_TEXT: CSSProperties = { whiteSpace: 'normal', overflowWrap: 'normal', wordBreak: 'normal', overflow: 'hidden', minWidth: 0 }
/** narrowest width a column can be dragged to */
export const MIN_COLUMN_WIDTH = 16
/** Fixed width without a Default width (approximation, see the file comment) */
export const DEFAULT_FIXED_WIDTH = 120

export type SizeBehavior = 'fitToContent' | 'growToFit' | 'fixedWidth'

export interface WidthInput {
  header: string
  headerFont: FontSpec
  texts: string[]
  valueFont: FontSpec
  /** texts drawn with another font (bold totals / subtotals) */
  extraTexts?: Array<{ text: string; font: FontSpec }>
  /** custom width (columnWidth entry) */
  explicit?: number
  /** extra px (sort caret, expand buttons + indentation, icons) */
  extra?: number
  /** minimum content width (sparklines: PBI's default sparkline width) */
  minWidth?: number
}

export interface WidthOptions {
  behavior: SizeBehavior
  /**
   * Legacy "Auto-size width: off" (no `columnAdjustment` in the file): PBI stored a width for every column when
   * the option was switched off; a column without one keeps its content width instead of the default width.
   */
  legacyManual?: boolean
  defaultWidth?: number
  wrapHeader: boolean
  /** width of the visual's viewport (without the vertical scrollbar) */
  available: number
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

/** Width a column needs to show its header and values (what "Fit to content" and a double-click on the header edge use). */
export function contentWidth(c: WidthInput, opts: Pick<WidthOptions, 'wrapHeader' | 'available' | 'max'>): number {
  const max = opts.max ?? Math.max(320, opts.available * 0.6)
  let valueW = maxTextWidth(c.texts, c.valueFont)
  for (const x of c.extraTexts ?? []) if (x.text) valueW = Math.max(valueW, measureText(x.text, x.font))
  const headerFull = measureText(c.header, c.headerFont)
  const longestWord = Math.max(0, ...c.header.split(/\s+/).map((w) => measureText(w, c.headerFont)))
  const headerW = opts.wrapHeader ? Math.max(longestWord, Math.min(headerFull, Math.max(valueW, 90))) : headerFull
  return Math.ceil(Math.min(max, Math.max(valueW, headerW, c.minWidth ?? 0) + 2 * CELL_PAD_X + (c.extra ?? 0)) + 1)
}

export function computeWidths(cols: WidthInput[], opts: WidthOptions): number[] {
  const widths = cols.map((c) => {
    if (c.explicit !== undefined) return Math.max(0, c.explicit)
    if (opts.behavior === 'fixedWidth' && !(opts.legacyManual && opts.defaultWidth === undefined)) return Math.max(MIN_COLUMN_WIDTH, opts.defaultWidth ?? DEFAULT_FIXED_WIDTH)
    // PBI samples the first 50 rows; callers pass those
    return contentWidth(c, opts)
  })
  if (opts.behavior !== 'growToFit') return widths
  const total = widths.reduce((a, b) => a + b, 0)
  const auto = widths.map((_, i) => i).filter((i) => cols[i].explicit === undefined)
  if (!auto.length || total <= 0 || total >= opts.available) return widths
  const extra = Math.floor((opts.available - total) / auto.length)
  return widths.map((w, i) => (cols[i].explicit !== undefined ? w : w + extra))
}

/** Horizontal cell padding for a column width: a column narrower than its padding (width 0 hides it) has none. */
export function cellPadX(width: number): number {
  return width <= 2 * CELL_PAD_X ? 0 : CELL_PAD_X
}
