/**
 * Code visual: data as CSS custom properties.
 *
 * Root (the visual's `#lumen-root` element, set by the frame runtime with `style.setProperty`):
 *   --<field>: 6487996            every measure / aggregation at the grand total, unformatted (usable in calc())
 *   --<field>-text: "$6.49M"      the same value formatted, as a CSS string (for `content:`)
 *   --<field>-highlight, --<field>-highlight-text   the value under another visual's cross-highlight (when active)
 *   --width / --height: 320px     the content area (also as container query units: the root is a size container)
 *   --theme-color-1 … -N, --theme-foreground, --theme-foreground-secondary, --theme-foreground-tertiary,
 *   --theme-background, --theme-background-light, --theme-background-neutral, --theme-accent, --theme-hyperlink,
 *   --theme-good, --theme-neutral, --theme-bad, --theme-font, --theme-<class>-size / -color / -font
 *   --param-<name>                each parameter (colour, number, text as a CSS string, toggle as 1 / 0)
 *   --level, --row-count, --has-highlight (1/0), --has-selection (1/0)
 * Per row (first element of each {{#each rows}} iteration; JSX: `row.vars` / `rowStyle(row)`):
 *   --value, --pct-of-max, --pct-of-total (first measure), --highlight-value, --highlight-pct-of-max,
 *   --index, --depth, and --<field> / --<field>-text for every column of the row.
 * Names: naming.ts (`cssName`).
 */
import type { CodeCell, CodeColumn, CodeData, CodeRow, ThemeInfo } from './types'
import { cssName } from './naming'

/** A CSS string literal (double quotes) that cannot break out of a declaration or a <style> element. */
export function cssString(s: string): string {
  let out = '"'
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)!
    if (ch === '"' || ch === '\\') out += '\\' + ch
    else if (c < 0x20 || c === 0x7f || ch === '<' || ch === '>' || ch === '&' || ch === '{' || ch === '}' || ch === ';') out += `\\${c.toString(16)} `
    else out += ch
  }
  return out + '"'
}

/** A finite number in CSS syntax (no exponent), else null. */
export function cssNumber(v: unknown): string | null {
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const r = Math.round(v * 1e9) / 1e9
  // CSS numbers do not accept exponents in every context: print plainly
  return Math.abs(r) >= 1e21 ? r.toFixed(0) : r.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 9 })
}

/** A colour as accepted in CSS (hex / rgb[a] / hsl[a] / a named colour); anything else is dropped. */
export function cssColor(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s
  if (/^(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)$/i.test(s)) return s
  if (/^[a-z]{3,20}$/i.test(s)) return s
  return null
}

function cellVars(name: string, cell: CodeCell | undefined, out: Record<string, string>): void {
  if (!cell) return
  const n = cssNumber(cell.value)
  if (n !== null) out[`--${name}`] = n
  out[`--${name}-text`] = cssString(cell.formatted)
  // cross-highlight from another visual: the value under the highlight
  if (cell.highlight !== undefined) {
    const h = cssNumber(cell.highlight ?? 0)
    if (h !== null) out[`--${name}-highlight`] = h
    out[`--${name}-highlight-text`] = cssString(cell.highlightFormatted ?? '')
  }
}

export function themeVars(theme: ThemeInfo): Record<string, string> {
  const out: Record<string, string> = {}
  theme.colors.forEach((c, i) => {
    const col = cssColor(c)
    if (col) out[`--theme-color-${i + 1}`] = col
  })
  const put = (k: string, v: string) => {
    const col = cssColor(v)
    if (col) out[k] = col
  }
  put('--theme-foreground', theme.foreground)
  put('--theme-foreground-secondary', theme.foregroundSecondary)
  put('--theme-foreground-tertiary', theme.foregroundTertiary)
  put('--theme-background', theme.background)
  put('--theme-background-light', theme.backgroundLight)
  put('--theme-background-neutral', theme.backgroundNeutral)
  put('--theme-accent', theme.accent)
  put('--theme-hyperlink', theme.hyperlink)
  put('--theme-good', theme.good)
  put('--theme-neutral', theme.neutral)
  put('--theme-bad', theme.bad)
  out['--theme-font'] = fontStack(theme.fontFamily)
  for (const [cls, t] of Object.entries(theme.text)) {
    const k = cssName(cls)
    out[`--theme-${k}-size`] = `${cssNumber(t.size) ?? '12'}px`
    put(`--theme-${k}-color`, t.color)
    out[`--theme-${k}-font`] = fontStack(t.font)
  }
  return out
}

