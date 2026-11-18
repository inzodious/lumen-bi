/**
 * DAX autocomplete (CodeMirror adapter over ./intellisense): fuzzy/prefix ranking with common,
 * recent and in-scope boosts; functions insert `NAME(` with an auto-closed `)` (type-over) and the
 * caret inside; tables insert 'Table'; `[` / 'Table'[ list measures / columns; snippets.
 */
import { insertBracket, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { EditorState, Transaction, TransactionSpec } from '@codemirror/state'
import { formatSignature } from './functions'
import type { DaxSchema } from './schema'
import { buildCandidates, completionContextAt, rankCandidates, recordUsage, snippetText, type RankedCandidate } from './intellisense'
import { DAX_EXAMPLES } from './examples'

export interface DaxCompletionOptions {
  schema: () => DaxSchema
  /** query editors also offer DEFINE/EVALUATE/ORDER BY... */
  query?: boolean
}

const MAX_OPTIONS = 120

/** CM icon type (class `cm-completionIcon-<type>`) per candidate. */
function iconType(c: RankedCandidate): string {
  switch (c.kind) {
    case 'function':
      return 'function'
    case 'keyword':
      return 'keyword'
    case 'table':
      return 'class'
    case 'measure':
      return 'dax-measure'
    case 'variable':
      return 'variable'
    case 'snippet':
      return 'text'
    case 'column': {
      if (c.calculated) return 'dax-calc'
      const t = c.dataType
      return t === 'int64' || t === 'double' || t === 'decimal' ? 'dax-num' : t === 'dateTime' ? 'dax-date' : t === 'boolean' ? 'dax-bool' : 'dax-text'
    }
  }
}

function infoNode(c: RankedCandidate): (() => Node) | undefined {
  if (c.kind === 'function' && c.fn) {
    const f = c.fn
    return () => el('div', 'wbi-dax-info', [el('div', 'wbi-dax-info__sig', formatSignature(f)), el('div', 'wbi-dax-info__desc', f.description), ...(DAX_EXAMPLES[f.name] ? [el('pre', 'wbi-dax-info__ex', DAX_EXAMPLES[f.name])] : [])])
  }
  if (c.kind === 'snippet' && c.template) {
    const text = snippetText(c.template)
    return () => el('div', 'wbi-dax-info', [el('div', 'wbi-dax-info__sig', `Snippet: ${c.detail ?? ''}`), el('pre', 'wbi-dax-info__ex', text)])
  }
  return undefined
}

function el(tag: string, cls: string, content: string | Node[]): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (typeof content === 'string') e.textContent = content
  else e.append(...content)
  return e
}

/** First step: replace the typed word with the function name (or step into an existing `(`). */
function nameInsertion(state: EditorState, name: string, from: number, to: number): { spec: TransactionSpec; needParens: boolean } {
  const hasParen = state.sliceDoc(to, to + 1) === '('
  return { spec: { changes: { from, to, insert: name }, selection: { anchor: from + name.length + (hasParen ? 1 : 0) }, userEvent: 'input.complete' }, needParens: !hasParen }
}

/** Second step: auto-closed `()` tracked by closeBrackets (so typing `)` types over), caret inside. */
function parensInsertion(state: EditorState): Transaction {
  const pos = state.selection.main.head
  return insertBracket(state, '(') ?? state.update({ changes: { from: pos, insert: '()' }, selection: { anchor: pos + 1 } })
}

/** Pure version over EditorState (unit tests). */
export function applyFunctionToState(state: EditorState, name: string, from: number, to: number): EditorState {
  const { spec, needParens } = nameInsertion(state, name, from, to)
  let next = state.update(spec).state
  if (needParens) next = parensInsertion(next).state
  return next
}

export function applyFunction(view: EditorView, name: string, from: number, to: number): void {
  const { spec, needParens } = nameInsertion(view.state, name, from, to)
  view.dispatch(spec)
  if (needParens) view.dispatch(parensInsertion(view.state))
}

function toCompletion(c: RankedCandidate): Completion {
  const base: Completion = { label: c.label, type: iconType(c), detail: c.detail, info: infoNode(c), boost: 0 }
  if (c.kind === 'function') {
    return {
      ...base,
      apply: (view, _completion, from, to) => {
        recordUsage(c.key)
        applyFunction(view, c.insert, from, to)
      }
    }
  }
  if (c.kind === 'snippet' && c.template) {
    const expand = snippet(c.template)
    return {
      ...base,
      apply: (view, completion, from, to) => {
        recordUsage(c.key)
        expand(view, completion, from, to)
      }
    }
  }
  return {
    ...base,
    apply: (view, _completion, from, to) => {
      recordUsage(c.key)
      // swallow an auto-closed `]` / `'` right after the cursor
      const after = view.state.sliceDoc(to, to + 1)
      const end = (c.insert.endsWith(']') && after === ']') || (c.insert.startsWith("'") && after === "'") ? to + 1 : to
      view.dispatch({ changes: { from, to: end, insert: c.insert }, selection: { anchor: from + c.insert.length }, userEvent: 'input.complete' })
    }
  }
}

export function daxCompletionSource(opts: DaxCompletionOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    // context from the current statement (bounded look-back keeps long queries fast)
    const lookFrom = Math.max(0, line.from - 2000)
    const before = ctx.state.sliceDoc(lookFrom, ctx.pos)
    const mode = completionContextAt(before)
    if (mode.kind === 'none') return null
    if (mode.kind === 'word' && !mode.query && !ctx.explicit) return null
    const cands = buildCandidates(mode, opts.schema(), { docBefore: ctx.state.sliceDoc(0, ctx.pos), query: opts.query })
    const ranked = rankCandidates(cands, mode.query, { limit: MAX_OPTIONS })
    if (!ranked.length) return null
    return { from: lookFrom + mode.from, options: ranked.map(toCompletion), filter: false }
  }
}
