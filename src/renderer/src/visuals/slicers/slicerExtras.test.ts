/**
 * Phase 2 slicer features: relative date shapes (include today, anchor date, "is in this"), date
 * presets evaluated by the real engine, single-value / What-if filters, list ordering, dropdown
 * summary text, keyboard focus movement, Force selection.
 */
import { describe, expect, it } from 'vitest'
import { build, d } from '@core/dax/tabular/__tests__/build'
import { createEngine } from '@core/engine/engine'
import { columnExpr } from '@core/report/sq'
import {
  DATE_PRESETS,
  datePresetFilter,
  detectDatePreset,
  equalsFilter,
  parseRangeFilter,
  parseRelativeFilter,
  relativeFilter,
  relativeRange,
  resolveRelativeFilter,
  snapTo,
  valueSelected,
  wrapFilter,
  type RelativeSelection
} from './filterModel'
import { clickItem, clickSelectAll, selectOnly, type ListState } from './listLogic'
import { findMeasure, moveFocus, orderItems, summaryText } from './listOptions'
import { isWhatIfColumn, loadItemStats } from './slicerData'

const date = columnExpr('T', 'Date')
const iso = (x: Date) => x.toISOString().slice(0, 10)
// "now" = Wednesday 2024-05-15 10:00 (wall clock)
const NOW = d(2024, 5, 15, 10)

function engine() {
  const rows: Array<[Date, number]> = []
  for (let i = 0; i < 1600; i++) rows.push([d(2022, 6, 1 + i), i])
  const { model, data } = build({
    tables: {
      T: { columns: { Date: 'dateTime', N: 'int64' }, rows, measures: { Rows: 'COUNTROWS ( T )', First: 'MIN ( T[Date] )', Last: 'MAX ( T[Date] )' } },
      P: { columns: { Value: 'int64' }, expression: 'GENERATESERIES ( -10, 10, 5 )' }
    }
  })
  const e = createEngine(model, data, { now: () => new Date(2024, 4, 15, 10, 0) })
  e.processCalculated()
  return e
}
const E = engine()
/** [first, last, count] of the rows the engine keeps under the filter */
function engineRange(f: any): [string, string, number] {
  const first = E.evaluateScalar('[First]', [f]).value as Date
  const last = E.evaluateScalar('[Last]', [f]).value as Date
  return [iso(first), iso(last), E.evaluateScalar('[Rows]', [f]).value as number]
}
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1

