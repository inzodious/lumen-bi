import { DaxSyntaxError } from './errors.ts'
import { lex, type Token } from './lexer.ts'

interface Span {
  /** 0-based start/end offsets into the source */
  s: number
  e: number
}

export type Node =
  | ({ kind: 'number'; value: number } & Span)
  | ({ kind: 'string'; value: string } & Span)
  | ({ kind: 'bool'; value: boolean } & Span)
  | ({ kind: 'column'; table: string | null; name: string } & Span)
  | ({ kind: 'ident'; name: string; quoted: boolean } & Span)
  | ({ kind: 'param'; name: string } & Span)
  | ({ kind: 'call'; name: string; args: Node[] } & Span)
  | ({ kind: 'binary'; op: string; left: Node; right: Node } & Span)
  | ({ kind: 'unary'; op: '-' | '+' | 'NOT'; operand: Node } & Span)
  | ({ kind: 'var'; decls: Array<{ name: string; expr: Node; s: number; e: number }>; body: Node } & Span)
  | ({ kind: 'tableCtor'; rows: Node[][] } & Span)
  | ({ kind: 'tuple'; items: Node[] } & Span)

export type CallNode = Extract<Node, { kind: 'call' }>
export type ColumnNode = Extract<Node, { kind: 'column' }>

/** A user-defined function parameter: `name [: [type] [subtype] [val|expr]] [= default]`. */
export interface FunctionParam {
  name: string
  /** AnyVal (default), Scalar, Table, AnyRef, CalendarRef, ColumnRef, MeasureRef, TableRef */
  type: string
  /** scalar subtype: Variant, Int64, Decimal, Double, String, DateTime, Boolean, Numeric */
  subtype?: string
  mode: 'val' | 'expr'
  default?: Node
}

export interface FunctionDefinition {
  name: string
  params: FunctionParam[]
  body: Node
}

export type QueryDefinition =
  | { kind: 'measure'; table: string; name: string; expr: Node; s: number; e: number }
  | { kind: 'var'; name: string; expr: Node; s: number; e: number }
  | { kind: 'table'; name: string; expr: Node; shape?: VisualShapeDef; s: number; e: number }
  | { kind: 'column'; table: string; name: string; expr: Node; s: number; e: number }
  | { kind: 'function'; name: string; fn: FunctionDefinition; expr: Node; s: number; e: number }

/**
 * TABLE 'name' = <input> WITH VISUAL SHAPE AXIS ROWS GROUP [a] TOTAL [t] ... ORDER BY [a] ASC ... DENSIFY "flag":
 * the visual matrix of a visual calculation query (Power BI's generated queries; COLUMN definitions on the table are
 * the visual calculations).
 */
export interface VisualShapeDef {
  axes: Array<{
    axis: 'ROWS' | 'COLUMNS' | 'ROWPAGES'
    /** levels: the level's columns (the first is the field, the others its sort-by / attribute columns) and total flag */
    groups: Array<{ cols: string[]; total?: string }>
    orderBy: Array<{ col: string; desc: boolean }>
  }>
  densify?: string
}

export interface EvaluateStatement {
  expr: Node
  orderBy: Array<{ expr: Node; desc: boolean }>
  startAt: Node[] | null
  s: number
}

export interface DaxQuery {
  definitions: QueryDefinition[]
  evaluates: EvaluateStatement[]
}

const INFIX_BP: Record<string, number> = {
  '||': 10,
  '&&': 20,
  '=': 40,
  '==': 40,
  '<': 40,
  '>': 40,
  '<=': 40,
  '>=': 40,
  '<>': 40,
  IN: 40,
  '&': 50,
  '+': 60,
  '-': 60,
  '*': 70,
  '/': 70,
  '^': 90
}
const NOT_BP = 30
const SIGN_BP = 80

function describe(t: Token): string {
  switch (t.type) {
    case 'eof':
      return 'the end of the expression'
    case 'string':
      return `"${t.value}"`
    case 'table':
      return `'${t.value}'`
    case 'column':
      return `[${t.value}]`
    default:
      return `'${t.value}'`
  }
}

const AXES = new Set(['ROWS', 'COLUMNS', 'ROWPAGES'])

const CLAUSE = new Set(['EVALUATE', 'ORDER', 'START', 'DEFINE', 'MEASURE', 'COLUMN', 'TABLE', 'FUNCTION'])

class Parser {
  private i = 0
  constructor(private readonly tokens: Token[]) {}

