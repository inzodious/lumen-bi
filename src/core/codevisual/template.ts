/**
 * Code visual: the HTML template language. A safe subset of Handlebars, evaluated by a small interpreter (no `eval`,
 * no JavaScript in templates). Every output is HTML-escaped; triple braces (unescaped output) are refused.
 *
 *   {{Total Sales}}                 formatted value (the measure's format string); a name with spaces needs no quotes
 *   {{raw Total Sales}}             the unformatted value
 *   {{[Total Sales]}}               bracket form, needed inside helper arguments: {{format [Total Sales] "0.0,,M"}}
 *   {{#each rows}} … {{else}} … {{/each}}   per row; @index @number @first @last; the first element of each
 *                                   iteration gets data-row, data-selected / data-highlighted and the row's CSS variables
 *   {{#if cond}} … {{else if c}} … {{else}} … {{/if}}  {{#unless}}  {{#with}}
 *   {{#if [Margin %] > 0.4}}        infix comparison (== != > >= < <=) with two operands
 *   (gt a b) …                      helper subexpressions
 *   {{! comment }} {{!-- comment --}}
 *
 * Name resolution: the current context (a row inside #each), then each enclosing context up to the root. A name
 * matches a display name ("Total Sales") or its JavaScript identifier (`totalSales`, naming.ts). `this`, `../name`,
 * `@root.name` and dotted paths (`size.width`) work as in Handlebars.
 *
 * A mustache whose first word is not a helper is read as one name: `{{Total Sales}}` = the field "Total Sales".
 * Errors carry the 1-based line and column in the template.
 */
import type { CodeCell, CodeRow } from './types'
import { jsName } from './naming'

// ---------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------

export class TemplateError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number
  ) {
    super(`${message} (line ${line}, column ${column})`)
    this.name = 'TemplateError'
  }
}

function posOf(src: string, offset: number): { line: number; column: number } {
  let line = 1
  let last = -1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      last = i
    }
  }
  return { line, column: offset - last }
}

// ---------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------

export type Expr =
  | { t: 'path'; parts: string[]; up: number; data: boolean; root: boolean; at: number }
  | { t: 'lit'; value: string | number | boolean | null; at: number }
  | { t: 'call'; name: string; args: Expr[]; at: number }
  /** consecutive bare words in helper arguments: one name with spaces when that resolves, else one argument each */
  | { t: 'run'; words: Expr[]; joined: Expr; at: number }

export type Node =
  | { t: 'text'; text: string }
  | { t: 'out'; expr: Expr; at: number }
  | { t: 'block'; kind: BlockKind; expr: Expr; body: Node[]; inverse: Node[]; at: number }

