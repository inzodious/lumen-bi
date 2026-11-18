/**
 * Performance analyzer metering for the canvas: each visual's host context gets an engine proxy that times the
 * query calls the visual makes (summarize / distinctValues / evaluateScalar / runDaxQuery…) and remembers the requests,
 * so the container can log "DAX query" / "Visual display" / "Other" time like PBI's Performance analyzer.
 * Cache hits (cachedEngine) are timed too — they show up as ~0 ms queries, which matches PBI's cached-query behavior.
 *
 * How a visual's duration is split (approximation of PBI's categories — Lumen's engine runs in the renderer, so there
 * is no network / queueing time to report):
 *   - DAX query      = time inside the engine calls the visual made;
 *   - Visual display = render time of the visual's own component tree (between its two <PerfMark>s) minus the query
 *                      time spent inside that render;
 *   - Other          = the rest of the wall-clock time until the next paint: waiting for the other visuals of the page
 *                      to render (they share one React commit), layout and painting.
 *
 * Also here: the "user action" that entries are grouped under in the pane (Refreshed visual, Changed a slicer, …),
 * the pane's row model (grouping / sorting) and the JSON export — pure functions, unit-tested in __tests__/perf.test.ts.
 */
import { useEffect, useRef } from 'react'
import type { QueryEngine } from '@core/engine/api'
import { useShell, type PerfEntry } from '../app/shellState'

export interface PerfMeter {
  /** total time inside engine query calls (ms) */
  queryMs: number
  queries: string[]
  /** render time of the visual's component tree, accumulated between the start / end <PerfMark> (ms) */
  renderMs: number
  /** the part of `queryMs` that was spent inside that render (queries run synchronously while rendering) */
  renderQueryMs: number
  /** performance.now() of the open start mark; 0 while the visual is not rendering */
  renderStart: number
}

const QUERY_METHODS = new Set(['summarize', 'distinctValues', 'evaluateScalar', 'runDaxQuery', 'resolveFieldParameter', 'evaluateVisualCalculations'])
const MAX_QUERIES = 20
/** Timed but not listed by "Copy query": metadata lookups that are not a query PBI would show (field parameters). */
const UNLISTED_METHODS = new Set(['resolveFieldParameter'])

/** The DAX text PBI's "Copy query" would give, when the engine can produce it; else the request as JSON. */
export function describe(method: string, args: unknown[], engine?: QueryEngine): string {
  try {
    // the engine's DAX forms already start with PBI's "// DAX Query" header
    if (method === 'summarize' && engine?.toDaxQuery) return engine.toDaxQuery(args[0] as never)
    // visuals with visual calculations: PBI's DEFINE COLUMN '__DS0VisualCalcs'[…] … WITH VISUAL SHAPE / DENSIFY form
    if (method === 'evaluateVisualCalculations' && engine?.toVisualCalcDaxQuery) return engine.toVisualCalcDaxQuery(args[0] as never)
    if (method === 'runDaxQuery' && typeof args[0] === 'string') return `// DAX Query\n${args[0]}`
    if (method === 'evaluateScalar' && typeof args[0] === 'string') return `// DAX Query\nEVALUATE { ${args[0]} }`
  } catch {
    // fall through to the request form
  }
  try {
    const body = JSON.stringify(args.length === 1 ? args[0] : args, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2)
    return `// ${method}\n${body}`
  } catch {
    return `// ${method}`
  }
}

export function newMeter(): PerfMeter {
  return { queryMs: 0, queries: [], renderMs: 0, renderQueryMs: 0, renderStart: 0 }
}

export function resetMeter(m: PerfMeter): void {
  m.queryMs = 0
  m.queries = []
  m.renderMs = 0
  m.renderQueryMs = 0
  m.renderStart = 0
}

