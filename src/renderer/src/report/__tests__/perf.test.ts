import { describe, expect, it } from 'vitest'
import type { PerfEntry } from '../../app/shellState'
import { PERF_ACTIONS, buildRows, currentAction, meteredEngine, newMeter, nextSort, noteAction, shouldLog, splitTimings, toExportJson } from '../perf'

const entry = (id: number, title: string, ms: number, actionId: number, action: string, extra: Partial<PerfEntry> = {}): PerfEntry => ({ id, visual: `v${id}`, title, ms, at: 1_700_000_000_000 + id * 1000, query: 1, render: ms - 1, other: 0, queries: ['// DAX Query\nEVALUATE x'], actionId, action, ...extra })

describe('Performance analyzer timing split', () => {
  it('separates query, display and other; the parts add up to the total', () => {
    // 40 ms wall clock: 12 ms of queries (10 of them while rendering), 25 ms inside the visual's render
    expect(splitTimings(40, { queryMs: 12, renderMs: 25, renderQueryMs: 10 })).toEqual({ ms: 40, query: 12, render: 15, other: 13 })
  })
  it('never reports negative or oversized parts', () => {
    expect(splitTimings(10, { queryMs: 30, renderMs: 50, renderQueryMs: 30 })).toEqual({ ms: 10, query: 10, render: 0, other: 0 })
    expect(splitTimings(10, { queryMs: 2, renderMs: 50, renderQueryMs: 0 })).toEqual({ ms: 10, query: 2, render: 8, other: 0 })
    expect(splitTimings(-5, undefined)).toEqual({ ms: 0, query: 0, render: 0, other: 0 })
  })
  it('a visual without a meter is all "other" (nothing was measured inside it)', () => {
    expect(splitTimings(8, undefined)).toEqual({ ms: 8, query: 0, render: 0, other: 8 })
  })
  it('the metered engine attributes query time to the render only between the render marks', () => {
    const meter = newMeter()
    const eng = meteredEngine({ summarize: () => ({ rows: [] }), toDaxQuery: () => '// DAX Query\nEVALUATE a' } as never, meter, () => true)
    meter.renderStart = performance.now()
    eng.summarize({} as never)
    meter.renderStart = 0
    const inRender = meter.renderQueryMs
    eng.summarize({} as never)
    expect(meter.queries).toHaveLength(2)
    expect(meter.renderQueryMs).toBe(inRender)
    expect(meter.queryMs).toBeGreaterThanOrEqual(meter.renderQueryMs)
  })
})

describe('Performance analyzer user actions', () => {
  it('merges the changes of one gesture into one action, labelled by the most significant change', async () => {
    const before = currentAction().id
    noteAction(PERF_ACTIONS.slicer)
    noteAction(PERF_ACTIONS.page)
    noteAction(PERF_ACTIONS.edit)
    expect(currentAction()).toEqual({ id: before + 1, label: PERF_ACTIONS.page })
    await Promise.resolve()
    noteAction(PERF_ACTIONS.highlight)
    expect(currentAction()).toEqual({ id: before + 2, label: PERF_ACTIONS.highlight })
    await Promise.resolve()
  })
  it('the second half of a gesture continues its action; a new gesture starts a new one', async () => {
    noteAction(PERF_ACTIONS.slicer)
    const id = currentAction().id
    await Promise.resolve()
    // the slicer updated itself; the rest of the page follows after the slicer debounce
    noteAction(PERF_ACTIONS.slicer, true)
    expect(currentAction().id).toBe(id)
    await Promise.resolve()
    noteAction(PERF_ACTIONS.slicer)
    expect(currentAction().id).toBe(id + 1)
    await Promise.resolve()
    // "continues" only ever continues the same kind of action
    noteAction(PERF_ACTIONS.page, true)
    expect(currentAction()).toEqual({ id: id + 2, label: PERF_ACTIONS.page })
    await Promise.resolve()
  })
  it('lists static visuals (no queries) only for refreshes and page changes', () => {
    const none = { queries: [], queryMs: 0 }
    expect(shouldLog(PERF_ACTIONS.slicer, none)).toBe(false)
    expect(shouldLog(PERF_ACTIONS.highlight, none)).toBe(false)
    expect(shouldLog(PERF_ACTIONS.slicer, { queries: ['q'], queryMs: 0 })).toBe(true)
    expect(shouldLog(PERF_ACTIONS.refresh, none)).toBe(true)
    expect(shouldLog(PERF_ACTIONS.page, undefined)).toBe(true)
  })
})

