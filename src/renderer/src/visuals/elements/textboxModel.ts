/**
 * Textbox paragraphs model: PBIR `objects.general[0].properties.paragraphs` → normalized
 * paragraphs/runs with CSS-ready styles. Pure (no React/DOM) so it is unit-testable.
 *
 * PBIR shape:
 *   paragraphs: [{ textRuns: [{ value, textStyle?: { fontFamily, fontSize: '14pt', fontWeight, fontStyle,
 *                 textDecoration, color }, url? }], horizontalTextAlignment?, listType?: 'bullet'|'number', indent? }]
 * Unknown keys are ignored (the corpus has generated textStyles holding stray `value`/nested
 * `textStyle` keys; PBI ignores them and renders the run with the default style).
 *
 * Dynamic values ("+ Value" in the textbox) bind a run to a field. The binding is read from any
 * of `valueExpr`, `expression`, `expr`, `field`, `valueExpression` holding an SQ field expression
 * (we have no corpus sample of this rarely used feature; all plausible spellings are accepted).
 */
import type { SQExpr } from '@core/report/sq'
import { cssFont, parseFontSize } from '../common/textStyle'
import { isSegoeFamily, segoeTextWidth } from './segoeMetrics'

export interface RunStyle {
  fontFamily: string
  /** px */
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  textDecoration?: string
  color: string
}

export interface TextRun {
  text: string
  style: RunStyle
  url?: string
  /** dynamic value binding (evaluated by the component) */
  binding?: SQExpr
  /** dynamic value referencing `objects.values` by selector id (Q&A "+ Value" / smart narrative) */
  valueRef?: string
  /** resolved from a dynamic value (Power BI underlines these in theme color 1 while editing) */
  dynamic?: boolean
  /** smart-narrative template switch: the runs of the case whose pattern equals the value of `on` */
  cases?: { on: string; cases: Array<{ pattern: unknown; runs: TextRun[] }>; otherwise: TextRun[] }
}

/** Key of a run's dynamic value in the evaluated-values map (undefined for static text). */
export function dynamicKey(run: TextRun): string | undefined {
  if (run.valueRef !== undefined) return 'ref:' + run.valueRef
  if (run.binding) return 'expr:' + JSON.stringify(run.binding)
  return undefined
}

export interface Paragraph {
  runs: TextRun[]
  align: 'left' | 'center' | 'right' | 'justify'
  listType?: 'bullet' | 'number'
  indent: number
  /** 1-based number for numbered lists (consecutive numbered paragraphs at the same indent) */
  listIndex?: number
}

export interface TextboxDefaults {
  fontFamily: string
  /** pt */
  fontSize: number
  color: string
}

export const TEXTBOX_DEFAULTS: TextboxDefaults = { fontFamily: 'Segoe UI', fontSize: 10, color: '#252423' }

/**
 * Run font when a text run has no textStyle: the theme's `label` text class (Power BI's text box, button and
 * navigator text start from it; the default theme's label class is Segoe UI 10pt #252423). A custom theme that
 * changes the label class (e.g. 12pt) changes unstyled text box text too: measured on a Power BI render of a report
 * whose theme sets label = 12pt (unstyled text box and page-navigator text measure 12.0–12.7pt).
 */
export function themeTextDefaults(theme: { textClasses?: Record<string, { fontFace?: string; fontSize?: number; color?: string }> } | undefined): TextboxDefaults {
  const label = theme?.textClasses?.label ?? {}
  return {
    fontFamily: typeof label.fontFace === 'string' && label.fontFace ? label.fontFace : TEXTBOX_DEFAULTS.fontFamily,
    fontSize: typeof label.fontSize === 'number' && label.fontSize > 0 ? label.fontSize : TEXTBOX_DEFAULTS.fontSize,
    color: typeof label.color === 'string' && label.color ? label.color : TEXTBOX_DEFAULTS.color
  }
}

const BINDING_KEYS = ['valueExpr', 'expression', 'expr', 'field', 'valueExpression']

