/**
 * Sample data stays populated under the selections a report's own slicers offer: every member of a sliced dimension
 * has fact rows in every period of the grain the report's date slicers select (./synthetic-coverage.ts). Invented
 * models only: clinics and programmes (dimensions) ← visits (events) → calendar sliced by quarter; a headcount
 * snapshot; a model too large for full pairwise coverage.
 */
import { describe, expect, it } from 'vitest'
import { emptyDataStore, makeDate, type Scalar } from '../../model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../model/types'
import type { ProjectDocument } from '../../project'
import type { ReportDocument } from '../../report/types'
import type { SQFilter } from '../../report/sq'
import { createEngine } from '../../engine/engine'
import { generateSyntheticData, type SyntheticOptions } from '../synthetic'
import { mineSliceable } from '../synthetic-slices'
import { allocate, layoutCoverage, layoutSnapshot, prioritise, type PeriodBucket } from '../synthetic-coverage'
import { calendarValue } from '../synthetic-values'

const TODAY = makeDate(2026, 11, 17)
const SAVED_QUARTER = '2025-Q2'
const PINNED_CLINIC = 'Lakeside Family Practice of Example County'

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}
function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: `let Source = Sql.Database("server", "db"), T = Source{[Schema="dbo",Item="${name}"]}[Data] in T` }], ...extra }
}
function rel(from: string, to: string, extra: Partial<RelationshipDef> = {}): RelationshipDef {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name: `${from}->${to}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true, ...extra }
}
const C = (alias: string, column: string) => ({ Column: { Expression: { SourceRef: { Source: alias } }, Property: column } })
const sqIn = (alias: string, entity: string, column: string, literals: string[]): SQFilter => ({
  Version: 2,
  From: [{ Name: alias, Entity: entity, Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [C(alias, column)], Values: literals.map((l) => [{ Literal: { Value: l } }]) } } }]
})
const field = (entity: string, column: string) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: column } })
const slicer = (name: string, entity: string, column: string, filter?: SQFilter, mode = 'Dropdown') => ({
  name,
  json: {
    name,
    visual: {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ field: field(entity, column), queryRef: `${entity}.${column}` }] } } },
      objects: { data: [{ properties: { mode: { expr: { Literal: { Value: `'${mode}'` } } } } }], ...(filter ? { general: [{ properties: { filter: { filter } } }] } : {}) }
    }
  }
})
const table = (name: string, fields: Array<[string, string]>) => ({
  name,
  json: { name, visual: { visualType: 'tableEx', query: { queryState: { Values: { projections: fields.map(([e, c]) => ({ field: field(e, c), queryRef: `${e}.${c}` })) } } } } }
})

/** clinics (300) and programmes ← visits → calendar (quarters); a headcount snapshot per clinic; slicers on all of them. */
function project(opts: { weekly?: boolean; clinics?: number } = {}): ProjectDocument {
  const calendar = imported('calendar', [col('date', 'dateTime', { isKey: true }), col('year', 'int64'), col('year_quarter', 'string'), col('week_end', 'dateTime')], { dataCategory: 'Time' })
  const clinics = imported('dim_clinic', [col('clinic_id', 'string'), col('clinic_name', 'string'), col('region', 'string'), col('status', 'string')])
  const programs = imported('dim_program', [col('program_code', 'string'), col('program_name', 'string')])
  const visits = imported('fact_visits', [col('visit_id', 'string'), col('clinic_id', 'string'), col('program_code', 'string'), col('visit_date', 'dateTime'), col('fee_amount', 'double')], {
    measures: [{ name: 'Visits', expression: 'COUNTROWS ( fact_visits )' }]
  })
  const headcount = imported('fact_headcount_snapshot', [col('snapshot_date', 'dateTime'), col('clinic_id', 'string'), col('headcount', 'int64')], {
    measures: [{ name: 'Headcount', expression: 'SUM ( fact_headcount_snapshot[headcount] )' }]
  })
  const model: SemanticModel = {
    name: 'Clinics',
    tables: [calendar, clinics, programs, visits, headcount],
    relationships: [
      rel('fact_visits.clinic_id', 'dim_clinic.clinic_id'),
      rel('fact_visits.program_code', 'dim_program.program_code'),
      rel('fact_visits.visit_date', 'calendar.date'),
      rel('fact_headcount_snapshot.clinic_id', 'dim_clinic.clinic_id'),
      rel('fact_headcount_snapshot.snapshot_date', 'calendar.date')
    ],
    expressions: [],
    roles: []
  }
  const period = opts.weekly ? slicer('s_week', 'calendar', 'week_end') : slicer('s_q', 'calendar', 'year_quarter', sqIn('c', 'calendar', 'year_quarter', [`'${SAVED_QUARTER}'`]))
  const report = {
    origin: 'pbir',
    report: { filterConfig: { filters: [] } },
    pagesMeta: { pageOrder: ['p1'] },
    pages: [
      {
        name: 'p1',
        json: { filterConfig: { filters: [{ name: 'f1', field: field('dim_clinic', 'region'), type: 'Categorical' }] } },
        visuals: [
          period,
          slicer('s_clinic', 'dim_clinic', 'clinic_name', sqIn('k', 'dim_clinic', 'clinic_name', [`'${PINNED_CLINIC}'`])),
          slicer('s_prog', 'dim_program', 'program_name'),
          slicer('s_range', 'calendar', 'date', undefined, 'Between'),
          table('t1', [
            ['dim_clinic', 'clinic_name'],
            ['dim_clinic', 'region']
          ])
        ]
      }
    ],
    bookmarks: [],
    theme: {},
    resources: []
  } as unknown as ReportDocument
  return { id: 'clinics', name: 'Clinics', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

function cells(p: ProjectDocument, t: string, c: string): Scalar[] {
  return p.data.tables.get(t)!.columns.find((x) => x.name === c)!.values
}
function k(v: Scalar): string {
  return v instanceof Date ? 'd' + v.getTime() : typeof v + String(v)
}
const cal = { today: TODAY, fiscalStartMonth: 7 }
const quarterOf = (d: Date): string => String(calendarValue('year_quarter', 'string', d, cal))

function generate(opts: SyntheticOptions = {}, p = project()) {
  const res = generateSyntheticData(p, { seed: 42, today: TODAY, factRows: 2000, dimRows: 300, ...opts })
  return { p, res }
}

describe('mineSliceable', () => {
  it('lists slicer, filter-card and visual grouping fields with their saved selections', () => {
    const f = mineSliceable(project())
    const by = (t: string, c: string) => f.find((x) => x.table === t && x.column === c)
    expect(by('calendar', 'year_quarter')).toMatchObject({ source: 'slicer', saved: [SAVED_QUARTER] })
    expect(by('dim_clinic', 'clinic_name')).toMatchObject({ source: 'slicer', saved: [PINNED_CLINIC] })
    expect(by('dim_program', 'program_name')?.source).toBe('slicer')
    expect(by('calendar', 'date')?.range).toBe(true)
    // a page filter card and a table's grouping column (the slicer source wins for a field used both ways)
    expect(by('dim_clinic', 'region')?.source).toBe('filter')
  })
})

describe('coverage layout (pure)', () => {
  const periods = (n: number, saved: number[] = []): PeriodBucket[] => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, days: [i * 10, i * 10 + 1], saved: saved.includes(i) }))
  it('puts saved periods first, then the most recent', () => {
    expect(prioritise(periods(5, [1])).map((p) => p.key)).toEqual(['p1', 'p4', 'p3', 'p2', 'p0'])
  })
  it('covers fully while the budget lasts, then shares the rest among older periods', () => {
    const ps = prioritise(periods(10, [0]))
    // not all fit: full periods take at most 3/4 of the budget (saved + 2 recent = 300 of 450), 7 older share 150
    expect(allocate(ps, 100, 450)).toEqual([100, 100, 100, 21, 21, 21, 21, 21, 21, 21])
    // all fit: all full
    expect(allocate(ps, 10, 100)).toEqual(new Array(10).fill(10))
  })
  it('lays out each member once per fully covered period, popular members first when partial', () => {
    const order = Int32Array.from([4, 2, 0, 1, 3])
    const lay = layoutCoverage(periods(3), [{ order }, { order: Int32Array.from([1, 0]) }], 14, () => 0.3)
    // 15 slots > 14: two periods full (10 ≤ 3/4 × 14), the oldest gets the remaining 4
    expect(lay.rows).toBe(14)
    expect(lay.fullPeriods).toBe(2)
    expect(lay.partialPeriods).toBe(1)
    // the partial (oldest) period: the four most popular members
    expect(new Set(lay.members[0].slice(10))).toEqual(new Set([4, 2, 0, 1]))
    for (let p = 0; p < 2; p++) expect(new Set(lay.members[0].slice(p * 5, p * 5 + 5))).toEqual(new Set([0, 1, 2, 3, 4]))
  })
  it('lays out snapshots as one row per entity per day', () => {
    const lay = layoutSnapshot([5, 10, 15], new Set([5]), { order: Int32Array.from([2, 0, 1]) }, [], 8, 1)
    // budget 8: the saved day and the most recent day full (6 ≤ 3/4 × 8), the middle day the rest (2 most popular)
    expect(Array.from(lay.day)).toEqual([5, 5, 5, 10, 10, 15, 15, 15])
    expect(Array.from(lay.entity)).toEqual([2, 0, 1, 2, 0, 2, 0, 1])
    expect(lay.fullPeriods).toBe(2)
  })
})

describe('dense sample data where the report is sliced', () => {
  const { p, res } = generate()
  const clinicIds = cells(p, 'dim_clinic', 'clinic_id')
  const visitClinic = cells(p, 'fact_visits', 'clinic_id')
  const visitProgram = cells(p, 'fact_visits', 'program_code')
  const visitDate = cells(p, 'fact_visits', 'visit_date') as Date[]

  it('gives every clinic and every programme visits in every quarter of the activity window', () => {
    const quarters = new Set<string>()
    for (let d = makeDate(2024, 1, 1); d.getTime() <= TODAY.getTime(); d = new Date(d.getTime() + 86400000)) quarters.add(quarterOf(d))
    const pairs = new Set<string>()
    const progPairs = new Set<string>()
    for (let r = 0; r < visitClinic.length; r++) {
      pairs.add(`${k(visitClinic[r])}|${quarterOf(visitDate[r])}`)
      progPairs.add(`${k(visitProgram[r])}|${quarterOf(visitDate[r])}`)
    }
    expect(clinicIds.length).toBe(300)
    for (const id of clinicIds) for (const q of quarters) expect(pairs.has(`${k(id)}|${q}`), `${String(id)} ${q}`).toBe(true)
    for (const code of cells(p, 'dim_program', 'program_code')) for (const q of quarters) expect(progPairs.has(`${k(code)}|${q}`)).toBe(true)
    const cov = res.coverage.find((c) => c.table === 'fact_visits')!
    expect(cov).toMatchObject({ kind: 'events', grain: 'year_quarter', periods: quarters.size, fullPeriods: quarters.size, partialPeriods: 0 })
    expect(cov.coveredPairs).toBe(cov.pairs)
    expect(cov.columns.sort()).toEqual(['clinic_id', 'program_code'])
  })

  it('keeps distributions skewed (a floor per clinic and quarter, popular clinics far busier)', () => {
    const n = new Map<string, number>()
    for (const v of visitClinic) n.set(k(v), (n.get(k(v)) ?? 0) + 1)
    const counts = [...n.values()].sort((a, b) => a - b)
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] * 3)
    // visits are not all on one day of their quarter, and never in the future
    expect(new Set(visitDate.map((d) => d.getTime())).size).toBeGreaterThan(300)
    expect(visitDate.every((d) => d.getTime() <= TODAY.getTime())).toBe(true)
  })

  it('keeps referential integrity', () => {
    const ids = new Set(clinicIds.map(k))
    expect(visitClinic.every((v) => ids.has(k(v)))).toBe(true)
    const codes = new Set(cells(p, 'dim_program', 'program_code').map(k))
    expect(visitProgram.every((v) => codes.has(k(v)))).toBe(true)
  })

  it('lays out the snapshot fact as one row per clinic per snapshot day', () => {
    const days = cells(p, 'fact_headcount_snapshot', 'snapshot_date') as Date[]
    const ids = cells(p, 'fact_headcount_snapshot', 'clinic_id')
    const per = new Map<number, Set<string>>()
    const rows = new Map<number, number>()
    for (let r = 0; r < days.length; r++) {
      const t = days[r].getTime()
      ;(per.get(t) ?? per.set(t, new Set()).get(t)!).add(k(ids[r]))
      rows.set(t, (rows.get(t) ?? 0) + 1)
    }
    expect(per.size).toBeGreaterThanOrEqual(24)
    for (const [t, s] of per) {
      expect(s.size, new Date(t).toISOString()).toBe(300)
      expect(rows.get(t)).toBe(300)
    }
    expect(res.coverage.find((c) => c.table === 'fact_headcount_snapshot')).toMatchObject({ kind: 'snapshot', partialPeriods: 0 })
  })

  it('is deterministic for a seed', () => {
    const again = generate().p
    for (const t of ['fact_visits', 'fact_headcount_snapshot', 'dim_clinic']) expect(JSON.stringify(again.data.tables.get(t))).toBe(JSON.stringify(p.data.tables.get(t)))
    const other = generate({ seed: 43 }).p
    expect(JSON.stringify(other.data.tables.get('fact_visits'))).not.toBe(JSON.stringify(p.data.tables.get('fact_visits')))
  })

  it('answers the pinned clinic selection with a generated stand-in that has visits in the saved quarter', () => {
    // the real name is never written to the data
    expect(cells(p, 'dim_clinic', 'clinic_name').some((v) => String(v).toLowerCase() === PINNED_CLINIC.toLowerCase())).toBe(false)
    const engine = createEngine(p.model, p.data)
    engine.processCalculated()
    const filters = [sqIn('k', 'dim_clinic', 'clinic_name', [`'${PINNED_CLINIC}'`]), sqIn('c', 'calendar', 'year_quarter', [`'${SAVED_QUARTER}'`])]
    expect(Number(engine.evaluateScalar('[Visits]', filters).value ?? 0)).toBeGreaterThan(0)
    expect(Number(engine.evaluateScalar('[Headcount]', filters).value ?? 0)).toBeGreaterThan(0)
    // and so has every other clinic in that quarter
    const r = engine.summarize({
      groupBy: [{ kind: 'sq', expr: field('dim_clinic', 'clinic_name') }],
      values: [{ id: 'v', expr: { kind: 'sq', expr: { Measure: { Expression: { SourceRef: { Entity: 'fact_visits' } }, Property: 'Visits' } } } }],
      filters: [filters[1]]
    })
    expect(r.rows.length).toBe(300)
  })

  it('can be turned off', () => {
    const off = generate({ coverageRows: 0 })
    expect(off.res.coverage).toEqual([])
    expect(off.p.data.tables.get('fact_visits')!.rowCount).toBeLessThan(p.data.tables.get('fact_visits')!.rowCount)
  })
})

describe('coverage beyond the budget', () => {
  // weekly grain × 2,000 clinics: ~150 weeks × 2,000 = 300,000 pairs, far above a 60,000-row budget
  const { p, res } = generate({ dimRows: 2000, coverageRows: 60_000 }, project({ weekly: true }))
  const cov = res.coverage.find((c) => c.table === 'fact_visits')!

  it('degrades deliberately: recent weeks fully covered, older weeks partly, and says so', () => {
    expect(cov.grain).toBe('week_end')
    // 3/4 of the budget: 22 full weeks (the most recent), the other weeks share 16,000 rows (about 100 clinics each)
    expect(cov.fullPeriods).toBe(22)
    expect(cov.partialPeriods).toBe(cov.periods - 22)
    expect(cov.coveredPairs).toBeLessThan(cov.pairs)
    expect(cov.rows).toBeLessThanOrEqual(60_000)
    const ids = cells(p, 'fact_visits', 'clinic_id')
    const days = cells(p, 'fact_visits', 'visit_date') as Date[]
    const weekOf = (d: Date) => String(calendarValue('week_end', 'dateTime', d, cal) instanceof Date ? (calendarValue('week_end', 'dateTime', d, cal) as Date).getTime() : '')
    const lastWeek = weekOf(TODAY)
    const seen = new Set<string>()
    for (let r = 0; r < ids.length; r++) if (weekOf(days[r]) === lastWeek) seen.add(k(ids[r]))
    expect(seen.size).toBe(2000)
  })

  it('keeps generation fast', () => {
    const t0 = performance.now()
    generate({ dimRows: 2000, coverageRows: 60_000 }, project({ weekly: true }))
    expect(performance.now() - t0).toBeLessThan(5000)
  })
})