type BlockKind = 'each' | 'if' | 'unless' | 'with'
const BLOCKS = new Set<BlockKind>(['each', 'if', 'unless', 'with'])
const INFIX: Record<string, string> = { '==': 'eq', '===': 'eq', '!=': 'ne', '!==': 'ne', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' }

// ---------------------------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------------------------

interface Tag {
  kind: 'out' | 'open' | 'close' | 'else'
  name?: string
  body: string
  at: number
  /** offset of `body` in the source */
  bodyAt: number
}

const MAX_TEMPLATE = 512 * 1024

export function parseTemplate(src: string): Node[] {
  if (src.length > MAX_TEMPLATE) throw new TemplateError(`The template is larger than ${MAX_TEMPLATE / 1024} KB`, 1, 1)
  const err = (msg: string, at: number): never => {
    const p = posOf(src, at)
    throw new TemplateError(msg, p.line, p.column)
  }
  // tokenise into text and tags
  const items: Array<{ text: string } | Tag> = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{{', i)
    if (open < 0) {
      items.push({ text: src.slice(i) })
      break
    }
    if (open > i) items.push({ text: src.slice(i, open) })
    if (src.startsWith('{{{', open)) err('Triple braces are not supported: values are always HTML-escaped. Use {{name}}', open)
    if (src.startsWith('{{!--', open)) {
      const end = src.indexOf('--}}', open + 5)
      if (end < 0) err('Unclosed comment {{!--', open)
      i = end + 4
      continue
    }
    const close = src.indexOf('}}', open + 2)
    if (close < 0) err('Unclosed {{', open)
    let body = src.slice(open + 2, close)
    let bodyAt = open + 2
    // whitespace control {{~ … ~}} is accepted and ignored
    if (body.startsWith('~')) {
      body = body.slice(1)
      bodyAt++
    }
    if (body.endsWith('~')) body = body.slice(0, -1)
    i = close + 2
    const lead = body.length - body.trimStart().length
    const trimmed = body.trim()
    bodyAt += lead
    if (trimmed.startsWith('!')) continue
    if (!trimmed) err('Empty {{ }}', open)
    if (trimmed[0] === '#') {
      const m = /^#\s*([A-Za-z]+)\s*([\s\S]*)$/.exec(trimmed)
      if (!m || !BLOCKS.has(m[1] as BlockKind)) err(`Unknown block {{${trimmed.split(/\s/)[0]}}} (use #each, #if, #unless or #with)`, open)
      items.push({ kind: 'open', name: m![1], body: m![2], at: open, bodyAt: bodyAt + trimmed.indexOf(m![2] || '\u0000') })
    } else if (trimmed[0] === '/') {
      items.push({ kind: 'close', name: trimmed.slice(1).trim(), body: '', at: open, bodyAt })
    } else if (trimmed === 'else' || trimmed.startsWith('else ')) {
      items.push({ kind: 'else', body: trimmed.slice(4).trim(), at: open, bodyAt: bodyAt + 4 })
    } else if (trimmed[0] === '>' || trimmed[0] === '&' || trimmed[0] === '^') {
      err(`{{${trimmed[0]}…}} is not supported in Lumen templates`, open)
    } else {
      items.push({ kind: 'out', body: trimmed, at: open, bodyAt })
    }
  }

  // build the tree
  let pos = 0
  const parseList = (stopAt: (t: Tag) => boolean): Node[] => {
    const out: Node[] = []
    while (pos < items.length) {
      const it = items[pos]
      if ('text' in it) {
        out.push({ t: 'text', text: it.text })
        pos++
        continue
      }
      if (stopAt(it)) return out
      if (it.kind === 'close') err(`Unexpected {{/${it.name}}}`, it.at)
      if (it.kind === 'else') err('{{else}} outside a block', it.at)
      pos++
      if (it.kind === 'out') {
        out.push({ t: 'out', expr: parseExpr(it.body, it.bodyAt, src), at: it.at })
        continue
      }
      out.push(parseBlock(it))
    }
    return out
  }
  const parseBlock = (open: Tag): Node => {
    const kind = open.name as BlockKind
    if (!open.body.trim()) err(`{{#${kind}}} needs an argument`, open.at)
    const expr = parseExpr(open.body, open.bodyAt, src)
    const body = parseList((t) => t.kind === 'else' || t.kind === 'close')
    let inverse: Node[] = []
    const t = items[pos] as Tag | undefined
    if (!t) err(`{{#${kind}}} is not closed with {{/${kind}}}`, open.at)
    if (t!.kind === 'else') {
      pos++
      if (t!.body.startsWith('if ') || t!.body.startsWith('unless ')) {
        // {{else if x}} = nested block that shares this block's closing tag
        const sub = t!.body.startsWith('if ') ? 'if' : 'unless'
        const subTag: Tag = { kind: 'open', name: sub, body: t!.body.slice(sub.length + 1), at: t!.at, bodyAt: t!.bodyAt + sub.length + 1 }
        inverse = [parseChained(subTag, kind)]
      } else {
        if (t!.body) err(`Unexpected "${t!.body}" after {{else}}`, t!.at)
        inverse = parseList((x) => x.kind === 'close' || x.kind === 'else')
      }
      const c = items[pos] as Tag | undefined
      if (!c || c.kind !== 'close') err(`{{#${kind}}} is not closed with {{/${kind}}}`, open.at)
    }
    const c = items[pos] as Tag
    if (c.name !== kind) err(`{{/${c.name}}} closes {{#${kind}}}`, c.at)
    pos++
    return { t: 'block', kind, expr, body, inverse, at: open.at }
  }
  /** an `else if` chain member: like parseBlock but closed by the outer block's tag (not consumed here) */
  const parseChained = (open: Tag, outer: BlockKind): Node => {
    const kind = open.name as BlockKind
    const expr = parseExpr(open.body, open.bodyAt, src)
    const body = parseList((t) => t.kind === 'else' || t.kind === 'close')
    let inverse: Node[] = []
    const t = items[pos] as Tag | undefined
    if (!t) err(`{{#${outer}}} is not closed with {{/${outer}}}`, open.at)
    if (t!.kind === 'else') {
      pos++
      if (t!.body.startsWith('if ') || t!.body.startsWith('unless ')) {
        const sub = t!.body.startsWith('if ') ? 'if' : 'unless'
        inverse = [parseChained({ kind: 'open', name: sub, body: t!.body.slice(sub.length + 1), at: t!.at, bodyAt: t!.bodyAt + sub.length + 1 }, outer)]
      } else inverse = parseList((x) => x.kind === 'close' || x.kind === 'else')
    }
    const c = items[pos] as Tag | undefined
    if (!c || c.kind !== 'close') err(`{{#${outer}}} is not closed with {{/${outer}}}`, open.at)
    if (c!.name !== outer) err(`{{/${c!.name}}} closes {{#${outer}}}`, c!.at)
    // the outer block consumes the closing tag
    return { t: 'block', kind, expr, body, inverse, at: open.at }
  }
  const nodes = parseList(() => false)
  return nodes
}

/** Split a mustache body into words: quotes, [brackets] and (subexpressions) stay whole. */
function words(body: string, at: number, src: string): Array<{ w: string; at: number }> {
  const out: Array<{ w: string; at: number }> = []
  let i = 0
  const err = (msg: string, o: number): never => {
    const p = posOf(src, at + o)
    throw new TemplateError(msg, p.line, p.column)
  }
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++
    if (i >= body.length) break
    const start = i
    let depth = 0
    let q: string | null = null
    let br = false
    for (; i < body.length; i++) {
      const c = body[i]
      if (q) {
        if (c === '\\') i++
        else if (c === q) q = null
        continue
      }
      if (br) {
        if (c === ']') br = false
        continue
      }
      if (c === '"' || c === "'") q = c
      else if (c === '[') br = true
      else if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth < 0) err('Unbalanced )', i)
      } else if (/\s/.test(c) && depth === 0) break
    }
    if (q) err('Unclosed string', start)
    if (br) err('Unclosed [', start)
    if (depth > 0) err('Unbalanced (', start)
    out.push({ w: body.slice(start, i), at: at + start })
  }
  return out
}

