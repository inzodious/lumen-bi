/**
 * Applied Steps editing on M query text (pure): rename a step (binding + references), insert an empty
 * step after another, delete until end, move up/down with the chain rewired like Power Query does,
 * replace a step's formula, plus reference renaming used for query renames, and a tolerant parser that
 * splits a step's call into its top-level argument texts (used by the step settings dialogs).
 */
import { tokenize, type Token } from '@core/m/lexer.ts'
import { deleteStep, insertStep, outlineQuery, renderQuery, stepRef, uniqueStepName, type QueryOutline } from '@core/m/editor.ts'

export { outlineQuery, renderQuery, insertStep, deleteStep, stepRef, uniqueStepName, type QueryOutline }

function safeTokens(text: string): Token[] | null {
  try {
    return tokenize(text)
  } catch {
    return null
  }
}

/**
 * Indexes of identifier tokens that are *references* (not field names inside `[...]` field access /
 * projections, and not field names on the left of `=` in record literals).
 */
function referenceTokens(tokens: Token[]): number[] {
  const out: number[] = []
  const skip = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind !== 'op' || t.value !== '[') continue
    // find the matching ']'
    let depth = 0
    let j = i
    let hasEquals = false
    for (; j < tokens.length; j++) {
      const u = tokens[j]!
      if (u.kind === 'op' && u.value === '[') depth++
      else if (u.kind === 'op' && u.value === ']') {
        depth--
        if (depth === 0) break
      } else if (depth === 1 && u.kind === 'op' && u.value === '=') hasEquals = true
    }
    if (!hasEquals) {
      // field access / projection: every name inside is a field name
      for (let k = i + 1; k < j; k++) skip.add(k)
    } else {
      // record literal: names right after '[' or ',' (depth 1) up to '=' are field names
      let d = 0
      let expectName = true
      for (let k = i; k < j; k++) {
        const u = tokens[k]!
        if (u.kind === 'op' && (u.value === '[' || u.value === '(' || u.value === '{')) {
          d++
          if (d === 1) expectName = true
          continue
        }
        if (u.kind === 'op' && (u.value === ']' || u.value === ')' || u.value === '}')) {
          d--
          continue
        }
        if (d === 1 && u.kind === 'op' && u.value === ',') {
          expectName = true
          continue
        }
        if (d === 1 && u.kind === 'op' && u.value === '=') {
          expectName = false
          continue
        }
        if (d === 1 && expectName) skip.add(k)
      }
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if ((t.kind === 'ident' || t.kind === 'quoted') && !skip.has(i)) out.push(i)
  }
  return out
}

/** Replaces references to identifier `from` with `to` (written as `stepRef(to)`). */
export function renameReferences(text: string, from: string, to: string): string {
  const tokens = safeTokens(text)
  if (!tokens) return text
  let out = ''
  let last = 0
  for (const i of referenceTokens(tokens)) {
    const t = tokens[i]!
    if (t.value !== from) continue
    out += text.slice(last, t.start) + stepRef(to)
    last = t.end
  }
  return out + text.slice(last)
}

/** Does `text` reference identifier `name`? */
export function referencesName(text: string, name: string): boolean {
  const tokens = safeTokens(text)
  if (!tokens) return false
  return referenceTokens(tokens).some((i) => tokens[i]!.value === name)
}

/** Every referenced identifier in a text (step names, query names, library functions…). */
export function referencedNames(text: string): Set<string> {
  const tokens = safeTokens(text)
  const out = new Set<string>()
  if (!tokens) return out
  for (const i of referenceTokens(tokens)) out.add(tokens[i]!.value)
  return out
}

/** Wraps a non-`let` query as `let Source = … in Source` (what PQ does when you add the first step). */
export function ensureLet(source: string): string {
  const q = outlineQuery(source)
  if (q && q.steps.length) return source
  const body = source.trim().replace(/\n/g, '\n    ')
  return `let\n    Source = ${body}\nin\n    Source`
}

function resultRefers(q: QueryOutline, name: string): boolean {
  return q.result === stepRef(name) || q.result === name
}