describe('relative date filters evaluated by the engine', () => {
  const cases: Array<[RelativeSelection, string, string]> = [
    [{ anchor: 'last', n: 7, unit: 'days', calendar: false }, '2024-05-09', '2024-05-15'],
    [{ anchor: 'last', n: 7, unit: 'days', calendar: false, includeToday: false }, '2024-05-08', '2024-05-14'],
    [{ anchor: 'last', n: 2, unit: 'months', calendar: false }, '2024-03-16', '2024-05-15'],
    [{ anchor: 'last', n: 2, unit: 'months', calendar: false, includeToday: false }, '2024-03-15', '2024-05-14'],
    [{ anchor: 'last', n: 2, unit: 'months', calendar: true }, '2024-03-01', '2024-04-30'],
    [{ anchor: 'last', n: 1, unit: 'weeks', calendar: true }, '2024-05-05', '2024-05-11'],
    [{ anchor: 'next', n: 3, unit: 'days', calendar: false }, '2024-05-15', '2024-05-17'],
    [{ anchor: 'next', n: 3, unit: 'days', calendar: false, includeToday: false }, '2024-05-16', '2024-05-18'],
    [{ anchor: 'next', n: 1, unit: 'years', calendar: true }, '2025-01-01', '2025-12-31'],
    [{ anchor: 'this', n: 1, unit: 'weeks', calendar: false }, '2024-05-12', '2024-05-18'],
    [{ anchor: 'this', n: 1, unit: 'years', calendar: false }, '2024-01-01', '2024-12-31'],
    [{ anchor: 'last', n: 10, unit: 'days', calendar: false, anchorDate: d(2024, 1, 10) }, '2024-01-01', '2024-01-10']
  ]
  for (const [sel, from, to] of cases) {
    const name = `${sel.anchor} ${sel.n} ${sel.unit}${sel.calendar ? ' (calendar)' : ''}${sel.includeToday === false ? ' excl. today' : ''}${sel.anchorDate ? ' anchored' : ''}`
    it(name, () => {
      const f = relativeFilter(date, sel)!
      // our caption, the engine and the pure membership test agree
      const r = relativeRange(sel, NOW)!
      expect([iso(r.start), iso(r.end)]).toEqual([from, to])
      expect(engineRange(f)).toEqual([from, to, days(from, to)])
      const resolved = resolveRelativeFilter(f, NOW)
      expect(valueSelected(resolved, date, new Date(Date.parse(from + 'T00:00:00Z')), NOW)).toBe(true)
      expect(valueSelected(resolved, date, new Date(Date.parse(from + 'T00:00:00Z') - 86400000), NOW)).toBe(false)
      expect(valueSelected(resolved, date, new Date(Date.parse(to + 'T00:00:00Z')), NOW)).toBe(true)
      expect(valueSelected(resolved, date, new Date(Date.parse(to + 'T00:00:00Z') + 86400000), NOW)).toBe(false)
      // round trip
      expect(parseRelativeFilter(f, date)).toEqual(sel)
    })
  }
  it('PBI shapes from real files parse (rolling weeks, calendar weeks)', () => {
    const now = { Now: {} }
    const add = (e: any, n: number, u: number) => ({ DateAdd: { Expression: e, Amount: n, TimeUnit: u } })
    const span = (e: any, u: number) => ({ DateSpan: { Expression: e, TimeUnit: u } })
    const rolling = wrapFilter({ Between: { Expression: date, LowerBound: span(add(add(now, 1, 0), -24, 1), 0), UpperBound: span(now, 0) } })
    expect(parseRelativeFilter(rolling, date)).toEqual({ anchor: 'last', n: 24, unit: 'weeks', calendar: false })
    const cal = wrapFilter({ Between: { Expression: date, LowerBound: span(add(now, -12, 1), 1), UpperBound: span(add(now, -1, 1), 1) } })
    expect(parseRelativeFilter(cal, date)).toEqual({ anchor: 'last', n: 12, unit: 'weeks', calendar: true })
  })
  it('filter-pane "is in this year" Comparison parses as This year', () => {
    const f = wrapFilter({ Comparison: { ComparisonKind: 0, Left: date, Right: { DateSpan: { Expression: { Now: {} }, TimeUnit: 3 } } } })
    expect(parseRelativeFilter(f, date)).toMatchObject({ anchor: 'this', unit: 'years' })
    expect(engineRange(f)).toEqual(['2024-01-01', '2024-12-31', 366])
    expect(valueSelected(f, date, d(2024, 12, 31), NOW)).toBe(true)
    expect(valueSelected(f, date, d(2025, 1, 1), NOW)).toBe(false)
  })
})

describe('date presets', () => {
  const expected: Record<string, [string, string]> = {
    today: ['2024-05-15', '2024-05-15'],
    yesterday: ['2024-05-14', '2024-05-14'],
    thisWeek: ['2024-05-12', '2024-05-18'],
    thisMonth: ['2024-05-01', '2024-05-31'],
    thisQuarter: ['2024-04-01', '2024-06-30'],
    thisYear: ['2024-01-01', '2024-12-31'],
    last7Days: ['2024-05-09', '2024-05-15'],
    last30Days: ['2024-04-16', '2024-05-15'],
    last90Days: ['2024-02-16', '2024-05-15'],
    last12Months: ['2023-05-16', '2024-05-15'],
    lastMonth: ['2024-04-01', '2024-04-30'],
    lastQuarter: ['2024-01-01', '2024-03-31'],
    lastYear: ['2023-01-01', '2023-12-31'],
    mtd: ['2024-05-01', '2024-05-15'],
    qtd: ['2024-04-01', '2024-05-15'],
    ytd: ['2024-01-01', '2024-05-15']
  }
  it('covers every preset', () => expect(Object.keys(expected).sort()).toEqual(DATE_PRESETS.map((p) => p.id).sort()))
  for (const p of DATE_PRESETS) {
    it(p.label, () => {
      const f = datePresetFilter(date, p.id, NOW)!
      const [from, to] = expected[p.id]
      expect(engineRange(f)).toEqual([from, to, days(from, to)])
      expect(detectDatePreset(f, date, NOW)).toBe(p.id)
      const r = resolveRelativeFilter(f, NOW)
      expect(valueSelected(r, date, new Date(from + 'T00:00:00Z'), NOW)).toBe(true)
      expect(valueSelected(r, date, new Date(to + 'T00:00:00Z'), NOW)).toBe(true)
      expect(valueSelected(r, date, new Date(Date.parse(to + 'T00:00:00Z') + 86400000), NOW)).toBe(false)
    })
  }
  it('relative presets are written relative to Now (they roll forward)', () => {
    expect(JSON.stringify(datePresetFilter(date, 'ytd', NOW))).toContain('"Now"')
    expect(JSON.stringify(datePresetFilter(date, 'last30Days', NOW))).toContain('"Now"')
    expect(detectDatePreset(relativeFilter(date, { anchor: 'last', n: 5, unit: 'days', calendar: false }), date, NOW)).toBeUndefined()
  })
})