  private get t(): Token {
    return this.tokens[this.i]
  }
  private peek(n = 1): Token {
    return this.tokens[Math.min(this.i + n, this.tokens.length - 1)]
  }
  private atEof(): boolean {
    return this.t.type === 'eof'
  }
  private next(): Token {
    const t = this.t
    if (t.type !== 'eof') this.i++
    return t
  }
  private prevEnd(): number {
    return this.tokens[Math.max(0, this.i - 1)].end
  }
  private kw(t: Token, k: string): boolean {
    return t.type === 'ident' && t.value.toUpperCase() === k
  }
  private punct(t: Token, p: string): boolean {
    return t.type === 'punct' && t.value === p
  }
  fail(msg: string, t: Token = this.t): never {
    throw new DaxSyntaxError(msg, t.line, t.col, t.start, Math.max(t.end, t.start + 1))
  }
  private expectPunct(p: string, opener?: { what: string; tok: Token }): Token {
    if (this.punct(this.t, p)) return this.next()
    const ctx = opener ? ` to close ${opener.what} opened at ${opener.tok.line}:${opener.tok.col}` : ''
    return this.fail(`expected '${p}'${ctx}, but found ${describe(this.t)}.`)
  }

  expectEnd(): void {
    if (!this.atEof()) this.fail(`unexpected ${describe(this.t)} after the function body.`)
  }

  parseProgram(): Node {
    if (this.atEof()) this.fail('the expression is empty.')
    const node = this.expr(0)
    if (!this.atEof()) {
      if (this.punct(this.t, ')')) this.fail("unexpected ')' without a matching '('.")
      if (this.kw(this.t, 'RETURN')) this.fail('RETURN must follow one or more VAR definitions.')
      this.fail(`unexpected ${describe(this.t)}. Did you miss an operator or a comma?`)
    }
    return node
  }

  parseQuery(): DaxQuery {
    const definitions: QueryDefinition[] = []
    const evaluates: EvaluateStatement[] = []
    if (this.atEof()) this.fail('the query is empty. A DAX query starts with EVALUATE.')
    while (this.kw(this.t, 'DEFINE')) {
      this.next()
      while (!this.kw(this.t, 'EVALUATE') && !this.kw(this.t, 'DEFINE')) {
        if (this.atEof()) this.fail('DEFINE must be followed by EVALUATE.')
        definitions.push(this.definition())
      }
    }
    if (!this.kw(this.t, 'EVALUATE')) this.fail(`a DAX query starts with EVALUATE (or DEFINE, then EVALUATE), but found ${describe(this.t)}.`)
    while (this.kw(this.t, 'EVALUATE')) {
      const start = this.next()
      if (this.atEof() || this.startsClause(this.t)) this.fail('EVALUATE needs a table expression.')
      const expr = this.expr(0)
      const orderBy: EvaluateStatement['orderBy'] = []
      let startAt: Node[] | null = null
      if (this.kw(this.t, 'ORDER')) {
        this.next()
        if (!this.kw(this.t, 'BY')) this.fail(`expected BY after ORDER, but found ${describe(this.t)}.`)
        this.next()
        for (;;) {
          const e = this.expr(0)
          let desc = false
          if (this.kw(this.t, 'ASC') || this.kw(this.t, 'DESC')) desc = this.next().value.toUpperCase() === 'DESC'
          orderBy.push({ expr: e, desc })
          if (!this.punct(this.t, ',')) break
          this.next()
        }
      }
      if (this.kw(this.t, 'START')) {
        if (orderBy.length === 0) this.fail('START AT can only follow ORDER BY.')
        this.next()
        if (!this.kw(this.t, 'AT')) this.fail(`expected AT after START, but found ${describe(this.t)}.`)
        this.next()
        startAt = []
        for (;;) {
          startAt.push(this.expr(0))
          if (!this.punct(this.t, ',')) break
          this.next()
        }
      }
      evaluates.push({ expr, orderBy, startAt, s: start.start })
      while (this.punct(this.t, ';')) this.next()
      if (!this.atEof() && !this.kw(this.t, 'EVALUATE')) this.fail(`unexpected ${describe(this.t)} after the EVALUATE expression.`)
    }
    return { definitions, evaluates }
  }

  private startsClause(t: Token): boolean {
    return t.type === 'ident' && ['EVALUATE', 'ORDER', 'START', 'DEFINE'].includes(t.value.toUpperCase())
  }

