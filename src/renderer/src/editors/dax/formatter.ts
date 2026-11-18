/**
 * "Format DAX" — a deterministic formatter following the basic DAX Formatter (daxformatter.com)
 * conventions:
 *   - function names and keywords upper-case, `FUNC ( arg1, arg2 )` with inner spaces, `FUNC ()` when empty
 *   - a call that does not fit on the line breaks into one argument per line, indented by 4 spaces,
 *     with the closing parenthesis aligned with the function name
 *   - `VAR name =` / `RETURN` on their own lines, the RETURN expression indented
 *   - queries: DEFINE / EVALUATE / ORDER BY / START AT sections, definitions indented
 *   - binary operators surrounded by spaces, unary minus attached, comments preserved
 * Formatting never changes tokens other than letter case of functions/keywords and whitespace.
 */
import { isTrivia, tokenizeDax, type DaxToken } from './tokenizer'

export interface FormatOptions {
  /** max line width before a call is broken over several lines (default 80) */
  maxWidth?: number
  /** indent unit (default 4 spaces) */
  indent?: string
}

type Item =
  | { k: 'tok'; t: DaxToken; unary?: boolean }
  | { k: 'comment'; text: string; line: boolean }
  | { k: 'group'; open: '(' | '{'; name?: string; args: Item[][]; closed: boolean }

interface Line {
  indent: number
  text: string
  /** trailing line comment */
  comment?: string
}

const QUERY_SECTION = new Set(['DEFINE', 'EVALUATE', 'ORDER', 'START'])
const DEFINITION = new Set(['MEASURE', 'VAR', 'TABLE', 'COLUMN', 'FUNCTION'])

// ---------------------------------------------------------------- parse

function parse(tokens: DaxToken[]): Item[] {
  let i = 0
  const parseSeq = (inGroup: boolean): Item[][] => {
    const args: Item[][] = [[]]
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.type === 'ws' || t.type === 'newline') {
        i++
        continue
      }
      const cur = args[args.length - 1]
      if (t.type === 'comment') {
        cur.push({ k: 'comment', text: t.lineComment ? t.text.trimEnd() : t.text, line: !!t.lineComment })
        i++
        continue
      }
      if (t.type === 'rparen' || t.type === 'rbrace') {
        if (inGroup) return args
        cur.push({ k: 'tok', t })
        i++
        continue
      }
      if (t.type === 'comma' && inGroup) {
        args.push([])
        i++
        continue
      }
      if (t.type === 'lparen' || t.type === 'lbrace') {
        let name: string | undefined
        const prev = lastSignificant(cur)
        if (t.type === 'lparen' && prev && prev.k === 'tok' && (prev.t.type === 'function' || prev.t.type === 'ident')) {
          cur.splice(cur.lastIndexOf(prev), 1)
          name = prev.t.text.toUpperCase()
        }
        i++
        const inner = parseSeq(true)
        const closer = tokens[i]
        const closed = !!closer && (closer.type === 'rparen' || closer.type === 'rbrace')
        if (closed) i++
        const args0 = inner.length === 1 && inner[0].length === 0 ? [] : inner
        cur.push({ k: 'group', open: t.type === 'lparen' ? '(' : '{', name, args: args0, closed })
        continue
      }
      const item: Item = { k: 'tok', t }
      if (t.type === 'op' && (t.text === '-' || t.text === '+')) {
        const prev = lastSignificant(cur)
        if (!prev || (prev.k === 'tok' && (prev.t.type === 'op' || prev.t.type === 'keyword' || prev.t.type === 'comma'))) item.unary = true
      }
      cur.push(item)
      i++
    }
    return args
  }
  const top = parseSeq(false)
  // top level commas (ORDER BY keys) are kept as tokens
  const out: Item[] = []
  top.forEach((seq, idx) => {
    if (idx > 0) out.push({ k: 'tok', t: { type: 'comma', text: ',', start: 0, end: 0 } })
    out.push(...seq)
  })
  return out
}

function lastSignificant(seq: Item[]): Item | undefined {
  for (let j = seq.length - 1; j >= 0; j--) if (seq[j].k !== 'comment') return seq[j]
  return undefined
}

// ---------------------------------------------------------------- inline rendering

function tokText(t: DaxToken): string {
  if (t.type === 'keyword' || t.type === 'function') return t.text.toUpperCase()
  return t.text
}

