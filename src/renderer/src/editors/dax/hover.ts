/**
 * Hover docs: functions (signature, description, example), measures (expression, format, home
 * table), columns (type, table, description / calculated expression), tables, variables.
 */
import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { findDaxFunction, formatSignature } from './functions'
import { DAX_EXAMPLES } from './examples'
import type { DaxSchema } from './schema'
import { isTrivia, tokenizeDax, unquoteRef } from './tokenizer'
import { DATA_TYPE_LABEL } from './labels'

export interface HoverDoc {
  from: number
  to: number
  title: string
  /** code block (signature / expression) */
  code?: string
  body?: string
  example?: string
}

/** Resolve what is under `pos` in `text` (pure; used by the tooltip and tests). */
export function hoverDocAt(text: string, pos: number, schema: DaxSchema): HoverDoc | null {
  const toks = tokenizeDax(text)
  const i = toks.findIndex((t) => t.start <= pos && pos < t.end)
  if (i < 0) return null
  const t = toks[i]
  const prevSig = (() => {
    let j = i - 1
    while (j >= 0 && isTrivia(toks[j])) j--
    return j >= 0 ? toks[j] : undefined
  })()
  if (t.type === 'function') {
    const f = findDaxFunction(t.text)
    if (!f) return { from: t.start, to: t.end, title: t.text.toUpperCase(), body: 'Unknown function.' }
    return { from: t.start, to: t.end, title: `${f.name} — ${f.category}`, code: formatSignature(f), body: `${f.description}${f.returns ? ` Returns: ${f.returns}.` : ''}`, example: DAX_EXAMPLES[f.name] }
  }
  const findTable = (n: string) => schema.tables.find((x) => x.name.toLowerCase() === n.toLowerCase())
  if (t.type === 'column') {
    const name = unquoteRef(t.text)
    const prev = toks[i - 1]
    const qualified = prev && (prev.type === 'table' || prev.type === 'ident')
    const tables = qualified ? [findTable(unquoteRef(prev.text))].filter((x): x is NonNullable<typeof x> => !!x) : [...(schema.homeTable ? [findTable(schema.homeTable)!].filter(Boolean) : []), ...schema.tables]
    for (const tb of tables) {
      const m = tb.measures.find((x) => x.name.toLowerCase() === name.toLowerCase())
      if (m)
        return {
          from: qualified ? prev.start : t.start,
          to: t.end,
          title: `Measure ${tb.name}[${m.name}]`,
          code: `${m.name} =\n${(m.expression ?? '').trim()}`,
          body: [m.formatString ? `Format: ${m.formatString}` : '', m.displayFolder ? `Folder: ${m.displayFolder}` : '', m.description ?? ''].filter(Boolean).join(' · ') || undefined
        }
    }
    for (const tb of qualified ? tables : tables.slice(0, schema.homeTable ? 1 : 0)) {
      const c = tb.columns.find((x) => x.name.toLowerCase() === name.toLowerCase())
      if (c)
        return {
          from: qualified ? prev.start : t.start,
          to: t.end,
          title: `Column ${tb.name}[${c.name}]`,
          code: c.calculated && c.expression ? `${c.name} =\n${c.expression.trim()}` : undefined,
          body: [`${DATA_TYPE_LABEL[c.dataType ?? ''] ?? c.dataType ?? 'Unknown type'}`, c.calculated ? 'calculated column' : '', c.formatString ? `Format: ${c.formatString}` : '', c.hidden ? 'hidden' : '', c.description ?? ''].filter(Boolean).join(' · ')
        }
    }
    return null
  }
  if (t.type === 'table' || t.type === 'ident') {
    if (t.type === 'ident' && prevSig?.type === 'keyword' && prevSig.text.toUpperCase() === 'VAR') return { from: t.start, to: t.end, title: `Variable ${t.text}` }
    const tb = findTable(unquoteRef(t.text))
    if (tb) return { from: t.start, to: t.end, title: `Table ${tb.name}`, body: `${tb.columns.length} columns · ${tb.measures.length} measures${tb.hidden ? ' · hidden' : ''}` }
    if (t.type === 'ident') {
      // variable reference: find its declaration
      const decl = toks.findIndex((x, k) => k < i && x.type === 'ident' && x.text.toLowerCase() === t.text.toLowerCase() && toks.slice(0, k).reverse().find((y) => !isTrivia(y))?.text.toUpperCase() === 'VAR')
      if (decl >= 0) return { from: t.start, to: t.end, title: `Variable ${t.text}`, body: 'Declared with VAR in this expression.' }
    }
  }
  if (t.type === 'keyword') {
    const k = t.text.toUpperCase()
    const kw: Record<string, string> = {
      VAR: 'Declares a variable that stores the result of an expression. Variables are evaluated once, in the context where they are defined.',
      RETURN: 'Ends the VAR block and returns the result expression.',
      DEFINE: 'Starts a block of query-scoped definitions (MEASURE, VAR, TABLE, COLUMN).',
      EVALUATE: 'Executes a table expression and returns its rows.',
      IN: 'Tests whether a value is in a table/list: Table[Column] IN { "A", "B" }.'
    }
    if (kw[k]) return { from: t.start, to: t.end, title: k, body: kw[k] }
  }
  return null
}

function render(doc: HoverDoc): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'wbi-dax-hover'
  const title = document.createElement('div')
  title.className = 'wbi-dax-hover__title'
  title.textContent = doc.title
  dom.append(title)
  if (doc.code) {
    const pre = document.createElement('pre')
    pre.className = 'wbi-dax-hover__code'
    pre.textContent = doc.code.split('\n').slice(0, 14).join('\n') + (doc.code.split('\n').length > 14 ? '\n…' : '')
    dom.append(pre)
  }
  if (doc.body) {
    const b = document.createElement('div')
    b.className = 'wbi-dax-hover__body'
    b.textContent = doc.body
    dom.append(b)
  }
  if (doc.example) {
    const lbl = document.createElement('div')
    lbl.className = 'wbi-dax-hover__label'
    lbl.textContent = 'Example'
    const ex = document.createElement('pre')
    ex.className = 'wbi-dax-hover__code'
    ex.textContent = doc.example
    dom.append(lbl, ex)
  }
  return dom
}

export function daxHover(schema: () => DaxSchema): Extension {
  return hoverTooltip(
    (view, pos): Tooltip | null => {
      const doc = hoverDocAt(view.state.doc.toString(), pos, schema())
      if (!doc) return null
      return { pos: doc.from, end: doc.to, above: true, create: () => ({ dom: render(doc) }) }
    },
    { hoverTime: 350 }
  )
}