/** Renames a step and every reference to it (other steps and the `in` result). */
export function renameStep(source: string, from: string, to: string): string | null {
  const q = outlineQuery(source)
  if (!q || from === to) return q ? source : null
  if (!q.steps.some((s) => s.name === from) || q.steps.some((s) => s.name === to)) return null
  const steps = q.steps.map((s) => ({ name: s.name === from ? to : s.name, formula: renameReferences(s.formula, from, to) }))
  return renderQuery({ steps, result: renameReferences(q.result, from, to) })
}

/** Replaces one step's formula. */
export function setStepFormula(source: string, name: string, formula: string): string | null {
  const q = outlineQuery(source)
  if (!q) return null
  if (!q.steps.some((s) => s.name === name)) return null
  return renderQuery({ steps: q.steps.map((s) => (s.name === name ? { name, formula: formula.trim() } : s)), result: q.result })
}

/** Removes a step (the first step too, leaving later references broken exactly like PQ). */
export function removeStep(source: string, name: string): string | null {
  const q = outlineQuery(source)
  if (!q || q.steps.length <= 1) return null
  const index = q.steps.findIndex((s) => s.name === name)
  if (index < 0) return null
  const steps = q.steps.filter((_, i) => i !== index).map((s) => ({ ...s }))
  if (index === 0) return renderQuery({ steps, result: resultRefers(q, name) ? stepRef(steps[0]!.name) : q.result })
  const prev = q.steps[index - 1]!.name
  const next = steps[index]
  if (next) next.formula = renameReferences(next.formula, name, prev)
  return renderQuery({ steps, result: resultRefers(q, name) ? stepRef(prev) : q.result })
}

/** "Delete Until End": removes the step and everything after it; the previous step becomes the result. */
export function deleteUntilEnd(source: string, name: string): string | null {
  const q = outlineQuery(source)
  if (!q) return null
  const index = q.steps.findIndex((s) => s.name === name)
  if (index <= 0) return null
  const steps = q.steps.slice(0, index)
  return renderQuery({ steps, result: stepRef(steps[steps.length - 1]!.name) })
}

/**
 * Inserts a step after `after` (the last step when null), as a ribbon button does: `formula` receives
 * the previous step's reference; the step that used to follow now reads the new step; when the result
 * was the previous step the new step becomes the result. A non-`let` query is wrapped first.
 */
export function addStep(source: string, after: string | null, base: string, formula: (prev: string) => string): { source: string; name: string } | null {
  const q = outlineQuery(ensureLet(source))
  if (!q || q.steps.length === 0) return null
  const index = after === null ? q.steps.length - 1 : q.steps.findIndex((s) => s.name === after)
  if (index < 0) return null
  const prev = q.steps[index]!.name
  const name = uniqueStepName(q, base)
  const steps = q.steps.map((s) => ({ ...s }))
  steps.splice(index + 1, 0, { name, formula: formula(stepRef(prev)) })
  const next = steps[index + 2]
  if (next) next.formula = renameReferences(next.formula, prev, name)
  return { source: renderQuery({ steps, result: resultRefers(q, prev) ? stepRef(name) : q.result }), name }
}

/** "Insert Step After": a new `Custom1 = <step>` step after `after` (PQ's default name). */
export function insertEmptyStepAfter(source: string, after: string): { source: string; name: string } | null {
  const q = outlineQuery(ensureLet(source))
  if (!q) return null
  const taken = new Set(q.steps.map((s) => s.name))
  let n = 1
  while (taken.has(`Custom${n}`)) n++
  return addStep(source, after, `Custom${n}`, (prev) => prev)
}

/**
 * Move a step up or down one position. Power Query rewires a linear chain: the moved step reads what its
 * new predecessor produced and the step after the pair reads the pair's new last step.
 */
export function moveStep(source: string, name: string, dir: 'up' | 'down'): string | null {
  const q = outlineQuery(source)
  if (!q) return null
  const i = q.steps.findIndex((s) => s.name === name)
  const a = dir === 'up' ? i - 1 : i // first of the pair being swapped
  if (i < 0 || a < 1 || a + 1 >= q.steps.length) return null // the Source step stays first
  const steps = q.steps.map((s) => ({ ...s }))
  const first = steps[a]!
  const second = steps[a + 1]!
  const before = steps[a - 1]!.name
  // second now reads `before` instead of `first`; first reads `second` instead of `before`
  const secondFormula = renameReferences(second.formula, first.name, before)
  const firstFormula = renameReferences(first.formula, before, second.name)
  steps[a] = { name: second.name, formula: secondFormula }
  steps[a + 1] = { name: first.name, formula: firstFormula }
  const next = steps[a + 2]
  if (next) next.formula = renameReferences(next.formula, second.name, first.name)
  let result = q.result
  if (resultRefers(q, second.name)) result = stepRef(first.name)
  return renderQuery({ steps, result })
}

