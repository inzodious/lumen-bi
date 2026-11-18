/**
 * Formatting + layout model of the button slicer (`advancedSlicerVisual`), pure so it can be tested.
 *
 * Objects (names from Microsoft's report-theme schema, visual-advancedSlicerVisual): layout (orientation,
 * columnCount, rowCount, autoGrid = "Fit to space", showFixedSize/fixedWidth/fixedHeight, cellPadding /
 * columnPadding / rowPadding), overFlow (overFlowStyle, overFlowDirection), shapeCustomRectangle
 * (rectangleRoundedCurve), fillCustom, outline, value (callout = the field value), label (the Label /
 * Highlight label measure), image (show, sourceType, url, image, position, imageAreaSize, imageFit),
 * accentBar, selectionIcon, shadowCustom, padding — each with per-state selectors
 * `{ id: 'default' | 'interaction:hover' | 'interaction:press' | 'selection:selected' }`.
 *
 * Defaults measured on Microsoft Learn's button slicer screenshot: white buttons, 1px #E1DFDD border,
 * 4px corners, centered Segoe UI Semibold value (#252423) over a smaller regular label (#605E5C),
 * ≈10px gaps, grid fitted to the space; items that the cross-highlight leaves without data are dimmed.
 * The selected-state default (light tint of theme color 1 + theme color border) and the numeric
 * encodings of `orientation` / `overFlowStyle` are not documented — approximations noted here.
 */
import { getColor, getProp, makePropContext, type PropContext, type Selector } from '@core/report/props'
import { shadeColor, withTransparency, type ResolvedTheme } from '@core/report/theme'
import { readFont, type FontSpec } from '../common/textStyle'
import { cleanFamily } from './slicerFormat'

export type ButtonState = 'default' | 'hover' | 'press' | 'selected' | 'disabled'
const SEL: Record<Exclude<ButtonState, 'disabled'>, Selector | undefined> = {
  default: undefined,
  hover: { id: 'interaction:hover' },
  press: { id: 'interaction:press' },
  selected: { id: 'selection:selected' }
}

export interface ButtonStateStyle {
  fill: string
  border: string
  borderWidth: number
  radius: number
  valueFont: FontSpec
  labelFont: FontSpec
  valueShow: boolean
  labelShow: boolean
  accentBar?: { color: string; position: 'left' | 'right' | 'top' | 'bottom'; width: number }
  shadow?: string
  opacity: number
}

export type Arrangement = 'horizontal' | 'vertical' | 'grid'

export interface ButtonImageFormat {
  show: boolean
  /** 'url' (static URL), 'field' (image URL per item from a column), 'image' (report resource) */
  source: 'url' | 'field' | 'image'
  url?: string
  resource?: { resource: string; package?: string; packageType?: number } | string
  /** SQ column with the image URL of each item (image.field) */
  field?: any
  position: 'left' | 'right' | 'top' | 'bottom'
  /** % of the button used by the image */
  areaSize: number
  fit: 'fit' | 'fill' | 'normal'
  padding: number
}

export interface ButtonSlicerFormat {
  pc: PropContext
  arrangement: Arrangement
  columns: number
  rows: number
  fitToSpace: boolean
  fixed?: { width: number; height: number }
  gapX: number
  gapY: number
  overflow: 'scroll' | 'paginate'
  overflowDirection: 'vertical' | 'horizontal'
  padding: { top: number; right: number; bottom: number; left: number }
  image: ButtonImageFormat
  selectionIcon: { show: boolean; color: string; position: 'topRight' | 'topLeft' | 'left' | 'right'; size: number }
  textAlign: 'left' | 'center' | 'right'
  states: Record<ButtonState, ButtonStateStyle>
}