function parseExpr(body: string, at: number, src: string): Expr {
  const ws = words(body, at, src)
  if (!ws.length) {
    const p = posOf(src, at)
    throw new TemplateError('Empty expression', p.line, p.column)
  }
  // infix comparison: a OP b
  if (ws.length === 3 && INFIX[ws[1].w]) return { t: 'call', name: INFIX[ws[1].w], args: [parseAtom(ws[0].w, ws[0].at, src), parseAtom(ws[2].w, ws[2].at, src)], at }
  const head = ws[0].w
  if (ws.length > 1 && isHelper(head)) return { t: 'call', name: head, args: argList(ws.slice(1), src), at }
  if (ws.length === 1) {
    if (isHelper(head) && !NAME_LIKE_HELPERS.has(head)) return { t: 'call', name: head, args: [], at }
    return parseAtom(head, ws[0].at, src)
  }
  // several words, the first is no helper: one name with spaces ("Total Sales")
  return { t: 'path', parts: [body.trim()], up: 0, data: false, root: false, at }
}

const BARE = /^[A-Za-z_\u00C0-\uFFFF][^\s"'()[\]@]*$/

/** Helper arguments: runs of bare words become `run` expressions (`{{raw Total Sales}}`, `{{format Total Sales "0"}}`). */
function argList(ws: Array<{ w: string; at: number }>, src: string): Expr[] {
  const out: Expr[] = []
  let i = 0
  while (i < ws.length) {
    let j = i
    while (j < ws.length && BARE.test(ws[j].w) && !['true', 'false', 'null', 'undefined', 'this'].includes(ws[j].w) && !ws[j].w.includes('.')) j++
    if (j - i >= 2) {
      const run = ws.slice(i, j)
      out.push({ t: 'run', words: run.map((x) => parseAtom(x.w, x.at, src)), joined: { t: 'path', parts: [run.map((x) => x.w).join(' ')], up: 0, data: false, root: false, at: run[0].at }, at: run[0].at })
      i = j
      continue
    }
    out.push(parseAtom(ws[i].w, ws[i].at, src))
    i++
  }
  return out
}

function parseAtom(w: string, at: number, src: string): Expr {
  if (w.startsWith('(')) {
    const fail = (msg: string, o = 0): never => {
      const p = posOf(src, at + o)
      throw new TemplateError(msg, p.line, p.column)
    }
    if (!w.endsWith(')')) fail('Unbalanced (')
    const ws = words(w.slice(1, -1), at + 1, src)
    if (!ws.length) fail('Empty ( )')
    if (ws.length === 3 && INFIX[ws[1].w]) return { t: 'call', name: INFIX[ws[1].w], args: [parseAtom(ws[0].w, ws[0].at, src), parseAtom(ws[2].w, ws[2].at, src)], at }
    if (!isHelper(ws[0].w)) fail(`Unknown helper "${ws[0].w}"`, 1)
    return { t: 'call', name: ws[0].w, args: argList(ws.slice(1), src), at }
  }
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(w)) return { t: 'lit', value: Number(w), at }
  if (w === 'true' || w === 'false') return { t: 'lit', value: w === 'true', at }
  if (w === 'null' || w === 'undefined') return { t: 'lit', value: null, at }
  if ((w.startsWith('"') && w.endsWith('"')) || (w.startsWith("'") && w.endsWith("'"))) {
    return { t: 'lit', value: w.slice(1, -1).replace(/\\(.)/g, '$1'), at }
  }
  return parsePath(w, at)
}