function needsSpace(prev: Item | undefined, cur: Item): boolean {
  if (!prev) return false
  if (prev.k === 'tok' && prev.unary) return false
  if (cur.k === 'tok' && cur.t.type === 'comma') return false
  if (cur.k === 'tok' && cur.t.type === 'column' && prev.k === 'tok' && (prev.t.type === 'table' || prev.t.type === 'ident')) return false
  return true
}

/** Inline text of a sequence, or null if it cannot be rendered on one line (line comment). */
function inlineSeq(seq: Item[]): string | null {
  let s = ''
  let prev: Item | undefined
  for (const it of seq) {
    let part: string | null
    if (it.k === 'comment') {
      if (it.line) return null
      part = it.text
    } else if (it.k === 'tok') part = tokText(it.t)
    else part = inlineGroup(it)
    if (part === null) return null
    s += (needsSpace(prev, it) ? ' ' : '') + part
    prev = it
  }
  return s
}

function inlineGroup(g: Extract<Item, { k: 'group' }>): string | null {
  const close = g.closed ? (g.open === '(' ? ')' : '}') : ''
  const head = g.name ? `${g.name} ${g.open}` : g.open
  if (g.args.length === 0) return `${head}${close}`
  const parts: string[] = []
  for (const a of g.args) {
    const p = inlineSeq(a)
    if (p === null) return null
    parts.push(p)
  }
  return `${head} ${parts.join(', ')}${close ? ' ' + close : ''}`
}

// ---------------------------------------------------------------- block rendering

class Writer {
  lines: Line[] = []
  constructor(
    private readonly width: number,
    private readonly unit: number
  ) {}

  fits(indent: number, text: string): boolean {
    return indent * this.unit + text.length <= this.width
  }

  /** Render `seq` starting a new line at `indent`. */
  block(seq: Item[], indent: number): void {
    if (hasTopKeyword(seq, 'VAR') || hasTopKeyword(seq, 'RETURN')) return this.varBlock(seq, indent)
    const inline = inlineSeq(seq)
    if (inline !== null && this.fits(indent, inline)) {
      this.lines.push({ indent, text: inline })
      return
    }
    this.flow(seq, indent)
  }

  /** Emit items left to right, breaking groups that do not fit. */
  private flow(seq: Item[], indent: number): void {
    let line: Line | null = null
    let prev: Item | undefined
    const ensure = (): Line => {
      if (!line || line.comment) {
        line = { indent, text: '' }
        this.lines.push(line)
      }
      return line
    }
    for (const it of seq) {
      if (it.k === 'comment') {
        if (it.line) {
          const l = ensure()
          if (l.text === '') l.text = it.text
          else l.comment = it.text
          line = null
          prev = undefined
          continue
        }
      }
      if (it.k === 'tok' && it.t.type === 'op' && (it.t.text === '&&' || it.t.text === '||') && line && !line.comment && !this.fits(indent, line.text)) {
        line = null
      }
      const l = ensure()
      const sep = l.text !== '' && needsSpace(prev, it) ? ' ' : ''
      if (it.k === 'group') {
        const inline = inlineGroup(it)
        if (inline !== null && this.fits(indent, l.text + sep + inline)) {
          l.text += sep + inline
        } else {
          l.text += sep + (it.name ? `${it.name} ${it.open}` : it.open)
          this.args(it.args, indent + 1)
          const close = it.closed ? (it.open === '(' ? ')' : '}') : ''
          line = { indent, text: close }
          this.lines.push(line)
        }
      } else if (it.k === 'comment') {
        l.text += sep + it.text
      } else {
        l.text += sep + tokText(it.t)
      }
      prev = it
    }
  }

  private args(args: Item[][], indent: number): void {
    args.forEach((a, idx) => {
      const start = this.lines.length
      this.block(a, indent)
      if (idx < args.length - 1) {
        const last = this.lines[this.lines.length - 1]
        if (this.lines.length > start) last.text += ','
      }
    })
  }