/** A font-family list: every family quoted as a CSS string, generic fallbacks appended. */
export function fontStack(families: string): string {
  const parts = String(families ?? '')
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter((f) => f && f.length < 80)
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive'])
  const list = parts.map((f) => (generic.has(f) ? f : cssString(f)))
  for (const f of ['"Segoe UI"', '"Selawik"', 'sans-serif']) if (!list.includes(f)) list.push(f)
  return list.join(', ')
}

export function paramVars(params: Record<string, string | number | boolean>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    const name = `--param-${cssName(k)}`
    if (typeof v === 'boolean') out[name] = v ? '1' : '0'
    else if (typeof v === 'number') out[name] = cssNumber(v) ?? '0'
    else out[name] = cssColor(v) ?? cssString(v)
  }
  return out
}

/** Root variables for the data (totals, counts, state). Theme, parameters and size are added by `rootVars`. */
export function dataVars(data: CodeData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of data.columns) if (c.kind === 'value') cellVars(c.css, data.totals[c.name], out)
  out['--level'] = String(data.drill.level)
  out['--row-count'] = String(data.rows.length)
  out['--has-highlight'] = data.hasHighlight ? '1' : '0'
  out['--has-selection'] = data.hasSelection ? '1' : '0'
  return out
}

export function rootVars(data: CodeData, theme: ThemeInfo, size: { width: number; height: number }): Record<string, string> {
  return {
    ...themeVars(theme),
    ...paramVars(data.params),
    ...dataVars(data),
    '--width': `${cssNumber(size.width) ?? 0}px`,
    '--height': `${cssNumber(size.height) ?? 0}px`
  }
}

/** Statistics of the first measure over the rows (for --pct-of-max / --pct-of-total). */
export interface RowStats {
  measure?: CodeColumn
  maxAbs: number
  total: number
}

export function rowStats(data: CodeData): RowStats {
  const measure = data.columns.find((c) => c.kind === 'value' && c.role === 'values')
  if (!measure) return { maxAbs: 0, total: 0 }
  let maxAbs = 0
  let total = 0
  for (const r of data.rows) {
    const v = r.cells[measure.name]?.value
    if (typeof v === 'number' && Number.isFinite(v)) {
      maxAbs = Math.max(maxAbs, Math.abs(v))
      total += v
    }
  }
  return { measure, maxAbs, total }
}

/** Per-row variables (name → CSS value). */
export function rowVars(row: CodeRow, data: CodeData, stats: RowStats): Record<string, string> {
  const out: Record<string, string> = {}
  const m = stats.measure
  const v = m ? row.cells[m.name]?.value : undefined
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null
  out['--value'] = cssNumber(n ?? 0)!
  out['--pct-of-max'] = cssNumber(n !== null && stats.maxAbs ? n / stats.maxAbs : 0)!
  out['--pct-of-total'] = cssNumber(n !== null && stats.total ? n / stats.total : 0)!
  if (data.hasHighlight && m) {
    const h = row.cells[m.name]?.highlight
    const hn = typeof h === 'number' && Number.isFinite(h) ? h : 0
    out['--highlight-value'] = cssNumber(hn)!
    out['--highlight-pct-of-max'] = cssNumber(stats.maxAbs ? hn / stats.maxAbs : 0)!
  }
  out['--index'] = String(row.index)
  out['--depth'] = String(row.depth)
  for (const c of data.columns) cellVars(c.css, row.cells[c.name], out)
  return out
}

export function styleText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
}
