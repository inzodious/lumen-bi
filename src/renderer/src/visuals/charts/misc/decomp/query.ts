/**
 * Decomposition tree data: root total + one engine.summarize per visible level, each under the
 * filter context of the expanded path (ctx.filters AND path identities). AI levels evaluate every
 * remaining Explain-by field and keep the one chosen by chooseAiSplit.
 */
import type { Scalar } from '@core/model/data'
import type { SQFilter } from '@core/report/sq'
import { identitiesToFilter, type DataPointIdentity, type SQExpr } from '@core/report/sq'
import type { VisualHostContext } from '../../../contract'
import { expandParameters, getProjections, valueId, type Projection } from '../../../common/query'
import { fieldRef, formatCategoryValue, type FieldRef } from '../../../common/categorical'
import { chooseAiSplit, readDecompState, sameScalar, type AiMethod, type AiMode, type DecompState } from './state'

/** Power BI caps a tree at 5,000 data points; per level we keep at most this many nodes. */
export const MAX_NODES_PER_LEVEL = 5000

export interface TreeNodeData {
  value: Scalar
  label: string
  measure: number | null
  /** Tooltips-role values, in tooltip field order */
  tips: Scalar[]
  identity: DataPointIdentity
}

export interface TreeColumnData {
  /** index into state.levels */
  levelIndex: number
  field: FieldRef
  ai?: AiMethod
  /** AI level: index of the recommended (highest / lowest) node */
  aiNode?: number
  nodes: TreeNodeData[]
  /** value of the node this level breaks down (root total for level 0) */
  parentValue: number | null
  /** index of the node expanded into the next level (-1 = none) */
  pathIndex: number
  /** max |value| in the level (bar scaling) */
  levelMax: number
}

export interface TreeData {
  measure: FieldRef
  total: number | null
  /** Explain-by fields in well order */
  explain: FieldRef[]
  tooltips: FieldRef[]
  state: DecompState
  columns: TreeColumnData[]
  /** queryRef of the field each visible level currently shows (AI levels resolved) */
  resolved: string[]
  /** fields still available for a split after the last visible level */
  remaining: FieldRef[]
}

