/**
 * Formatting model shared by the table (tableEx) and matrix (pivotTable) visuals.
 *
 * Property names follow Microsoft's published report-theme JSON schema (reportThemeSchema-2.159,
 * microsoft/powerbi-desktop-samples) for `tableEx` / `pivotTable`. Defaults follow the "Default"
 * style preset as documented on Microsoft Learn (create custom report themes → structural colors
 * and text classes) and as measured on Learn's screenshots of new tables/matrices:
 *  - every region uses the `label` text class (Segoe UI 10pt, `foreground`), column headers too
 *    (regular weight, not Semibold); totals and subtotals use `boldLabel` (bold);
 *  - grid outline (line under the column headers, above table totals, right of matrix row
 *    headers) = `tableAccent`, falling back to `backgroundNeutral`;
 *  - gridlines = `backgroundLight` ("thirdLevelElements: table and matrix grid color");
 *  - tables: alternating rows (`background` / `backgroundLight`) with horizontal gridlines on;
 *    matrices: no banding, no gridlines, no top border on the grand total row;
 *  - row padding 3px — not published by Microsoft; kept from phase 1 (approximation).
 * `grid.textSize` is the legacy "text size" that applies to every region when set.
 */
import { getColor, getProp, makePropContext, objectEntries, type PropContext } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { fieldKey } from '@core/report/sq'
import { cssAlign, readFont, type FontSpec } from '../common/textStyle'
import { readSparklineFormats, type SparklineFormat } from './sparklineModel'

export type Outline = 'None' | 'BottomOnly' | 'TopOnly' | 'LeftOnly' | 'RightOnly' | 'TopBottom' | 'LeftRight' | 'Frame'

export interface RegionStyle {
  font: FontSpec
  background?: string
  outline: Outline
  wordWrap: boolean
  alignment?: 'left' | 'center' | 'right'
}

export interface GridStyle {
  vertical: boolean
  verticalColor: string
  verticalWeight: number
  horizontal: boolean
  horizontalColor: string
  horizontalWeight: number
  rowPadding: number
  outlineColor: string
  outlineWeight: number
  imageHeight: number
  /** undefined = keep the image's aspect ratio */
  imageWidth?: number
}

export interface ColumnOverride {
  fontColor?: string
  backColor?: string
  alignment?: 'left' | 'center' | 'right'
  displayUnits?: number
  precision?: number
  styleHeader: boolean
  styleValues: boolean
  styleTotal: boolean
  /** matrix only ("Apply to subtotals") */
  styleSubtotals: boolean
}

/** Subtotal / grand-total region style (matrix `subTotals`, `rowTotal`, `columnTotal`). */
export interface TotalStyle {
  font: FontSpec
  background?: string
  /** "Apply to labels": the font / colors also apply to the row/column header labels */
  applyToHeaders: boolean
}

export interface ExpandButtonStyle {
  show: boolean
  /** icon size in px (PBI: 8..60 px) */
  size: number
  color?: string
}

