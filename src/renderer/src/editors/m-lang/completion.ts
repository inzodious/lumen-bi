/**
 * M autocomplete: library functions / constants / types (from the engine's library, loaded lazily),
 * keywords and intrinsics, plus names supplied by the host editor (applied step names, query names,
 * columns of the current table). Candidate generation is pure (`mCompletionsFor`); the CodeMirror
 * source (`mCompletionSource`) only finds the word before the caret.
 */
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { createSession } from '@core/m/engine.ts'
import { stepRef } from '@core/m/editor.ts'
import { force, MFunction, MType } from '@core/m/values.ts'
import { M_INTRINSICS, M_KEYWORDS } from './language'

export type MCandidateKind = 'function' | 'constant' | 'type' | 'keyword' | 'step' | 'query' | 'column'

export interface MCandidate {
  label: string
  /** text inserted in place of the typed word */
  apply: string
  kind: MCandidateKind
  detail?: string
}

export interface LibraryEntry {
  name: string
  kind: 'function' | 'constant' | 'type'
  /** `Table.SelectRows(table, condition)` */
  signature?: string
}

export interface MNames {
  library: readonly LibraryEntry[]
  steps?: readonly string[]
  queries?: readonly string[]
  columns?: readonly string[]
}

let library: LibraryEntry[] | null = null

/** The engine's library (computed once). */
export function mLibrary(): LibraryEntry[] {
  if (library) return library
  const out: LibraryEntry[] = []
  try {
    const vars = createSession().interp.globals.vars
    for (const [name, cell] of vars) {
      if (name.startsWith('#')) continue
      let kind: LibraryEntry['kind'] = 'constant'
      let signature: string | undefined
      try {
        const v = force(cell)
        if (v instanceof MFunction) {
          kind = 'function'
          signature = `${name}(${v.params.map((p) => (p.optional ? `optional ${p.name}` : p.name)).join(', ')})`
        } else if (v instanceof MType) kind = 'type'
      } catch {
        /* a constant that fails to evaluate stays a constant */
      }
      out.push({ name, kind, signature })
    }
  } catch {
    /* engine unavailable: keywords + host names only */
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  library = out
  return out
}

const GENERALIZED = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?: (?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|[0-9]+))*$/
const KEYWORD_SET = new Set<string>(M_KEYWORDS)

/** Field access as Power Query writes it: `[Amount]`, `[Order Date]`, `[#"Sales (USD)"]`. */
export function mFieldRef(name: string): string {
  return `[${mFieldName(name)}]`
}

/** The field name inside `[…]`. */
export function mFieldName(name: string): string {
  if (GENERALIZED.test(name) && !KEYWORD_SET.has(name)) return name
  return `#"${name.replace(/"/g, '""')}"`
}

/** What the caret is completing, from the text of the line before it. */
export type MWordContext = { kind: 'word'; word: string } | { kind: 'hash'; word: string } | { kind: 'field'; word: string } | null

