/**
 * Formatting model of the classic `slicer` visual (header / items / selection / data / general /
 * slider / date objects), resolved through props.ts so theme visualStyles apply.
 */
import type { CSSProperties } from 'react'
import { getColor, getProp, makePropContext, type PropContext } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { readFont, type FontSpec } from '../common/textStyle'

/** PBI outline enum used by header/items outlines. */
export const OUTLINE = { None: 0, BottomOnly: 1, TopOnly: 2, LeftOnly: 3, RightOnly: 4, TopBottom: 5, LeftRight: 6, Frame: 7 } as const

export type SlicerMode = 'Basic' | 'Dropdown' | 'Between' | 'Before' | 'After' | 'Single' | 'Relative' | 'RelativeTime' | 'RelativeDatePicker'

export interface SlicerFormat {
  pc: PropContext
  mode: SlicerMode
  horizontal: boolean
  searchEnabled: boolean
  inverted: boolean
  header: { show: boolean; text?: string; font: FontSpec; background?: string; outline: number; outlineColor: string; outlineWeight: number }
  items: {
    font: FontSpec
    background?: string
    padding: number
    outline: number
    outlineColor: string
    indent: number
    /** 0 chevron, 1 plus/minus */
    toggleType: number
  }
  selection: { selectAll: boolean; ctrlMulti: boolean; strictSingle: boolean }
  slider: {
    show: boolean
    color: string
    handleFill: string
    handleBorder: string
    handleSize: number
    secondaryLine: string
    /** `general.responsive` off → rectangular bar handles (`handleWidth` × `handleHeight`, Learn: 7 × 17 px) */
    bar?: { width: number; height: number }
  }
  /** PBI `dropdown` object (classic slicer, Dropdown style) */
  dropdown: { borderColor: string; radius: number; iconColor: string; accentBar?: { color: string; position: 'left' | 'right' | 'top' | 'bottom'; width: number } }
  /** PBI `searchBox` object */
  searchBox: { background?: string; borderColor: string }
  /** PBI `date` (inputs font/background, hideDatePickerButton) + `dateRange` (includeToday, anchorDate) objects */
  date: { hidePicker: boolean; includeToday: boolean; anchorDate?: Date; font: FontSpec; background?: string }
  /** PBI `selectionIcon.color` (check box / radio fill of the vertical list and dropdown; selected tile fill), default foreground */
  selectionIcon: string
  /** PBI `numericInputStyle` (range slicer number inputs) */
  numericInput: { font: FontSpec; background?: string }
  /** Date picker style (`RelativeDatePicker`): `calendarButton`, `dateRangeText`, `relativeText`, `selection.singleDate` */
  picker: PickerFormat
  /** PBI `query.sortDefinition` of the slicer (More options › Sort ascending / descending) */
  sort?: 'asc' | 'desc'
  /** Lumen-only extras (object `lumenSlicer`; PBI ignores unknown objects). Defaults keep PBI's behavior. */
  ext: SlicerExtras
}

export interface PickerFormat {
  singleDate: boolean
  /** selected-range line (`dateRangeText`) */
  rangeFont: FontSpec
  /** restatement line (`relativeText`), hidden with relativeText.show = false */
  relativeFont: FontSpec
  relativeShow: boolean
  /** slider defaults of the date picker style (thicker dark handles than the Between slider) */
  sliderColor: string
  trackColor: string
  handleBorder: string
  handleSize: number
  /** the square button that opens the calendar (`calendarButton`) */
  button: {
    iconColor: string
    iconSize: number
    background?: string
    stroke?: { color: string; width: number; pattern: 'solid' | 'dashed' | 'dotted' }
    radius: number
  }
}

export type SummaryStyle = 'pbi' | 'list' | 'count' | 'chips'
export type ItemSort = 'default' | 'asc' | 'desc' | 'countDesc' | 'countAsc' | 'measureDesc' | 'measureAsc'