describe('single value / What-if', () => {
  it('writes Comparison(=) like PBI and parses it back', () => {
    const f = equalsFilter(columnExpr('P', 'Value'), 5)
    expect(f.Where[0].Condition).toMatchObject({ Comparison: { ComparisonKind: 0 } })
    expect(parseRangeFilter(f, columnExpr('P', 'Value'))).toEqual({ min: 5, max: 5 })
    expect(E.evaluateScalar('COUNTROWS ( P )', [f]).value).toBe(1)
  })
  it('snaps to the series', () => {
    const s = [-10, -5, 0, 5, 10]
    expect(snapTo(s, 3)).toBe(5)
    expect(snapTo(s, 2)).toBe(0)
    expect(snapTo(s, -99)).toBe(-10)
    expect(snapTo(s, 99)).toBe(10)
  })
  it('detects GENERATESERIES parameter tables', () => {
    expect(isWhatIfColumn(E, columnExpr('P', 'Value'))).toBe(true)
    expect(isWhatIfColumn(E, columnExpr('T', 'N'))).toBe(false)
  })
})

describe('list options', () => {
  const items = [
    { value: 'b', text: 'b', selected: false, count: 3, measure: 10 },
    { value: 'a', text: 'a', selected: true, count: 9, measure: null },
    { value: 'C', text: 'C', selected: false, count: 1, measure: 30 },
    { value: null, text: '(Blank)', selected: true, count: null, measure: 20 }
  ]
  const texts = (xs: Array<{ text: string }>) => xs.map((x) => x.text)
  it('default keeps the engine order; PBI sortDefinition descending reverses it', () => {
    expect(texts(orderItems(items, { sort: 'default', selectedFirst: false }))).toEqual(['b', 'a', 'C', '(Blank)'])
    expect(texts(orderItems(items, { sort: 'default', pbiSort: 'desc', selectedFirst: false }))).toEqual(['(Blank)', 'C', 'a', 'b'])
  })
  it('A–Z / Z–A (case-insensitive), by count, by measure (blanks last)', () => {
    expect(texts(orderItems(items, { sort: 'asc', selectedFirst: false }))).toEqual(['(Blank)', 'a', 'b', 'C'])
    expect(texts(orderItems(items, { sort: 'desc', selectedFirst: false }))).toEqual(['C', 'b', 'a', '(Blank)'])
    expect(texts(orderItems(items, { sort: 'countDesc', selectedFirst: false }))).toEqual(['a', 'b', 'C', '(Blank)'])
    expect(texts(orderItems(items, { sort: 'measureAsc', selectedFirst: false }))).toEqual(['b', '(Blank)', 'C', 'a'])
    expect(texts(orderItems(items, { sort: 'measureDesc', selectedFirst: false }))).toEqual(['C', '(Blank)', 'b', 'a'])
  })
  it('selected first is a stable partition', () => {
    expect(texts(orderItems(items, { sort: 'asc', selectedFirst: true }))).toEqual(['(Blank)', 'a', 'b', 'C'])
    expect(texts(orderItems(items, { sort: 'desc', selectedFirst: true }))).toEqual(['a', '(Blank)', 'C', 'b'])
  })
  it('summary text: PBI default and the extra styles', () => {
    const base = { total: 12, all: false }
    expect(summaryText({ style: 'pbi', selected: [], total: 12, all: true })).toBe('All')
    expect(summaryText({ style: 'pbi', selected: ['A'], ...base })).toBe('A')
    expect(summaryText({ style: 'pbi', selected: ['A', 'B', 'C'], ...base })).toBe('Multiple selections')
    expect(summaryText({ style: 'list', selected: ['A', 'B'], ...base })).toBe('A, B')
    expect(summaryText({ style: 'list', selected: ['A', 'B', 'C', 'D', 'E'], ...base })).toBe('A, B +3')
    expect(summaryText({ style: 'count', selected: ['A', 'B', 'C'], ...base })).toBe('3 of 12 selected')
    // inverted (Select all minus 2): count comes from the caller
    expect(summaryText({ style: 'count', selected: ['A'], ...base, selectedCount: 10 })).toBe('10 of 12 selected')
  })
  it('keyboard focus movement', () => {
    expect(moveFocus(-1, 'ArrowDown', 5)).toBe(0)
    expect(moveFocus(-1, 'ArrowUp', 5)).toBe(4)
    expect(moveFocus(4, 'ArrowDown', 5)).toBe(4)
    expect(moveFocus(2, 'Home', 5)).toBe(0)
    expect(moveFocus(2, 'End', 5)).toBe(4)
    expect(moveFocus(1, 'PageDown', 20, 8)).toBe(9)
    expect(moveFocus(1, 'PageUp', 20, 8)).toBe(0)
    expect(moveFocus(0, 'ArrowDown', 0)).toBe(-1)
  })
  it('finds sort measures by "Table[Measure]", "[Measure]" or name', () => {
    expect(findMeasure(E.model, "'T'[Rows]")).toEqual(expect.objectContaining({ Measure: expect.objectContaining({ Property: 'Rows' }) }))
    expect(findMeasure(E.model, '[rows]')).toBeDefined()
    expect(findMeasure(E.model, 'Rows')).toBeDefined()
    expect(findMeasure(E.model, 'P[Rows]')).toBeUndefined()
  })
})

