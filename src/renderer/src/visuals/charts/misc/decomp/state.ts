/**
 * Decomposition tree: expansion state (pure, no DOM) and the AI-split / bar-scaling math.
 *
 * Persistence follows PBIR exactly (visualContainer schema → `visual.expansionStates`):
 *
 *   expansionStates: [{
 *     roles: ['ExplainBy'],
 *     levels: [                                   // one entry per tree level after the root, in order
 *       { queryRefs: ['Sales.Region'], isCollapsed: true, identityKeys: [<Column expr>], isPinned: true,
 *         isLocked?: true,                        // "lock level" (decomposition trees only)
 *         AIInformation?: { method: 'MaxSplit' | 'MinSplit' } }   // AI level (High value / Low value)
 *     ],
 *     root: { isToggled: true,                    // root expanded into levels[0]
 *       children: [{ identityValues: [<Literal>], isToggled: true,   // node of levels[0] expanded into levels[1]
 *         children: [ ... ] }] }
 *   }]
 *
 * The schema's third method, `BestSplit`, is read as `MaxSplit` (Power BI Desktop writes Max/Min).
 * An AI level's `queryRefs` holds the field chosen when it was last computed; Power BI re-runs the split
 * whenever the path or the filter context changes, and so does Lumen (see resolveAiField in query.ts).
 */
import type { Scalar } from '@core/model/data'
import { literalExpr, literalValue, type SQExpr } from '@core/report/sq'

export type AiMethod = 'MaxSplit' | 'MinSplit'
export type AiMode = 'absolute' | 'relative'
export type BarScaling = 'topNode' | 'parentNode' | 'levelMaximum'

export interface DecompLevel {
  /** queryRef of the Explain-by projection this level splits by */
  queryRef: string
  /** AI split level (re-evaluated on every path / filter change) */
  ai?: AiMethod
  locked?: boolean
}

export interface DecompState {
  levels: DecompLevel[]
  /**
   * path[i] = value of the node of level i that is expanded into level i+1 (so path.length ≤ levels.length - 1).
   * `undefined` entries mean "no node chosen yet" (e.g. the path disappeared under a cross-filter; the levels
   * stay pinned and reappear when a node is chosen).
   */
  path: Array<Scalar | undefined>
}

export const EMPTY_STATE: DecompState = { levels: [], path: [] }

const ROLE = 'ExplainBy'

function decompEntry(visualJson: any): any | undefined {
  const list: any[] = visualJson?.visual?.expansionStates ?? []
  return list.find((e) => Array.isArray(e?.roles) && e.roles.includes(ROLE))
}

/** Read the expansion state; levels whose field isn't in `validQueryRefs` (field removed) truncate the tree. */
export function readDecompState(visualJson: any, validQueryRefs?: string[]): DecompState {
  const e = decompEntry(visualJson)
  if (!e) return { levels: [], path: [] }
  const levels: DecompLevel[] = []
  const seen = new Set<string>()
  for (const l of (e.levels ?? []) as any[]) {
    const queryRef = Array.isArray(l?.queryRefs) ? l.queryRefs[0] : undefined
    if (typeof queryRef !== 'string') break
    const method = l.AIInformation?.method
    const ai: AiMethod | undefined = l.AIInformation && !l.AIInformation.disabled ? (method === 'MinSplit' ? 'MinSplit' : 'MaxSplit') : undefined
    // AI levels re-resolve their field, so a stale queryRef doesn't invalidate them
    if (!ai && validQueryRefs && !validQueryRefs.includes(queryRef)) break
    if (!ai && seen.has(queryRef)) break
    seen.add(queryRef)
    levels.push({ queryRef, ...(ai ? { ai } : {}), ...(l.isLocked ? { locked: true } : {}) })
  }
  const path: Array<Scalar | undefined> = []
  let node = e.root
  while (node && path.length < Math.max(0, levels.length - 1)) {
    const kids: any[] = Array.isArray(node.children) ? node.children : []
    const next = kids.find((k) => k?.isToggled !== false && Array.isArray(k?.identityValues))
    if (!next) break
    path.push(literalValue(next.identityValues[0]))
    node = next
  }
  return { levels, path }
}

/** Write the state back into visual.json (mutates). `identityExprOf` maps a queryRef to its identity column expr. */
export function writeDecompState(visualJson: any, state: DecompState, identityExprOf: (queryRef: string) => SQExpr | undefined): void {
  const v = visualJson.visual ?? (visualJson.visual = {})
  const others: any[] = (v.expansionStates ?? []).filter((e: any) => !(Array.isArray(e?.roles) && e.roles.includes(ROLE)))
  if (!state.levels.length) {
    if (others.length) v.expansionStates = others
    else delete v.expansionStates
    return
  }
  const levels = state.levels.map((l) => {
    const key = identityExprOf(l.queryRef)
    return {
      queryRefs: [l.queryRef],
      isCollapsed: true,
      ...(key ? { identityKeys: [key] } : {}),
      isPinned: true,
      ...(l.locked ? { isLocked: true } : {}),
      ...(l.ai ? { AIInformation: { method: l.ai } } : {})
    }
  })
  const root: any = { isToggled: true }
  let cur = root
  for (let i = 0; i < Math.min(state.path.length, state.levels.length - 1); i++) {
    const p = state.path[i]
    if (p === undefined) break
    const child: any = { identityValues: [literalExpr(p)], isToggled: true }
    cur.children = [child]
    cur = child
  }
  v.expansionStates = [...others, { roles: [ROLE], levels, root }]
}

