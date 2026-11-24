/**
 * Count-up of formatted numbers ("$1,234.5K", "12.3%", "-4,500", "1.234,5 €"): the text is split into a prefix, a number
 * and a suffix, and intermediate frames re-print the number with the final text's decimals, grouping and separators.
 * Only the frames in between are approximations; the last frame is always the visual's own text.
 */

export interface CountText {
  prefix: string
  suffix: string
  value: number
  decimals: number
  group: string
  decimal: string
  grouped: boolean
}

const NUM = /^([^\d]*?)(-|−)?(\d[\d.,  ' ]*\d|\d)(.*)$/s

/** Parse a formatted number; null when the text isn't one number with an optional short prefix and suffix. */
export function parseCountText(text: string): CountText | null {
  const t = text.trim()
  if (!t || t.length > 40) return null
  const m = NUM.exec(t)
  if (!m) return null
  const [, prefix, minus, body, suffix] = m
  // a prefix glued to the number ("Q3", "FY24") makes it a label, not an amount
  if (prefix.length > 4 || suffix.length > 6 || /\d/.test(suffix) || /\p{L}$/u.test(prefix)) return null
  const seps = [...body.matchAll(/[.,  ' ]/g)]
  let decimal = '.'
  let group = ','
  let decimals = 0
  let intPart = body
  let fracPart = ''
  if (seps.length) {
    const last = seps[seps.length - 1]
    const lastChar = last[0]
    const after = body.length - (last.index! + 1)
    const kinds = new Set(seps.map((s) => s[0]))
    // the last separator is the decimal one when another kind comes before it, or it is the only one and isn't followed by 3 digits
    const count = seps.filter((s) => s[0] === lastChar).length
    const isDecimal = (lastChar === '.' || lastChar === ',') && (kinds.size > 1 || (count === 1 && after !== 3))
    if (isDecimal) {
      decimal = lastChar
      intPart = body.slice(0, last.index)
      fracPart = body.slice(last.index! + 1)
      decimals = fracPart.length
      const g = [...intPart.matchAll(/[.,  ' ]/g)].map((s) => s[0])
      group = g[0] ?? (decimal === ',' ? '.' : ',')
    } else {
      group = lastChar
      decimal = group === ',' ? '.' : ','
    }
  }
  const groups = intPart.split(/[.,\u00a0\u202f' ]/)
  if (groups.length > 1 && (groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3))) return null
  const digits = intPart.replace(/[^\d]/g, '')
  if (!digits) return null
  const value = Number(`${digits}${fracPart ? '.' + fracPart : ''}`) * (minus ? -1 : 1)
  if (!Number.isFinite(value)) return null
  const grouped = /[.,  ' ]/.test(intPart)
  return { prefix, suffix, value, decimals, group, decimal, grouped }
}

/** Print `value` the way `shape` was printed. */
export function formatCountText(shape: CountText, value: number): string {
  const neg = value < 0
  const fixed = Math.abs(value).toFixed(shape.decimals)
  const [int, frac] = fixed.split('.')
  const intText = shape.grouped ? int.replace(/\B(?=(\d{3})+(?!\d))/g, shape.group) : int
  return `${shape.prefix}${neg ? '-' : ''}${intText}${frac ? shape.decimal + frac : ''}${shape.suffix}`
}

/**
 * Start value for counting to `to`: the old text's number when it was printed the same way (same prefix and suffix,
 * so "1.2K" → "3.4K" counts but "950" → "1.2K" starts from zero), else 0.
 */
export function countFrom(from: string | null | undefined, to: CountText): number {
  const f = from ? parseCountText(from) : null
  return f && f.prefix === to.prefix && f.suffix === to.suffix ? f.value : 0
}

/** Ease-out cubic, the curve every Lumen animation uses. */
export function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - c, 3)
}