describe('Force selection / single-select auto pick', () => {
  const f = columnExpr('Sales', 'Region')
  const opts = { ctrl: false, ctrlMulti: true, strictSingle: false, force: true }
  it('a click that would clear the only selected item is ignored', () => {
    const s: ListState = { field: f, filter: selectOnly({ field: f, filter: undefined, inverted: false }, 'A', 'A').filter, inverted: false }
    expect(clickItem(s, 'A', 'A', opts)).toEqual({ filter: s.filter, inverted: false })
    expect(clickItem(s, 'A', 'A', { ...opts, force: false }).filter).toBeUndefined()
    expect(clickItem(s, 'B', 'B', opts).filter).toBeDefined()
  })
  it('Select all cannot be turned off into an empty selection', () => {
    const s: ListState = { field: f, filter: undefined, inverted: true }
    expect(clickSelectAll(s, true)).toEqual({ filter: undefined, inverted: true })
    expect(clickSelectAll(s, false)).toEqual({ filter: undefined, inverted: false })
  })
  it('selectOnly writes a one-value In filter', () => {
    const u = selectOnly({ field: f, filter: undefined, inverted: true }, 'X', 'X')
    expect(u.inverted).toBe(false)
    expect(u.filter?.Where[0].Condition).toMatchObject({ In: { Values: [[{ Literal: { Value: "'X'" } }]] } })
  })
})

// ---------------------------------------------------------------------------------------------
// Button slicer model, paste, list slicer format, rendering
// ---------------------------------------------------------------------------------------------
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveTheme } from '@core/report/theme'
import { createMockHost } from '../common/mockHost'
import { createSampleEngine } from '../common/sampleData'
import { getVisual } from '../registry'
import './index'
import { galleryEntries } from './gallery'
import { buttonPosition, layoutButtons, parsePastedValues, readButtonSlicerFormat } from './buttonSlicerModel'
import { matchPasted } from './listOptions'
import { readSlicerFormat } from './slicerFormat'