function parsePath(w: string, at: number): Expr {
  let s = w
  let up = 0
  let data = false
  let root = false
  if (s.startsWith('@root.')) {
    root = true
    s = s.slice(6)
  } else if (s.startsWith('@')) {
    data = true
    s = s.slice(1)
  }
  while (s.startsWith('../')) {
    up++
    s = s.slice(3)
  }
  if (s === 'this' || s === '.') return { t: 'path', parts: [], up, data, root, at }
  if (s.startsWith('this.')) s = s.slice(5)
  const parts: string[] = []
  const re = /\[([^\]]*)\]|([^.[\]]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) parts.push(m[1] ?? m[2])
  return { t: 'path', parts, up, data, root, at }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

export interface TemplateEnv {
  /** Lumen's formatter (the same one native visuals use) */
  format(value: unknown, formatString?: string): string
  /** a registered report resource (image) by name, as a data: URI; undefined when unknown */
  resource?(name: string): string | undefined
}

type Helper = (env: TemplateEnv, args: unknown[], scope: Scope) => unknown

const isCell = (v: unknown): v is CodeCell => !!v && typeof v === 'object' && 'formatted' in (v as object) && 'type' in (v as object)
/** raw value of a cell (other values unchanged) */
export const rawOf = (v: unknown): unknown => (isCell(v) ? v.value : v)
const num = (v: unknown): number => {
  const r = rawOf(v)
  if (typeof r === 'number') return r
  if (typeof r === 'boolean') return r ? 1 : 0
  if (r === null || r === undefined || r === '') return NaN
  const n = Number(r)
  return n
}
const truthy = (v: unknown): boolean => {
  const r = rawOf(v)
  if (Array.isArray(r)) return r.length > 0
  return !(r === null || r === undefined || r === false || r === 0 || r === '' || (typeof r === 'number' && Number.isNaN(r)))
}
const cmp = (a: unknown, b: unknown): number => {
  const x = rawOf(a)
  const y = rawOf(b)
  if (typeof x === 'number' || typeof y === 'number') return num(x) - num(y)
  return String(x ?? '').localeCompare(String(y ?? ''))
}

