/**
 * Text measurement and font helpers shared by the SVG visuals.
 *
 * Power BI expresses font sizes in points; the canvas renders them at 96 dpi, so px = pt * 4/3.
 * Measurement uses a cached 2D canvas context when a DOM is available and falls back to an
 * average-advance approximation in Node (unit tests), which is good enough for layout decisions.
 */

export const PT_TO_PX = 4 / 3

export function ptToPx(pt: number): number {
  return pt * PT_TO_PX
}

/** PBI font family names → CSS font-family stacks with Linux-friendly fallbacks. */
const FONT_STACKS: Record<string, string> = {
  'segoe ui': "'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
  'segoe ui semibold': "'Segoe UI Semibold', 'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', Arial, sans-serif",
  'segoe ui bold': "'Segoe UI Bold', 'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', Arial, sans-serif",
  'segoe ui light': "'Segoe UI Light', 'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', Arial, sans-serif",
  din: "'DIN', 'D-DIN', 'Barlow', 'Roboto Condensed', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  'din light': "'DIN Light', 'DIN', 'Barlow', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  'wf_standard-font': "'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', Arial, sans-serif",
  'wf_standard-font_light': "'Segoe UI Light', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  'wf_segoe-ui_normal': "'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', Arial, sans-serif",
  'wf_segoe-ui_semibold': "'Segoe UI Semibold', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  'wf_segoe-ui_bold': "'Segoe UI Bold', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  'wf_segoe-ui_light': "'Segoe UI Light', 'Segoe UI', 'Open Sans', Arial, sans-serif",
  arial: 'Arial, Helvetica, sans-serif',
  'arial black': "'Arial Black', Arial, sans-serif",
  calibri: "Calibri, Carlito, 'Segoe UI', 'Open Sans', Arial, sans-serif",
  cambria: 'Cambria, Caladea, Georgia, serif',
  'courier new': "'Courier New', Courier, 'Liberation Mono', monospace",
  consolas: "Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace",
  'comic sans ms': "'Comic Sans MS', 'Comic Neue', 'Baloo 2', 'Segoe UI', sans-serif",
  georgia: "Georgia, 'Gelasio', 'Noto Serif', 'DejaVu Serif', serif",
  'times new roman': "'Times New Roman', Times, serif",
  'trebuchet ms': "'Trebuchet MS', 'Segoe UI', sans-serif",
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  'lucida sans unicode': "'Lucida Sans Unicode', 'Lucida Grande', sans-serif",
  corbel: "Corbel, 'Segoe UI', sans-serif",
  candara: "Candara, 'Segoe UI', sans-serif",
  constantia: 'Constantia, Georgia, serif',
  'open sans': "'Open Sans', 'Segoe UI', Arial, sans-serif",
  barlow: "Barlow, 'Segoe UI', Arial, sans-serif",
  'roboto condensed': "'Roboto Condensed', 'Segoe UI', Arial, sans-serif"
}

export const DEFAULT_FONT_FAMILY = 'Segoe UI'

/** The CSS fallback stack Lumen uses for a Power BI font family name (case-insensitive), if it has one. */
export function knownFontStack(family: string): string | undefined {
  return FONT_STACKS[family.trim().toLowerCase()]
}

