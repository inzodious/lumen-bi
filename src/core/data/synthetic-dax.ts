/**
 * Small, tolerant DAX tokenizer + expression parser used by the synthetic-data generator to mine
 * value domains (string / number literals compared to columns) and to read DATATABLE / table
 * constructor literals of calculated tables.
 *
 * This is deliberately independent from the real DAX engine (src/core/dax): it only has to build a
 * shape-faithful syntax tree for analysis, never evaluate anything, and it must not throw on
 * constructs it does not understand (callers fall back to a token-level scan on parse errors).
 */

export type DaxTokKind = 'str' | 'num' | 'ident' | 'qtable' | 'colref' | 'op' | 'eof'

export interface DaxTok {
  kind: DaxTokKind
  /** decoded text: string content without quotes, identifier, table name, column name, operator */
  text: string
  pos: number
}

const OPS3 = new Set<string>([])
const OPS2 = new Set(['&&', '||', '<=', '>=', '<>', '=='])
const OPS1 = new Set(['=', '<', '>', '+', '-', '*', '/', '^', '&', '(', ')', '{', '}', ',', '.', ':', ';', '!', '|'])

/** Tokenize DAX text. Comments (`//`, `--`, `/* *\/`) are skipped. Never throws. */
export function tokenizeDax(src: string): DaxTok[] {
  const out: DaxTok[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src.charCodeAt(i)
    // whitespace
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xa0 || c === 0xfeff) {
      i++
      continue
    }
    const ch = src[i]
    const next = src[i + 1]
    // comments
    if ((ch === '/' && next === '/') || (ch === '-' && next === '-')) {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    // string literal "..." with "" escapes
    if (ch === '"') {
      const start = i
      let s = ''
      i++
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"'
            i += 2
            continue
          }
          i++
          break
        }
        s += src[i++]
      }
      out.push({ kind: 'str', text: s, pos: start })
      continue
    }
    // quoted table name '...' with '' escapes
    if (ch === "'") {
      const start = i
      let s = ''
      i++
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'"
            i += 2
            continue
          }
          i++
          break
        }
        s += src[i++]
      }
      out.push({ kind: 'qtable', text: s, pos: start })
      continue
    }
    // [column] with ]] escapes
    if (ch === '[') {
      const start = i
      let s = ''
      i++
      while (i < n) {
        if (src[i] === ']') {
          if (src[i + 1] === ']') {
            s += ']'
            i += 2
            continue
          }
          i++
          break
        }
        s += src[i++]
      }
      out.push({ kind: 'colref', text: s, pos: start })
      continue
    }
    // number
    if ((c >= 48 && c <= 57) || (ch === '.' && next !== undefined && next >= '0' && next <= '9')) {
      const start = i
      while (i < n && /[0-9.]/.test(src[i])) i++
      if (i < n && (src[i] === 'e' || src[i] === 'E') && /[0-9+-]/.test(src[i + 1] ?? '')) {
        i += 2
        while (i < n && /[0-9]/.test(src[i])) i++
      }
      out.push({ kind: 'num', text: src.slice(start, i), pos: start })
      continue
    }
    // identifier (function names may contain dots: PERCENTILE.INC, T.DIST.2T)
    if (/[A-Za-z_À-￿]/.test(ch)) {
      const start = i
      i++
      while (i < n && /[A-Za-z0-9_.À-￿]/.test(src[i])) i++
      // a trailing dot belongs to nobody — give it back
      let end = i
      while (end > start + 1 && src[end - 1] === '.') end--
      i = end
      out.push({ kind: 'ident', text: src.slice(start, end), pos: start })
      continue
    }
    const three = src.slice(i, i + 3)
    if (OPS3.has(three)) {
      out.push({ kind: 'op', text: three, pos: i })
      i += 3
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.has(two)) {
      out.push({ kind: 'op', text: two, pos: i })
      i += 2
      continue
    }
    if (OPS1.has(ch)) {
      out.push({ kind: 'op', text: ch, pos: i })
      i++
      continue
    }
    // unknown character: skip it
    i++
  }
  out.push({ kind: 'eof', text: '', pos: n })
  return out
}

// ---------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------

export type DaxNode =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 'col'; table?: string; column: string }
  | { k: 'tbl'; name: string }
  | { k: 'id'; name: string }
  | { k: 'call'; name: string; args: Array<DaxNode | null> }
  | { k: 'bin'; op: string; l: DaxNode; r: DaxNode }
  | { k: 'un'; op: string; e: DaxNode }
  | { k: 'list'; items: DaxNode[] }
  | { k: 'tuple'; items: DaxNode[] }
  | { k: 'var'; defs: Array<{ name: string; e: DaxNode }>; ret: DaxNode }

export class DaxParseError extends Error {}

const BIN_PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '=': 4,
  '==': 4,
  '<>': 4,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  IN: 4,
  '&': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '^': 8
}
const NOT_PREC = 3