  private tableColumnRef(what: string): { table: string; name: string } {
    const ref = this.t
    if ((ref.type === 'ident' || ref.type === 'table') && this.peek().type === 'column') {
      this.next()
      return { table: ref.value, name: this.next().value }
    }
    return this.fail(`expected table[name] after ${what}, but found ${describe(ref)}.`)
  }

  private definition(): QueryDefinition {
    const t = this.t
    const k = t.type === 'ident' ? t.value.toUpperCase() : ''
    if (k === 'MEASURE' || k === 'COLUMN') {
      this.next()
      const { table, name } = this.tableColumnRef(k)
      this.expectEquals(`${k} ${table}[${name}]`)
      const expr = this.expr(0)
      return { kind: k === 'MEASURE' ? 'measure' : 'column', table, name, expr, s: t.start, e: this.prevEnd() }
    }
    if (k === 'VAR' || k === 'TABLE') {
      this.next()
      const nameTok = this.t
      if (nameTok.type !== 'ident' && nameTok.type !== 'table') this.fail(`expected a name after ${k}, but found ${describe(nameTok)}.`)
      this.next()
      this.expectEquals(`${k} ${nameTok.value}`)
      const expr = this.expr(0)
      if (k === 'TABLE' && this.kw(this.t, 'WITH') && this.kw(this.peek(), 'VISUAL')) {
        const shape = this.visualShape()
        return { kind: 'table', name: nameTok.value, expr, shape, s: t.start, e: this.prevEnd() }
      }
      return { kind: k === 'VAR' ? 'var' : 'table', name: nameTok.value, expr, s: t.start, e: this.prevEnd() }
    }
    if (k === 'FUNCTION') {
      this.next()
      const nameTok = this.t
      if (nameTok.type !== 'ident') this.fail(`expected a function name after FUNCTION, but found ${describe(nameTok)}.`)
      this.next()
      this.expectEquals(`FUNCTION ${nameTok.value}`)
      const fn = this.functionBody(nameTok.value)
      return { kind: 'function', name: nameTok.value, fn, expr: fn.body, s: t.start, e: this.prevEnd() }
    }
    return this.fail(`expected MEASURE, VAR, TABLE, COLUMN or EVALUATE after DEFINE, but found ${describe(t)}.`)
  }

  /** WITH VISUAL SHAPE ( AXIS <axis> ( GROUP <cols> [TOTAL <col>] )+ [ORDER BY <col> [ASC|DESC], ...] )+ [DENSIFY "name"] */
  private visualShape(): VisualShapeDef {
    this.next() // WITH
    this.next() // VISUAL
    if (!this.kw(this.t, 'SHAPE')) this.fail(`expected SHAPE after WITH VISUAL, but found ${describe(this.t)}.`)
    this.next()
    const col = (): string => {
      const c = this.t
      if (c.type === 'column') {
        this.next()
        return c.value
      }
      if ((c.type === 'ident' || c.type === 'table') && this.peek().type === 'column') {
        this.next()
        return this.next().value
      }
      return this.fail(`expected a column such as [Name] in the visual shape, but found ${describe(c)}.`)
    }
    const shape: VisualShapeDef = { axes: [] }
    while (this.kw(this.t, 'AXIS')) {
      this.next()
      const ax = this.t.type === 'ident' ? this.t.value.toUpperCase() : ''
      if (ax !== 'ROWS' && ax !== 'COLUMNS' && ax !== 'ROWPAGES') this.fail(`expected ROWS, COLUMNS or ROWPAGES after AXIS, but found ${describe(this.t)}.`)
      this.next()
      const axis: VisualShapeDef['axes'][number] = { axis: ax, groups: [], orderBy: [] }
      while (this.kw(this.t, 'GROUP')) {
        this.next()
        const cols = [col()]
        while (this.punct(this.t, ',')) {
          this.next()
          cols.push(col())
        }
        let total: string | undefined
        if (this.kw(this.t, 'TOTAL')) {
          this.next()
          total = col()
        }
        axis.groups.push({ cols, total })
      }
      if (!axis.groups.length) this.fail(`AXIS ${ax} needs at least one GROUP.`)
      if (this.kw(this.t, 'ORDER') && this.kw(this.peek(), 'BY')) {
        this.next()
        this.next()
        for (;;) {
          const c = col()
          let desc = false
          if (this.kw(this.t, 'ASC') || this.kw(this.t, 'DESC')) desc = this.next().value.toUpperCase() === 'DESC'
          axis.orderBy.push({ col: c, desc })
          if (!this.punct(this.t, ',')) break
          this.next()
        }
      }
      shape.axes.push(axis)
    }
    if (!shape.axes.length) this.fail('WITH VISUAL SHAPE needs at least one AXIS.')
    if (this.kw(this.t, 'DENSIFY')) {
      this.next()
      if (this.t.type !== 'string') this.fail(`expected a column name in double quotes after DENSIFY, but found ${describe(this.t)}.`)
      shape.densify = this.next().value
    }
    return shape
  }

