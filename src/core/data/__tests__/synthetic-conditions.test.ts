/**
 * Condition-aware sample data: the miner records how each literal is used (operator, polarity, site), the generator
 * decides each column's distribution from all the conditions on it, and the report's own logic holds for (nearly) every
 * member. Invented models only: accounts (dimension) ← visits (fact) → calendar.
 */
import { describe, expect, it } from 'vitest'
import { emptyDataStore, makeDate, type Scalar } from '../../model/data'
import type { ColumnDef, DataType, MeasureDef, RelationshipDef, SemanticModel, TableDef } from '../../model/types'
import type { ProjectDocument } from '../../project'
import type { ReportDocument } from '../../report/types'
import type { SQFilter } from '../../report/sq'
import { generateSyntheticData, mineModel, type SyntheticOptions } from '../synthetic'
import { columnWidths, decideColumns, entityMeasures, idWriter, isSentinel, shapeOf, surfacedColumns } from '../synthetic-conditions'
import { standInFor } from '../standIns'

const TODAY = makeDate(2026, 11, 17)

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}
function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: `let Source = Sql.Database("server", "db"), T = Source{[Schema="dbo",Item="${name}"]}[Data] in T` }], ...extra }
}
function rel(from: string, to: string): RelationshipDef {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name: `${from}->${to}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
}
const field = (entity: string, column: string) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: column } })
const measureField = (entity: string, name: string) => ({ Measure: { Expression: { SourceRef: { Entity: entity } }, Property: name } })
const C = (alias: string, column: string) => ({ Column: { Expression: { SourceRef: { Source: alias } }, Property: column } })
const sqIn = (entity: string, column: string, literals: string[], not = false): SQFilter => {
  const cond = { In: { Expressions: [C('x', column)], Values: literals.map((l) => [{ Literal: { Value: l } }]) } }
  return { Version: 2, From: [{ Name: 'x', Entity: entity, Type: 0 }], Where: [{ Condition: not ? { Not: { Expression: cond } } : cond }] }
}
const slicer = (name: string, entity: string, column: string, filter?: SQFilter) => ({
  name,
  json: {
    name,
    visual: {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ field: field(entity, column), queryRef: `${entity}.${column}` }] } } },
      objects: { data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }], ...(filter ? { general: [{ properties: { filter: { filter } } }] } : {}) }
    }
  }
})
const table = (name: string, columns: Array<[string, string]>, measures: Array<[string, string]>, extra: { filters?: SQFilter[]; widths?: Record<string, number> } = {}) => ({
  name,
  json: {
    name,
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: {
          Values: {
            projections: [
              ...columns.map(([e, c]) => ({ field: field(e, c), queryRef: `${e}.${c}` })),
              ...measures.map(([e, m]) => ({ field: measureField(e, m), queryRef: `${e}.${m}` }))
            ]
          }
        }
      },
      ...(extra.widths
        ? { objects: { columnWidth: Object.entries(extra.widths).map(([ref, px]) => ({ properties: { value: { expr: { Literal: { Value: `${px}D` } } } }, selector: { metadata: ref } })) } }
        : {})
    },
    ...(extra.filters ? { filterConfig: { filters: extra.filters.map((f, i) => ({ name: `f${i}`, field: { Column: f.Where[0].Condition.In?.Expressions?.[0]?.Column ?? f.Where[0].Condition.Not.Expression.In.Expressions[0].Column }, type: 'Categorical', filter: f })) } } : {})
  }
})

interface Spec {
  accountCols?: ColumnDef[]
  visitCols?: ColumnDef[]
  measures: MeasureDef[]
  visuals?: Array<{ name: string; json: any }>
  pageFilters?: SQFilter[]
}

function project(spec: Spec): ProjectDocument {
  const model: SemanticModel = {
    name: 'Accounts',
    tables: [
      imported('calendar', [col('date', 'dateTime', { isKey: true }), col('year_quarter', 'string')], { dataCategory: 'Time' }),
      imported('accounts', [col('account_id', 'string'), col('account_name', 'string'), col('segment', 'string'), ...(spec.accountCols ?? [])]),
      imported('visits', [col('visit_id', 'string'), col('account_id', 'string'), col('visit_date', 'dateTime'), col('minutes', 'double'), ...(spec.visitCols ?? [])], { measures: spec.measures })
    ],
    relationships: [rel('visits.account_id', 'accounts.account_id'), rel('visits.visit_date', 'calendar.date')],
    expressions: [],
    roles: []
  }
  const report = {
    origin: 'pbir',
    report: {},
    pagesMeta: { pageOrder: ['p1'] },
    pages: [{ name: 'p1', json: spec.pageFilters ? { filterConfig: { filters: spec.pageFilters.map((f, i) => ({ name: `pf${i}`, field: { Column: f.Where[0].Condition.In?.Expressions?.[0]?.Column ?? f.Where[0].Condition.Not.Expression.In.Expressions[0].Column }, filter: f })) } } : {}, visuals: spec.visuals ?? [] }],
    bookmarks: [],
    theme: {},
    resources: {}
  } as unknown as ReportDocument
  return { id: 'a', name: 'Accounts', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

const OPTS: SyntheticOptions = { seed: 42, today: TODAY, factRows: 3000, dimRows: 200 }
function values(p: ProjectDocument, t: string, c: string): Scalar[] {
  return p.data.tables.get(t)!.columns.find((x) => x.name === c)!.values
}
function share(vs: Scalar[], v: Scalar): number {
  return vs.filter((x) => x === v).length / vs.length
}

describe('mining conditions with polarity and site', () => {
  it('records operator, polarity, site and use through variables and wrappers', () => {
    const p = project({
      accountCols: [col('tier', 'string'), col('region', 'string'), col('notes_flag', 'string')],
      visitCols: [col('channel', 'string'), col('status', 'string')],
      measures: [
        { name: 'Web', expression: 'CALCULATE ( SUM ( visits[minutes] ), KEEPFILTERS ( visits[channel] = "Web" ) )' },
        { name: 'Not phone', expression: 'VAR c = visits[channel] <> "Phone" RETURN CALCULATE ( COUNTROWS ( visits ), FILTER ( visits, c ) )' },
        { name: 'Open', expression: 'CALCULATE ( COUNTROWS ( visits ), NOT ( visits[status] IN { "Closed", "Void" } ) )' },
        { name: 'Gold', expression: 'CALCULATE ( COUNTROWS ( visits ), TREATAS ( { "Gold" }, accounts[tier] ) )' },
        { name: 'Label', expression: 'IF ( SELECTEDVALUE ( accounts[region] ) = "North", "N", SWITCH ( TRUE (), ISBLANK ( SELECTEDVALUE ( accounts[region] ) ), "-", "other" ) )' },
        { name: 'Long', expression: 'CALCULATE ( COUNTROWS ( visits ), visits[minutes] >= 30, NOT ISBLANK ( visits[status] ) )' }
      ],
      visuals: [slicer('s1', 'accounts', 'segment', sqIn('accounts', 'segment', ["'Retail'"]))],
      pageFilters: [sqIn('accounts', 'tier', ["'Trial'"], true)]
    })
    const conds = mineModel(p).conditions
    const find = (column: string, f: (c: (typeof conds)[number]) => boolean) => conds.filter((c) => c.column === column && f(c))
    expect(find('channel', (c) => c.op === '=' && c.polarity === 'positive' && c.use === 'filter' && c.site === 'measure' && c.source === 'Web')).toHaveLength(1)
    // traced through the variable: a negative filter condition
    expect(find('channel', (c) => c.polarity === 'negative' && c.use === 'filter' && c.source === 'Not phone' && c.values[0] === 'Phone')).toHaveLength(1)
    expect(find('status', (c) => c.op === 'IN' && c.polarity === 'negative' && c.use === 'filter')[0].values).toEqual(['Closed', 'Void'])
    expect(find('status', (c) => c.op === 'ISBLANK' && c.polarity === 'negative' && c.use === 'filter')).toHaveLength(1)
    expect(find('minutes', (c) => c.op === '>=' && c.values[0] === 30)).toHaveLength(1)
    expect(find('tier', (c) => c.site === 'measure' && c.polarity === 'positive' && c.values[0] === 'Gold')).toHaveLength(1)
    // report: an exclude filter card and a slicer's saved selection
    expect(find('tier', (c) => c.site === 'filter' && c.polarity === 'negative' && c.values[0] === 'Trial')).toHaveLength(1)
    expect(find('segment', (c) => c.site === 'slicer' && c.polarity === 'positive' && c.use === 'filter')).toHaveLength(1)
    // branch conditions are tests
    expect(find('region', (c) => c.op === '=' && c.use === 'test' && c.values[0] === 'North')).toHaveLength(1)
    expect(find('region', (c) => c.op === 'ISBLANK' && c.use === 'test')).toHaveLength(1)
  })

  it('knows which columns the report shows and which measures entity-level tables use', () => {
    const p = project({
      accountCols: [col('is_counted', 'string')],
      measures: [
        { name: 'Base', expression: 'CALCULATE ( SUM ( visits[minutes] ), FILTER ( accounts, accounts[is_counted] = "Y" ) )' },
        { name: 'Shown', expression: '[Base] * 1' },
        { name: 'Other', expression: 'COUNTROWS ( visits )' }
      ],
      visuals: [slicer('s', 'accounts', 'account_name'), table('t', [['accounts', 'account_name'], ['accounts', 'segment']], [['visits', 'Shown']], { widths: { 'accounts.segment': 61 } })]
    })
    const shown = surfacedColumns(p)!
    expect(shown.has('accounts[account_name]')).toBe(true)
    expect(shown.has('accounts[segment]')).toBe(true)
    expect(shown.has('visits[account_id]')).toBe(true) // relationship key
    expect(shown.has('accounts[is_counted]')).toBe(false)
    expect([...entityMeasures(p)].sort()).toEqual(['base', 'shown'])
    expect(columnWidths(p).get('accounts[segment]')).toBe(61)
  })
})

describe('distributions decided from the conditions', () => {
  it('a flag only DAX filters on is free: every row satisfies it', () => {
    const p = project({
      accountCols: [col('is_counted', 'string')],
      measures: [{ name: 'Counted', expression: 'CALCULATE ( SUM ( visits[minutes] ), FILTER ( accounts, accounts[is_counted] = "keep_row" ) )' }],
      visuals: [slicer('s', 'accounts', 'account_name'), table('t', [['accounts', 'account_name']], [['visits', 'Counted']])]
    })
    const r = generateSyntheticData(p, OPTS)
    const d = r.decisions.find((x) => x.column === 'is_counted')!
    expect(d).toMatchObject({ rule: 'all-rows', surfaced: false })
    expect(values(p, 'accounts', 'is_counted').every((v) => v === 'keep_row')).toBe(true)
  })

  it('a shown column keeps a spread, the literal measures need dominates', () => {
    const p = project({
      accountCols: [col('status', 'string')],
      measures: [{ name: 'Active minutes', expression: 'CALCULATE ( SUM ( visits[minutes] ), accounts[status] = "Active" )' }],
      visuals: [slicer('s', 'accounts', 'status'), table('t', [['accounts', 'account_name']], [['visits', 'Active minutes']])]
    })
    const r = generateSyntheticData(p, OPTS)
    expect(r.decisions.find((x) => x.column === 'status')).toMatchObject({ rule: 'dominant', surfaced: true })
    const s = share(values(p, 'accounts', 'status'), 'Active')
    expect(s).toBeGreaterThan(0.75)
    expect(s).toBeLessThan(0.95)
    expect(new Set(values(p, 'accounts', 'status')).size).toBeGreaterThan(1)
  })

  it('a measure that needs a literal a report filter excludes: both keep data', () => {
    const p = project({
      accountCols: [col('status', 'string')],
      measures: [{ name: 'Active minutes', expression: 'CALCULATE ( SUM ( visits[minutes] ), accounts[status] = "Active" )' }],
      visuals: [slicer('s', 'accounts', 'status'), table('t', [['accounts', 'account_name']], [['visits', 'Active minutes']])],
      pageFilters: [sqIn('accounts', 'status', ["'Active'"], true)]
    })
    const r = generateSyntheticData(p, OPTS)
    expect(r.decisions.find((x) => x.column === 'status')).toMatchObject({ rule: 'balanced' })
    const s = share(values(p, 'accounts', 'status'), 'Active')
    expect(s).toBeGreaterThan(0.45)
    expect(s).toBeLessThan(0.75)
  })

  it('two measures needing different values split the rows, weighted towards the entity-level measure', () => {
    const p = project({
      visitCols: [col('outcome', 'string')],
      measures: [
        { name: 'Resolved', expression: 'CALCULATE ( COUNTROWS ( visits ), visits[outcome] = "Resolved" )' },
        { name: 'Escalated', expression: 'CALCULATE ( COUNTROWS ( visits ), visits[outcome] = "Escalated" )' }
      ],
      visuals: [slicer('s', 'accounts', 'account_name'), table('t', [['accounts', 'account_name']], [['visits', 'Resolved']])]
    })
    const r = generateSyntheticData(p, OPTS)
    const d = r.decisions.find((x) => x.column === 'outcome')!
    expect(d.rule).toBe('split')
    const v = values(p, 'visits', 'outcome')
    const res = share(v, 'Resolved')
    const esc = share(v, 'Escalated')
    expect(esc).toBeGreaterThan(0.1)
    expect(res).toBeGreaterThan(esc)
    expect(res + esc).toBeGreaterThan(0.95)
  })

  it('negative-only literals and sentinels are absent or rare, never the common value', () => {
    const p = project({
      accountCols: [col('display_label', 'string'), col('kind', 'string')],
      measures: [
        { name: 'Real', expression: 'CALCULATE ( COUNTROWS ( visits ), accounts[kind] <> "Test", accounts[kind] <> "Internal" )' },
        { name: 'Label', expression: 'IF ( LOWER ( SELECTEDVALUE ( accounts[display_label] ) ) IN { "none", "null", "nan" }, "-", SELECTEDVALUE ( accounts[display_label] ) )' }
      ],
      visuals: [table('t', [['accounts', 'account_name'], ['accounts', 'display_label'], ['accounts', 'kind']], [['visits', 'Real']])]
    })
    generateSyntheticData(p, OPTS)
    const labels = values(p, 'accounts', 'display_label')
    const sentinels = labels.filter((v) => typeof v === 'string' && isSentinel(v)).length / labels.length
    expect(sentinels).toBeLessThan(0.06)
    const kinds = values(p, 'accounts', 'kind')
    expect(share(kinds, 'Test') + share(kinds, 'Internal')).toBeLessThan(0.06)
    expect(isSentinel('N/A')).toBe(true)
    expect(isSentinel('(Blank)')).toBe(true)
    expect(isSentinel('Active')).toBe(false)
  })

  it('the stand-in of a withheld name is a member the measures do not exclude', () => {
    const p = project({
      accountCols: [col('status', 'string')],
      measures: [{ name: 'Active minutes', expression: 'CALCULATE ( SUM ( visits[minutes] ), accounts[status] = "Active" )' }],
      visuals: [
        slicer('s', 'accounts', 'account_name', sqIn('accounts', 'account_name', ["'Harbor Point Wellness LLC'"])),
        slicer('st', 'accounts', 'status'),
        table('t', [['accounts', 'segment']], [['visits', 'Active minutes']])
      ]
    })
    generateSyntheticData(p, { ...OPTS, identifyingLiterals: 'never' })
    expect(values(p, 'accounts', 'account_name')).not.toContain('Harbor Point Wellness LLC')
    const s = standInFor(p.data, 'accounts', 'account_name', 'Harbor Point Wellness LLC')
    const names = values(p, 'accounts', 'account_name')
    const status = values(p, 'accounts', 'status')
    const rows = names.map((n, i) => (n === s ? status[i] : undefined)).filter((x) => x !== undefined)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((x) => x === 'Active')).toBe(true)
  })

  it('is deterministic per seed', () => {
    const make = () =>
      project({
        accountCols: [col('status', 'string'), col('is_counted', 'boolean')],
        measures: [{ name: 'M', expression: 'CALCULATE ( SUM ( visits[minutes] ), accounts[status] = "Active", accounts[is_counted] = TRUE () )' }],
        visuals: [slicer('s', 'accounts', 'status'), table('t', [['accounts', 'account_name']], [['visits', 'M']])]
      })
    const a = make()
    const b = make()
    const ra = generateSyntheticData(a, OPTS)
    const rb = generateSyntheticData(b, OPTS)
    expect(ra.decisions).toEqual(rb.decisions)
    expect(values(a, 'accounts', 'status')).toEqual(values(b, 'accounts', 'status'))
    expect(values(a, 'accounts', 'is_counted').every((v) => v === true)).toBe(true)
    const direct = decideColumns(a, mineModel(a).conditions)
    expect([...direct.values()].map((d) => d.rule).sort()).toEqual(['all-rows', 'dominant'])
  })
})

describe('id-like and code columns', () => {
  it('sizes ids to the name, the width and the shape of mined literals', () => {
    // a number-like name: short digit strings of one length
    const num = idWriter({ names: ['system_number'], prefix: 'acc', count: 300, salt: 1 })
    expect(num(1)).toMatch(/^\d{4}$/)
    expect(num(300)).toHaveLength(num(1).length)
    // a narrow column: digits that fit
    const narrow = idWriter({ names: ['account'], prefix: 'acc', count: 300, widthPx: 47, salt: 1 })
    expect(narrow(1).length).toBeLessThanOrEqual(5)
    const wide = idWriter({ names: ['account'], prefix: 'acc', count: 300, salt: 1 })
    expect(wide(7)).toBe('ACC-0007')
    // the shape of a literal (never its letters): two capitals, a dash, five digits
    const shaped = idWriter({ names: ['member_code'], prefix: 'mem', count: 50, literals: ['HP-77812'], salt: 3 })
    expect(shapeOf(shaped(12))).toBe('AA-99999')
    expect(shaped(12)).not.toContain('HP')
    expect(shaped(12).endsWith('00012')).toBe(true)
  })

  it('generated keys and codes follow those rules in a model', () => {
    const p = project({
      accountCols: [col('system_number', 'string')],
      measures: [],
      visuals: [table('t', [['accounts', 'account_name'], ['accounts', 'system_number']], [], { widths: { 'accounts.system_number': 47 } })]
    })
    generateSyntheticData(p, OPTS)
    for (const v of values(p, 'accounts', 'system_number')) expect(String(v)).toMatch(/^\d{3,5}$/)
    for (const v of values(p, 'accounts', 'account_id')) expect(String(v)).toMatch(/^\d+$/)
  })
})
