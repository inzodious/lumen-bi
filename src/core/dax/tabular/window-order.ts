/**
 * ORDERBY clauses of the window functions (OFFSET, INDEX, WINDOW, RANK, ROWNUMBER) and their blank handling.
 *
 * ORDERBY ( <expr>[, <order>] ... ) where <order> is "OrderDirection [BlankHandling]": ASC / DESC (or 1 / TRUE,
 * 0 / FALSE) optionally followed by BLANKS DEFAULT | BLANKS FIRST | BLANKS LAST. The parser joins the words of an
 * order into one identifier ("DESC BLANKS LAST"). Blank handling on an expression takes priority over the window
 * function's <blanks> argument.
 */
import type { Node } from './parser.ts'
import { sortCompare, type Scalar } from './values.ts'

export type BlankOrder = 'DEFAULT' | 'FIRST' | 'LAST' | 'KEEP'

export interface OrderItem {
  expr: Node
  desc: boolean
  /** per-expression blank handling (BLANKS FIRST / LAST / DEFAULT); undefined = the function's <blanks> */
  blanks?: BlankOrder
}

const ORDER_WORD = /^(ASC|DESC)?( BLANKS (DEFAULT|FIRST|LAST))?$/

function orderWord(n: Node | undefined): { desc: boolean; blanks?: BlankOrder } | null {
  if (!n) return null
  if (n.kind === 'number') return { desc: n.value === 0 }
  if (n.kind === 'bool') return { desc: !n.value }
  if (n.kind !== 'ident') return null
  const u = n.name.toUpperCase().replace(/\s+/g, ' ').trim()
  if (!u || u === 'BLANKS') return null
  const m = ORDER_WORD.exec(u.startsWith('BLANKS') ? ' ' + u : u)
  if (!m) return null
  return { desc: m[1] === 'DESC', blanks: m[3] as BlankOrder | undefined }
}

/** The (expression, direction, blanks) items of an ORDERBY call's arguments. */
export function parseOrderBy(args: Node[]): OrderItem[] {
  const out: OrderItem[] = []
  for (let i = 0; i < args.length; ) {
    const e = args[i]
    const o = orderWord(args[i + 1])
    if (o) {
      out.push({ expr: e, desc: o.desc, blanks: o.blanks })
      i += 2
    } else {
      out.push({ expr: e, desc: false })
      i += 1
    }
  }
  return out
}

/**
 * Compare two ORDERBY values. DEFAULT (and KEEP): for numbers a blank sorts between the negative values and zero;
 * for strings (and other types) before all values, including the empty string. FIRST / LAST put blanks at the
 * beginning / end regardless of the direction.
 */
export function windowCompare(a: Scalar, b: Scalar, desc: boolean, blanks: BlankOrder): number {
  const an = a === null
  const bn = b === null
  if (an && bn) return 0
  if (an !== bn) {
    if (blanks === 'FIRST') return an ? -1 : 1
    if (blanks === 'LAST') return an ? 1 : -1
    const v = an ? b : a
    // blank vs a value v (ascending): blank > negative numbers, blank < zero / positives / strings
    const blankVsV = typeof v === 'number' && v < 0 ? 1 : -1
    const c = an ? blankVsV : -blankVsV
    return desc ? -c : c
  }
  const c = sortCompare(a, b)
  return desc ? -c : c
}