/** Wrap an engine so query calls are timed into `meter` (only while `enabled()`). */
export function meteredEngine(engine: QueryEngine, meter: PerfMeter, enabled: () => boolean): QueryEngine {
  return new Proxy(engine, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      const name = String(prop)
      if (!QUERY_METHODS.has(name)) return (v as (...a: unknown[]) => unknown).bind(target)
      return (...args: unknown[]) => {
        if (!enabled()) return (v as (...a: unknown[]) => unknown).apply(target, args)
        const t0 = performance.now()
        try {
          const out = (v as (...a: unknown[]) => unknown).apply(target, args)
          if (out && typeof (out as Promise<unknown>).then === 'function') {
            return (out as Promise<unknown>).finally(() => {
              meter.queryMs += performance.now() - t0
            })
          }
          return out
        } finally {
          const dt = performance.now() - t0
          meter.queryMs += dt
          if (meter.renderStart) meter.renderQueryMs += dt
          if (meter.queries.length < MAX_QUERIES && !UNLISTED_METHODS.has(name)) meter.queries.push(describe(name, args, target))
        }
      }
    }
  })
}

/** ctx → meter (set by the host; read by the container when logging). */
export const meters = new WeakMap<object, PerfMeter>()

// ---------------------------------------------------------------------------------------------
// Timing split
// ---------------------------------------------------------------------------------------------

export interface PerfSplit {
  ms: number
  query: number
  render: number
  other: number
}

/** Split a visual's wall-clock duration into PBI's three categories (see the file header). Never negative; sums to `total`. */
export function splitTimings(total: number, meter: Pick<PerfMeter, 'queryMs' | 'renderMs' | 'renderQueryMs'> | undefined): PerfSplit {
  const ms = Math.max(0, total)
  const query = Math.min(ms, Math.max(0, meter?.queryMs ?? 0))
  const render = Math.min(ms - query, Math.max(0, (meter?.renderMs ?? 0) - Math.min(meter?.renderQueryMs ?? 0, meter?.queryMs ?? 0)))
  return { ms, query, render, other: Math.max(0, ms - query - render) }
}

// ---------------------------------------------------------------------------------------------
// User actions (the group headers of the pane)
// ---------------------------------------------------------------------------------------------

export const PERF_ACTIONS = {
  refresh: 'Refreshed visual',
  slicer: 'Changed a slicer',
  highlight: 'Cross-highlighted',
  drill: 'Drilled',
  page: 'Changed page',
  drillthrough: 'Drilled through',
  bookmark: 'Selected a bookmark',
  edit: 'Changed a visual',
  recording: 'Recording started'
} as const

/** Which label wins when one gesture changes several things (a bookmark changes the page and the slicers…). */
const ACTION_PRIORITY: Record<string, number> = {
  [PERF_ACTIONS.edit]: 1,
  [PERF_ACTIONS.refresh]: 2,
  [PERF_ACTIONS.drill]: 3,
  [PERF_ACTIONS.highlight]: 4,
  [PERF_ACTIONS.slicer]: 5,
  [PERF_ACTIONS.page]: 6,
  [PERF_ACTIONS.drillthrough]: 7,
  [PERF_ACTIONS.bookmark]: 8
}

export interface PerfAction {
  id: number
  label: string
}

let action: PerfAction = { id: 0, label: PERF_ACTIONS.refresh }
let actionOpen = false

/**
 * Note what the user just did; visuals that re-render because of it are logged under this action.
 * Calls made in the same task (one gesture) merge into one action, labelled by the most significant change.
 * `continues`: this change is the second half of the previous action of the same kind (a slicer first updates itself,
 * then — after its debounce — the rest of the page), so it doesn't start a new group.
 */
export function noteAction(label: string, continues = false): void {
  if (actionOpen) {
    if ((ACTION_PRIORITY[label] ?? 0) > (ACTION_PRIORITY[action.label] ?? 0)) action = { id: action.id, label }
    return
  }
  if (!(continues && label === action.label)) action = { id: action.id + 1, label }
  actionOpen = true
  queueMicrotask(() => {
    actionOpen = false
  })
}

export function currentAction(): PerfAction {
  return action
}

/** Actions after which only visuals that queried data are listed (PBI doesn't list text boxes / shapes for a slicer change). */
const DATA_ONLY_ACTIONS = new Set<string>([PERF_ACTIONS.slicer, PERF_ACTIONS.highlight, PERF_ACTIONS.drill])