/** Values of one field over a list of rows (the root rows when the list is omitted). */
function columnValues(args: unknown[], scope: Scope): number[] {
  let rows: unknown = scope.root().rows
  let field: unknown = args[0]
  if (Array.isArray(args[0])) {
    rows = args[0]
    field = args[1]
  }
  if (!Array.isArray(rows)) return []
  const name = String(rawOf(field) ?? '')
  return rows.map((r) => num(lookupIn(r, name))).filter((n) => !Number.isNaN(n))
}

function sparkPoints(a: unknown[], scope: Scope, area: boolean): string {
  const args = [...a]
  let field: string | undefined
  if (args.length && typeof rawOf(args[0]) === 'string' && Number.isNaN(Number(rawOf(args[0])))) field = String(rawOf(args.shift()))
  const w = args[0] === undefined ? 100 : num(args[0])
  const h = args[1] === undefined ? 30 : num(args[1])
  const root = scope.root()
  const rows: unknown[] = Array.isArray(root.rows) ? root.rows : []
  const name = field ?? root.measureName1
  if (!name || !rows.length) return ''
  const vals = rows.map((r) => num(lookupIn(r, name)))
  const finite = vals.filter((v) => Number.isFinite(v))
  if (!finite.length) return ''
  const lo = Math.min(0, ...finite)
  const hi = Math.max(...finite)
  const span = hi - lo || 1
  const step = rows.length > 1 ? w / (rows.length - 1) : 0
  const r2 = (n: number) => Math.round(n * 100) / 100
  const pts = vals.map((v, i) => `${r2(i * step)},${r2(h - ((Number.isFinite(v) ? v : lo) - lo) / span * h)}`)
  if (area) pts.push(`${r2((rows.length - 1) * step)},${r2(h)}`, `0,${r2(h)}`)
  return pts.join(' ')
}