  private varBlock(seq: Item[], indent: number): void {
    // leading comments
    let i = 0
    const stmts: Array<{ kw: 'VAR' | 'RETURN' | null; items: Item[] }> = []
    let cur: { kw: 'VAR' | 'RETURN' | null; items: Item[] } = { kw: null, items: [] }
    for (; i < seq.length; i++) {
      const it = seq[i]
      if (it.k === 'tok' && it.t.type === 'keyword') {
        const up = it.t.text.toUpperCase()
        if (up === 'VAR' || (up === 'RETURN' && cur.kw !== 'RETURN')) {
          if (cur.items.length || cur.kw) stmts.push(cur)
          cur = { kw: up, items: [] }
          continue
        }
      }
      cur.items.push(it)
    }
    if (cur.items.length || cur.kw) stmts.push(cur)
    for (const st of stmts) {
      if (st.kw === null) {
        this.flowComments(st.items, indent)
      } else if (st.kw === 'VAR') {
        this.definition('VAR', st.items, indent)
      } else {
        const { lead, rest } = splitLeadingComments(st.items)
        this.lines.push({ indent, text: 'RETURN' })
        for (const c of lead) this.lines.push({ indent: indent + 1, text: c.text })
        if (rest.length) this.block(rest, indent + 1)
      }
    }
  }

  private flowComments(items: Item[], indent: number): void {
    if (items.every((x) => x.k === 'comment')) {
      for (const c of items) if (c.k === 'comment') this.lines.push({ indent, text: c.text })
    } else this.block(items, indent)
  }

  /** `KW head = expr` (VAR x = ..., MEASURE T[m] = ..., TABLE t = ...) */
  definition(kw: string, items: Item[], indent: number): void {
    const eq = items.findIndex((x) => x.k === 'tok' && x.t.type === 'op' && x.t.text === '=')
    if (eq < 0) {
      const inline = inlineSeq(items)
      this.lines.push({ indent, text: `${kw}${inline ? ' ' + inline : ''}` })
      return
    }
    const head = inlineSeq(items.slice(0, eq)) ?? ''
    const { lead, rest: expr } = splitLeadingComments(items.slice(eq + 1))
    const exprInline = lead.length ? null : inlineSeq(expr)
    const first = `${kw} ${head} =`
    if (exprInline !== null && !hasTopKeyword(expr, 'VAR') && this.fits(indent, `${first} ${exprInline}`)) {
      this.lines.push({ indent, text: `${first} ${exprInline}` })
      return
    }
    this.lines.push({ indent, text: first })
    for (const c of lead) this.lines.push({ indent: indent + 1, text: c.text })
    if (expr.length) this.block(expr, indent + 1)
  }
}

function splitLeadingComments(items: Item[]): { lead: Array<Extract<Item, { k: 'comment' }>>; rest: Item[] } {
  const lead: Array<Extract<Item, { k: 'comment' }>> = []
  let i = 0
  while (i < items.length && items[i].k === 'comment') lead.push(items[i++] as Extract<Item, { k: 'comment' }>)
  return { lead, rest: items.slice(i) }
}

function hasTopKeyword(seq: Item[], kw: string): boolean {
  return seq.some((x) => x.k === 'tok' && x.t.type === 'keyword' && x.t.text.toUpperCase() === kw)
}

function kwOf(it: Item | undefined): string | null {
  return it && it.k === 'tok' && it.t.type === 'keyword' ? it.t.text.toUpperCase() : null
}

// ---------------------------------------------------------------- queries