  /** `( params ) => body` of a user-defined function. */
  functionBody(name: string): FunctionDefinition {
    const open = this.expectPunct('(')
    const params: FunctionParam[] = []
    const TYPES = ['ANYVAL', 'SCALAR', 'TABLE', 'ANYREF', 'CALENDARREF', 'COLUMNREF', 'MEASUREREF', 'TABLEREF']
    const SUBTYPES = ['VARIANT', 'INT64', 'DECIMAL', 'DOUBLE', 'STRING', 'DATETIME', 'BOOLEAN', 'NUMERIC']
    if (!this.punct(this.t, ')')) {
      for (;;) {
        const pt = this.t
        if (pt.type !== 'ident') this.fail(`expected a parameter name in function ${name}, but found ${describe(pt)}.`)
        this.next()
        const p: FunctionParam = { name: pt.value, type: 'ANYVAL', mode: 'val' }
        let explicitMode: string | null = null
        let explicitType = false
        if (this.punct(this.t, ':')) {
          this.next()
          while (this.t.type === 'ident') {
            const w = this.t.value.toUpperCase()
            if (TYPES.includes(w)) {
              p.type = w
              explicitType = true
            } else if (SUBTYPES.includes(w)) {
              p.subtype = w
              if (!explicitType) p.type = 'SCALAR'
            } else if (w === 'VAL' || w === 'EXPR') explicitMode = w
            else this.fail(`unknown type hint '${this.t.value}' for parameter ${pt.value}. Use AnyVal, Scalar, Table, AnyRef, ColumnRef, MeasureRef, TableRef, CalendarRef, a scalar subtype, VAL or EXPR.`)
            this.next()
          }
        }
        const isRef = p.type.endsWith('REF')
        if (isRef && explicitMode === 'VAL') this.fail(`parameter ${pt.value}: reference types (${p.type}) are always passed as EXPR.`)
        p.mode = isRef || explicitMode === 'EXPR' ? 'expr' : 'val'
        if (this.t.type === 'op' && this.t.value === '=') {
          this.next()
          p.default = this.expr(0)
        }
        if (params.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) this.fail(`the parameter ${p.name} is declared twice in function ${name}.`)
        params.push(p)
        if (this.punct(this.t, ',')) {
          this.next()
          continue
        }
        break
      }
    }
    this.expectPunct(')', { what: `the parameter list of ${name} (`, tok: open })
    if (!(this.t.type === 'op' && this.t.value === '=>')) this.fail(`expected '=>' after the parameters of function ${name}, but found ${describe(this.t)}.`)
    this.next()
    if (this.atEof()) this.fail(`function ${name} has no body after '=>'.`)
    const body = this.expr(0)
    return { name, params, body }
  }

  private expectEquals(what: string): void {
    if (!(this.t.type === 'op' && this.t.value === '=')) this.fail(`expected '=' after ${what}, but found ${describe(this.t)}.`)
    this.next()
    const nt: Token = this.tokens[this.i]
    if (this.atEof() || (nt.type === 'ident' && CLAUSE.has(nt.value.toUpperCase()) && nt.value.toUpperCase() !== 'TABLE'))
      this.fail(`${what} has no expression after '='.`)
  }

  private infixOp(t: Token): string | null {
    if (t.type === 'op' && t.value !== '=>') return t.value
    if (this.kw(t, 'IN')) return 'IN'
    return null
  }

  private expr(minBp: number): Node {
    let left = this.prefix()
    for (;;) {
      const t = this.t
      if (this.kw(t, 'NOT') && this.kw(this.peek(), 'IN')) this.fail('DAX has no NOT IN operator. Write NOT ( <value> IN { ... } ) instead.')
      const op = this.infixOp(t)
      if (!op) break
      const bp = INFIX_BP[op]
      if (bp === undefined || bp <= minBp) break
      this.next()
      if (this.atEof()) this.fail(`expected an expression after '${op}', but found the end of the expression.`)
      const right = this.expr(bp)
      left = { kind: 'binary', op: op === 'IN' ? 'IN' : op, left, right, s: left.s, e: right.e }
    }
    return left
  }