const fixed = (n: number, d: number) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const HELPERS: Record<string, Helper> = {
  raw: (_e, a) => rawOf(a[0]),
  format: (e, a) => {
    const v = a[0]
    const f = a[1] === undefined ? undefined : String(rawOf(a[1]))
    if (isCell(v)) return v.value === null ? '' : f === undefined ? v.formatted : e.format(v.value, f)
    return v === null || v === undefined ? '' : e.format(v, f)
  },
  percent: (_e, a) => {
    const n = num(a[0])
    return Number.isNaN(n) ? '' : `${fixed(n * 100, a[1] === undefined ? 0 : num(a[1]))}%`
  },
  number: (_e, a) => {
    const n = num(a[0])
    return Number.isNaN(n) ? '' : fixed(n, a[1] === undefined ? 0 : num(a[1]))
  },
  sum: (_e, a, s) => columnValues(a, s).reduce((x, y) => x + y, 0),
  min: (_e, a, s) => {
    const v = columnValues(a, s)
    return v.length ? Math.min(...v) : null
  },
  max: (_e, a, s) => {
    const v = columnValues(a, s)
    return v.length ? Math.max(...v) : null
  },
  avg: (_e, a, s) => {
    const v = columnValues(a, s)
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null
  },
  count: (_e, a, s) => (Array.isArray(a[0]) ? a[0].length : a.length ? columnValues(a, s).length : (s.root().rows?.length ?? 0)),
  eq: (_e, a) => cmp(a[0], a[1]) === 0,
  ne: (_e, a) => cmp(a[0], a[1]) !== 0,
  gt: (_e, a) => cmp(a[0], a[1]) > 0,
  gte: (_e, a) => cmp(a[0], a[1]) >= 0,
  lt: (_e, a) => cmp(a[0], a[1]) < 0,
  lte: (_e, a) => cmp(a[0], a[1]) <= 0,
  and: (_e, a) => a.every(truthy),
  or: (_e, a) => a.some(truthy),
  not: (_e, a) => !truthy(a[0]),
  add: (_e, a) => a.reduce<number>((x, y) => x + num(y), 0),
  sub: (_e, a) => num(a[0]) - num(a[1]),
  mul: (_e, a) => a.reduce<number>((x, y) => x * num(y), 1),
  div: (_e, a) => (num(a[1]) === 0 ? null : num(a[0]) / num(a[1])),
  mod: (_e, a) => num(a[0]) % num(a[1]),
  round: (_e, a) => {
    const d = a[1] === undefined ? 0 : num(a[1])
    const f = 10 ** d
    return Math.round(num(a[0]) * f) / f
  },
  abs: (_e, a) => Math.abs(num(a[0])),
  floor: (_e, a) => Math.floor(num(a[0])),
  ceil: (_e, a) => Math.ceil(num(a[0])),
  clamp: (_e, a) => Math.min(num(a[2]), Math.max(num(a[1]), num(a[0]))),
  default: (_e, a) => (truthy(a[0]) ? a[0] : a[1]),
  concat: (_e, a) => a.map((x) => (isCell(x) ? x.formatted : x === null || x === undefined ? '' : String(x))).join(''),
  lower: (_e, a) => String(textOf(a[0])).toLowerCase(),
  upper: (_e, a) => String(textOf(a[0])).toUpperCase(),
  len: (_e, a) => (Array.isArray(a[0]) ? a[0].length : String(textOf(a[0])).length),
  ifThen: (_e, a) => (truthy(a[0]) ? a[1] : a[2]),
  json: (_e, a) => JSON.stringify(a[0] ?? null),
  resource: (e, a) => e.resource?.(String(rawOf(a[0]) ?? '')) ?? '',
  color: (_e, a, s) => {
    const colors: string[] = s.root().theme?.colors ?? []
    const n = Math.max(1, Math.round(num(a[0]) || 1))
    return colors.length ? colors[(n - 1) % colors.length] : ''
  },
  /**
   * SVG polyline points for a field over the root rows, scaled into width × height (the largest value at the top,
   * zero or the smallest value at the bottom): `points [field] width height` (field defaults to the first measure).
   */
  points: (_e, a, s) => sparkPoints(a, s, false),
  /** the same as a closed area (down to the bottom edge), for <polygon> */
  areaPoints: (_e, a, s) => sparkPoints(a, s, true),
  /** value / largest value of a field over the rows, 0…1 (negative values give negative fractions) */
  pctOfMax: (_e, a, s) => {
    const field = String(rawOf(a[1] ?? '') ?? '')
    const v = num(a[0])
    const vals = columnValues([field], s)
    const m = Math.max(0, ...vals.map(Math.abs))
    return m === 0 || Number.isNaN(v) ? 0 : v / m
  }
}

/** Helpers whose name can also be a field name when used alone (`{{count}}` = a field named "count" if it exists). */
const NAME_LIKE_HELPERS = new Set(['min', 'max', 'sum', 'count', 'avg', 'color', 'default', 'number', 'percent', 'format', 'raw', 'len'])

function isHelper(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HELPERS, name)
}

const textOf = (v: unknown): unknown => (isCell(v) ? v.formatted : (v ?? ''))

// ---------------------------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------------------------

interface Frame {
  ctx: any
  data: Record<string, unknown>
}