describe('button slicer layout', () => {
  const base = { arrangement: 'grid' as const, columns: 3, rows: 2, fitToSpace: true, gapX: 10, gapY: 10, overflow: 'paginate' as const, overflowDirection: 'vertical' as const }
  it('grid 3 × 2 paginates 8 items into 2 pages', () => {
    const g = layoutButtons(8, 320, 110, base)
    expect([g.cols, g.rows, g.perPage, g.pages]).toEqual([3, 2, 6, 2])
    expect(g.cellW).toBeCloseTo(100)
    expect(g.cellH).toBeCloseTo(50)
    expect(buttonPosition(4, g, base)).toEqual({ x: 110, y: 60, page: 0 })
    expect(buttonPosition(6, g, base)).toEqual({ x: 0, y: 0, page: 1 })
  })
  it('Fit to space shares the space between fewer buttons; off reserves slots', () => {
    expect(layoutButtons(2, 320, 100, { ...base, rows: 0 }).cols).toBe(2)
    expect(layoutButtons(2, 320, 100, { ...base, rows: 0, fitToSpace: false }).cols).toBe(3)
  })
  it('horizontal fixed size scrolls horizontally', () => {
    const f = { ...base, arrangement: 'horizontal' as const, overflow: 'scroll' as const, fixed: { width: 100, height: 40 } }
    const g = layoutButtons(6, 250, 40, f)
    expect(g.cols).toBe(2)
    expect(g.contentW).toBe(6 * 100 + 5 * 10)
    expect(buttonPosition(3, g, f)).toEqual({ x: 330, y: 0, page: 0 })
  })
  it('vertical with too little height keeps a minimum button height', () => {
    const f = { ...base, arrangement: 'vertical' as const, rows: 0, overflow: 'scroll' as const }
    const g = layoutButtons(20, 200, 200, f, 32)
    expect(g.cellH).toBe(32)
    expect(g.contentH).toBe(20 * 32 + 19 * 10)
  })
  it('reads PBI defaults and per-state formatting', () => {
    const entry = galleryEntries.find((e) => e.id === 'button-slicer-label-accent')!
    const f = readButtonSlicerFormat(entry.visualJson, resolveTheme())
    expect(f.states.default.border).toBe('#E1DFDD')
    expect(f.states.default.radius).toBe(4)
    expect(f.states.default.accentBar).toBeUndefined()
    expect(f.states.selected.accentBar?.color).toBe('#118DFF')
    expect(f.states.hover.fill).toBe('#F3F2F1')
    expect(f.selectionIcon.show).toBe(true)
    expect(f.arrangement).toBe('grid')
  })
})

describe('paste values to select', () => {
  it('parses lines and tab-separated hierarchy levels (max 2,000)', () => {
    expect(parsePastedValues('A\r\nB\t x \n\n C \n')).toEqual([['A'], ['B', 'x'], ['C']])
    expect(parsePastedValues(Array.from({ length: 2500 }, (_, i) => String(i)).join('\n'))).toHaveLength(2000)
  })
  it('exact, case-insensitive matches on text or raw value', () => {
    const items = [
      { value: 'Canada', text: 'Canada' },
      { value: 'Can', text: 'Can' },
      { value: 1234.5, text: '$1,234.50' },
      { value: null, text: '(Blank)' }
    ]
    expect(matchPasted(['canada', '1234.5', '(blank)', 'nope'], items).map((i) => i.text)).toEqual(['Canada', '$1,234.50', '(Blank)'])
  })
})

describe('list slicer (new) and slicer format extras', () => {
  it('list slicer: dropdownMode, pills → chips summary, drawer size, no slicer header', () => {
    const entry = galleryEntries.find((e) => e.id === 'list-slicer-dropdown-pills')!
    const json = structuredClone(entry.visualJson)
    json.visual.objects.dropdownMenu = [{ properties: { width: { expr: { Literal: { Value: '300D' } } } } }]
    const f = readSlicerFormat(json, resolveTheme())
    expect(f.mode).toBe('Dropdown')
    expect(f.header.show).toBe(false)
    expect(f.ext.summary).toBe('chips')
    expect(f.ext.popupWidth).toBe(300)
  })
  it('classic slicer defaults stay PBI (no Lumen extras), sortDefinition is read', () => {
    const json = structuredClone(galleryEntries.find((e) => e.id === 'slicer-basic')!.visualJson)
    json.visual.query.sortDefinition = { sort: [{ field: columnExpr('Sales', 'Country'), direction: 'Descending' }] }
    const f = readSlicerFormat(json, resolveTheme())
    expect(f.ext).toMatchObject({ summary: 'pbi', clearButton: false, showCounts: false, selectedFirst: false, sort: 'default', datePresets: false, forceSelection: false })
    expect(f.sort).toBe('desc')
    expect(f.date.includeToday).toBe(true)
  })
})