function isFieldExpr(e: any): boolean {
  return !!(e && typeof e === 'object' && (e.Measure || e.Column || e.Aggregation || e.HierarchyLevel))
}

function bindingOf(run: any): SQExpr | undefined {
  for (const k of BINDING_KEYS) {
    const v = run?.[k]
    if (isFieldExpr(v)) return v
    if (isFieldExpr(v?.expr)) return v.expr
  }
  return undefined
}

function weightOf(v: unknown, familyWeight: number | undefined): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').toLowerCase()
  if (s === 'bold' || s === 'bolder') return 700
  if (s === 'semibold') return 600
  if (s === 'light' || s === 'lighter') return 300
  if (/^\d{3}$/.test(s)) return Number(s)
  return familyWeight ?? 400
}

export function normalizeStyle(ts: any, defaults: TextboxDefaults = TEXTBOX_DEFAULTS): RunStyle {
  const s = ts && typeof ts === 'object' ? ts : {}
  const family = typeof s.fontFamily === 'string' && s.fontFamily ? s.fontFamily : defaults.fontFamily
  const ff = cssFont(family)
  const deco = typeof s.textDecoration === 'string' && s.textDecoration !== 'none' ? s.textDecoration : undefined
  return {
    fontFamily: ff.fontFamily,
    fontSize: parseFontSize(s.fontSize, defaults.fontSize),
    fontWeight: weightOf(s.fontWeight, ff.fontWeight),
    fontStyle: String(s.fontStyle ?? '').toLowerCase() === 'italic' ? 'italic' : 'normal',
    textDecoration: deco,
    color: typeof s.color === 'string' && s.color ? s.color : defaults.color
  }
}

function refId(v: any): string | undefined {
  const id = v && typeof v === 'object' && v.propertyIdentifier ? v.selector?.id : undefined
  return typeof id === 'string' ? id : undefined
}

function literalPattern(p: any): unknown {
  const raw = p?.expr?.Literal?.Value ?? p?.Literal?.Value
  if (typeof raw !== 'string') return raw
  const m = /^(-?\d+(?:\.\d+)?)[LDM]?$/.exec(raw)
  if (m) return Number(m[1])
  return raw.replace(/^'|'$/g, '')
}

function buildRun(r: any, defaults: TextboxDefaults): TextRun {
  const style = normalizeStyle(r?.textStyle, defaults)
  const url = typeof r?.url === 'string' && r.url ? r.url : undefined
  if (Array.isArray(r?.cases) || r?.defaultCase) {
    const on = refId(r.expression) ?? ''
    const sub = (rs: any) => (Array.isArray(rs?.textRuns) ? rs.textRuns : []).map((x: any) => buildRun(x, defaults))
    return {
      text: '',
      style,
      cases: { on, cases: (r.cases ?? []).map((c: any) => ({ pattern: literalPattern(c.pattern), runs: sub(c) })), otherwise: sub(r.defaultCase) }
    }
  }
  const ref = refId(r?.value)
  if (ref !== undefined) return { text: '', style, url, valueRef: ref }
  const text = typeof r?.value === 'string' ? r.value : r?.value === undefined || r?.value === null ? '' : String(r.value)
  // smart narratives write "__Newline__" for a line break in template text
  return { text: text === '__Newline__' ? '\n' : text, style, url, binding: bindingOf(r) }
}

/** Runs of a smart-narrative switch for a template id (falls back to the default case). */
export function caseRuns(run: TextRun, value: unknown): TextRun[] {
  if (!run.cases) return [run]
  const hit = run.cases.cases.find((c) => c.pattern === value || String(c.pattern) === String(value))
  return hit ? hit.runs : run.cases.otherwise
}

function alignOf(v: unknown): Paragraph['align'] {
  const s = String(v ?? '').toLowerCase()
  return s === 'center' ? 'center' : s === 'right' ? 'right' : s === 'justify' ? 'justify' : 'left'
}