class Scope {
  constructor(private frames: Frame[]) {}
  push(ctx: any, data: Record<string, unknown> = {}): Scope {
    return new Scope([...this.frames, { ctx, data: { ...this.top().data, ...data } }])
  }
  top(): Frame {
    return this.frames[this.frames.length - 1]
  }
  root(): any {
    return this.frames[0].ctx
  }
  at(up: number): Frame | undefined {
    return this.frames[this.frames.length - 1 - up]
  }
  /** the frames from innermost to outermost */
  chain(): Frame[] {
    return [...this.frames].reverse()
  }
}

/** Own-property lookup by display name, then by JavaScript identifier, then case-insensitively. */
export function lookupIn(obj: any, name: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name]
  const cells = (obj as { cells?: Record<string, unknown> }).cells
  if (cells && typeof cells === 'object' && Object.prototype.hasOwnProperty.call(cells, name)) return cells[name]
  const lower = name.toLowerCase()
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower || jsName(k) === name) return obj[k]
  if (cells) for (const k of Object.keys(cells)) if (k.toLowerCase() === lower || jsName(k) === name) return cells[k]
  return undefined
}

const MISSING = Symbol('missing')

function resolvePath(e: Extract<Expr, { t: 'path' }>, scope: Scope): unknown {
  if (e.data) {
    const v = scope.top().data[e.parts[0]]
    return e.parts.slice(1).reduce<unknown>((o, p) => lookupIn(o, p), v)
  }
  let base: unknown
  if (e.root) base = scope.root()
  else if (e.up > 0) base = scope.at(e.up)?.ctx
  if (base !== undefined || e.root || e.up > 0) return e.parts.reduce<unknown>((o, p) => lookupIn(o, p), base)
  if (!e.parts.length) return scope.top().ctx
  // first part: innermost context that has it
  for (const f of scope.chain()) {
    const v = lookupIn(f.ctx, e.parts[0])
    if (v !== undefined) return e.parts.slice(1).reduce<unknown>((o, p) => lookupIn(o, p), v)
  }
  return MISSING
}

