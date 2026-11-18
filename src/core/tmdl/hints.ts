/**
 * Source-formatting hints for byte-faithful TMDL round-trips.
 *
 * When a model is parsed from TMDL we remember, per model object (WeakMap — never part of the
 * model itself, so it does not affect equality, cloning or persistence):
 *   - the order in which properties / child objects appeared,
 *   - the exact source lines of each leaf entry (property, annotation, ...),
 *   - the canonical text our serializer would produce for that entry at parse time.
 * On save, an entry whose canonical text is unchanged is written with its original source lines,
 * so unmodified objects come out byte-identical while edited ones get canonical formatting.
 * Objects created or replaced after load (e.g. immer drafts that changed) simply have no hint.
 */

export interface ObjHint {
  /** entry keys in source order */
  keys: string[]
  /** exact source lines per leaf entry */
  raw: Map<string, string[]>
  /** canonical text per leaf entry at parse time (null = serializer did not emit it) */
  canon: Map<string, string | null>
  child: Set<string>
  group: Map<string, string>
  /** exact header lines (description + declaration + default expression) */
  header?: string[]
  headerCanon?: string
  /** relative file path the object came from (tables, roles...) */
  file?: string
  /** object name when it was read from `file` (a renamed object gets a fresh file name) */
  fileFor?: string
  /** (model only) trailing whitespace of each source file, e.g. '\n\n' */
  fileTails?: Record<string, string>
}

const hints = new WeakMap<object, ObjHint>()

export function getHint(obj: object): ObjHint | undefined {
  return hints.get(obj)
}

export function newHint(obj: object, header?: string[]): ObjHint {
  const h: ObjHint = { keys: [], raw: new Map(), canon: new Map(), child: new Set(), group: new Map(), header }
  hints.set(obj, h)
  return h
}

export function hintEntry(h: ObjHint | undefined, key: string, raw: string[] | undefined, child: boolean, group: string): void {
  if (!h) return
  if (h.keys.includes(key)) return
  h.keys.push(key)
  if (raw) h.raw.set(key, raw)
  if (child) h.child.add(key)
  h.group.set(key, group)
}

/** Forget the hint of an object (e.g. to force canonical formatting). */
export function clearHint(obj: object): void {
  hints.delete(obj)
}
