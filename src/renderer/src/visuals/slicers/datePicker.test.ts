import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { columnExpr } from '@core/report/sq'
import { resolveTheme } from '@core/report/theme'
import { createMockHost, createMockState } from '../common/mockHost'
import { createSampleEngine } from '../common/sampleData'
import { getVisual } from '../registry'
import './index'
import { galleryEntries } from './gallery'
import {
  calendarClick,
  clipRange,
  monthGrid,
  parseDateInput,
  pickerFilter,
  readPickerRule,
  relativeSummary,
  resolvePickerRange,
  ruleFromFilter,
  writePickerRule,
  type PickerRelative,
  type PickerRule
} from './datePicker'
import { effectiveRule } from './DatePickerSlicer'
import { parseRangeFilter, parseRelativeFilter, rangeFilter, relativeFilter, resolveRelativeFilter } from './filterModel'
import { evalFilter } from '../common/sqEval'
import { readSlicerFormat } from './slicerFormat'

const date = columnExpr('Sales', 'Date')
const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const iso = (d: Date | undefined) => d?.toISOString().slice(0, 10)
const now = D(2026, 11, 17)
const domain = { first: D(2023, 1, 1), last: D(2026, 5, 6) }
const rel = (p: Partial<PickerRelative>): PickerRelative => ({ kind: 'relative', range: 'last', n: 1, unit: 'months', calendar: false, anchor: 'today', offset: 0, ...p })

/** inclusive [start, end] of a filter, evaluated row-wise on the date column */
function members(filter: ReturnType<typeof pickerFilter>, days: Date[]): string[] {
  const f = resolveRelativeFilter(filter, now)
  return days.filter((d) => evalFilter(f!, () => d)).map((d) => iso(d)!)
}

describe('date picker: PBIR objects round-trip', () => {
  const cases: PickerRule[] = [
    { kind: 'manual', start: D(2026, 4, 14), end: D(2026, 4, 24) },
    rel({ range: 'last', n: 2, unit: 'years', calendar: true, anchor: 'last', offset: 1 }),
    rel({ range: 'next', n: 7, unit: 'days', anchor: 'first' }),
    rel({ range: 'this', n: 1, unit: 'weeks' })
  ]
  for (const c of cases)
    it(`${c.kind} ${c.kind === 'relative' ? relativeSummary(c) : ''}`, () => {
      const j: any = { visual: { visualType: 'slicer', objects: { data: [{ properties: { mode: { expr: { Literal: { Value: "'RelativeDatePicker'" } } } } }] } } }
      writePickerRule(j, c)
      expect(readPickerRule(j)).toEqual(c)
      // schema-documented keys + values
      const props = j.visual.objects.data[0].properties
      expect(props.mode).toBeDefined()
      if (c.kind === 'manual') expect(props.startDate.expr.Literal.Value).toBe("datetime'2026-04-14T00:00:00'")
      else expect(['Days', 'Weeks', 'Calendar Weeks', 'Months', 'Calendar Months', 'Years', 'Calendar Years']).toContain(props.relativePeriod.expr.Literal.Value.slice(1, -1))
      writePickerRule(j, undefined)
      expect(readPickerRule(j)).toBeUndefined()
      expect(Object.keys(j.visual.objects.data[0].properties)).toEqual(['mode'])
    })
  it('reads PBI-encoded values (relativeDuration as a D literal, quoted dates)', () => {
    const j = { visual: { objects: { data: [{ properties: { relativeRange: { expr: { Literal: { Value: "'Last'" } } }, relativeDuration: { expr: { Literal: { Value: '3D' } } }, relativePeriod: { expr: { Literal: { Value: "'Calendar Months'" } } } } }] } } }
    expect(readPickerRule(j)).toEqual(rel({ n: 3, calendar: true }))
    const m = { visual: { objects: { data: [{ properties: { startDate: { expr: { Literal: { Value: "'2026-04-24'" } } }, endDate: { expr: { Literal: { Value: "'4/14/2026'" } } } } }] } } }
    expect(readPickerRule(m)).toEqual({ kind: 'manual', start: D(2026, 4, 14), end: D(2026, 4, 24) })
  })
})