/** First family of a (possibly quoted / doubly quoted) PBI font value: "''Segoe UI Semibold'', wf_…, arial" → "Segoe UI Semibold". */
export function primaryFamily(family: string | undefined): string {
  return (family ?? '').split(',')[0].replace(/['"]/g, '').trim()
}

/**
 * Weight carried by a PBI family name. Power BI has no weight property: the format pane's font list offers
 * faces ("Segoe UI Light / Semibold / Bold", the web-font aliases `wf_segoe-ui_*`, DIN = `wf_standard-font*`) and a
 * separate Bold toggle. Only the FIRST family of a stack counts (its fallbacks say nothing about the weight).
 */
const FACE_WEIGHTS: Array<[RegExp, number]> = [
  [/[ _-](semi-?bold|demi-?bold)$/i, 600],
  [/[ _-](semi-?light)$/i, 350],
  [/[ _-](extra-?bold|ultra-?bold)$/i, 800],
  [/[ _-](black|heavy)$/i, 900],
  [/[ _-]bold$/i, 700],
  [/[ _-](extra-?light|ultra-?light|thin)$/i, 200],
  [/[ _-]light$/i, 300]
]

function faceOf(first: string): { base: string; weight: number; face?: string } {
  for (const [re, weight] of FACE_WEIGHTS) {
    if (!re.test(first)) continue
    let base = first.replace(re, '')
    if (/^wf_segoe-ui$/i.test(base)) base = 'Segoe UI'
    else if (/^wf_standard-font$/i.test(base)) base = 'DIN'
    return { base, weight, face: /^wf_/i.test(first) ? undefined : first }
  }
  if (/^wf_segoe-ui(_normal)?$/i.test(first)) return { base: 'Segoe UI', weight: 400 }
  if (/^wf_standard-font$/i.test(first)) return { base: 'DIN', weight: 400 }
  return { base: first, weight: 400 }
}

/** Weight implied by a PBI family name ("Segoe UI Semibold" → 600); the Bold toggle wins. */
export function fontWeightOf(family: string | undefined, bold?: boolean): number {
  const w = faceOf(primaryFamily(family)).weight
  return bold ? Math.max(700, w) : w
}

const GENERIC_FAMILY = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|helvetica|arial)$/i

/**
 * PBI font value (+ Bold toggle) → CSS `font-family` stack and numeric `font-weight`.
 *
 *  - "Segoe UI Semibold", "'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif" (what the format
 *    pane stores), "wf_segoe-ui_semibold" → the Semibold face at weight 600 — never bold because of a family name;
 *  - Bold toggle on a weighted face ("Segoe UI Semibold" + bold) → the family's real Bold face (weight 700), like
 *    Windows does, not a synthesized bold of the Semibold face;
 *  - PBI's own fallbacks (helvetica, arial) are replaced by the Segoe-metric stack: on Linux they resolve to
 *    Arial-metric fonts, 5–10% wider than what Power BI renders.
 */
export function resolveFont(family: string | undefined, opts: { bold?: boolean } = {}): { fontFamily: string; fontWeight: number } {
  const first = primaryFamily(family)
  if (!first) return { fontFamily: FONT_STACKS['segoe ui'], fontWeight: opts.bold ? 700 : 400 }
  const f = faceOf(first)
  const known = FONT_STACKS[f.base.toLowerCase()]
  let stack: string
  if (known) stack = known
  else {
    // custom family: keep the author's own fallbacks (minus the generic ones) ahead of ours
    const rest = (family ?? '')
      .split(',')
      .slice(1)
      .map((x) => x.replace(/['"]/g, '').trim())
      .filter((x) => x && !GENERIC_FAMILY.test(x) && !/^wf_/i.test(x))
    stack = [f.base, ...rest].map((x) => `'${x}'`).join(', ') + ', ' + FONT_STACKS['segoe ui']
  }
  // the named face first (a locally installed "Segoe UI Semibold" / the bundled alias), unless Bold asks for the real bold face
  const fontFamily = f.face && !opts.bold && !stack.startsWith(`'${f.face}'`) ? `'${f.face}', ${stack}` : stack
  return { fontFamily, fontWeight: opts.bold ? Math.max(700, f.weight) : f.weight }
}

/** CSS font-family stack for a PBI font family (may already be a comma-separated stack). */
export function cssFontFamily(family: string | undefined): string {
  if (!family) return FONT_STACKS['segoe ui']
  const first = primaryFamily(family)
  const stack = FONT_STACKS[first.toLowerCase()]
  if (stack) return stack
  return resolveFont(family).fontFamily
}

export interface FontSpec {
  /** size in px */
  size: number
  family?: string
  weight?: number
  italic?: boolean
}

export function cssFont(f: FontSpec): string {
  return `${f.italic ? 'italic ' : ''}${f.weight ?? 400} ${f.size}px ${cssFontFamily(f.family)}`
}

/** SVG text attribute bag for a FontSpec. */
export function fontAttrs(f: FontSpec): { fontSize: number; fontFamily: string; fontWeight: number; fontStyle?: string } {
  return { fontSize: f.size, fontFamily: cssFontFamily(f.family), fontWeight: f.weight ?? 400, ...(f.italic ? { fontStyle: 'italic' } : {}) }
}

let ctx2d: CanvasRenderingContext2D | null | undefined
function context(): CanvasRenderingContext2D | null {
  if (ctx2d !== undefined) return ctx2d
  try {
    ctx2d = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  } catch {
    ctx2d = null
  }
  return ctx2d
}

const cache = new Map<string, number>()

/** Width of `text` in px for the given font. */
export function measureText(text: string, font: FontSpec): number {
  if (!text) return 0
  const css = cssFont(font)
  const key = css + '\u0000' + text
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const c = context()
  let w: number
  if (c) {
    c.font = css
    w = c.measureText(text).width
  } else {
    w = approxWidth(text, font)
  }
  if (cache.size > 20000) cache.clear()
  cache.set(key, w)
  return w
}

/** Deterministic width approximation (Segoe UI-like average advances). */
export function approxWidth(text: string, font: FontSpec): number {
  let units = 0
  for (const ch of text) {
    if ('il.,:;\'|!'.includes(ch)) units += 0.28
    else if ('fjrt()[] '.includes(ch)) units += 0.36
    else if ('mwMW'.includes(ch)) units += 0.85
    else if (ch >= 'A' && ch <= 'Z') units += 0.64
    else if (ch >= '0' && ch <= '9') units += 0.55
    else units += 0.52
  }
  const weightFactor = (font.weight ?? 400) >= 600 ? 1.06 : 1
  return units * font.size * weightFactor
}

/** Line height used for a font (PBI uses ~1.3 × size for labels). */
export function lineHeight(font: FontSpec): number {
  return Math.ceil(font.size * 1.3)
}

/** Truncate with an ellipsis to fit maxWidth. */
export function ellipsize(text: string, maxWidth: number, font: FontSpec): string {
  if (maxWidth <= 0) return ''
  if (measureText(text, font) <= maxWidth) return text
  const ell = '…'
  const ellW = measureText(ell, font)
  if (ellW > maxWidth) return ''
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureText(text.slice(0, mid), font) + ellW <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? ell : text.slice(0, lo).trimEnd() + ell
}

/** Word-wrap into at most maxLines lines; the last line is ellipsized. */
export function wrapText(text: string, maxWidth: number, font: FontSpec, maxLines: number): string[] {
  if (maxLines <= 1) return [ellipsize(text, maxWidth, font)]
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const next = cur ? cur + ' ' + w : w
    if (measureText(next, font) <= maxWidth || !cur) {
      cur = next
      continue
    }
    lines.push(cur)
    cur = w
    if (lines.length === maxLines - 1) {
      cur = words.slice(i).join(' ')
      break
    }
  }
  if (cur) lines.push(cur)
  return lines.map((l, i) => (i === lines.length - 1 || measureText(l, font) > maxWidth ? ellipsize(l, maxWidth, font) : l))
}
