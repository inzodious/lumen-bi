/**
 * Code visual: name mangling from field / parameter display names to the identifiers the author's code uses.
 *
 * Two forms, both documented in docs/reference/code-visual-api.md and shown in the editor's Data tab:
 *  - CSS identifier (`cssName`): lower case, `%` → `pct`, `#` → `num`, `&` → `and`, `+` → `plus`, every other run of
 *    characters outside [a-z0-9] → one `-`, leading / trailing `-` trimmed; a name starting with a digit gets an `f-`
 *    prefix; an empty result becomes `field`. "Total Sales" → `total-sales`, "Margin %" → `margin-pct`.
 *  - JavaScript identifier (`jsName`): the same words in camelCase. "Total Sales" → `totalSales`, "Margin %" →
 *    `marginPct`, "2024 Target" → `f2024Target`.
 * Collisions inside one visual get `-2`, `-3`… (CSS) / `2`, `3`… (JS) in field order (`uniqueNames`).
 */

const SYMBOLS: Array<[RegExp, string]> = [
  [/%/g, ' pct '],
  [/#/g, ' num '],
  [/&/g, ' and '],
  [/\+/g, ' plus ']
]

/** The words of a display name (accents removed, symbols spelled out). */
export function nameWords(name: string): string[] {
  let s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  for (const [re, w] of SYMBOLS) s = s.replace(re, w)
  // split camelCase boundaries too ("TotalSales" → total sales) so both spellings mangle the same way
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function cssName(name: string): string {
  const w = nameWords(name)
  if (!w.length) return 'field'
  const out = w.join('-')
  return /^[0-9]/.test(out) ? `f-${out}` : out
}

export function jsName(name: string): string {
  const w = nameWords(name)
  if (!w.length) return 'field'
  const out = w.map((x, i) => (i === 0 ? x : x[0].toUpperCase() + x.slice(1))).join('')
  return /^[0-9]/.test(out) ? `f${out}` : out
}

/** Names reserved by the runtime (per-row and root variables): a field mangled to one of these gets a suffix. */
export const RESERVED_CSS = new Set(['value', 'pct-of-max', 'pct-of-total', 'index', 'width', 'height', 'level', 'depth', 'row-count', 'highlight'])
export const RESERVED_JS = new Set(['index', 'key', 'label', 'selected', 'highlighted', 'level', 'depth', 'canDrill', 'parentKeys', 'identity', 'cells', 'value', 'formatted'])

/** Unique CSS and JS names for a list of display names (collisions and reserved names numbered in order). */
export function uniqueNames(names: string[]): Array<{ css: string; js: string }> {
  const usedCss = new Set<string>()
  const usedJs = new Set<string>()
  return names.map((n) => {
    const base = { css: cssName(n), js: jsName(n) }
    let css = base.css
    let i = 2
    while (usedCss.has(css) || RESERVED_CSS.has(css)) css = `${base.css}-${i++}`
    let js = base.js
    i = 2
    while (usedJs.has(js) || RESERVED_JS.has(js)) js = `${base.js}${i++}`
    usedCss.add(css)
    usedJs.add(js)
    return { css, js }
  })
}