export function shouldLog(actionLabel: string, meter: Pick<PerfMeter, 'queries' | 'queryMs'> | undefined): boolean {
  if (!DATA_ONLY_ACTIONS.has(actionLabel)) return true
  return !!meter && (meter.queries.length > 0 || meter.queryMs > 0)
}

// ---------------------------------------------------------------------------------------------
// Canvas glue (report/VisualContainer.tsx)
// ---------------------------------------------------------------------------------------------

/**
 * Render-time marks around a visual's component: `start` right before it, `end` right after it. React renders siblings
 * depth-first in order, so the time between the two is the render time of the visual's whole subtree.
 * (Re-renders the visual starts on its own — internal state — don't pass through the marks and count as "Other".)
 */
export function PerfMark({ ctx, edge }: { ctx: object | null; edge: 'start' | 'end' }): null {
  const m = ctx && useShell.getState().perfRecording ? meters.get(ctx) : undefined
  if (m) {
    if (edge === 'start') m.renderStart = performance.now()
    else if (m.renderStart) {
      m.renderMs += performance.now() - m.renderStart
      m.renderStart = 0
    }
  }
  return null
}

export interface PerfVisualInfo {
  visual: string
  title: string
  type?: string
  page?: string
}

const afterPaintQueue: Array<(now: number) => void> = []
let afterPaintTimer: ReturnType<typeof setTimeout> | undefined

function flushAfterPaint(): void {
  if (afterPaintTimer === undefined) return
  clearTimeout(afterPaintTimer)
  afterPaintTimer = undefined
  const now = performance.now()
  for (const fn of afterPaintQueue.splice(0)) fn(now)
}

/**
 * Run `fn` once the frame that shows the current commit has been painted, with ONE timestamp shared by everything
 * queued for that frame. (Logging each visual from its own timer made the pane re-render between the timers, so the
 * visuals logged later looked slower by the cost of drawing the log.)
 */
function afterPaint(fn: (now: number) => void): void {
  afterPaintQueue.push(fn)
  if (afterPaintTimer !== undefined) return
  // hidden / occluded windows don't produce frames: this fallback keeps durations from growing until the window is shown
  afterPaintTimer = setTimeout(flushAfterPaint, 500)
  requestAnimationFrame(() => setTimeout(flushAfterPaint, 0))
}

/**
 * Log one Performance analyzer entry per (re)load of a visual while recording: from the render that received a new host
 * context (new filters / data / drill…) or a new visual definition `rev` (fields / formatting edited) to the next paint.
 */
export function useVisualPerf(ctx: object | null, enabled: boolean, rev: unknown, info: () => PerfVisualInfo): void {
  const start = useRef<{ ctx: object | null; rev: unknown; t0: number }>({ ctx: null, rev: undefined, t0: 0 })
  if (ctx && (start.current.ctx !== ctx || start.current.rev !== rev)) {
    start.current = { ctx, rev, t0: performance.now() }
    const m = meters.get(ctx)
    if (m) resetMeter(m)
  }
  const infoRef = useRef(info)
  infoRef.current = info
  useEffect(() => {
    if (!ctx || !enabled || !useShell.getState().perfRecording) return
    const s = start.current
    if (s.ctx !== ctx) return
    const act = currentAction()
    let cancelled = false
    afterPaint((now) => {
      if (cancelled) return
      const m = meters.get(ctx)
      if (!shouldLog(act.label, m)) return
      useShell.getState().logPerf({ ...infoRef.current(), ...splitTimings(now - s.t0, m), queries: m?.queries.slice(), action: act.label, actionId: act.id })
    })
    return () => {
      cancelled = true
    }
  }, [ctx, enabled, rev])
}

// ---------------------------------------------------------------------------------------------
// Pane model: grouping / sorting
// ---------------------------------------------------------------------------------------------

export type PerfSort = { by: 'name' | 'duration'; dir: 'asc' | 'desc' } | null

export type PerfRow = { kind: 'action'; key: string; label: string; at: number } | { kind: 'visual'; key: string; entry: PerfEntry }