  private prefix(): Node {
    const t = this.t
    const s = t.start
    switch (t.type) {
      case 'number':
        this.next()
        return { kind: 'number', value: Number(t.value), s, e: t.end }
      case 'string':
        this.next()
        return { kind: 'string', value: t.value, s, e: t.end }
      case 'column':
        this.next()
        return { kind: 'column', table: null, name: t.value, s, e: t.end }
      case 'param':
        this.next()
        return { kind: 'param', name: t.value, s, e: t.end }
      case 'table': {
        this.next()
        if (this.t.type === 'column') {
          const c = this.next()
          return { kind: 'column', table: t.value, name: c.value, s, e: c.end }
        }
        return { kind: 'ident', name: t.value, quoted: true, s, e: t.end }
      }
      case 'op':
        if (t.value === '-' || t.value === '+') {
          this.next()
          const operand = this.expr(SIGN_BP)
          return { kind: 'unary', op: t.value, operand, s, e: operand.e }
        }
        return this.fail(`unexpected operator '${t.value}'. An operator needs a value on its left.`)
      case 'punct':
        if (t.value === '(') return this.paren()
        if (t.value === '{') return this.tableCtor()
        if (t.value === ')') return this.fail("unexpected ')'. Is there an extra closing parenthesis or a missing argument?")
        if (t.value === ',') return this.fail("unexpected ','. Is an argument missing?")
        return this.fail(`unexpected ${describe(t)}.`)
      case 'eof':
        return this.fail('the expression ended unexpectedly. Is an argument or a closing parenthesis missing?')
      case 'ident':
        return this.identExpr()
    }
  }