export function mWordContext(before: string): MWordContext {
  const field = /\[\s*([^\]"#[]*)$/.exec(before)
  if (field && !/[=,]/.test(field[1]!)) return { kind: 'field', word: field[1]!.trimStart() }
  const hash = /#(?:"(?:[^"]|"")*|[A-Za-z]*)$/.exec(before)
  if (hash) return { kind: 'hash', word: hash[0] }
  const word = /[\p{L}_][\p{L}\p{N}_.]*$/u.exec(before)
  if (word) return { kind: 'word', word: word[0] }
  return null
}

const rank = (label: string, word: string): number => {
  const l = label.toLowerCase()
  const w = word.toLowerCase()
  if (l.startsWith(w)) return 0
  const tail = l.slice(l.lastIndexOf('.') + 1)
  if (tail.startsWith(w)) return 1
  return l.includes(w) ? 2 : -1
}

/** Pure candidate list for a completion context. */
export function mCompletionsFor(ctx: MWordContext, names: MNames): MCandidate[] {
  if (!ctx) return []
  const out: Array<MCandidate & { r: number }> = []
  const push = (c: MCandidate, word: string) => {
    const r = word ? rank(c.label, word) : 0
    if (r >= 0) out.push({ ...c, r })
  }
  if (ctx.kind === 'field') {
    for (const c of names.columns ?? []) push({ label: c, apply: mFieldName(c), kind: 'column' }, ctx.word)
    return finish(out)
  }
  if (ctx.kind === 'hash') {
    const w = ctx.word
    for (const i of M_INTRINSICS) if (i.startsWith(w.toLowerCase())) out.push({ label: i, apply: i, kind: 'keyword', r: 0 })
    const inner = w.startsWith('#"') ? w.slice(2).replace(/""/g, '"') : w.slice(1)
    for (const s of names.steps ?? []) push({ label: s, apply: stepRef(s), kind: 'step', detail: 'Step' }, inner)
    for (const q of names.queries ?? []) push({ label: q, apply: stepRef(q), kind: 'query', detail: 'Query' }, inner)
    return finish(out.filter((c) => c.kind === 'keyword' || c.apply.startsWith('#')))
  }
  const word = ctx.word
  const dotted = word.includes('.')
  if (dotted) {
    // `Table.Se` → members of the namespace
    const ns = word.slice(0, word.lastIndexOf('.') + 1).toLowerCase()
    for (const e of names.library) if (e.name.toLowerCase().startsWith(ns)) push({ label: e.name, apply: e.name, kind: e.kind, detail: e.signature ?? namespaceOf(e.name) }, word)
    for (const s of names.steps ?? []) if (s.toLowerCase().startsWith(word.toLowerCase())) push({ label: s, apply: stepRef(s), kind: 'step', detail: 'Step' }, word)
    return finish(out)
  }
  for (const k of M_KEYWORDS) push({ label: k, apply: k, kind: 'keyword' }, word)
  for (const s of names.steps ?? []) push({ label: s, apply: stepRef(s), kind: 'step', detail: 'Step' }, word)
  for (const q of names.queries ?? []) push({ label: q, apply: stepRef(q), kind: 'query', detail: 'Query' }, word)
  for (const c of names.columns ?? []) push({ label: c, apply: mFieldRef(c), kind: 'column', detail: 'Column' }, word)
  for (const e of names.library) push({ label: e.name, apply: e.name, kind: e.kind, detail: e.signature ?? namespaceOf(e.name) }, word)
  return finish(out)
}

const KIND_ORDER: Record<MCandidateKind, number> = { step: 0, column: 1, query: 2, keyword: 3, function: 4, constant: 5, type: 6 }

function finish(list: Array<MCandidate & { r: number }>): MCandidate[] {
  const seen = new Set<string>()
  return list
    .sort((a, b) => a.r - b.r || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label))
    .filter((c) => (seen.has(c.label + c.kind) ? false : (seen.add(c.label + c.kind), true)))
    .map(({ r: _r, ...c }) => c)
}

function namespaceOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : ''
}

const CM_TYPE: Record<MCandidateKind, string> = { function: 'function', constant: 'constant', type: 'type', keyword: 'keyword', step: 'variable', query: 'class', column: 'property' }

/** CodeMirror completion source. `names` is read on every request (host names change). */
export function mCompletionSource(names: () => Omit<MNames, 'library'>): CompletionSource {
  return (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos)
    const before = line.text.slice(0, cx.pos - line.from)
    const ctx = mWordContext(before)
    if (!ctx) return cx.explicit ? { from: cx.pos, options: toOptions(mCompletionsFor({ kind: 'word', word: '' }, { library: mLibrary(), ...names() })) } : null
    if (!cx.explicit && ctx.kind === 'word' && ctx.word.length < 1) return null
    const cands = mCompletionsFor(ctx, { library: mLibrary(), ...names() })
    if (!cands.length) return null
    const from = cx.pos - ctx.word.length
    return { from, options: toOptions(cands, ctx.kind === 'field' ? cx.state.sliceDoc(cx.pos, cx.pos + 1) === ']' : false), validFor: ctx.kind === 'word' ? /^[\p{L}\p{N}_.]*$/u : undefined }
  }
}

function toOptions(cands: MCandidate[], closedField = false): Completion[] {
  return cands.slice(0, 300).map((c) => ({
    label: c.label,
    apply: c.kind === 'column' && !closedField && !c.apply.startsWith('[') ? `${c.apply}]` : c.apply,
    type: CM_TYPE[c.kind],
    detail: c.detail,
    boost: c.kind === 'step' || c.kind === 'column' ? 2 : c.kind === 'keyword' ? 1 : 0
  }))
}