// ------------------------------------------------------------------------------------------------
// State transitions (immutable)
// ------------------------------------------------------------------------------------------------

/**
 * Split `node` (a node of level `atLevel`; -1 = the root) by a new level. Deeper levels are replaced.
 * A manual split after AI levels turns those AI levels into normal ones (PBI: "a non-AI level can't follow
 * an AI level"); `resolved` gives the field each AI level currently shows so it can be frozen.
 */
export function addLevel(state: DecompState, atLevel: number, node: Scalar | undefined, level: DecompLevel, resolved: string[] = []): DecompState {
  const keep = state.levels.slice(0, atLevel + 1).map((l, i) => (level.ai || !l.ai ? l : { queryRef: resolved[i] ?? l.queryRef, ...(l.locked ? { locked: true } : {}) }))
  const path = state.path.slice(0, Math.max(0, atLevel))
  if (atLevel >= 0) path[atLevel] = node
  return { levels: [...keep, level], path }
}

/** Remove level `i` and every level after it (PBI removes the subsequent levels too). */
export function removeLevel(state: DecompState, i: number): DecompState {
  if (state.levels.slice(i).some((l) => l.locked)) return state
  return { levels: state.levels.slice(0, i), path: state.path.slice(0, Math.max(0, i - 1)) }
}

/** Choose node `value` in level `i` as the expanded path node (levels stay pinned). */
export function selectPathNode(state: DecompState, i: number, value: Scalar): DecompState {
  if (i >= state.levels.length - 1) return state
  const path = state.path.slice(0, i)
  while (path.length < i) path.push(undefined)
  path[i] = value
  return { levels: state.levels, path }
}

/**
 * Lock / unlock. Unlocked levels can't precede locked ones: locking level i locks 0..i,
 * unlocking level i unlocks i..end.
 */
export function setLocked(state: DecompState, i: number, locked: boolean): DecompState {
  return { ...state, levels: state.levels.map((l, j) => (locked ? (j <= i ? { ...l, locked: true } : l) : j >= i ? omitLocked(l) : l)) }
}

function omitLocked(l: DecompLevel): DecompLevel {
  const { locked: _locked, ...rest } = l
  return rest
}

/** Revert an AI level to a normal level showing `queryRef` (clicking the light bulb). */
export function revertAi(state: DecompState, i: number, queryRef: string): DecompState {
  return { ...state, levels: state.levels.map((l, j) => (j === i ? { queryRef, ...(l.locked ? { locked: true } : {}) } : l)) }
}

// ------------------------------------------------------------------------------------------------
// AI split
// ------------------------------------------------------------------------------------------------

export interface AiCandidate {
  /** candidate field key (queryRef) */
  key: string
  /** node values of the split (blank nodes excluded) */
  values: number[]
}

export interface AiChoice {
  index: number
  /** index (into the candidate's values) of the recommended node */
  node: number
  /** absolute value or relative ratio of the recommended node */
  score: number
}

/**
 * Pick the field to split by (Power BI "High value" / "Low value").
 *
 * - absolute: High = the field whose best node has the highest value; Low = whose worst node has the lowest value.
 * - relative: the node that stands out most against its siblings: value / |average of the column's values|
 *   (Microsoft Learn: "North America Sales for Platform / Abs(Avg(...))"); High maximizes, Low minimizes it.
 *
 * Ties keep the first candidate (Explain-by order). Candidates with no values are skipped.
 */
export function chooseAiSplit(cands: AiCandidate[], method: AiMethod, mode: AiMode): AiChoice | null {
  let best: AiChoice | null = null
  const high = method === 'MaxSplit'
  cands.forEach((c, index) => {
    const vals = c.values.filter((v) => Number.isFinite(v))
    if (!vals.length) return
    const avg = Math.abs(vals.reduce((a, b) => a + b, 0) / vals.length)
    let node = -1
    let score = high ? -Infinity : Infinity
    c.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return
      const s = mode === 'relative' ? (avg === 0 ? 0 : v / avg) : v
      if (high ? s > score : s < score) {
        score = s
        node = i
      }
    })
    if (node < 0) return
    if (!best || (high ? score > best.score : score < best.score)) best = { index, node, score }
  })
  return best
}

// ------------------------------------------------------------------------------------------------
// Bars
// ------------------------------------------------------------------------------------------------

/**
 * Fraction of the bar track filled by a node. Power BI's default (`levelMaximum`) scales every bar in a
 * level against the level's largest absolute value; `parentNode` / `topNode` scale against the parent / root.
 */
export function barFraction(value: number | null, scaling: BarScaling, ref: { root: number | null; parent: number | null; levelMax: number }): number {
  if (value === null || !Number.isFinite(value)) return 0
  const den = scaling === 'topNode' ? Math.abs(ref.root ?? 0) : scaling === 'parentNode' ? Math.abs(ref.parent ?? 0) : ref.levelMax
  const d = den > 0 ? den : ref.levelMax
  if (!(d > 0)) return 0
  return Math.max(0, Math.min(1, Math.abs(value) / d))
}

/** Same scalar (dates by time). */
export function sameScalar(a: Scalar | undefined, b: Scalar | undefined): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}