describe('date picker: resolution', () => {
  it('Learn example: last 2 calendar years, offset +1, from last date → 2025–2026 clipped to the last date', () => {
    const r = resolvePickerRange(rel({ n: 2, unit: 'years', calendar: true, anchor: 'last', offset: 1 }), domain, now)!
    expect([iso(r.start), iso(r.end)]).toEqual(['2025-01-01', '2026-12-31'])
    const c = clipRange(r, domain.first, domain.last)
    expect([iso(c.start), iso(c.end), c.clipped]).toEqual(['2025-01-01', '2026-05-06', true])
  })
  it('Learn example: last 1 month from last date offset by -1 months', () => {
    const r = resolvePickerRange(rel({ n: 1, unit: 'months', anchor: 'last', offset: -1 }), domain, now)!
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-03-07', '2026-04-06'])
  })
  it('today anchor rolls with now; first-date anchor; this week (Sunday start)', () => {
    expect(resolvePickerRange(rel({ n: 30, unit: 'days' }), domain, now)).toEqual({ start: D(2026, 10, 19), end: D(2026, 11, 17) })
    expect(resolvePickerRange(rel({ range: 'next', n: 10, unit: 'days', anchor: 'first' }), domain, now)).toEqual({ start: D(2023, 1, 1), end: D(2023, 1, 10) })
    expect(resolvePickerRange(rel({ range: 'this', unit: 'weeks' }), domain, now)).toEqual({ start: D(2026, 11, 15), end: D(2026, 11, 21) })
  })
  it('includeToday off / anchorDate apply to the Today anchor', () => {
    expect(resolvePickerRange(rel({ n: 7, unit: 'days' }), domain, now, { includeToday: false })).toEqual({ start: D(2026, 11, 10), end: D(2026, 11, 16) })
    expect(resolvePickerRange(rel({ n: 1, unit: 'months', calendar: true }), domain, now, { anchorDate: D(2024, 3, 15) })).toEqual({ start: D(2024, 2, 1), end: D(2024, 2, 29) })
  })
  it('manual ranges and missing anchors', () => {
    expect(resolvePickerRange({ kind: 'manual', start: D(2026, 1, 2), end: D(2026, 1, 2) }, domain, now)).toEqual({ start: D(2026, 1, 2), end: D(2026, 1, 2) })
    expect(resolvePickerRange(rel({ anchor: 'last' }), {}, now)).toBeUndefined()
    expect(clipRange({ start: D(2027, 1, 1), end: D(2027, 2, 1) }, domain.first, domain.last).empty).toBe(true)
  })
})