  private identExpr(): Node {
    const t = this.t
    const s = t.start
    const upper = t.value.toUpperCase()
    if (upper === 'VAR') return this.varBlock()
    if (upper === 'RETURN') this.fail('RETURN must follow one or more VAR definitions.')
    if (upper === 'NOT' && !this.punct(this.peek(), '(')) {
      this.next()
      const operand = this.expr(NOT_BP)
      return { kind: 'unary', op: 'NOT', operand, s, e: operand.e }
    }
    this.next()
    if (this.t.type === 'column') {
      const c = this.next()
      return { kind: 'column', table: t.value, name: c.value, s, e: c.end }
    }
    if (this.punct(this.t, '(')) {
      const open = this.next()
      const args: Node[] = []
      if (!this.punct(this.t, ')')) {
        for (;;) {
          if (this.punct(this.t, ',') || this.punct(this.t, ')')) {
            // DAX allows skipped optional arguments: f(a, , c) -> treat as BLANK-ish "missing" argument
            args.push({ kind: 'ident', name: '__missing__', quoted: false, s: this.t.start, e: this.t.start })
          } else args.push(this.expr(0))
          if (this.punct(this.t, ',')) {
            this.next()
            continue
          }
          break
        }
      }
      const close = this.expectPunct(')', { what: `${t.value} (`, tok: open })
      if (upper === 'NOT' && args.length === 1) {
        // NOT ( x ) followed by operators: NOT binds to the parenthesized operand, then continue as unary
        return { kind: 'unary', op: 'NOT', operand: args[0], s, e: close.end }
      }
      if ((upper === 'TRUE' || upper === 'FALSE') && args.length === 0) return { kind: 'bool', value: upper === 'TRUE', s, e: close.end }
      return { kind: 'call', name: t.value, args, s, e: close.end }
    }
    if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'bool', value: upper === 'TRUE', s, e: t.end }
    // visual calculation axes may combine: ROWS COLUMNS, COLUMNS ROWS ROWPAGES ...
    if (AXES.has(upper)) {
      let name = upper
      let end = t.end
      while (this.t.type === 'ident' && AXES.has(this.t.value.toUpperCase()) && !name.split(' ').includes(this.t.value.toUpperCase())) {
        name += ' ' + this.t.value.toUpperCase()
        end = this.next().end
      }
      return { kind: 'ident', name, quoted: false, s, e: end }
    }
    // ORDERBY order: "ASC|DESC [BLANKS DEFAULT|FIRST|LAST]" (or just "BLANKS ...") becomes one identifier
    if (upper === 'ASC' || upper === 'DESC' || upper === 'BLANKS') {
      let name = upper
      let end = t.end
      if (upper !== 'BLANKS' && this.t.type === 'ident' && this.t.value.toUpperCase() === 'BLANKS') {
        name += ' BLANKS'
        end = this.next().end
      }
      if (name.endsWith('BLANKS')) {
        const w = this.t.type === 'ident' ? this.t.value.toUpperCase() : ''
        if (w !== 'DEFAULT' && w !== 'FIRST' && w !== 'LAST') this.fail('expected DEFAULT, FIRST or LAST after BLANKS.')
        name += ' ' + w
        end = this.next().end
      }
      return { kind: 'ident', name, quoted: false, s, e: end }
    }
    return { kind: 'ident', name: t.value, quoted: false, s, e: t.end }
  }

  private varBlock(): Node {
    const start = this.t
    const decls: Array<{ name: string; expr: Node; s: number; e: number }> = []
    while (this.kw(this.t, 'VAR')) {
      this.next()
      const nameTok = this.t
      if (nameTok.type !== 'ident' || ['VAR', 'RETURN'].includes(nameTok.value.toUpperCase())) this.fail(`expected a variable name after VAR, but found ${describe(nameTok)}.`)
      this.next()
      if (!(this.t.type === 'op' && this.t.value === '=')) this.fail(`expected '=' after VAR ${nameTok.value}, but found ${describe(this.t)}.`)
      this.next()
      if (this.kw(this.t, 'RETURN') || this.atEof()) this.fail(`VAR ${nameTok.value} has no expression after '='.`)
      const expr = this.expr(0)
      decls.push({ name: nameTok.value, expr, s: nameTok.start, e: nameTok.end })
    }
    if (!this.kw(this.t, 'RETURN')) this.fail(`expected RETURN after the VAR definitions that start at ${start.line}:${start.col}, but found ${describe(this.t)}.`)
    this.next()
    if (this.atEof()) this.fail('RETURN needs an expression.')
    const body = this.expr(0)
    return { kind: 'var', decls, body, s: start.start, e: body.e }
  }

  private paren(): Node {
    const open = this.next()
    const first = this.expr(0)
    if (this.punct(this.t, ',')) {
      const items = [first]
      while (this.punct(this.t, ',')) {
        this.next()
        items.push(this.expr(0))
      }
      const close = this.expectPunct(')', { what: 'the row tuple (', tok: open })
      return { kind: 'tuple', items, s: open.start, e: close.end }
    }
    const close = this.expectPunct(')', { what: "'('", tok: open })
    // keep the parenthesized node but widen its span
    return { ...first, s: open.start, e: close.end }
  }

  private tableCtor(): Node {
    const open = this.next()
    const rows: Node[][] = []
    if (!this.punct(this.t, '}')) {
      for (;;) {
        const item = this.expr(0)
        rows.push(item.kind === 'tuple' ? item.items : [item])
        if (this.punct(this.t, ',')) {
          this.next()
          continue
        }
        break
      }
    }
    const close = this.expectPunct('}', { what: 'the table constructor {', tok: open })
    const width = rows[0]?.length ?? 1
    rows.forEach((r, k) => {
      if (r.length !== width) this.fail(`row ${k + 1} of the table constructor has ${r.length} values, but row 1 has ${width}.`, open)
    })
    return { kind: 'tableCtor', rows, s: open.start, e: close.end }
  }
}

export function parseExpression(src: string): Node {
  return new Parser(lex(src)).parseProgram()
}

/** A model-level function definition (`( params ) => body`, the text after `function Name =`). */
export function parseFunctionDefinition(name: string, src: string): FunctionDefinition {
  const p = new Parser(lex(src))
  const fn = p.functionBody(name)
  p.expectEnd()
  return fn
}

export function parseQuery(src: string): DaxQuery {
  return new Parser(lex(src)).parseQuery()
}

export function isQueryText(src: string): boolean {
  try {
    const t = lex(src)[0]
    return t.type === 'ident' && ['DEFINE', 'EVALUATE'].includes(t.value.toUpperCase())
  } catch {
    return /^\s*(define|evaluate)\b/i.test(src)
  }
}

/** Visit every node (pre-order). */
export function walk(node: Node, fn: (n: Node) => void): void {
  fn(node)
  switch (node.kind) {
    case 'call':
      node.args.forEach((a) => walk(a, fn))
      break
    case 'binary':
      walk(node.left, fn)
      walk(node.right, fn)
      break
    case 'unary':
      walk(node.operand, fn)
      break
    case 'var':
      node.decls.forEach((d) => walk(d.expr, fn))
      walk(node.body, fn)
      break
    case 'tableCtor':
      node.rows.forEach((r) => r.forEach((c) => walk(c, fn)))
      break
    case 'tuple':
      node.items.forEach((c) => walk(c, fn))
      break
  }
}
