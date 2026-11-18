/**
 * Format-string lexing shared by the numeric, date and text formatters.
 *
 * A section is turned into a list of characters flagged as literal (from `\x` escapes, `"quoted text"` or a
 * `[$sym-locale]` currency block) or as format codes. Bracket blocks other than `[$...]` and Excel elapsed-time
 * codes (`[h]`, `[mm]`, `[ss]`, approximated as the plain code) are dropped here. Excel colors and conditions
 * (`[Red]`, `[Color10]`, `[>=1000]`) are read separately by `sectionMeta` and select the section / display color.
 */

export interface Ch {
  c: string
  lit: boolean
}

/** Split on `;` outside quotes, escapes and brackets. */
export function splitSections(fmt: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]
    if (c === '\\') {
      i++
    } else if (c === '"') {
      const e = fmt.indexOf('"', i + 1)
      i = e < 0 ? fmt.length : e
    } else if (c === '[') {
      const e = fmt.indexOf(']', i + 1)
      if (e >= 0) i = e
    } else if (c === ';') {
      out.push(fmt.slice(start, i))
      start = i + 1
    }
  }
  out.push(fmt.slice(start))
  return out
}

export function lex(section: string): Ch[] {
  const out: Ch[] = []
  const n = section.length
  let i = 0
  while (i < n) {
    const c = section[i]
    if (c === '\\') {
      if (i + 1 < n) out.push({ c: section[i + 1], lit: true })
      i += 2
    } else if (c === '"') {
      let e = section.indexOf('"', i + 1)
      if (e < 0) e = n // unclosed quote: rest is literal (never throw)
      for (let k = i + 1; k < e; k++) out.push({ c: section[k], lit: true })
      i = e + 1
    } else if (c === '[') {
      const e = section.indexOf(']', i + 1)
      if (e < 0) {
        out.push({ c, lit: true })
        i++
        continue
      }
      const content = section.slice(i + 1, e)
      if (content.startsWith('$')) {
        const dash = content.indexOf('-')
        const sym = dash >= 0 ? content.slice(1, dash) : content.slice(1)
        for (const s of sym) out.push({ c: s, lit: true })
      } else if (/^(h+|m+|s+)$/i.test(content)) {
        for (const s of content) out.push({ c: s, lit: false })
      }
      i = e + 1
    } else {
      out.push({ c, lit: false })
      i++
    }
  }
  return out
}

export interface SectionCondition {
  op: '<' | '<=' | '>' | '>=' | '=' | '<>'
  value: number
}

export interface SectionMeta {
  cond: SectionCondition | null
  /** CSS color for Excel color codes ([Red], [Color 7]...) */
  color: string | null
}

/** Excel's 8 named colors and the 56-color legacy palette ([ColorN]). */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  magenta: '#FF00FF',
  cyan: '#00FFFF'
}
const PALETTE = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080',
  '#C0C0C0', '#808080', '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF', '#000080', '#FF00FF', '#FFFF00', '#00FFFF',
  '#800080', '#800000', '#008080', '#0000FF', '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99', '#3366FF', '#33CCCC',
  '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696', '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333'
]

/** Color and condition blocks of a section (outside quotes / escapes), e.g. `[Red][>=1000]#,##0,"K"`. */
export function sectionMeta(section: string): SectionMeta {
  const meta: SectionMeta = { cond: null, color: null }
  for (let i = 0; i < section.length; i++) {
    const c = section[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"') {
      const e = section.indexOf('"', i + 1)
      if (e < 0) break
      i = e
      continue
    }
    if (c !== '[') continue
    const e = section.indexOf(']', i + 1)
    if (e < 0) break
    const content = section.slice(i + 1, e).trim()
    i = e
    const cm = /^(<=|>=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.exec(content)
    if (cm) {
      meta.cond ??= { op: cm[1] as SectionCondition['op'], value: Number(cm[2]) }
      continue
    }
    const named = NAMED_COLORS[content.toLowerCase()]
    if (named) {
      meta.color ??= named
      continue
    }
    const pm = /^color\s*(\d{1,2})$/i.exec(content)
    if (pm) {
      const n = Number(pm[1])
      if (n >= 1 && n <= 56) meta.color ??= PALETTE[n - 1]
    }
  }
  return meta
}

export function conditionMet(c: SectionCondition, v: number): boolean {
  switch (c.op) {
    case '<':
      return v < c.value
    case '<=':
      return v <= c.value
    case '>':
      return v > c.value
    case '>=':
      return v >= c.value
    case '=':
      return v === c.value
    case '<>':
      return v !== c.value
  }
}