/** Names of the steps that come after `name`. */
export function stepsAfter(source: string, name: string): string[] {
  const q = outlineQuery(source)
  if (!q) return []
  const i = q.steps.findIndex((s) => s.name === name)
  return i < 0 ? [] : q.steps.slice(i + 1).map((s) => s.name)
}

// ---------------------------------------------------------------------------------------------
// Call parsing (step settings dialogs)

export interface ParsedCall {
  callee: string
  /** raw text of each top-level argument, trimmed */
  args: string[]
}

/** Splits `Fn.Name(a, {b, c}, each [x] + 1)` into callee + argument texts. Null when not a call. */
export function parseCall(formula: string): ParsedCall | null {
  const tokens = safeTokens(formula)
  if (!tokens || tokens.length < 3) return null
  const head = tokens[0]!
  if (head.kind !== 'ident' || tokens[1]!.kind !== 'op' || tokens[1]!.value !== '(') return null
  const args: string[] = []
  let depth = 0
  let argStart = tokens[1]!.end
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind !== 'op') continue
    if (t.value === '(' || t.value === '[' || t.value === '{') depth++
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      depth--
      if (depth === 0) {
        const last = formula.slice(argStart, t.start).trim()
        if (last || args.length) args.push(last)
        // must be the end of the formula
        return tokens[i + 1]?.kind === 'eof' ? { callee: head.value, args } : null
      }
    } else if (t.value === ',' && depth === 1) {
      args.push(formula.slice(argStart, t.start).trim())
      argStart = t.end
    }
  }
  return null
}

/** Raw item texts of a top-level list literal `{a, {b, c}, d}`, or null. */
export function splitList(text: string): string[] | null {
  const src = text.trim()
  const tokens = safeTokens(src)
  if (!tokens || tokens[0]?.kind !== 'op' || tokens[0].value !== '{') return null
  const items: string[] = []
  let depth = 0
  let start = tokens[0].end
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind !== 'op') continue
    if (t.value === '(' || t.value === '[' || t.value === '{') depth++
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      depth--
      if (depth === 0) {
        const last = src.slice(start, t.start).trim()
        if (last || items.length) items.push(last)
        return tokens[i + 1]?.kind === 'eof' ? items : null
      }
    } else if (t.value === ',' && depth === 1) {
      items.push(src.slice(start, t.start).trim())
      start = t.end
    }
  }
  return null
}

/** Value of an M text literal (`"a""b"` → `a"b`), or null when the text isn't one. */
export function textLiteral(text: string): string | null {
  const tokens = safeTokens(text.trim())
  if (!tokens || tokens.length !== 2 || tokens[0]!.kind !== 'text') return null
  return tokens[0]!.value
}

/** `{"A", "B"}` → ['A', 'B'] (null when not a list of text literals). */
export function textListLiteral(text: string): string[] | null {
  const tokens = safeTokens(text.trim())
  if (!tokens || tokens[0]?.value !== '{') return null
  const out: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'text') out.push(t.value)
    else if (t.kind === 'op' && t.value === ',') continue
    else if (t.kind === 'op' && t.value === '}') return tokens[i + 1]?.kind === 'eof' ? out : null
    else return null
  }
  return null
}

/** The body of an `each` expression (`each [A] * 2` → `[A] * 2`), or null. */
export function eachBody(text: string): string | null {
  const m = /^each\s+([\s\S]*)$/.exec(text.trim())
  return m ? m[1]!.trim() : null
}

/** The step a formula reads first (`Table.X(#"Prev", …)` → `Prev`), when it starts with an identifier argument. */
export function firstArgStep(formula: string): string | null {
  const call = parseCall(formula)
  if (!call?.args[0]) return null
  const tokens = safeTokens(call.args[0])
  if (!tokens || tokens.length !== 2) return null
  const t = tokens[0]!
  return t.kind === 'ident' || t.kind === 'quoted' ? t.value : null
}