function formatQuery(items: Item[], w: Writer): void {
  let i = 0
  let sections = 0
  while (i < items.length) {
    const kw = kwOf(items[i])
    if (kw === 'DEFINE') {
      if (sections++) w.lines.push({ indent: 0, text: '' })
      w.lines.push({ indent: 0, text: 'DEFINE' })
      i++
      // definitions until EVALUATE
      let def: Item[] | null = null
      let defKw = ''
      let openVars = 0
      let exprStarted = false
      const flush = (): void => {
        if (def) w.definition(defKw, def, 1)
        def = null
      }
      while (i < items.length && kwOf(items[i]) !== 'EVALUATE') {
        const it = items[i]
        const k = kwOf(it)
        const startsDef = k !== null && DEFINITION.has(k) && (k !== 'VAR' || !def || (openVars === 0 && exprStarted))
        if (startsDef) {
          flush()
          def = []
          defKw = k
          openVars = 0
          exprStarted = false
        } else if (def) {
          const seenEq = def.some((x) => x.k === 'tok' && x.t.type === 'op' && x.t.text === '=')
          if (k === 'VAR' && seenEq) openVars++
          if (k === 'RETURN') openVars = Math.max(0, openVars - 1)
          if (seenEq && it.k !== 'comment') exprStarted = true
          def.push(it)
        } else if (it.k === 'comment') {
          w.lines.push({ indent: 1, text: it.text })
        }
        i++
      }
      flush()
    } else if (kw === 'EVALUATE') {
      if (sections++) w.lines.push({ indent: 0, text: '' })
      w.lines.push({ indent: 0, text: 'EVALUATE' })
      i++
      const body: Item[] = []
      while (i < items.length && !(kwOf(items[i]) !== null && QUERY_SECTION.has(kwOf(items[i])!))) body.push(items[i++])
      if (body.length) w.block(body, 1)
    } else if (kw === 'ORDER' || kw === 'START') {
      const second = kwOf(items[i + 1])
      w.lines.push({ indent: 0, text: kw === 'ORDER' ? 'ORDER BY' : 'START AT' })
      i += second === 'BY' || second === 'AT' ? 2 : 1
      const keys: Item[][] = [[]]
      while (i < items.length && !(kwOf(items[i]) !== null && QUERY_SECTION.has(kwOf(items[i])!))) {
        const it = items[i++]
        if (it.k === 'tok' && it.t.type === 'comma') keys.push([])
        else keys[keys.length - 1].push(it)
      }
      keys.forEach((k, idx) => {
        const text = inlineSeq(k) ?? ''
        w.lines.push({ indent: 1, text: text + (idx < keys.length - 1 ? ',' : '') })
      })
    } else {
      const it = items[i++]
      if (it.k === 'comment') w.lines.push({ indent: 0, text: it.text })
      else {
        // stray tokens before the first section: keep them on their own line
        const rest: Item[] = [it]
        while (i < items.length && !(kwOf(items[i]) !== null && QUERY_SECTION.has(kwOf(items[i])!))) rest.push(items[i++])
        w.block(rest, 0)
      }
    }
  }
}

export function isDaxQueryText(src: string): boolean {
  const first = tokenizeDax(src).find((t) => !isTrivia(t))
  return !!first && first.type === 'keyword' && ['DEFINE', 'EVALUATE'].includes(first.text.toUpperCase())
}

/** Format a DAX expression or query. Returns the input unchanged (trimmed) when it is empty. */
export function formatDax(src: string, opts: FormatOptions = {}): string {
  const indentUnit = opts.indent ?? '    '
  const w = new Writer(opts.maxWidth ?? 80, indentUnit.length)
  const tokens = tokenizeDax(src)
  if (!tokens.some((t) => !isTrivia(t) || t.type === 'comment')) return src.trim()
  const items = parse(tokens)
  if (isDaxQueryText(src)) formatQuery(items, w)
  else w.block(items, 0)
  return w.lines
    .map((l) => {
      const body = l.text + (l.comment ? (l.text ? ' ' : '') + l.comment : '')
      return body === '' ? '' : indentUnit.repeat(l.indent) + body
    })
    .join('\n')
}

/**
 * Format a `Name = expression` definition as shown in the formula bar: the name line stays
 * first; a multi-line expression starts on the next line (Power BI formula bar convention).
 */
export function formatDaxDefinition(text: string, opts: FormatOptions = {}): string {
  const split = splitDefinition(text)
  if (!split) return formatDax(text, opts)
  const body = formatDax(split.expression, opts)
  return body.includes('\n') || hasLeadingVar(body) ? `${split.name} =\n${body}` : `${split.name} = ${body}`
}

function hasLeadingVar(s: string): boolean {
  return /^\s*VAR\b/i.test(s)
}

/**
 * Split formula-bar text `Name = expression` (name may be `[Name]` or `'Name'` or bare words).
 * Returns null when there is no top-level `=` after a name.
 */
export function splitDefinition(text: string): { name: string; expression: string } | null {
  const m = /^\s*(\[[^\]]*(?:]][^\]]*)*\]|'[^']*(?:''[^']*)*'|[^=\n[\]"<>!]+?)\s*=(?!=)/.exec(text)
  if (!m) return null
  let name = m[1].trim()
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1).replace(/]]/g, ']')
  else if (name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1).replace(/''/g, "'")
  if (!name) return null
  return { name, expression: text.slice(m[0].length).replace(/^[ \t]*\r?\n/, '').replace(/^[ \t]+/, '') }
}