export function buildParagraphs(raw: unknown, defaults: TextboxDefaults = TEXTBOX_DEFAULTS): Paragraph[] {
  const list = Array.isArray(raw) ? raw : []
  const out: Paragraph[] = []
  const counters: number[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const runs: TextRun[] = (Array.isArray(p.textRuns) ? p.textRuns : []).map((r: any) => buildRun(r, defaults))
    const listType = p.listType === 'bullet' || p.listType === 'number' ? p.listType : undefined
    const indent = Number.isFinite(Number(p.indent)) ? Math.max(0, Number(p.indent)) : 0
    let listIndex: number | undefined
    if (listType === 'number') {
      counters.length = indent + 1
      counters[indent] = (counters[indent] ?? 0) + 1
      listIndex = counters[indent]
    } else if (!listType) counters.length = 0
    out.push({ runs, align: alignOf(p.horizontalTextAlignment), listType, indent, listIndex })
  }
  return out
}

/** Plain text of a paragraph list (for getData / accessibility / tooltips). */
export function paragraphsText(ps: Paragraph[]): string {
  return ps.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
}

/** Bullet glyph by indent level (PBI cycles •, ◦, ▪). */
export function bulletGlyph(indent: number): string {
  return ['•', '◦', '▪'][indent % 3]
}

/** Serialize edited plain text back into PBIR paragraphs, keeping the first run's style per line. */
export function paragraphsFromText(text: string, previous: any[]): any[] {
  const lines = text.replace(/\r/g, '').split('\n')
  return lines.map((line, i) => {
    const prev = previous[Math.min(i, previous.length - 1)] ?? {}
    const style = prev.textRuns?.[0]?.textStyle
    const para: any = { textRuns: [{ value: line, ...(style ? { textStyle: style } : {}) }] }
    if (prev.horizontalTextAlignment) para.horizontalTextAlignment = prev.horizontalTextAlignment
    if (prev.listType && i < previous.length) para.listType = prev.listType
    if (prev.indent && i < previous.length) para.indent = prev.indent
    return para
  })
}

/**
 * Width (px) Power BI needs for a paragraph on one line, using Segoe UI metrics. Undefined when a run
 * uses a non-Segoe family (we can't predict its metrics) or is a dynamic value (text unknown here).
 */
export function segoeParagraphWidth(p: Paragraph): number | undefined {
  let w = 0
  for (const r of p.runs) {
    if (r.binding || r.valueRef !== undefined || r.cases) return undefined
    if (!isSegoeFamily(r.style.fontFamily)) return undefined
    w += segoeTextWidth(r.text, r.style.fontSize, r.style.fontWeight)
  }
  return w
}

/**
 * Does PBI render this paragraph on a single line in a text box `availablePx` wide? Used to stop the
 * wider Linux fallback font (Open Sans) from wrapping titles that fit in Segoe UI.
 */
export function fitsOneLineInPbi(p: Paragraph, availablePx: number): boolean {
  if (!p.runs.length || p.runs.some((r) => /\n/.test(r.text))) return false
  const w = segoeParagraphWidth(p)
  if (w === undefined) return false
  const indentPx = (p.listType ? 1.5 * (p.indent + 1) : 1.5 * p.indent) * (p.runs[0]?.style.fontSize ?? 13.33)
  // 3% slack: PBI lays text boxes out a few px wider than our content box (e.g. a 28pt Segoe UI Light
  // "District Monthly Sales" = 332px stays on one line in a 340px text box, whose content box here is
  // 330px after the 5px container padding); fitScale() then shrinks the line into the real width.
  return w + indentPx <= availablePx * 1.03
}

/** Font scale that makes a line measured at `naturalPx` fit `availablePx` (never enlarges; floor 0.7). */
export function fitScale(naturalPx: number, availablePx: number): number {
  if (!(naturalPx > 0) || naturalPx <= availablePx) return 1
  return Math.max(0.7, Math.floor((availablePx / naturalPx) * 1000) / 1000)
}