export interface SlicerExtras {
  /** dropdown box text: 'pbi' = All / value / "Multiple selections"; 'list' = "A, B +3"; 'count' = "3 of 12 selected"; 'chips' = removable pills */
  summary: SummaryStyle
  /** clear (×) button inside the dropdown box */
  clearButton: boolean
  /** popup width in px (0 = same as the box) and max height (0 = auto) */
  popupWidth: number
  popupMaxHeight: number
  /** show the row count of each item (COUNTROWS of the field's table under the slicer's filters) */
  showCounts: boolean
  /** list selected items first */
  selectedFirst: boolean
  sort: ItemSort
  /** measure used by 'measureDesc' / 'measureAsc' ("Table[Measure]" or "Measure") */
  sortMeasure?: string
  /** date presets (Today, This month, Last 30 days, YTD...) on date fields */
  datePresets: boolean
  /** never allow an empty selection: auto-select the first item, keep the last selected item */
  forceSelection: boolean
}

export const DEFAULT_EXTRAS: SlicerExtras = {
  summary: 'pbi',
  clearButton: false,
  popupWidth: 0,
  popupMaxHeight: 0,
  showCounts: false,
  selectedFirst: false,
  sort: 'default',
  datePresets: false,
  forceSelection: false
}

/** PBI sometimes writes font stacks with doubled/unbalanced quotes (`''Segoe UI Semibold', wf_...'`). */
export function cleanFamily(f: string | undefined): string | undefined {
  if (!f) return f
  return f.replace(/'/g, '').trim()
}

function normalizeMode(m: unknown): SlicerMode {
  const s = String(m ?? 'Basic')
  // PBI 2025+ writes 'VerticalList' / 'HorizontalList' (format pane "Vertical list" / "Tile") next to the legacy 'Basic'
  if (s.toLowerCase() === 'verticallist' || s.toLowerCase() === 'horizontallist') return 'Basic'
  const known: SlicerMode[] = ['Basic', 'Dropdown', 'Between', 'Before', 'After', 'Single', 'Relative', 'RelativeTime', 'RelativeDatePicker']
  return known.find((k) => k.toLowerCase() === s.toLowerCase()) ?? 'Basic'
}

export function readSlicerFormat(visualJson: any, theme: ResolvedTheme): SlicerFormat {
  const pc = makePropContext(visualJson, theme)
  const fg = theme.foreground
  const headerFont = readFont(pc, 'header', { size: 10, color: fg, family: 'Segoe UI Semibold' }, { size: 'textSize' })
  headerFont.family = cleanFamily(headerFont.family)
  // Item text: PBI's "lightLabel" text class / secondLevelElements ("Slicer item font color", #605E5C), except the
  // dropdown style, whose items use firstLevelElements ("Slicer dropdown item font color", #252423) — Microsoft Learn,
  // report-themes-create-custom (structural colors + text classes tables).
  const modeForColor = normalizeMode(getProp<any>(pc, 'data', 'mode', 'Basic'))
  const itemColor = modeForColor === 'Dropdown' ? fg : theme.foregroundNeutralSecondary || '#605E5C'
  const itemFont = readFont(pc, 'items', { size: 10, color: itemColor, family: 'Segoe UI' }, { size: 'textSize' })
  itemFont.family = cleanFamily(itemFont.family)
  const orientation = getProp<any>(pc, 'general', 'orientation', 0)
  const rawMode = String(getProp<any>(pc, 'data', 'mode', 'Basic'))
  const base: SlicerFormat = {
    pc,
    mode: normalizeMode(rawMode),
    horizontal: Number(orientation) === 1 || String(orientation).toLowerCase() === 'horizontal' || rawMode.toLowerCase() === 'horizontallist',
    searchEnabled: getProp<boolean>(pc, 'general', 'selfFilterEnabled', false) === true,
    inverted: getProp<boolean>(pc, 'data', 'isInvertedSelectionMode', false) === true,
    header: {
      show: getProp<boolean>(pc, 'header', 'show', true) !== false,
      text: getProp<string | undefined>(pc, 'header', 'text', undefined),
      font: headerFont,
      background: optionalColor(pc, 'header', 'background'),
      outline: Number(getProp<any>(pc, 'header', 'outline', 0)) || outlineFromName(getProp<any>(pc, 'header', 'outline', 'None')),
      outlineColor: getColor(pc, 'header', 'outlineColor', '#C8C6C4'),
      outlineWeight: Number(getProp<any>(pc, 'header', 'outlineWeight', 1)) || 1
    },
    items: {
      font: itemFont,
      background: optionalColor(pc, 'items', 'background'),
      padding: Number(getProp<any>(pc, 'items', 'padding', 4)) || 0,
      outline: Number(getProp<any>(pc, 'items', 'outlineStyle', 0)) || outlineFromName(getProp<any>(pc, 'items', 'outline', 'None')),
      outlineColor: getColor(pc, 'items', 'outlineColor', '#C8C6C4'),
      indent: Number(getProp<any>(pc, 'items', 'steppedLayoutIndentation', 10)),
      toggleType: Number(getProp<any>(pc, 'items', 'expandCollapseToggleType', 0)) || 0
    },
    selection: {
      selectAll: getProp<boolean>(pc, 'selection', 'selectAllCheckboxEnabled', false) === true,
      // PBI naming quirk: `singleSelect` is the "Multi-select with CTRL" toggle; `strictSingleSelect` is "Single select".
      ctrlMulti: getProp<boolean>(pc, 'selection', 'singleSelect', true) !== false,
      strictSingle: getProp<boolean>(pc, 'selection', 'strictSingleSelect', false) === true
    },
    slider: {
      show: getProp<boolean>(pc, 'slider', 'show', true) !== false,
      color: getColor(pc, 'slider', 'color', '#605E5C'),
      handleFill: getColor(pc, 'slider', 'handleFillColor', '#FFFFFF'),
      handleBorder: getColor(pc, 'slider', 'handleBorderColor', getColor(pc, 'slider', 'color', '#605E5C')),
      handleSize: Number(getProp<any>(pc, 'slider', 'handleSize', 12)) || 12,
      secondaryLine: getColor(pc, 'slider', 'secondaryLineColor', '#C8C6C4'),
      bar:
        getProp<boolean>(pc, 'general', 'responsive', true) === false
          ? { width: Number(getProp<any>(pc, 'slider', 'handleWidth', 7)) || 7, height: Number(getProp<any>(pc, 'slider', 'handleHeight', 17)) || 17 }
          : undefined
    },
    dropdown: {
      // PBI's dropdown box: 1px #C8C6C4 border, square corners, chevron in the item font color
      borderColor: getColor(pc, 'dropdown', 'borderColor', '#C8C6C4'),
      radius: Number(getProp<any>(pc, 'dropdown', 'borderRadius', 0)) || 0,
      iconColor: getColor(pc, 'dropdown', 'iconColor', itemFont.color),
      accentBar:
        getProp<boolean>(pc, 'dropdown', 'accentBarShow', false) === true
          ? {
              color: getColor(pc, 'dropdown', 'accentBarColor', theme.dataColors?.[0] ?? '#118DFF'),
              position: (String(getProp<any>(pc, 'dropdown', 'accentBarPosition', 'left')).toLowerCase() as 'left') || 'left',
              width: Number(getProp<any>(pc, 'dropdown', 'accentBarWidth', 4)) || 4
            }
          : undefined
    },
    searchBox: { background: optionalColor(pc, 'searchBox', 'background'), borderColor: getColor(pc, 'searchBox', 'borderColor', '#C8C6C4') },
    // range inputs: firstLevelElements ("Slicer numeric input font color", #252423)
    numericInput: { font: cleaned(readFont(pc, 'numericInputStyle', { ...itemFont, color: fg }, { size: 'textSize' })), background: optionalColor(pc, 'numericInputStyle', 'background') },
    selectionIcon: getColor(pc, 'selectionIcon', 'color', fg),
    date: {
      font: cleaned(readFont(pc, 'date', { ...itemFont, color: fg }, { size: 'textSize' })),
      background: optionalColor(pc, 'date', 'background'),
      hidePicker: getProp<boolean>(pc, 'date', 'hideDatePickerButton', false) === true,
      includeToday: getProp<boolean>(pc, 'dateRange', 'includeToday', true) !== false,
      anchorDate: dateProp(getProp<any>(pc, 'dateRange', 'anchorDate', undefined))
    },
    picker: readPicker(pc, headerFont),
    sort: sortOf(visualJson),
    ext: readExtras(pc)
  }
  return visualJson?.visual?.visualType === 'listSlicer' ? applyListSlicer(base, pc, theme) : base
}

/**
 * New list slicer (`listSlicer`): no slicer header (the container title is used), items styled by
 * `value`, Dropdown via `data.dropdownMode`, selection pills (`pills`, on by default in dropdown mode:
 * "Selection pills show current selections and let you remove them"), drawer size from `dropdownMenu`.
 * "Single select" / "Force selection" are PBI's `singleSelect` / `strictSingleSelect`.
 */
function applyListSlicer(f: SlicerFormat, pc: PropContext, theme: ResolvedTheme): SlicerFormat {
  const font = readFont(pc, 'value', { size: 10, color: theme.foreground, family: 'Segoe UI' }, { size: 'fontSize' })
  font.family = cleanFamily(font.family)
  const dropdown = getProp<boolean>(pc, 'data', 'dropdownMode', false) === true
  const pills = getProp<boolean>(pc, 'pills', 'show', true) !== false
  const menuW = Number(getProp<any>(pc, 'dropdownMenu', 'width', 0)) || 0
  const menuH = Number(getProp<any>(pc, 'dropdownMenu', 'maxHeight', 0)) || 0
  return {
    ...f,
    mode: dropdown ? 'Dropdown' : f.mode === 'Dropdown' ? 'Basic' : f.mode,
    header: { ...f.header, show: false },
    items: { ...f.items, font },
    searchEnabled: f.searchEnabled || getProp<boolean>(pc, 'search', 'show', false) === true,
    ext: {
      ...f.ext,
      summary: f.ext.summary !== 'pbi' ? f.ext.summary : dropdown && pills ? 'chips' : 'pbi',
      popupWidth: f.ext.popupWidth || menuW,
      popupMaxHeight: f.ext.popupMaxHeight || menuH
    }
  }
}

/**
 * Date picker formatting. Defaults measured on Microsoft Learn's date picker screenshots (rendered at 150%):
 * range and restatement text in Segoe UI at the header size, #616161 (Fluent neutral foreground 2);
 * a 22 px square calendar button with a 1 px #C8C6C4 outline, 4 px corners and a #616161 icon.
 */
function readPicker(pc: PropContext, headerFont: FontSpec): PickerFormat {
  const textBase = { size: headerFont.size, color: '#616161', family: 'Segoe UI' }
  const rangeFont = cleaned(readFont(pc, 'dateRangeText', { ...textBase }, { size: 'fontSize', color: 'color' }))
  const relativeFont = cleaned(readFont(pc, 'relativeText', { ...textBase }, { size: 'fontSize', color: 'color' }))
  const alpha = (obj: string, prop: string) => {
    const t = Number(getProp<any>(pc, obj, prop, 0))
    return Number.isFinite(t) ? Math.max(0, Math.min(1, 1 - t / 100)) : 1
  }
  rangeFont.color = withAlpha(rangeFont.color, alpha('dateRangeText', 'transparency'))
  relativeFont.color = withAlpha(relativeFont.color, alpha('relativeText', 'transparency'))
  const strokeShow = getProp<boolean>(pc, 'calendarButton', 'strokeShow', true) !== false
  const bgShow = getProp<boolean>(pc, 'calendarButton', 'backgroundShow', false) === true
  const pattern = String(getProp<any>(pc, 'calendarButton', 'strokePattern', 'solid'))
  return {
    singleDate: getProp<boolean>(pc, 'selection', 'singleDate', false) === true,
    rangeFont,
    relativeFont,
    relativeShow: getProp<boolean>(pc, 'relativeText', 'show', true) !== false,
    // Learn screenshot: 2 px #707070 track, white 20 px handles (the format pane shows "Size 20 px") with a
    // #242424 border. The selected-range color isn't visible in any screenshot: #242424 like the handles.
    sliderColor: getColor(pc, 'slider', 'color', '#242424'),
    trackColor: getColor(pc, 'slider', 'secondaryLineColor', '#707070'),
    handleBorder: getColor(pc, 'slider', 'handleBorderColor', '#242424'),
    handleSize: Number(getProp<any>(pc, 'slider', 'handleSize', 20)) || 20,
    button: {
      iconColor: withAlpha(getColor(pc, 'calendarButton', 'iconColor', '#616161'), alpha('calendarButton', 'iconTransparency')),
      iconSize: Math.max(8, Number(getProp<any>(pc, 'calendarButton', 'iconSize', 0)) ? ptToPxLocal(Number(getProp<any>(pc, 'calendarButton', 'iconSize', 0))) : 14),
      background: bgShow ? withAlpha(getColor(pc, 'calendarButton', 'backgroundColor', '#FFFFFF'), alpha('calendarButton', 'backgroundTransparency')) : undefined,
      stroke: strokeShow
        ? {
            color: withAlpha(getColor(pc, 'calendarButton', 'strokeColor', '#C8C6C4'), alpha('calendarButton', 'strokeTransparency')),
            width: Math.max(0, Number(getProp<any>(pc, 'calendarButton', 'strokeWidth', 1)) || 1),
            pattern: pattern === 'dashed' || pattern === 'dotted' ? pattern : 'solid'
          }
        : undefined,
      radius: Math.max(0, Number(getProp<any>(pc, 'calendarButton', 'cornerRadius', 4)))
    }
  }
}

function ptToPxLocal(pt: number): number {
  return (pt * 96) / 72
}

/** `#RRGGBB` + opacity → rgba() (other color syntaxes are returned unchanged when fully opaque). */
function withAlpha(color: string, a: number): string {
  if (a >= 1) return color
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`
}

function dateProp(v: unknown): Date | undefined {
  if (v instanceof Date) return v
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.length === 10 ? v + 'T00:00:00Z' : v.endsWith('Z') ? v : v + 'Z')
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

function sortOf(visualJson: any): 'asc' | 'desc' | undefined {
  const s = visualJson?.visual?.query?.sortDefinition?.sort?.[0]
  if (!s) return undefined
  return s.direction === 'Descending' || s.direction === 2 ? 'desc' : 'asc'
}

/** Lumen-only slicer options (object `lumenSlicer`). */
export function readExtras(pc: PropContext): SlicerExtras {
  const g = <T,>(name: string, d: T): T => getProp<T>(pc, 'lumenSlicer', name, d)
  const num = (name: string, d: number) => {
    const v = Number(g<any>(name, d))
    return Number.isFinite(v) ? Math.max(0, v) : d
  }
  const summary = String(g<any>('summary', 'pbi')) as SummaryStyle
  const sort = String(g<any>('sort', 'default')) as ItemSort
  return {
    summary: (['pbi', 'list', 'count', 'chips'] as const).includes(summary) ? summary : 'pbi',
    clearButton: g<boolean>('clearButton', false) === true,
    popupWidth: num('popupWidth', 0),
    popupMaxHeight: num('popupMaxHeight', 0),
    showCounts: g<boolean>('showCounts', false) === true,
    selectedFirst: g<boolean>('selectedFirst', false) === true,
    sort: (['default', 'asc', 'desc', 'countDesc', 'countAsc', 'measureDesc', 'measureAsc'] as const).includes(sort) ? sort : 'default',
    sortMeasure: (g<string | undefined>('sortMeasure', undefined) || undefined) as string | undefined,
    datePresets: g<boolean>('datePresets', false) === true,
    forceSelection: g<boolean>('forceSelection', false) === true
  }
}

function cleaned(f: FontSpec): FontSpec {
  f.family = cleanFamily(f.family)
  return f
}

function outlineFromName(v: unknown): number {
  const s = String(v ?? '').toLowerCase()
  const map: Record<string, number> = { none: 0, bottomonly: 1, toponly: 2, leftonly: 3, rightonly: 4, topbottom: 5, leftright: 6, frame: 7 }
  return map[s] ?? 0
}

function optionalColor(pc: PropContext, object: string, prop: string): string | undefined {
  const c = getColor(pc, object, prop, '')
  return c || undefined
}

/** CSS borders for a PBI outline enum value. */
export function outlineCss(outline: number, color: string, weight = 1): CSSProperties {
  const b = `${weight}px solid ${color}`
  switch (outline) {
    case OUTLINE.BottomOnly:
      return { borderBottom: b }
    case OUTLINE.TopOnly:
      return { borderTop: b }
    case OUTLINE.LeftOnly:
      return { borderLeft: b }
    case OUTLINE.RightOnly:
      return { borderRight: b }
    case OUTLINE.TopBottom:
      return { borderTop: b, borderBottom: b }
    case OUTLINE.LeftRight:
      return { borderLeft: b, borderRight: b }
    case OUTLINE.Frame:
      return { border: b }
    default:
      return {}
  }
}

/** Object name of the Lumen-only slicer options. */
export const LUMEN_SLICER_OBJECT = 'lumenSlicer'

/**
 * Keep untouched reports byte-identical for PBI Desktop: drop `lumenSlicer` properties whose value equals
 * the default (PBI behavior) and remove the object when nothing is left. Call after every write to the
 * object (format pane) and before saving. Mutates `visualJson`; returns true when something changed.
 */
export function normalizeLumenSlicer(visualJson: any): boolean {
  const objs = visualJson?.visual?.objects
  const entries: any[] | undefined = objs?.[LUMEN_SLICER_OBJECT]
  if (!entries) return false
  let changed = false
  const defaults = DEFAULT_EXTRAS as unknown as Record<string, unknown>
  for (const e of entries) {
    for (const [k, raw] of Object.entries<any>(e?.properties ?? {})) {
      const lit = raw?.expr?.Literal?.Value
      const v = typeof lit === 'string' ? decodeLumenLiteral(lit) : undefined
      const isDefault = k === 'sortMeasure' ? v === undefined || v === '' : k in defaults ? v === defaults[k] : false
      if (isDefault || !(k in defaults || k === 'sortMeasure')) {
        delete e.properties[k]
        changed = true
      }
    }
  }
  const kept = entries.filter((e) => e?.properties && Object.keys(e.properties).length)
  if (kept.length !== entries.length) changed = true
  if (kept.length) objs[LUMEN_SLICER_OBJECT] = kept
  else delete objs[LUMEN_SLICER_OBJECT]
  return changed
}

function decodeLumenLiteral(s: string): string | number | boolean | undefined {
  if (s === 'true' || s === 'false') return s === 'true'
  const q = /^'(.*)'$/s.exec(s)
  if (q) return q[1].replace(/''/g, "'")
  const n = /^(-?\d+(?:\.\d+)?)[DLM]?$/.exec(s)
  return n ? Number(n[1]) : undefined
}
