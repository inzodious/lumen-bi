/**
 * Typed accessors over core/report/props for visual components: one `FormatReader` per render
 * resolves `visual.objects` → theme visualStyles → PBI defaults.
 */
import { decodeValue, getProp, makePropContext, type PropContext, type Selector } from '@core/report/props'
import { findEntry, type ScopeField } from './color'
import type { ResolvedTheme } from '@core/report/theme'
import { ptToPx, fontWeightOf, type FontSpec } from './text'

export interface TextStyle {
  font: FontSpec
  color: string
}

export interface TextPropNames {
  size?: string
  family?: string
  color?: string
  bold?: string
  italic?: string
}

export class FormatReader {
  readonly pc: PropContext
  constructor(
    visualJson: any,
    readonly theme: ResolvedTheme
  ) {
    this.pc = makePropContext(visualJson, theme)
  }

  get visualType(): string {
    return this.pc.visualType
  }

  /**
   * Selector to use for a per-series property: the series' `metadata` entry when it sets the
   * property, otherwise undefined (= the default entry → theme), mirroring PBI's per-series override.
   */
  seriesSel(object: string, prop: string, metadata: string | undefined): Selector | undefined {
    if (!metadata) return undefined
    const entries = [...(this.pc.objects?.[object] ?? [])]
    return entries.some((e) => e.selector?.metadata === metadata && !e.selector?.data && e.properties && prop in e.properties) ? { metadata } : undefined
  }

  /**
   * Per-series value: an entry whose data selector matches the series scope (legend series) or
   * whose metadata selector is the measure's queryRef; otherwise the default entry → theme.
   */
  seriesRaw(object: string, prop: string, series: { metadata?: string; scope?: ScopeField[] }): any {
    const hit = findEntry(this.pc.objects?.[object] ?? [], prop, { metadata: series.metadata, fields: series.scope })
    if (hit) return decodeValue(hit.properties[prop], this.theme)
    return this.raw(object, prop)
  }

  sBool(object: string, prop: string, fallback: boolean, series: { metadata?: string; scope?: ScopeField[] }): boolean {
    const v = this.seriesRaw(object, prop, series)
    return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback
  }

  sNum(object: string, prop: string, fallback: number, series: { metadata?: string; scope?: ScopeField[] }): number {
    const v = this.seriesRaw(object, prop, series)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  sStr(object: string, prop: string, fallback: string, series: { metadata?: string; scope?: ScopeField[] }): string {
    const v = this.seriesRaw(object, prop, series)
    return typeof v === 'string' && v !== '' ? v : fallback
  }

  /** undefined when not set anywhere (lets callers apply an "auto" color) */
  sColor(object: string, prop: string, series: { metadata?: string; scope?: ScopeField[] }): string | undefined {
    const v = this.seriesRaw(object, prop, series)
    return typeof v === 'string' && v.startsWith('#') ? v : typeof v === 'string' && v ? v : undefined
  }

  raw(object: string, prop: string, sel?: Selector): any {
    return getProp<any>(this.pc, object, prop, undefined, sel)
  }

  bool(object: string, prop: string, fallback: boolean, sel?: Selector): boolean {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    if (typeof v === 'boolean') return v
    if (v === 'true') return true
    if (v === 'false') return false
    return fallback
  }

  num(object: string, prop: string, fallback: number, sel?: Selector): number {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  /** Number or undefined when unset (e.g. axis start/end "Auto"). */
  optNum(object: string, prop: string, sel?: Selector): number | undefined {
    const v = getProp<any>(this.pc, object, prop, undefined, sel)
    if (v === null || v === undefined || v === '') return undefined
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  str(object: string, prop: string, fallback: string, sel?: Selector): string {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    return typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v)
  }

  optStr(object: string, prop: string, sel?: Selector): string | undefined {
    const v = getProp<any>(this.pc, object, prop, undefined, sel)
    return typeof v === 'string' && v !== '' ? v : undefined
  }

  color(object: string, prop: string, fallback: string, sel?: Selector): string {
    const v = getProp<any>(this.pc, object, prop, fallback, sel)
    return typeof v === 'string' ? v : fallback
  }

  /** Text style from an object (sizes in pt → px). */
  text(object: string, names: TextPropNames, defaults: { size: number; family?: string; color: string; bold?: boolean; italic?: boolean }, metadata?: string): TextStyle {
    const s = (p: string) => this.seriesSel(object, p, metadata)
    const n = { size: names.size ?? 'fontSize', family: names.family ?? 'fontFamily', bold: names.bold ?? 'bold', italic: names.italic ?? 'italic', color: names.color ?? 'color' }
    const sizePt = this.num(object, n.size, defaults.size, s(n.size))
    const family = this.str(object, n.family, defaults.family ?? 'Segoe UI', s(n.family))
    const bold = this.bool(object, n.bold, defaults.bold ?? false, s(n.bold))
    const italic = this.bool(object, n.italic, defaults.italic ?? false, s(n.italic))
    const color = this.color(object, n.color, defaults.color, s(n.color))
    return { font: { size: ptToPx(sizePt), family, weight: fontWeightOf(family, bold), italic }, color }
  }
}

/** PBI default text colors / sizes (CY24SU10 look). */
export const PBI = {
  labelColor: '#605E5C',
  titleColor: '#252423',
  // smallLightLabel (Learn text classes: "Data labels"); sampled #605E5C on PBI renders
  dataLabelColor: '#605E5C',
  gridColor: '#C8C6C4',
  axisFontPt: 9,
  axisTitleFontPt: 12,
  legendFontPt: 8,
  legendTitleFontPt: 8,
  dataLabelFontPt: 9,
  fontFamily: 'Segoe UI',
  /** opacity of non-selected / non-highlighted points */
  dimOpacity: 0.4,
  /** cross-highlight: background (full) bar opacity */
  highlightBackOpacity: 0.4
}

/**
 * Axis-title defaults from the theme's `title` text class (PBI: "Category and value axis titles"),
 * e.g. CY24SU10 = DIN 12pt #252423.
 */
export function axisTitleDefaults(fmt: FormatReader): { size: number; family: string; color: string } {
  const tc = fmt.theme.textClasses?.title ?? {}
  return { size: tc.fontSize ?? PBI.axisTitleFontPt, family: tc.fontFace ?? 'DIN', color: tc.color ?? PBI.titleColor }
}

/** Default text style of a theme text class (label / callout / title / header) with fallbacks. */
export function textClass(theme: ResolvedTheme, name: string, fallback: { size: number; family: string; color: string }): { size: number; family: string; color: string } {
  const tc = theme.textClasses?.[name] ?? {}
  return { size: tc.fontSize ?? fallback.size, family: tc.fontFace ?? fallback.family, color: tc.color ?? fallback.color }
}
