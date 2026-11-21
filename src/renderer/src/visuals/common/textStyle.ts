/**
 * Text styling helpers shared by the non-chart visuals (tables, cards, slicers, elements).
 *
 * Power BI stores font sizes in points (formatting pane "10" = 10pt = 13.33px) and font families
 * as CSS-ish names where weight is encoded in the family ("Segoe UI Semibold", "Segoe UI Light",
 * "DIN"...). We translate them into CSS with a Segoe-like fallback stack so Linux renders closely.
 */
import type { CSSProperties } from 'react'
import { getColor, getProp, type PropContext, type Selector } from '@core/report/props'
import { knownFontStack } from './text'

export const FALLBACK_STACK = "'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"

/** points → CSS pixels */
export function ptToPx(pt: number): number {
  return (pt * 96) / 72
}

/** Parse "14pt" / "12px" / 12 → px. Bare numbers are points (PBI convention). */
export function parseFontSize(v: unknown, fallbackPt = 10): number {
  if (typeof v === 'number' && Number.isFinite(v)) return ptToPx(v)
  if (typeof v === 'string') {
    const m = /^\s*(-?[\d.]+)\s*(pt|px)?\s*$/i.exec(v)
    if (m) return m[2]?.toLowerCase() === 'px' ? Number(m[1]) : ptToPx(Number(m[1]))
  }
  return ptToPx(fallbackPt)
}

const WEIGHT_SUFFIX: Array<[RegExp, number]> = [
  [/\s+(semibold|semi-bold|demibold)$/i, 600],
  [/\s+(bold)$/i, 700],
  [/\s+(black|heavy)$/i, 900],
  [/\s+(light)$/i, 300],
  [/\s+(semilight)$/i, 350],
  [/\s+(thin)$/i, 200]
]

/** "Segoe UI Semibold" → { family: "'Segoe UI', <fallbacks>", weight: 600 }. Stacks are kept as-is. */
export function cssFont(family: string | undefined): { fontFamily: string; fontWeight?: number } {
  if (!family) return { fontFamily: FALLBACK_STACK }
  let f = String(family).trim()
  if (f.includes(',')) {
    // theme stacks like "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif"
    const first = f.split(',')[0].replace(/['"]/g, '').trim()
    const parsed = cssFont(first)
    return { fontFamily: `${parsed.fontFamily.split(',')[0]}, ${FALLBACK_STACK}`, fontWeight: parsed.fontWeight }
  }
  // PBIR sometimes double-quotes stacks ("''Segoe UI Semibold', wf_…'") — drop every quote
  f = f.replace(/['"]/g, '').trim()
  let weight: number | undefined
  for (const [re, w] of WEIGHT_SUFFIX) {
    if (re.test(f)) {
      weight = w
      f = f.replace(re, '')
      break
    }
  }
  if (/^wf_segoe-ui_(\w+)/i.test(f)) {
    const kind = /^wf_segoe-ui_(\w+)/i.exec(f)![1].toLowerCase()
    weight = kind === 'semibold' ? 600 : kind === 'bold' ? 700 : kind === 'light' ? 300 : undefined
    f = 'Segoe UI'
  }
  if (/^din$/i.test(f)) f = 'DIN'
  // a Power BI font that Linux rarely has (Georgia, Consolas, Trebuchet MS…): its own fallbacks (a serif for Georgia,
  // a monospace for Consolas), not the Segoe stand-in, which would turn every face into the same sans-serif
  const known = /^(segoe ui|din)$/i.test(f) ? undefined : knownFontStack(f)
  if (known) return { fontFamily: `'${f}', ${known}`, fontWeight: weight }
  return { fontFamily: `'${f}', ${FALLBACK_STACK}`, fontWeight: weight }
}

export interface FontSpec {
  family?: string
  /** points */
  size: number
  color: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** CSS for a FontSpec. */
export function fontStyle(f: FontSpec): CSSProperties {
  const ff = cssFont(f.family)
  return {
    fontFamily: ff.fontFamily,
    fontWeight: f.bold ? 700 : ff.fontWeight ?? 400,
    fontStyle: f.italic ? 'italic' : 'normal',
    textDecoration: f.underline ? 'underline' : undefined,
    fontSize: `${ptToPx(f.size)}px`,
    color: f.color
  }
}

export interface FontPropNames {
  size?: string
  family?: string
  color?: string
  bold?: string
  italic?: string
  underline?: string
}

/** Read a font group from an object (with PBI's usual property names unless overridden). */
export function readFont(
  pc: PropContext,
  object: string,
  defaults: Partial<FontSpec> & { size: number; color: string },
  names: FontPropNames = {},
  sel?: Selector
): FontSpec {
  const n = { size: 'fontSize', family: 'fontFamily', color: 'fontColor', bold: 'bold', italic: 'italic', underline: 'underline', ...names }
  const rawSize = getProp<any>(pc, object, n.size, defaults.size, sel)
  const size = typeof rawSize === 'number' ? rawSize : Number.parseFloat(String(rawSize)) || defaults.size
  return {
    family: getProp<string | undefined>(pc, object, n.family, defaults.family, sel),
    size,
    color: getColor(pc, object, n.color, defaults.color, sel),
    bold: getProp<boolean>(pc, object, n.bold, defaults.bold ?? false, sel),
    italic: getProp<boolean>(pc, object, n.italic, defaults.italic ?? false, sel),
    underline: getProp<boolean>(pc, object, n.underline, defaults.underline ?? false, sel)
  }
}

/** Theme text class (e.g. 'label', 'callout', 'title', 'header') → defaults for readFont. */
export function textClassDefaults(theme: { textClasses: Record<string, any>; foreground: string }, cls: string, fallbackPt: number): { size: number; color: string; family?: string } {
  const tc = theme.textClasses?.[cls] ?? {}
  return { size: tc.fontSize ?? fallbackPt, color: tc.color ?? theme.foreground, family: tc.fontFace }
}

/** CSS text-align from PBI alignment values ('Left' | 'center' | 'right' | ...). */
export function cssAlign(v: unknown, fallback: 'left' | 'center' | 'right' = 'left'): 'left' | 'center' | 'right' | 'justify' {
  const s = String(v ?? '').toLowerCase()
  if (s === 'center' || s === 'centre' || s === 'middle') return 'center'
  if (s === 'right') return 'right'
  if (s === 'left') return 'left'
  if (s === 'justify') return 'justify'
  return fallback
}

/** Measure text width using a shared canvas (renderer only; returns an estimate in Node). */
let measureCtx: CanvasRenderingContext2D | null | undefined
export function measureText(text: string, font: FontSpec): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  const px = ptToPx(font.size)
  if (!measureCtx) return text.length * px * 0.55
  const ff = cssFont(font.family)
  measureCtx.font = `${font.italic ? 'italic ' : ''}${font.bold ? 700 : ff.fontWeight ?? 400} ${px}px ${ff.fontFamily}`
  return measureCtx.measureText(text).width
}