describe('rendering (SSR)', () => {
  const engine = createSampleEngine()
  const render = (id: string, type?: string) => {
    const entry = galleryEntries.find((e) => e.id === id)!
    const json = entry.visualJson
    const ctx = createMockHost({ engine, visualJson: json })
    return renderToStaticMarkup(createElement(getVisual(type ?? json.visual.visualType)!.component, { visual: { name: id, json }, pageName: 'p', width: entry.width, height: entry.height, ctx }))
  }
  it('dropdown chips show each selected value with a remove button, plus the clear button', () => {
    const html = render('slicer-dropdown-chips')
    for (const v of ['Canada', 'Germany', 'Japan']) expect(html).toContain(`aria-label="Remove ${v}"`)
    expect(html).toContain('aria-label="Clear selections"')
  })
  it('dropdown "list" summary', () => {
    expect(render('slicer-dropdown-list-summary')).toMatch(/Canada, France \+2/)
  })
  it('value counts per item (rows are virtualized, so check the data path)', () => {
    const json = galleryEntries.find((e) => e.id === 'slicer-counts-sorted')!.visualJson
    const ctx = createMockHost({ engine, visualJson: json })
    const stats = loadItemStats(ctx, columnExpr('Sales', 'Product'), { counts: true })
    const total = [...stats.counts!.values()].reduce((a: number, b) => a + (b ?? 0), 0)
    expect(total).toBe(2400) // every sample row counted once
  })
  it('button slicer: Label measure under each value, paging control', () => {
    expect(render('button-slicer-label-accent')).toMatch(/Europe<\/span><span[^>]*>\$/)
    const html = render('button-slicer-paginate')
    expect(html).toContain('aria-label="Next page"')
    expect(html).toMatch(/1(<!-- -->)? \/ (<!-- -->)?2/)
  })
})

// ---------------------------------------------------------------------------------------------
// lumenSlicer hygiene: untouched reports never carry the Lumen-only object
// ---------------------------------------------------------------------------------------------
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '@core/io/nodefs'
import { openProject, saveProject } from '@core/io/open'
import { createMockState } from '../common/mockHost'
import { normalizeLumenSlicer } from './slicerFormat'

describe('lumenSlicer object', () => {
  const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
  it('normalize drops default values and the empty object, keeps real choices', () => {
    const json: any = { visual: { visualType: 'slicer', objects: { lumenSlicer: [{ properties: { summary: lit("'pbi'"), clearButton: lit('false'), popupWidth: lit('0D'), sortMeasure: lit("''") } }] } } }
    expect(normalizeLumenSlicer(json)).toBe(true)
    expect(json.visual.objects.lumenSlicer).toBeUndefined()
    const j2: any = { visual: { visualType: 'slicer', objects: { lumenSlicer: [{ properties: { summary: lit("'chips'"), showCounts: lit('false') } }] } } }
    normalizeLumenSlicer(j2)
    expect(j2.visual.objects.lumenSlicer).toEqual([{ properties: { summary: lit("'chips'") } }])
    const untouched: any = { visual: { visualType: 'slicer', objects: { data: [] } } }
    expect(normalizeLumenSlicer(untouched)).toBe(false)
    expect(untouched).toEqual({ visual: { visualType: 'slicer', objects: { data: [] } } })
  })

  const DIR = process.env.LUMEN_SAMPLES_DIR
  const files = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pbix$/i.test(f)).sort() : []
  describe.skipIf(!files.length)('opening, rendering and saving sample reports', () => {
    for (const f of files) {
      it(`${f}: no lumenSlicer objects after render + save`, async () => {
        const doc = await openProject(join(DIR!, f), nodeFs)
        const eng = createEngine(doc.model, doc.data)
        eng.processCalculated()
        let n = 0
        for (const p of doc.report!.pages) {
          for (const v of p.visuals) {
            const type = v.json.visual?.visualType
            if (!['slicer', 'listSlicer', 'textSlicer', 'advancedSlicerVisual'].includes(type)) continue
            const def = getVisual(type)
            if (!def) continue
            const state = createMockState()
            const ctx = createMockHost({ engine: eng, visualJson: v.json, state })
            renderToStaticMarkup(createElement(def.component, { visual: v, pageName: p.name, width: 240, height: 200, ctx }))
            n++
          }
        }
        const tmp = mkdtempSync(join(tmpdir(), 'wbi-slicer-'))
        try {
          await saveProject(doc, join(tmp, 'Out.pbip'), nodeFs, { format: 'pbip' })
          const walk = (d: string): string[] => readdirSync(d).flatMap((x) => (statSync(join(d, x)).isDirectory() ? walk(join(d, x)) : [join(d, x)]))
          const hits = walk(tmp).filter((p) => p.endsWith('.json') && readFileSync(p, 'utf8').includes('lumenSlicer'))
          expect(hits).toEqual([])
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
        expect(n).toBeGreaterThanOrEqual(0)
      }, 120000)
    }
  })
})