export interface TableFormat {
  pc: PropContext
  isMatrix: boolean
  header: RegionStyle & {
    autoSize: boolean
    columnAdjustment: 'growToFit' | 'fixedWidth' | 'fitToContent' | 'auto'
    defaultWidth?: number
    titleAlignment?: 'left' | 'center' | 'right'
    /** matrix column headers: +/- icons */
    buttons: ExpandButtonStyle
    /** matrix: column levels start expanded */
    autoExpand: boolean
    urlIcon: boolean
  }
  values: RegionStyle & {
    fontColorSecondary: string
    backPrimary: string
    backSecondary: string
    urlIcon: boolean
    bandedRowHeaders: boolean
    valuesOnRow: boolean
  }
  total: RegionStyle & { show: boolean; label: string }
  grid: GridStyle
  /** matrix */
  rowHeaders: RegionStyle & {
    stepped: boolean
    layout: 'compact' | 'outline' | 'tabular'
    indentation: number
    showButtons: boolean
    buttonSize: number
    buttonColor?: string
    autoExpand: boolean
    /** Layout › Freeze › Row headers off */
    unfrozen: boolean
    urlIcon: boolean
  }
  subTotals: {
    rows: boolean
    columns: boolean
    rowPosition: 'top' | 'bottom'
    perRowLevel: boolean
    perColumnLevel: boolean
    levelEnabled: Map<string, boolean>
    /** per-level subtotal labels (selector.metadata = level queryRef) */
    levelLabel: Map<string, string>
    /** row subtotal label (also used for the row grand total label; PBI default "Total") */
    label: string
    columnLabel: string
    /** row subtotal style (`subTotals` $id Row); undefined props fall back to the bold values font */
    style: TotalStyle
    /** column subtotal style (`subTotals` $id Column) */
    columnStyle: TotalStyle
  }
  rowTotal: TotalStyle
  columnTotal: TotalStyle
  showBlankRows: boolean
  blankRows: { color?: string; border: boolean; borderPosition: 'Top' | 'Bottom' | 'TopAndBottom'; borderColor: string; borderWidth: number }
  /** column width by queryRef (selector.metadata) */
  widthByRef: Map<string, number>
  /** column width by matrix column-header scope (stringified scopeId) */
  widthByScope: Array<{ scope: any; width: number }>
  cornerWidth?: number
  columnOverrides: Map<string, ColumnOverride>
  /** sparkline formatting by sparkline projection queryRef */
  sparklines: Map<string, SparklineFormat>
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

function outlineOf(v: unknown, fallback: Outline): Outline {
  // PBIR stores outlines as names ('BottomOnly'…) or legacy numeric codes
  if (typeof v === 'number') {
    const codes: Record<number, Outline> = { 0: 'None', 1: 'BottomOnly', 2: 'TopOnly', 3: 'LeftOnly', 4: 'RightOnly', 5: 'TopBottom', 6: 'LeftRight', 7: 'Frame', 10: 'None' }
    return codes[v] ?? fallback
  }
  const s = String(v ?? '')
  const known: Outline[] = ['None', 'BottomOnly', 'TopOnly', 'LeftOnly', 'RightOnly', 'TopBottom', 'LeftRight', 'Frame']
  return known.find((k) => k.toLowerCase() === s.toLowerCase()) ?? fallback
}

function align(v: unknown): 'left' | 'center' | 'right' | undefined {
  if (v === undefined || v === null || String(v).toLowerCase() === 'auto') return undefined
  const a = cssAlign(v)
  return a === 'justify' ? 'left' : a
}

export function readTableFormat(visualJson: any, theme: ResolvedTheme): TableFormat {
  const pc = makePropContext(visualJson, theme)
  const isMatrix = pc.visualType === 'pivotTable'
  const label = theme.textClasses?.label ?? {}
  const fg = label.color ?? theme.foreground
  const family = label.fontFace ?? 'Segoe UI'
  const legacySize = getProp<number | undefined>(pc, 'grid', 'textSize', undefined)
  const baseSize = typeof legacySize === 'number' ? legacySize : typeof label.fontSize === 'number' ? label.fontSize : 10

  // Column headers use the `label` class (regular weight) per Learn's text-class table.
  const headerFont = readFont(pc, 'columnHeaders', { size: baseSize, color: fg, family })
  const valueFont = readFont(pc, 'values', { size: baseSize, color: fg, family }, { color: 'fontColorPrimary' })
  // matrix grand totals: legacy `total` object, then rowTotal; tables: `total`
  const totalFont = readFont(pc, 'total', { size: baseSize, color: fg, family, bold: true })
  const rowHeaderFont = readFont(pc, 'rowHeaders', { size: baseSize, color: fg, family })
  // explicit legacy `values.fontColor` (non-CF) applies to every row
  const plainValueColor = getProp<any>(pc, 'values', 'fontColor', undefined)
  if (typeof plainValueColor === 'string') valueFont.color = plainValueColor

  const backPrimary = getColor(pc, 'values', 'backColorPrimary', getColor(pc, 'values', 'backColor', theme.background))
  const backSecondary = getColor(pc, 'values', 'backColorSecondary', isMatrix ? backPrimary : theme.backgroundLight)

  const widthByRef = new Map<string, number>()
  const widthByScope: Array<{ scope: any; width: number }> = []
  let cornerWidth: number | undefined
  for (const e of objectEntries(pc, 'columnWidth')) {
    const raw = e.properties?.value
    const w = num(raw?.expr?.Literal ? Number.parseFloat(String(raw.expr.Literal.Value)) : raw, NaN)
    if (!Number.isFinite(w)) continue
    if (e.selector?.metadata) widthByRef.set(e.selector.metadata, w)
    else if (e.selector?.data) widthByScope.push({ scope: e.selector.data, width: w })
    else if (e.selector?.id === 'cornerColumn') cornerWidth = w
  }
  // Legacy `table` / older `tableEx` files keep per-column widths in `general.columnWidth` (selector = queryRef)
  for (const e of objectEntries(pc, 'general')) {
    const raw = e.properties?.columnWidth
    if (raw === undefined || !e.selector?.metadata || widthByRef.has(e.selector.metadata)) continue
    const w = num(raw?.expr?.Literal ? Number.parseFloat(String(raw.expr.Literal.Value)) : raw, NaN)
    if (Number.isFinite(w)) widthByRef.set(e.selector.metadata, w)
  }

  const columnOverrides = new Map<string, ColumnOverride>()
  for (const e of objectEntries(pc, 'columnFormatting')) {
    const ref = e.selector?.metadata
    if (!ref) continue
    const sel = { metadata: ref }
    const fc = getProp<any>(pc, 'columnFormatting', 'fontColor', undefined, sel)
    const bc = getProp<any>(pc, 'columnFormatting', 'backColor', undefined, sel)
    const du = getProp<any>(pc, 'columnFormatting', 'labelDisplayUnits', getProp<any>(pc, 'columnFormatting', 'displayUnits', undefined, sel), sel)
    const pr = getProp<any>(pc, 'columnFormatting', 'labelPrecision', getProp<any>(pc, 'columnFormatting', 'precision', undefined, sel), sel)
    const styleTotal = getProp<boolean>(pc, 'columnFormatting', 'styleTotal', false, sel)
    columnOverrides.set(ref, {
      fontColor: typeof fc === 'string' ? fc : undefined,
      backColor: typeof bc === 'string' ? bc : undefined,
      alignment: align(getProp<any>(pc, 'columnFormatting', 'alignment', undefined, sel)),
      displayUnits: typeof du === 'number' ? du : undefined,
      precision: typeof pr === 'number' ? pr : undefined,
      styleHeader: getProp<boolean>(pc, 'columnFormatting', 'styleHeader', true, sel),
      styleValues: getProp<boolean>(pc, 'columnFormatting', 'styleValues', true, sel),
      styleTotal,
      styleSubtotals: getProp<boolean>(pc, 'columnFormatting', 'styleSubtotals', styleTotal, sel)
    })
  }

  const levelEnabled = new Map<string, boolean>()
  const levelLabel = new Map<string, string>()
  for (const e of objectEntries(pc, 'subTotals')) {
    const ref = e.selector?.metadata
    if (!ref) continue
    if (e.properties?.levelSubtotalEnabled !== undefined) levelEnabled.set(ref, getProp<boolean>(pc, 'subTotals', 'levelSubtotalEnabled', true, { metadata: ref }))
    if (e.properties?.levelSubtotalLabel !== undefined) {
      const l = getProp<any>(pc, 'subTotals', 'levelSubtotalLabel', undefined, { metadata: ref })
      if (typeof l === 'string' && l) levelLabel.set(ref, l)
    }
  }

  const columnAdjustmentRaw = String(getProp<any>(pc, 'columnHeaders', 'columnAdjustment', 'auto'))
  const columnAdjustment = (['growToFit', 'fixedWidth', 'fitToContent'] as const).find((x) => x.toLowerCase() === columnAdjustmentRaw.toLowerCase()) ?? 'auto'
  const layoutRaw = String(getProp<any>(pc, 'general', 'layout', 'Compact')).toLowerCase()
  const layout: 'compact' | 'outline' | 'tabular' = layoutRaw === 'outline' ? 'outline' : layoutRaw === 'tabular' ? 'tabular' : 'compact'

  const accent = theme.tableAccent || theme.backgroundNeutral
  const optColor = (object: string, prop: string, sel?: { id: string }) => {
    const c = getProp<any>(pc, object, prop, undefined, sel)
    return typeof c === 'string' ? c : undefined
  }
  const regionColors = (object: string) => optColor(object, 'backColor')

  // Subtotals: `subTotals` style, optionally per `$id` Row / Column (selector-less entries apply to
  // both); bold label class by default.
  const subStyleFor = (id: 'Row' | 'Column'): TotalStyle => ({
    font: readFont(pc, 'subTotals', { size: valueFont.size, color: valueFont.color, family: valueFont.family, bold: true }, {}, { id }),
    background: optColor('subTotals', 'backColor', { id }),
    applyToHeaders: getProp<boolean>(pc, 'subTotals', 'applyToHeaders', false, { id })
  })
  const subStyle = subStyleFor('Row')
  const subFont = subStyle.font
  // Grand totals inherit the subtotal text / background color when not set (Learn: "Grand total color behavior").
  const grandStyle = (object: 'rowTotal' | 'columnTotal'): TotalStyle => {
    const legacy = readFont(pc, 'total', { ...subFont })
    const font = readFont(pc, object, { ...legacy, size: legacy.size, color: legacy.color })
    return {
      font,
      background: optColor(object, 'backColor') ?? optColor('total', 'backColor') ?? subStyle.background,
      applyToHeaders: getProp<boolean>(pc, object, 'applyToHeaders', getProp<boolean>(pc, 'total', 'applyToHeaders', false))
    }
  }
  const pbiTotalLabel = (v: unknown, fallback: string) => (typeof v === 'string' && v.length ? v : fallback)
  const rowButtonSize = num(getProp<any>(pc, 'rowHeaders', 'expandCollapseButtonsSize', undefined), NaN)
  const colButtonSize = num(getProp<any>(pc, 'columnHeaders', 'expandCollapseButtonsSize', undefined), NaN)
  const defaultButtonPx = Math.round((rowHeaderFont.size * 96) / 72 * 0.85)

  return {
    pc,
    isMatrix,
    header: {
      font: headerFont,
      background: regionColors('columnHeaders'),
      outline: outlineOf(getProp<any>(pc, 'columnHeaders', 'outlineStyle', getProp<any>(pc, 'columnHeaders', 'outline', 'BottomOnly')), 'BottomOnly'),
      wordWrap: getProp<boolean>(pc, 'columnHeaders', 'wordWrap', true),
      alignment: align(getProp<any>(pc, 'columnHeaders', 'alignment', undefined)),
      titleAlignment: align(getProp<any>(pc, 'columnHeaders', 'titleAlignment', undefined)),
      autoSize: getProp<boolean>(pc, 'columnHeaders', 'autoSizeColumnWidth', true),
      columnAdjustment,
      defaultWidth: (() => {
        const d = getProp<any>(pc, 'columnHeaders', 'defaultColumnWidth', undefined)
        return typeof d === 'number' ? d : undefined
      })(),
      buttons: {
        show: getProp<boolean>(pc, 'columnHeaders', 'showExpandCollapseButtons', isMatrix) !== false,
        size: Number.isFinite(colButtonSize) ? colButtonSize : defaultButtonPx,
        color: optColor('columnHeaders', 'expandCollapseButtonsColor')
      },
      autoExpand: getProp<boolean>(pc, 'columnHeaders', 'autoExpand', false) === true,
      urlIcon: getProp<boolean>(pc, 'columnHeaders', 'urlIcon', false) === true
    },
    values: {
      font: valueFont,
      fontColorSecondary: getColor(pc, 'values', 'fontColorSecondary', valueFont.color),
      backPrimary,
      backSecondary,
      background: backPrimary,
      outline: outlineOf(getProp<any>(pc, 'values', 'outlineStyle', getProp<any>(pc, 'values', 'outline', 'None')), 'None'),
      wordWrap: getProp<boolean>(pc, 'values', 'wordWrap', true),
      urlIcon: getProp<boolean>(pc, 'values', 'urlIcon', false),
      bandedRowHeaders: getProp<boolean>(pc, 'values', 'bandedRowHeaders', true),
      valuesOnRow: getProp<boolean>(pc, 'values', 'valuesOnRow', false)
    },
    total: {
      font: totalFont,
      background: regionColors('total'),
      outline: outlineOf(getProp<any>(pc, 'total', 'outlineStyle', getProp<any>(pc, 'total', 'outline', 'TopOnly')), 'TopOnly'),
      wordWrap: false,
      // legacy `table` visuals: the Totals toggle lives in `general.totals`
      show: getProp<boolean>(pc, 'total', 'totals', getProp<boolean>(pc, 'general', 'totals', true)),
      // schema: tableEx total.label ("Total label"); `totalText` kept for older files
      label: pbiTotalLabel(getProp<any>(pc, 'total', 'label', getProp<any>(pc, 'total', 'totalText', undefined)), 'Total')
    },
    grid: {
      vertical: getProp<boolean>(pc, 'grid', 'gridVertical', false),
      verticalColor: getColor(pc, 'grid', 'gridVerticalColor', theme.backgroundLight),
      verticalWeight: num(getProp<any>(pc, 'grid', 'gridVerticalWeight', 1), 1),
      horizontal: getProp<boolean>(pc, 'grid', 'gridHorizontal', !isMatrix),
      horizontalColor: getColor(pc, 'grid', 'gridHorizontalColor', theme.backgroundLight),
      horizontalWeight: num(getProp<any>(pc, 'grid', 'gridHorizontalWeight', 1), 1),
      rowPadding: num(getProp<any>(pc, 'grid', 'rowPadding', 3), 3),
      outlineColor: getColor(pc, 'grid', 'outlineColor', accent),
      outlineWeight: num(getProp<any>(pc, 'grid', 'outlineWeight', 1), 1),
      imageHeight: num(getProp<any>(pc, 'grid', 'imageHeight', 75), 75),
      imageWidth: (() => {
        const w = num(getProp<any>(pc, 'grid', 'imageWidth', undefined), NaN)
        return Number.isFinite(w) ? w : undefined
      })()
    },
    rowHeaders: {
      font: rowHeaderFont,
      background: regionColors('rowHeaders'),
      outline: outlineOf(getProp<any>(pc, 'rowHeaders', 'outlineStyle', getProp<any>(pc, 'rowHeaders', 'outline', 'RightOnly')), 'RightOnly'),
      wordWrap: getProp<boolean>(pc, 'rowHeaders', 'wordWrap', true),
      alignment: align(getProp<any>(pc, 'rowHeaders', 'alignment', undefined)),
      layout,
      // `rowHeaders.stepped` predates `general.layout`; compact = stepped
      stepped: layout === 'compact' && getProp<boolean>(pc, 'rowHeaders', 'stepped', true),
      indentation: num(getProp<any>(pc, 'rowHeaders', 'steppedLayoutIndentation', 10), 10),
      showButtons: getProp<boolean>(pc, 'rowHeaders', 'showExpandCollapseButtons', true),
      buttonSize: Number.isFinite(rowButtonSize) ? rowButtonSize : defaultButtonPx,
      buttonColor: optColor('rowHeaders', 'expandCollapseButtonsColor'),
      autoExpand: getProp<boolean>(pc, 'rowHeaders', 'autoExpand', false) === true,
      unfrozen: getProp<boolean>(pc, 'rowHeaders', 'unfrozen', false) === true,
      urlIcon: getProp<boolean>(pc, 'rowHeaders', 'urlIcon', false) === true
    },
    subTotals: {
      rows: getProp<boolean>(pc, 'subTotals', 'rowSubtotals', getProp<boolean>(pc, 'subTotals', 'rowSubtotals', true, { id: 'Row' })),
      columns: getProp<boolean>(pc, 'subTotals', 'columnSubtotals', getProp<boolean>(pc, 'subTotals', 'columnSubtotals', true, { id: 'Column' })),
      rowPosition: String(getProp<any>(pc, 'subTotals', 'rowSubtotalsPosition', 'Top')).toLowerCase() === 'bottom' ? 'bottom' : 'top',
      perRowLevel: getProp<boolean>(pc, 'subTotals', 'perRowLevel', false),
      perColumnLevel: getProp<boolean>(pc, 'subTotals', 'perColumnLevel', false),
      levelEnabled,
      levelLabel,
      label: pbiTotalLabel(getProp<any>(pc, 'subTotals', 'rowSubtotalsLabel', undefined), 'Total'),
      columnLabel: pbiTotalLabel(getProp<any>(pc, 'subTotals', 'columnSubtotalsLabel', undefined), 'Total'),
      style: subStyle,
      columnStyle: subStyleFor('Column')
    },
    rowTotal: grandStyle('rowTotal'),
    columnTotal: grandStyle('columnTotal'),
    showBlankRows: getProp<boolean>(pc, 'blankRows', 'showBlankRows', false),
    blankRows: {
      color: (() => {
        const c = optColor('blankRows', 'blankRowColor')
        if (!c) return undefined
        const t = num(getProp<any>(pc, 'blankRows', 'blankRowTransparency', 0), 0)
        return t > 0 ? withAlpha(c, 1 - t / 100) : c
      })(),
      border: getProp<boolean>(pc, 'blankRows', 'showBorder', false) === true,
      borderPosition: (['Top', 'Bottom', 'TopAndBottom'] as const).find((x) => x === getProp<any>(pc, 'blankRows', 'borderPosition', 'Bottom')) ?? 'Bottom',
      borderColor: getColor(pc, 'blankRows', 'borderColor', theme.backgroundNeutral),
      borderWidth: num(getProp<any>(pc, 'blankRows', 'borderWidth', 1), 1)
    },
    widthByRef,
    widthByScope,
    cornerWidth,
    columnOverrides,
    sparklines: readSparklineFormats(pc, theme)
  }
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

/** CSS borders for an outline style. */
export function outlineBorders(o: Outline, color: string, weight: number): { borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string } {
  const b = `${weight}px solid ${color}`
  switch (o) {
    case 'BottomOnly':
      return { borderBottom: b }
    case 'TopOnly':
      return { borderTop: b }
    case 'LeftOnly':
      return { borderLeft: b }
    case 'RightOnly':
      return { borderRight: b }
    case 'TopBottom':
      return { borderTop: b, borderBottom: b }
    case 'LeftRight':
      return { borderLeft: b, borderRight: b }
    case 'Frame':
      return { borderTop: b, borderBottom: b, borderLeft: b, borderRight: b }
    default:
      return {}
  }
}

/** Does a columnWidth scope selector match a column header path (field expr + value pairs)? */
export function scopeMatches(scope: any[], path: Array<{ expr: any; value: unknown }>): boolean {
  const conds = scope.map((s) => s?.scopeId).filter(Boolean)
  if (!conds.length) return false
  return conds.every((c: any) => {
    const cmp = c.Comparison
    if (!cmp) return false
    const key = fieldKey(cmp.Left)
    const lit = cmp.Right?.Literal?.Value
    return path.some((p) => fieldKey(p.expr) === key && encodeForMatch(p.value) === String(lit))
  })
}

function encodeForMatch(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isInteger(v) ? `${v}L` : `${v}D`
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `datetime'${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}T${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}'`
  }
  return `'${String(v).replace(/'/g, "''")}'`
}