const keyOf = (e: PerfEntry, i: number) => String(e.id ?? `i${i}`)

/**
 * Rows of the pane. Unsorted (PBI's default "action order"): chronological, each run of entries of one user action under
 * a header row. Sorted by name or duration: a flat list of the visuals (headers make no sense out of order).
 */
export function buildRows(log: readonly PerfEntry[], sort: PerfSort): PerfRow[] {
  if (sort) {
    const sign = sort.dir === 'asc' ? 1 : -1
    return log
      .map((entry, i) => ({ entry, i }))
      .filter((x) => !x.entry.marker)
      .sort((a, b) => {
        const d = sort.by === 'duration' ? a.entry.ms - b.entry.ms : (a.entry.title || a.entry.visual).localeCompare(b.entry.title || b.entry.visual, undefined, { numeric: true, sensitivity: 'base' })
        return d ? d * sign : a.i - b.i
      })
      .map(({ entry, i }) => ({ kind: 'visual' as const, key: keyOf(entry, i), entry }))
  }
  const rows: PerfRow[] = []
  let last: number | string | undefined
  log.forEach((e, i) => {
    const group = e.marker ? `m${keyOf(e, i)}` : (e.actionId ?? e.action ?? '')
    if (e.marker || group !== last) rows.push({ kind: 'action', key: `a${keyOf(e, i)}`, label: e.action ?? PERF_ACTIONS.refresh, at: e.at })
    last = group
    if (!e.marker) rows.push({ kind: 'visual', key: keyOf(e, i), entry: e })
  })
  return rows
}

/** Next state of a column header click: descending first for durations (slowest on top), A→Z first for names; third click = action order. */
export function nextSort(sort: PerfSort, by: 'name' | 'duration'): PerfSort {
  const first = by === 'duration' ? 'desc' : 'asc'
  if (!sort || sort.by !== by) return { by, dir: first }
  if (sort.dir === first) return { by, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

const round = (n: number | undefined) => Math.round((n ?? 0) * 100) / 100

/**
 * The log as JSON, shaped after Power BI Desktop's PowerBIPerformanceData.json: a flat `events` list where each
 * user action is a "User Action" event and each visual a "Visual Container Lifecycle" event (parentId = its action)
 * with "Query" / "Render" / "Other" children. Approximation: PBI's file has many more engine-internal event kinds and
 * per-event start/end from its own tracing; here children carry the measured duration and the DAX text.
 */
export function toExportJson(log: readonly PerfEntry[], now: Date = new Date()): string {
  const events: Array<Record<string, unknown>> = []
  const iso = (t: number) => new Date(t).toISOString()
  let actionEvent: string | undefined
  let n = 0
  for (const row of buildRows(log, null)) {
    if (row.kind === 'action') {
      actionEvent = `action-${++n}`
      events.push({ name: 'User Action', component: 'Report Canvas', start: iso(row.at), id: actionEvent, metrics: { sourceLabel: row.label } })
      continue
    }
    const e = row.entry
    const id = `visual-${row.key}`
    const start = e.at - e.ms
    events.push({
      name: 'Visual Container Lifecycle',
      component: 'Report Canvas',
      start: iso(start),
      end: iso(e.at),
      id,
      parentId: actionEvent,
      metrics: { visualTitle: e.title, visualId: e.visual, visualType: e.type, pageName: e.page, durationMs: round(e.ms) }
    })
    events.push({ name: 'Query', component: 'Report Canvas', id: `${id}-query`, parentId: id, metrics: { durationMs: round(e.query), queryCount: e.queries?.length ?? 0, QueryText: e.queries ?? [] } })
    events.push({ name: 'Render', component: 'Report Canvas', id: `${id}-render`, parentId: id, metrics: { durationMs: round(e.render) } })
    events.push({ name: 'Other', component: 'Report Canvas', id: `${id}-other`, parentId: id, metrics: { durationMs: round(e.other) } })
  }
  return JSON.stringify({ version: '1.1.0', generator: 'Lumen', exportedAt: now.toISOString(), events }, null, 2)
}