export interface EvalOptions {
  /** called for each `{{#each}}` iteration over rows: attributes for the iteration's first element */
  rowAttributes?(row: CodeRow, index: number): { attrs: Record<string, string>; style: string }
  /** maximum output length (characters) */
  maxOutput?: number
  /** a name that resolved to nothing (output empty): reported once per position, for the editor's warnings */
  onMissing?(name: string, line: number, column: number): void
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' }
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`=]/g, (c) => ESC[c])
}

function display(v: unknown): string {
  if (v === MISSING || v === null || v === undefined) return ''
  if (isCell(v)) return v.formatted
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return ''
  return ''
}

const isRow = (v: unknown): v is CodeRow => !!v && typeof v === 'object' && 'cells' in (v as object) && 'key' in (v as object)

/** Start tag at the beginning of an iteration's output (after whitespace / comments): `<tag attrs>` */
const START_TAG = /^(\s*(?:<!--[\s\S]*?-->\s*)*<)([A-Za-z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)(\s*\/?>)/

/** Put the row attributes and CSS variables on the first element of one iteration's output. */
export function decorateFirstElement(html: string, attrs: Record<string, string>, style: string): string {
  const m = START_TAG.exec(html)
  if (!m) return html
  let a = m[3]
  for (const [k, v] of Object.entries(attrs)) {
    if (new RegExp(`\\s${k}\\s*=`, 'i').test(a)) continue
    a += ` ${k}="${escapeHtml(v)}"`
  }
  if (style) {
    const sm = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/i.exec(a)
    if (sm) {
      const cur = sm[3] ?? sm[4] ?? ''
      a = a.replace(sm[0], `${sm[1]}"${escapeHtml(style)}${escapeHtml(decodeEntities(cur))}"`)
    } else a += ` style="${escapeHtml(style)}"`
  }
  return m[1] + m[2] + a + m[4] + html.slice(m[0].length)
}

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? ''
  })
}

/** Evaluate a parsed template against a root context. */
export function renderTemplate(nodes: Node[], root: any, env: TemplateEnv, src: string, opts: EvalOptions = {}): string {
  const max = opts.maxOutput ?? 4 * 1024 * 1024
  let size = 0
  const reported = new Set<number>()
  const fail = (msg: string, at: number): never => {
    const p = posOf(src, at)
    throw new TemplateError(msg, p.line, p.column)
  }
  const evalExpr = (e: Expr, scope: Scope): unknown => {
    if (e.t === 'lit') return e.value
    if (e.t === 'run') return evalExpr(e.joined, scope)
    if (e.t === 'path') {
      const v = resolvePath(e, scope)
      if (v === MISSING) {
        if (opts.onMissing && !reported.has(e.at)) {
          reported.add(e.at)
          const p = posOf(src, e.at)
          opts.onMissing(e.parts.join('.'), p.line, p.column)
        }
        return undefined
      }
      return v
    }
    const h = HELPERS[e.name]
    if (!h) {
      // `(name)` with no helper: a name lookup
      const v = resolvePath({ t: 'path', parts: [e.name], up: 0, data: false, root: false, at: e.at }, scope)
      if (v !== MISSING && !e.args.length) return v
      return fail(`Unknown helper "${e.name}"`, e.at)
    }
    // a lone name-like helper that is also a field (`{{count}}`): the field wins
    if (!e.args.length && NAME_LIKE_HELPERS.has(e.name)) {
      const v = resolvePath({ t: 'path', parts: [e.name], up: 0, data: false, root: false, at: e.at }, scope)
      if (v !== MISSING) return v
    }
    try {
      const args: unknown[] = []
      for (const a of e.args) {
        if (a.t !== 'run') {
          args.push(evalExpr(a, scope))
          continue
        }
        const whole = resolvePath(a.joined as Extract<Expr, { t: 'path' }>, scope)
        if (whole !== MISSING) args.push(whole)
        else for (const w of a.words) args.push(evalExpr(w, scope))
      }
      return h(env, args, scope)
    } catch (x) {
      if (x instanceof TemplateError) throw x
      return fail(`${e.name}: ${x instanceof Error ? x.message : String(x)}`, e.at)
    }
  }
  const run = (nodes: Node[], scope: Scope): string => {
    let out = ''
    for (const n of nodes) {
      if (n.t === 'text') out += n.text
      else if (n.t === 'out') out += escapeHtml(display(evalExpr(n.expr, scope)))
      else out += runBlock(n, scope)
      if (out.length + size > max) fail(`The template output is larger than ${Math.round(max / 1048576)} MB`, n.t === 'text' ? 0 : n.at)
    }
    return out
  }
  const runBlock = (n: Extract<Node, { t: 'block' }>, scope: Scope): string => {
    const v = evalExpr(n.expr, scope)
    switch (n.kind) {
      case 'if':
        return truthy(v) ? run(n.body, scope) : run(n.inverse, scope)
      case 'unless':
        return !truthy(v) ? run(n.body, scope) : run(n.inverse, scope)
      case 'with':
        return truthy(v) ? run(n.body, scope.push(v)) : run(n.inverse, scope)
      case 'each': {
        const r = rawOf(v)
        let entries: Array<[string | number, unknown]>
        if (Array.isArray(r)) entries = r.map((x, i) => [i, x])
        else if (r && typeof r === 'object') entries = Object.entries(r)
        else entries = []
        if (!entries.length) return run(n.inverse, scope)
        let out = ''
        entries.forEach(([k, item], i) => {
          const s = scope.push(item, { index: i, number: i + 1, key: k, first: i === 0, last: i === entries.length - 1 })
          let part = run(n.body, s)
          if (isRow(item) && opts.rowAttributes) {
            const d = opts.rowAttributes(item, i)
            part = decorateFirstElement(part, d.attrs, d.style)
          }
          out += part
          size += part.length
        })
        return out
      }
    }
  }
  return run(nodes, new Scope([{ ctx: root, data: {} }]))
}

/** Parse + evaluate (convenience). */
export function evaluateTemplate(src: string, root: any, env: TemplateEnv, opts?: EvalOptions): string {
  return renderTemplate(parseTemplate(src), root, env, src, opts)
}