describe('Performance analyzer rows', () => {
  const log: PerfEntry[] = [
    { id: 1, visual: '', title: '', ms: 0, at: 1_700_000_000_000, marker: true, action: PERF_ACTIONS.recording },
    entry(2, 'Sales by country', 19, 1, PERF_ACTIONS.refresh),
    entry(3, 'Stores', 30, 1, PERF_ACTIONS.refresh),
    entry(4, 'Sales by country', 7, 2, PERF_ACTIONS.slicer),
    entry(5, 'Year', 12, 2, PERF_ACTIONS.slicer),
    entry(6, 'Stores', 4, 3, PERF_ACTIONS.slicer)
  ]
  const shape = (rows: ReturnType<typeof buildRows>) => rows.map((r) => (r.kind === 'action' ? `# ${r.label}` : `${r.entry.title} ${r.entry.ms}`))

  it('action order: chronological, one header per user action (two slicer changes in a row stay separate)', () => {
    expect(shape(buildRows(log, null))).toEqual(['# Recording started', '# Refreshed visual', 'Sales by country 19', 'Stores 30', '# Changed a slicer', 'Sales by country 7', 'Year 12', '# Changed a slicer', 'Stores 4'])
  })
  it('sorted: flat list without headers; ties keep the chronological order', () => {
    expect(shape(buildRows(log, { by: 'duration', dir: 'desc' }))).toEqual(['Stores 30', 'Sales by country 19', 'Year 12', 'Sales by country 7', 'Stores 4'])
    expect(shape(buildRows(log, { by: 'duration', dir: 'asc' }))[0]).toBe('Stores 4')
    expect(shape(buildRows(log, { by: 'name', dir: 'asc' }))).toEqual(['Sales by country 19', 'Sales by country 7', 'Stores 30', 'Stores 4', 'Year 12'])
    expect(shape(buildRows(log, { by: 'name', dir: 'desc' }))[0]).toBe('Year 12')
  })
  it('row keys are unique and stable (expansion state survives new entries)', () => {
    const keys = buildRows(log, null).map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    const visualKeys = (rows: ReturnType<typeof buildRows>) => rows.filter((r) => r.kind === 'visual').map((r) => r.key)
    expect(visualKeys(buildRows(log.slice(1), null))).toEqual(visualKeys(buildRows(log, null)))
  })
  it('header clicks cycle: first direction, reverse, back to action order', () => {
    expect(nextSort(null, 'duration')).toEqual({ by: 'duration', dir: 'desc' })
    expect(nextSort({ by: 'duration', dir: 'desc' }, 'duration')).toEqual({ by: 'duration', dir: 'asc' })
    expect(nextSort({ by: 'duration', dir: 'asc' }, 'duration')).toBeNull()
    expect(nextSort({ by: 'duration', dir: 'asc' }, 'name')).toEqual({ by: 'name', dir: 'asc' })
    expect(nextSort({ by: 'name', dir: 'asc' }, 'name')).toEqual({ by: 'name', dir: 'desc' })
    expect(nextSort({ by: 'name', dir: 'desc' }, 'name')).toBeNull()
  })
  it('exports user actions with their visuals and the query / render / other parts', () => {
    const doc = JSON.parse(toExportJson(log, new Date(1_700_000_100_000)))
    expect(doc.version).toBe('1.1.0')
    expect(doc.exportedAt).toBe(new Date(1_700_000_100_000).toISOString())
    const actions = doc.events.filter((e: any) => e.name === 'User Action')
    expect(actions.map((a: any) => a.metrics.sourceLabel)).toEqual(['Recording started', 'Refreshed visual', 'Changed a slicer', 'Changed a slicer'])
    const visuals = doc.events.filter((e: any) => e.name === 'Visual Container Lifecycle')
    expect(visuals).toHaveLength(5)
    expect(visuals[0]).toMatchObject({ parentId: actions[1].id, metrics: { visualTitle: 'Sales by country', visualId: 'v2', durationMs: 19 } })
    expect(new Date(visuals[0].end).getTime() - new Date(visuals[0].start).getTime()).toBe(19)
    const parts = doc.events.filter((e: any) => e.parentId === visuals[0].id)
    expect(parts.map((p: any) => [p.name, p.metrics.durationMs])).toEqual([['Query', 1], ['Render', 18], ['Other', 0]])
    expect(parts[0].metrics.QueryText).toEqual(['// DAX Query\nEVALUATE x'])
  })
})