function num(v: Scalar | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function readDecompFields(visualJson: any, ctx: VisualHostContext): { analyze?: Projection; explain: FieldRef[]; tooltips: FieldRef[] } {
  const roles = getProjections(visualJson)
  const analyze = expandParameters(roles.Analyze ?? [], ctx)[0]
  const seen = new Set<string>()
  const explain: FieldRef[] = []
  for (const p of expandParameters(roles.ExplainBy ?? [], ctx)) {
    if (seen.has(p.queryRef)) continue
    seen.add(p.queryRef)
    explain.push(fieldRef(ctx, p))
  }
  const tooltips = expandParameters(roles.Tooltips ?? [], ctx).map((p) => fieldRef(ctx, p))
  return { analyze, explain, tooltips }
}

/**
 * Compute the visible tree. Returns null when the Analyze well is empty.
 * `aiMode` / `aiEnabled` come from the `analysis` formatting object.
 */
export function computeTree(visualJson: any, ctx: VisualHostContext, opts: { aiMode: AiMode; aiEnabled: boolean }): TreeData | null {
  const { analyze, explain, tooltips } = readDecompFields(visualJson, ctx)
  if (!analyze) return null
  const measure = fieldRef(ctx, analyze)
  const state = readDecompState(
    visualJson,
    explain.map((f) => f.proj.queryRef)
  )
  const mId = valueId(analyze)
  const values = [{ id: mId, expr: { kind: 'sq' as const, expr: analyze.expr } }, ...tooltips.map((t, i) => ({ id: `tip|${i}|${t.proj.queryRef}`, expr: { kind: 'sq' as const, expr: t.proj.expr } }))]
  const root = ctx.engine.summarize({ groupBy: [], values: values.slice(0, 1), filters: ctx.filters })
  const total = num(root.rows[0]?.[0])

  const byRef = new Map(explain.map((f) => [f.proj.queryRef, f]))
  const split = (f: FieldRef, filters: SQFilter[], scope: Array<{ expr: SQExpr; value: Scalar }>): TreeNodeData[] => {
    const res = ctx.engine.summarize({
      groupBy: [{ kind: 'sq', expr: f.proj.expr }],
      values,
      filters,
      orderBy: [{ target: { value: mId }, direction: 'desc' }],
      limit: MAX_NODES_PER_LEVEL
    })
    return res.rows.map((r) => ({
      value: r[0],
      label: formatCategoryValue(ctx, f, r[0]),
      measure: num(r[1]),
      tips: r.slice(2),
      identity: { fields: [...scope, { expr: f.identityExpr, value: r[0] }] }
    }))
  }

  const columns: TreeColumnData[] = []
  const resolved: string[] = []
  const scope: Array<{ expr: SQExpr; value: Scalar }> = []
  let parentValue = total
  for (let i = 0; i < state.levels.length; i++) {
    const level = state.levels[i]
    const filters = scope.length ? [...ctx.filters, identitiesToFilter([{ fields: scope.slice() }])!] : ctx.filters
    const used = new Set(resolved)
    let field: FieldRef | undefined
    let nodes: TreeNodeData[] = []
    let aiNode: number | undefined
    const ai = opts.aiEnabled ? level.ai : undefined
    if (ai) {
      const cands = explain.filter((f) => !used.has(f.proj.queryRef))
      const splits = cands.map((f) => split(f, filters, scope))
      const choice = chooseAiSplit(
        splits.map((s, k) => ({ key: cands[k].proj.queryRef, values: s.map((n) => (n.measure === null ? NaN : n.measure)) })),
        ai,
        opts.aiMode
      )
      if (choice) {
        field = cands[choice.index]
        nodes = splits[choice.index]
        aiNode = choice.node
      } else {
        // no candidate produced data: fall back to the last chosen field, if still available
        field = byRef.get(level.queryRef)
        if (field && !used.has(field.proj.queryRef)) nodes = splits[cands.indexOf(field)] ?? []
        else field = undefined
      }
    } else {
      field = byRef.get(level.queryRef)
      if (field && used.has(field.proj.queryRef)) field = undefined
      if (field) nodes = split(field, filters, scope)
    }
    if (!field) break
    resolved.push(field.proj.queryRef)
    const levelMax = nodes.reduce((m, n) => Math.max(m, Math.abs(n.measure ?? 0)), 0)
    let pathIndex = -1
    const hasNext = i < state.levels.length - 1
    if (hasNext) {
      const want = state.path[i]
      if (want !== undefined) pathIndex = nodes.findIndex((n) => sameScalar(n.value, want))
      // AI levels follow their recommended node unless another node of the level was chosen
      if (pathIndex < 0 && ai && aiNode !== undefined) pathIndex = aiNode
    }
    columns.push({ levelIndex: i, field, ...(ai ? { ai } : {}), ...(aiNode !== undefined ? { aiNode } : {}), nodes, parentValue, pathIndex, levelMax })
    if (pathIndex < 0) break
    const p = nodes[pathIndex]
    scope.push({ expr: field.identityExpr, value: p.value })
    parentValue = p.measure
  }
  const allUsed = new Set(resolved)
  const remaining = explain.filter((f) => !allUsed.has(f.proj.queryRef))
  return { measure, total, explain, tooltips, state, columns, resolved, remaining }
}

/** Fields offered by the "+" menu on a node of level `atLevel` (-1 = root): Explain-by fields not used up to that level. */
export function splitCandidates(tree: TreeData, atLevel: number): FieldRef[] {
  const used = new Set(tree.resolved.slice(0, atLevel + 1))
  return tree.explain.filter((f) => !used.has(f.proj.queryRef))
}

/** "Show as table" / export: the expanded path plus the last visible level's nodes. */
export function treeTable(tree: TreeData): { columns: string[]; rows: Scalar[][] } {
  const cols = tree.columns
  if (!cols.length) return { columns: [tree.measure.label], rows: [[tree.total]] }
  const last = cols[cols.length - 1]
  const prefix = cols.slice(0, -1).map((c) => c.nodes[c.pathIndex]?.value ?? null)
  return {
    columns: [...cols.map((c) => c.field.label), tree.measure.label],
    rows: last.nodes.map((n) => [...prefix, n.value, n.measure])
  }
}