describe('date picker: filters', () => {
  const days = [D(2026, 4, 13), D(2026, 4, 14), D(2026, 4, 24), D(2026, 4, 25)]
  it('manual = >= start AND < end + 1 day (inclusive end)', () => {
    const f = pickerFilter(date, { kind: 'manual', start: D(2026, 4, 14), end: D(2026, 4, 24) }, domain, now)!
    expect(JSON.stringify(f)).toBe(JSON.stringify(rangeFilter(date, { min: D(2026, 4, 14), max: D(2026, 4, 24) })))
    expect(members(f, days)).toEqual(['2026-04-14', '2026-04-24'])
    expect(parseRangeFilter(f, date)).toEqual({ min: D(2026, 4, 14), max: D(2026, 4, 24) })
  })
  it('today anchor writes the rolling Now-based relative shape', () => {
    const f = pickerFilter(date, rel({ n: 3, unit: 'months', calendar: true }), domain, now)!
    expect(JSON.stringify(f)).toBe(JSON.stringify(relativeFilter(date, { anchor: 'last', n: 3, unit: 'months', calendar: true })))
    expect(JSON.stringify(f)).toContain('"Now"')
  })
  it('first/last anchors and offsets write the resolved anchor as a literal', () => {
    const f = pickerFilter(date, rel({ n: 1, unit: 'months', anchor: 'last', offset: -1 }), domain, now)!
    expect(JSON.stringify(f)).not.toContain('"Now"')
    expect(parseRelativeFilter(f, date)?.anchorDate).toEqual(D(2026, 4, 6))
    expect(members(f, [D(2026, 3, 6), D(2026, 3, 7), D(2026, 4, 6), D(2026, 4, 7)])).toEqual(['2026-03-07', '2026-04-06'])
  })
  it('ruleFromFilter recovers rules from filters written without the data.* properties', () => {
    expect(ruleFromFilter(relativeFilter(date, { anchor: 'last', n: 3, unit: 'months', calendar: true }), date)).toEqual(rel({ n: 3, calendar: true }))
    expect(ruleFromFilter(rangeFilter(date, { min: D(2026, 1, 1), max: D(2026, 1, 31) }), date)).toEqual({ kind: 'manual', start: D(2026, 1, 1), end: D(2026, 1, 31) })
    expect(ruleFromFilter(undefined, date)).toBeUndefined()
  })
  it('effectiveRule: stored rule while it matches, filter otherwise, nothing when cleared', () => {
    const stored = rel({ n: 1, anchor: 'last' })
    const f = pickerFilter(date, stored, domain, now)
    expect(effectiveRule(stored, f, date, domain, now, {})).toBe(stored)
    // the data grew: the stored anchored rule wins (and is re-applied by the slicer)
    expect(effectiveRule(stored, f, date, { ...domain, last: D(2026, 6, 1) }, now, {})).toBe(stored)
    const other = rangeFilter(date, { min: D(2025, 1, 1), max: D(2025, 1, 2) })
    expect(effectiveRule(stored, other, date, domain, now, {})).toEqual({ kind: 'manual', start: D(2025, 1, 1), end: D(2025, 1, 2) })
    expect(effectiveRule(stored, undefined, date, domain, now, {})).toBeUndefined()
  })
})

describe('date picker: text, calendar, typing', () => {
  it('restatements', () => {
    expect(relativeSummary(rel({ n: 2, unit: 'years', calendar: true, anchor: 'last', offset: 1 }))).toBe('In the last 2 calendar years, offset by 1 calendar year from last date')
    expect(relativeSummary(rel({ n: 1, anchor: 'last', offset: -1 }))).toBe('In the last 1 month, offset by -1 month from last date')
    expect(relativeSummary(rel({ range: 'this', unit: 'weeks' }))).toBe('In this week')
    expect(relativeSummary(rel({ range: 'next', n: 30, unit: 'days' }))).toBe('In the next 30 days')
  })
  it('month grid: 6 weeks from Sunday', () => {
    const g = monthGrid(2026, 3) // April 2026 (Learn screenshot: starts with 29 30 31 of March)
    expect(g.length).toBe(6)
    expect(g[0].map((d) => d.date.getUTCDate())).toEqual([29, 30, 31, 1, 2, 3, 4])
    expect(g[0][0].inMonth).toBe(false)
    expect(g[4].map((d) => d.date.getUTCDate())).toEqual([26, 27, 28, 29, 30, 1, 2])
  })
  it('calendar clicks: start, end (swapped when earlier), same day twice = single date', () => {
    let p = calendarClick({}, D(2026, 4, 24), false)
    expect(p).toEqual({ start: D(2026, 4, 24), end: undefined })
    p = calendarClick(p, D(2026, 4, 14), false)
    expect(p).toEqual({ start: D(2026, 4, 14), end: D(2026, 4, 24) })
    p = calendarClick(p, D(2026, 5, 1), false)
    expect(p).toEqual({ start: D(2026, 5, 1), end: undefined })
    expect(calendarClick(p, D(2026, 5, 1), false)).toEqual({ start: D(2026, 5, 1), end: D(2026, 5, 1) })
    expect(calendarClick({}, D(2026, 5, 3), true)).toEqual({ start: D(2026, 5, 3), end: D(2026, 5, 3) })
  })
  it('typed dates', () => {
    expect(parseDateInput('4/14/2026')).toEqual(D(2026, 4, 14))
    expect(parseDateInput('4/14/26')).toEqual(D(2026, 4, 14))
    expect(parseDateInput('2026-04-14')).toEqual(D(2026, 4, 14))
    expect(parseDateInput('Apr 14, 2026')).toEqual(D(2026, 4, 14))
    expect(parseDateInput('14 April 2026')).toEqual(D(2026, 4, 14))
    expect(parseDateInput('2/30/2026')).toBeUndefined()
    expect(parseDateInput('soon')).toBeUndefined()
  })
})