class Parser {
  private i = 0
  constructor(private readonly toks: DaxTok[]) {}

  private peek(o = 0): DaxTok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)]
  }
  private next(): DaxTok {
    const t = this.toks[this.i]
    if (this.i < this.toks.length - 1) this.i++
    return t
  }
  private isOp(t: DaxTok, op: string): boolean {
    return t.kind === 'op' && t.text === op
  }
  private expectOp(op: string): void {
    const t = this.next()
    if (!this.isOp(t, op)) throw new DaxParseError(`expected '${op}' at ${t.pos}, got '${t.text}'`)
  }
  private isKw(t: DaxTok, kw: string): boolean {
    return t.kind === 'ident' && t.text.toUpperCase() === kw
  }

  parseAll(): DaxNode {
    const e = this.parseExpr(0)
    // tolerate a trailing ';' or stray tokens? Only eof is accepted for a full parse.
    if (this.peek().kind !== 'eof') throw new DaxParseError(`unexpected '${this.peek().text}' at ${this.peek().pos}`)
    return e
  }

  parseExpr(minPrec: number): DaxNode {
    let left = this.parsePrefix()
    for (;;) {
      const t = this.peek()
      let op: string | undefined
      if (t.kind === 'op' && BIN_PREC[t.text] !== undefined) op = t.text
      else if (this.isKw(t, 'IN')) op = 'IN'
      else if (this.isKw(t, 'NOT') && this.isKw(this.peek(1), 'IN')) op = 'NOT IN'
      if (!op) break
      const prec = BIN_PREC[op === 'NOT IN' ? 'IN' : op]
      if (prec <= minPrec) break
      this.next()
      if (op === 'NOT IN') this.next()
      // '^' is right-associative; others left
      const right = this.parseExpr(op === '^' ? prec - 1 : prec)
      left = op === 'NOT IN' ? { k: 'un', op: 'NOT', e: { k: 'bin', op: 'IN', l: left, r: right } } : { k: 'bin', op, l: left, r: right }
    }
    return left
  }

  private parsePrefix(): DaxNode {
    const t = this.next()
    switch (t.kind) {
      case 'str':
        return { k: 'str', v: t.text }
      case 'num':
        return { k: 'num', v: Number(t.text) }
      case 'colref':
        return { k: 'col', column: t.text }
      case 'qtable': {
        if (this.peek().kind === 'colref') return { k: 'col', table: t.text, column: this.next().text }
        return { k: 'tbl', name: t.text }
      }
      case 'ident': {
        const up = t.text.toUpperCase()
        if (up === 'VAR') return this.parseVarBlock()
        if (up === 'NOT' && !this.isOp(this.peek(), '(')) {
          return { k: 'un', op: 'NOT', e: this.parseExpr(NOT_PREC) }
        }
        if (this.isOp(this.peek(), '(')) {
          this.next()
          const args = this.parseArgs(')')
          if (up === 'NOT' && args.length === 1 && args[0]) {
            // NOT ( x ) [ op ... ] — treat as unary applied to the parenthesised expression
            return { k: 'un', op: 'NOT', e: args[0] }
          }
          return { k: 'call', name: up, args }
        }
        if (this.peek().kind === 'colref') return { k: 'col', table: t.text, column: this.next().text }
        return { k: 'id', name: t.text }
      }
      case 'op': {
        if (t.text === '(') {
          const items = this.parseArgs(')')
          if (items.length === 1 && items[0]) return items[0]
          return { k: 'tuple', items: items.filter((x): x is DaxNode => x !== null) }
        }
        if (t.text === '{') {
          const items = this.parseArgs('}')
          return { k: 'list', items: items.filter((x): x is DaxNode => x !== null) }
        }
        if (t.text === '-' || t.text === '+') {
          const e = this.parseExpr(7)
          if (t.text === '-' && e.k === 'num') return { k: 'num', v: -e.v }
          return t.text === '-' ? { k: 'un', op: '-', e } : e
        }
        throw new DaxParseError(`unexpected '${t.text}' at ${t.pos}`)
      }
      default:
        throw new DaxParseError(`unexpected end of expression`)
    }
  }

  /** Comma-separated args up to `close`; empty args (`f(a,,b)`, `f()`) yield null entries / []. */
  private parseArgs(close: string): Array<DaxNode | null> {
    const args: Array<DaxNode | null> = []
    if (this.isOp(this.peek(), close)) {
      this.next()
      return args
    }
    for (;;) {
      if (this.isOp(this.peek(), ',') || this.isOp(this.peek(), close)) args.push(null)
      else args.push(this.parseExpr(0))
      const t = this.next()
      if (this.isOp(t, ',')) continue
      if (this.isOp(t, close)) return args
      throw new DaxParseError(`expected ',' or '${close}' at ${t.pos}, got '${t.text}'`)
    }
  }

  private parseVarBlock(): DaxNode {
    const defs: Array<{ name: string; e: DaxNode }> = []
    for (;;) {
      const nameTok = this.next()
      if (nameTok.kind !== 'ident' && nameTok.kind !== 'qtable') throw new DaxParseError(`bad VAR name at ${nameTok.pos}`)
      this.expectOp('=')
      defs.push({ name: nameTok.text, e: this.parseExpr(0) })
      const t = this.peek()
      if (this.isKw(t, 'VAR')) {
        this.next()
        continue
      }
      if (this.isKw(t, 'RETURN')) {
        this.next()
        return { k: 'var', defs, ret: this.parseExpr(0) }
      }
      throw new DaxParseError(`expected VAR or RETURN at ${t.pos}`)
    }
  }
}