function num(v: unknown, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

function arrangementOf(v: unknown): Arrangement {
  if (typeof v === 'number') return v === 1 ? 'vertical' : v === 2 ? 'grid' : 'horizontal'
  const s = String(v ?? 'grid').toLowerCase()
  return s.startsWith('v') ? 'vertical' : s.startsWith('h') ? 'horizontal' : 'grid'
}

function sidePosition(v: unknown): 'left' | 'right' | 'top' | 'bottom' {
  const s = String(v ?? 'left').toLowerCase()
  return s === 'right' || s === 'top' || s === 'bottom' ? s : 'left'
}

function stateStyle(pc: PropContext, state: ButtonState, theme: ResolvedTheme): ButtonStateStyle {
  const sel = state === 'disabled' ? undefined : SEL[state]
  const accent = theme.dataColors?.[0] ?? '#118DFF'
  const defFill = state === 'selected' ? shadeColor(accent, 0.85) : state === 'press' ? '#E1DFDD' : state === 'hover' ? '#F3F2F1' : '#FFFFFF'
  const fillShow = getProp<boolean>(pc, 'fillCustom', 'show', true, sel) !== false
  const fill = fillShow ? withTransparency(getColor(pc, 'fillCustom', 'fillColor', defFill, sel), num(getProp(pc, 'fillCustom', 'transparency', 0, sel), 0)) : 'transparent'
  const outlineShow = getProp<boolean>(pc, 'outline', 'show', true, sel) !== false
  const lineColor = withTransparency(getColor(pc, 'outline', 'lineColor', state === 'selected' ? accent : '#E1DFDD', sel), num(getProp(pc, 'outline', 'transparency', 0, sel), 0))
  const weight = outlineShow ? num(getProp(pc, 'outline', 'weight', 1, sel), 1) : 0
  const radius = num(getProp(pc, 'shapeCustomRectangle', 'rectangleRoundedCurve', 4, sel), 4)
  const valueFont = readFont(pc, 'value', { size: 11, color: theme.foreground ?? '#252423', family: 'Segoe UI Semibold' }, { size: 'fontSize' }, sel)
  valueFont.family = cleanFamily(valueFont.family)
  const labelFont = readFont(pc, 'label', { size: 9, color: '#605E5C', family: 'Segoe UI' }, { size: 'fontSize' }, sel)
  labelFont.family = cleanFamily(labelFont.family)
  const accentShow = getProp<boolean>(pc, 'accentBar', 'show', false, sel) === true
  const shadowShow = getProp<boolean>(pc, 'shadowCustom', 'show', false, sel) === true
  const shadowColor = withTransparency(getColor(pc, 'shadowCustom', 'color', '#000000', sel), num(getProp(pc, 'shadowCustom', 'transparency', 70, sel), 70))
  const blur = num(getProp(pc, 'shadowCustom', 'shadowBlur', 10, sel), 10)
  const dist = num(getProp(pc, 'shadowCustom', 'shadowDistance', 3, sel), 3)
  return {
    fill: state === 'disabled' ? '#F3F2F1' : fill,
    border: lineColor,
    borderWidth: weight,
    radius,
    valueFont: state === 'disabled' ? { ...valueFont, color: '#C8C6C4' } : valueFont,
    labelFont: state === 'disabled' ? { ...labelFont, color: '#E1DFDD' } : labelFont,
    valueShow: getProp<boolean>(pc, 'value', 'show', true, sel) !== false,
    labelShow: getProp<boolean>(pc, 'label', 'show', true, sel) !== false,
    accentBar: accentShow
      ? {
          color: getColor(pc, 'accentBar', 'color', accent, sel),
          position: sidePosition(getProp<any>(pc, 'accentBar', 'position', 'left', sel)),
          width: num(getProp(pc, 'accentBar', 'width', 4, sel), 4)
        }
      : undefined,
    shadow: shadowShow ? `0 ${dist}px ${blur}px ${shadowColor}` : undefined,
    opacity: 1
  }
}

export function readButtonSlicerFormat(visualJson: any, theme: ResolvedTheme): ButtonSlicerFormat {
  const pc = makePropContext(visualJson, theme)
  const cellPadding = num(getProp(pc, 'layout', 'cellPadding', 10), 10)
  const fixedOn = getProp<boolean>(pc, 'layout', 'showFixedSize', false) === true
  const ovStyle = getProp<any>(pc, 'overFlow', 'overFlowStyle', 0)
  const ovDir = getProp<any>(pc, 'overFlow', 'overFlowDirection', 0)
  const imgSrc = String(getProp<any>(pc, 'image', 'sourceType', 'url')).toLowerCase()
  const rawImage = (visualJson?.visual?.objects?.image ?? []).find((e: any) => !e.selector)?.properties ?? {}
  const pos = String(getProp<any>(pc, 'image', 'position', 'left')).toLowerCase()
  const align = String(getProp<any>(pc, 'value', 'horizontalAlignment', 'center')).toLowerCase()
  const states = {} as Record<ButtonState, ButtonStateStyle>
  for (const s of ['default', 'hover', 'press', 'selected', 'disabled'] as ButtonState[]) states[s] = stateStyle(pc, s, theme)
  return {
    pc,
    arrangement: arrangementOf(getProp<any>(pc, 'layout', 'orientation', 'grid')),
    columns: Math.max(1, num(getProp(pc, 'layout', 'columnCount', getProp<any>(pc, 'layout', 'maxTiles', 3)), 3)),
    rows: Math.max(0, num(getProp(pc, 'layout', 'rowCount', 0), 0)),
    fitToSpace: getProp<boolean>(pc, 'layout', 'autoGrid', true) !== false,
    fixed: fixedOn ? { width: num(getProp(pc, 'layout', 'fixedWidth', 120), 120), height: num(getProp(pc, 'layout', 'fixedHeight', 48), 48) } : undefined,
    gapX: num(getProp(pc, 'layout', 'columnPadding', cellPadding), cellPadding),
    gapY: num(getProp(pc, 'layout', 'rowPadding', cellPadding), cellPadding),
    overflow: ovStyle === 1 || String(ovStyle).toLowerCase().startsWith('pag') ? 'paginate' : 'scroll',
    overflowDirection: ovDir === 1 || String(ovDir).toLowerCase().startsWith('h') ? 'horizontal' : 'vertical',
    padding: {
      top: num(getProp(pc, 'padding', 'topMargin', 4), 4),
      right: num(getProp(pc, 'padding', 'rightMargin', 8), 8),
      bottom: num(getProp(pc, 'padding', 'bottomMargin', 4), 4),
      left: num(getProp(pc, 'padding', 'leftMargin', 8), 8)
    },
    image: {
      show: getProp<boolean>(pc, 'image', 'show', false) === true,
      source: imgSrc.includes('field') ? 'field' : imgSrc.includes('file') || imgSrc === 'image' ? 'image' : 'url',
      url: getProp<string | undefined>(pc, 'image', 'url', undefined),
      resource: rawImage.image?.image ?? rawImage.image ?? undefined,
      field: rawImage.field?.expr ?? rawImage.field,
      position: pos === 'right' || pos === 'top' || pos === 'bottom' ? pos : 'left',
      areaSize: Math.max(5, Math.min(90, num(getProp(pc, 'image', 'imageAreaSize', 30), 30))),
      fit: String(getProp<any>(pc, 'image', 'imageFit', 'fit')).toLowerCase() === 'fill' ? 'fill' : String(getProp<any>(pc, 'image', 'imageFit', 'fit')).toLowerCase() === 'normal' ? 'normal' : 'fit',
      padding: num(getProp(pc, 'image', 'padding', 4), 4)
    },
    selectionIcon: {
      show: getProp<boolean>(pc, 'selectionIcon', 'show', false) === true,
      color: getColor(pc, 'selectionIcon', 'color', theme.dataColors?.[0] ?? '#118DFF'),
      position: (['topRight', 'topLeft', 'left', 'right'].find((p) => p.toLowerCase() === String(getProp<any>(pc, 'selectionIcon', 'position', 'topRight')).toLowerCase()) ?? 'topRight') as ButtonSlicerFormat['selectionIcon']['position'],
      size: num(getProp(pc, 'selectionIcon', 'size', 12), 12)
    },
    textAlign: align === 'left' || align === 'right' ? align : 'center',
    states
  }
}

export interface ButtonGrid {
  /** columns × rows of one page / viewport */
  cols: number
  rows: number
  /** button size in px */
  cellW: number
  cellH: number
  /** number of pages (paginate) */
  pages: number
  /** items per page (paginate) */
  perPage: number
  /** scroll content size (scroll mode) */
  contentW: number
  contentH: number
}

/**
 * Lay the buttons out in a `width × height` area.
 *  - horizontal: one row, `columns` buttons per view; vertical: one column, `rows` (or all) per view;
 *    grid: `columns` × `rows` (rows 0 = as many as needed).
 *  - Fit to space on: the visible buttons share the space; off: space is reserved for the configured
 *    count. Fixed size: buttons keep their size and the rest scrolls / pages.
 */
export function layoutButtons(n: number, width: number, height: number, f: Pick<ButtonSlicerFormat, 'arrangement' | 'columns' | 'rows' | 'fitToSpace' | 'fixed' | 'gapX' | 'gapY' | 'overflow' | 'overflowDirection'>, minCellH = 32): ButtonGrid {
  const count = Math.max(0, n)
  let cols: number
  let rows: number
  if (f.arrangement === 'horizontal') {
    cols = f.fixed ? Math.max(1, Math.floor((width + f.gapX) / (f.fixed.width + f.gapX))) : Math.max(1, f.fitToSpace ? Math.min(f.columns, Math.max(1, count)) : f.columns)
    rows = 1
  } else if (f.arrangement === 'vertical') {
    cols = 1
    const want = f.rows > 0 ? f.rows : count
    rows = f.fixed ? Math.max(1, Math.floor((height + f.gapY) / (f.fixed.height + f.gapY))) : Math.max(1, f.fitToSpace ? Math.min(want, Math.max(1, count)) : want)
  } else {
    cols = f.fixed ? Math.max(1, Math.floor((width + f.gapX) / (f.fixed.width + f.gapX))) : Math.max(1, f.fitToSpace ? Math.min(f.columns, Math.max(1, count)) : f.columns)
    const needed = Math.max(1, Math.ceil(count / cols))
    rows = f.fixed ? Math.max(1, Math.floor((height + f.gapY) / (f.fixed.height + f.gapY))) : f.rows > 0 ? (f.fitToSpace ? Math.min(f.rows, needed) : f.rows) : needed
  }
  const cellW = f.fixed ? f.fixed.width : Math.max(1, (width - f.gapX * (cols - 1)) / cols)
  let cellH = f.fixed ? f.fixed.height : Math.max(1, (height - f.gapY * (rows - 1)) / rows)
  // too many rows for the height: keep a readable minimum and scroll / page the rest
  if (!f.fixed && cellH < minCellH && f.arrangement !== 'horizontal') {
    cellH = minCellH
    rows = Math.max(1, Math.floor((height + f.gapY) / (minCellH + f.gapY)))
  }
  const perPage = Math.max(1, cols * rows)
  const pages = Math.max(1, Math.ceil(count / perPage))
  // scroll mode: content grows along the overflow direction
  const horizontalFlow = f.arrangement === 'horizontal' || (f.arrangement === 'grid' && f.overflowDirection === 'horizontal')
  const lines = horizontalFlow ? Math.ceil(count / Math.max(1, rows)) : Math.ceil(count / Math.max(1, cols))
  const contentW = horizontalFlow ? lines * cellW + Math.max(0, lines - 1) * f.gapX : width
  const contentH = horizontalFlow ? height : lines * cellH + Math.max(0, lines - 1) * f.gapY
  return { cols, rows, cellW, cellH, pages, perPage, contentW, contentH }
}

/** Position of item `i` (scroll mode, or within its page when paginating). */
export function buttonPosition(i: number, g: ButtonGrid, f: Pick<ButtonSlicerFormat, 'arrangement' | 'gapX' | 'gapY' | 'overflow' | 'overflowDirection'>): { x: number; y: number; page: number } {
  const paginate = f.overflow === 'paginate'
  const page = paginate ? Math.floor(i / g.perPage) : 0
  const k = paginate ? i % g.perPage : i
  const horizontalFlow = f.arrangement === 'horizontal' || (f.arrangement === 'grid' && f.overflowDirection === 'horizontal')
  let col: number
  let row: number
  if (horizontalFlow && !paginate) {
    // fill columns top-to-bottom, then move right
    col = Math.floor(k / g.rows)
    row = k % g.rows
  } else {
    col = k % g.cols
    row = Math.floor(k / g.cols)
  }
  return { x: col * (g.cellW + f.gapX), y: row * (g.cellH + f.gapY), page }
}

/** Parse pasted text (one value per line, hierarchy levels separated by tabs) — PBI's paste-to-select, max 2,000 lines. */
export function parsePastedValues(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .slice(0, 2000)
    .map((l) => l.split('\t').map((c) => c.trim()))
}