describe('date picker: format + rendering', () => {
  it('modes written by current PBI Desktop', () => {
    const t = resolveTheme()
    const mk = (mode: string) => ({ visual: { visualType: 'slicer', objects: { data: [{ properties: { mode: { expr: { Literal: { Value: `'${mode}'` } } } } }] } } })
    expect(readSlicerFormat(mk('RelativeDatePicker'), t).mode).toBe('RelativeDatePicker')
    expect(readSlicerFormat(mk('VerticalList'), t)).toMatchObject({ mode: 'Basic', horizontal: false })
    expect(readSlicerFormat(mk('HorizontalList'), t)).toMatchObject({ mode: 'Basic', horizontal: true })
    const f = readSlicerFormat(mk('RelativeDatePicker'), t)
    expect(f.picker).toMatchObject({ singleDate: false, relativeShow: true, handleSize: 20, trackColor: '#707070' })
    expect(f.picker.button.stroke).toEqual({ color: '#C8C6C4', width: 1, pattern: 'solid' })
  })
  const engine = createSampleEngine()
  const render = (id: string, state = createMockState()) => {
    const entry = galleryEntries.find((e) => e.id === id)!
    const json = JSON.parse(JSON.stringify(entry.visualJson))
    const ctx = createMockHost({ engine, visualJson: json, state })
    return { html: renderToStaticMarkup(createElement(getVisual('slicer')!.component, { visual: { name: id, json }, pageName: 'p', width: 300, height: 120, ctx })), ctx, json }
  }
  it('manual selection shows the range in the column format', () => {
    const { html } = render('slicer-datepicker-manual')
    expect(html).toContain('4/14/2024 – 4/24/2024')
    expect(html).toContain('Open date picker')
  })
  it('relative selection shows the range and the restatement', () => {
    const { html } = render('slicer-datepicker-relative')
    expect(html).toContain('In the last 2 calendar months, offset by -1 calendar month from last date')
    expect(html).toMatch(/\d+\/\d+\/2024 – \d+\/\d+\/2024/)
  })
  it('a range outside the data shows the indicator', () => {
    const { html } = render('slicer-datepicker-today')
    expect(html).toContain('extends beyond the available dates')
  })
  it('no selection shows the available dates; getData reports From/To', () => {
    const { html, ctx, json } = render('slicer-datepicker-unfiltered')
    expect(html).toMatch(/1\/\d+\/2023 – 12\/\d+\/2024/)
    const d = getVisual('slicer')!.getData!({ name: 'x', json }, ctx)!
    expect(d.columns).toEqual(['Field', 'From', 'To'])
    const m = render('slicer-datepicker-manual')
    const dm = getVisual('slicer')!.getData!({ name: 'x', json: m.json }, m.ctx)!
    expect(dm.rows[0].slice(1)).toEqual([D(2024, 4, 14), D(2024, 4, 24)])
  })
})