/** Parse a DAX expression; throws DaxParseError on syntax it cannot handle. */
export function parseDaxExpr(src: string): DaxNode {
  // DAX query-ish wrappers are not expected here; `EVALUATE` would just fail and fall back.
  return new Parser(tokenizeDax(src)).parseAll()
}

/** Parse, returning undefined instead of throwing. */
export function tryParseDax(src: string): DaxNode | undefined {
  try {
    return parseDaxExpr(src)
  } catch {
    return undefined
  }
}

/** Visit every node (pre-order). */
export function walkDax(node: DaxNode | null | undefined, fn: (n: DaxNode) => void): void {
  if (!node) return
  fn(node)
  switch (node.k) {
    case 'call':
      for (const a of node.args) walkDax(a, fn)
      break
    case 'bin':
      walkDax(node.l, fn)
      walkDax(node.r, fn)
      break
    case 'un':
      walkDax(node.e, fn)
      break
    case 'list':
    case 'tuple':
      for (const a of node.items) walkDax(a, fn)
      break
    case 'var':
      for (const d of node.defs) walkDax(d.e, fn)
      walkDax(node.ret, fn)
      break
    default:
      break
  }
}

/** Literal scalar of a node (string / number / boolean), or undefined when not a literal. */
export function literalOf(node: DaxNode | null | undefined): string | number | boolean | undefined {
  if (!node) return undefined
  if (node.k === 'str') return node.v
  if (node.k === 'num') return Number.isFinite(node.v) ? node.v : undefined
  if (node.k === 'call' && node.args.length === 0) {
    if (node.name === 'TRUE') return true
    if (node.name === 'FALSE') return false
  }
  if (node.k === 'id') {
    const u = node.name.toUpperCase()
    if (u === 'TRUE') return true
    if (u === 'FALSE') return false
  }
  if (node.k === 'un' && node.op === '-' && node.e.k === 'num') return -node.e.v
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Calculated-table literals: DATATABLE(...) and { (a, b), ... } table constructors
// ---------------------------------------------------------------------------------------------

export interface LiteralTable {
  /** column names: DATATABLE names, or Value1..ValueN for table constructors */
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
}

function cellOf(node: DaxNode | null): string | number | boolean | null | undefined {
  if (!node) return null
  if (node.k === 'call' && node.name === 'BLANK' && node.args.length === 0) return null
  return literalOf(node)
}

/**
 * Extract literal rows of a calculated table expression when it is a DATATABLE or a table
 * constructor whose cells are all literals. Returns undefined for anything else (field
 * parameters with NAMEOF, CALENDAR, SELECTCOLUMNS...).
 */
export function literalTableOf(expression: string): LiteralTable | undefined {
  const node = tryParseDax(expression)
  if (!node) return undefined
  return literalTableOfNode(node)
}

export function literalTableOfNode(node: DaxNode): LiteralTable | undefined {
  if (node.k === 'call' && node.name === 'DATATABLE') {
    const args = node.args
    const last = args[args.length - 1]
    if (!last || last.k !== 'list') return undefined
    const columns: string[] = []
    for (let i = 0; i + 1 < args.length - 1; i += 2) {
      const a = args[i]
      if (!a || a.k !== 'str') return undefined
      columns.push(a.v)
    }
    const rows: LiteralTable['rows'] = []
    for (const r of last.items) {
      const cells = r.k === 'list' || r.k === 'tuple' ? r.items : [r]
      const row: Array<string | number | boolean | null> = []
      for (const c of cells) {
        const v = cellOf(c)
        if (v === undefined) return undefined
        row.push(v)
      }
      rows.push(row)
    }
    return { columns, rows }
  }
  if (node.k === 'list') {
    const rows: LiteralTable['rows'] = []
    let width = 0
    for (const r of node.items) {
      const cells = r.k === 'tuple' ? r.items : [r]
      const row: Array<string | number | boolean | null> = []
      for (const c of cells) {
        const v = cellOf(c)
        if (v === undefined) return undefined
        row.push(v)
      }
      width = Math.max(width, row.length)
      rows.push(row)
    }
    return { columns: Array.from({ length: width }, (_, i) => `Value${i + 1}`), rows }
  }
  return undefined
}
