/**
 * The one deep-copy helper for document state (report JSON, model objects, layouts, themes).
 *
 * RULE: never call `structuredClone` / `JSON.parse(JSON.stringify(…))` directly on state; use `cloneDeep`.
 * Edits run inside immer's `produce` (state/store.ts), where every object read from the document is a draft (a
 * Proxy). `structuredClone` throws `DataCloneError` on a Proxy — the cause of "Duplicate page does nothing", fields
 * dropped from wells and slicer sync failing. `cloneDeep` unwraps drafts (at any depth, also inside plain objects
 * built from a draft, e.g. `{ ...draft }` or `const { a, ...rest } = draft`) and otherwise behaves like
 * `structuredClone` (Dates, Maps, typed arrays, shared references and cycles of plain data are kept).
 * `clone.test.ts` greps the sources so no new direct call slips in.
 */
import { current, isDraft } from 'immer'

export function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const v: unknown = isDraft(value) ? current(value as object) : value
  try {
    return structuredClone(v) as T
  } catch (e) {
    // a draft nested in a plain container: unwrap every draft, then copy
    if (!isDataCloneError(e)) throw e
    return structuredClone(undraftDeep(v, new Map())) as T
  }
}

function isDataCloneError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'DataCloneError'
}

/** A copy of the plain object / array tree of `v` with every immer draft replaced by its current value. */
function undraftDeep(v: unknown, seen: Map<object, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v
  if (isDraft(v)) return current(v)
  if (seen.has(v)) return seen.get(v)
  if (Array.isArray(v)) {
    const out: unknown[] = []
    seen.set(v, out)
    for (const x of v) out.push(undraftDeep(x, seen))
    return out
  }
  if (v instanceof Map) {
    const out = new Map()
    seen.set(v, out)
    for (const [k, x] of v) out.set(undraftDeep(k, seen), undraftDeep(x, seen))
    return out
  }
  if (v instanceof Set) {
    const out = new Set()
    seen.set(v, out)
    for (const x of v) out.add(undraftDeep(x, seen))
    return out
  }
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return v // Date, RegExp, typed arrays…: structuredClone copies them
  const out: Record<string, unknown> = proto === null ? Object.create(null) : {}
  seen.set(v, out)
  for (const k of Object.keys(v)) out[k] = undraftDeep((v as Record<string, unknown>)[k], seen)
  return out
}
