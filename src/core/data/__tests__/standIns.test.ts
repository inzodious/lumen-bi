/**
 * Sample data must leave a report interactive: slicers offer items, picking one cuts the facts, and filters or saved
 * slicer selections pinned to a real name / id (withheld from the data by the privacy rule) read a generated
 * stand-in instead of matching nothing. Invented model: accounts (dimension with a calculated column) ← visits
 * (fact) → calendar, plus a second fact that only covers part of the accounts.
 */
import { describe, expect, it } from 'vitest'
import { emptyDataStore, makeDate, type Scalar } from '../../model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../model/types'
import type { ProjectDocument } from '../../project'
import type { ReportDocument } from '../../report/types'
import type { SQFilter } from '../../report/sq'
import { createEngine } from '../../engine/engine'
import { generateSyntheticData } from '../synthetic'
import { chooseStandIns, literalKey, standInFor, translateFilter, translateFilters } from '../standIns'

const TODAY = makeDate(2026, 11, 17)
const PINNED_NAME = 'Harbor Point Wellness LLC'
const PINNED_CODE = 'HPW-77812'
const PINNED_PART = 'harbor po'

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
const C = (alias: string, column: string) => ({ Column: { Expression: { SourceRef: { Source: alias } }, Property: column } })
const sqIn = (alias: string, entity: string, column: string, literals: string[]): SQFilter => ({
  Version: 2,
  From: [{ Name: alias, Entity: entity, Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [C(alias, column)], Values: literals.map((l) => [{ Literal: { Value: l } }]) } } }]
})
const containsF = (text: string): SQFilter => ({
  Version: 2,
  From: [{ Name: 'a', Entity: 'accounts', Type: 0 }],
  Where: [{ Condition: { Contains: { Left: C('a', 'account_name'), Right: { Literal: { Value: `'${text}'` } } } } }]
})
const slicer = (name: string, entity: string, column: string, filter?: SQFilter) => ({
  name,
  json: {
    name,
    visual: {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: entity } }, Property: column } }, queryRef: `${entity}.${column}` }] } } },
      objects: { data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }], ...(filter ? { general: [{ properties: { filter: { filter } } }] } : {}) }
    }
  }
})

function project(): ProjectDocument {
  const calendar = imported('calendar', [col('date', 'dateTime', { isKey: true }), col('year', 'int64'), col('year_quarter', 'string')], { dataCategory: 'Time' })
  const accounts = imported('accounts', [
    col('account_id', 'string'),
    col('account_name', 'string'),
    col('account_code', 'string'),
    col('segment', 'string'),
    col('active', 'boolean'),
    { name: 'status_label', dataType: 'string', kind: 'calculated', expression: 'IF ( accounts[active] = FALSE (), "Inactive", "Active" )' }
  ])
  const visits = imported('visits', [col('visit_id', 'string'), col('account_id', 'string'), col('visit_date', 'dateTime'), col('amount', 'double')], {
    measures: [{ name: 'Visits', expression: 'COUNTROWS ( visits )' }, { name: 'Amount', expression: 'SUM ( visits[amount] )' }]
  })
  const invoices = imported('invoices', [col('invoice_id', 'string'), col('account_id', 'string'), col('invoice_date', 'dateTime'), col('total', 'double')])
  const model: SemanticModel = {
    name: 'Accounts',
    tables: [calendar, accounts, visits, invoices],
    relationships: [rel('visits.account_id', 'accounts.account_id'), rel('visits.visit_date', 'calendar.date'), rel('invoices.account_id', 'accounts.account_id'), rel('invoices.invoice_date', 'calendar.date')],
    expressions: [],
    roles: []
  }
  const report: ReportDocument = {
    origin: 'pbir',
    report: { filterConfig: { filters: [] } },
    pagesMeta: { pageOrder: ['p1', 'p2'] },
    pages: [
      // page 1: slicers, one saved to a real account name, one saved to a quarter
      { name: 'p1', json: {}, visuals: [slicer('s1', 'accounts', 'account_name', sqIn('a', 'accounts', 'account_name', [`'${PINNED_NAME}'`])), slicer('s2', 'calendar', 'year_quarter', sqIn('c', 'calendar', 'year_quarter', ["'2026-Q3'"])), slicer('s3', 'accounts', 'status_label')] },
      // page 2: a page filter pinned to an account code
      { name: 'p2', json: { filterConfig: { filters: [{ name: 'f1', filter: sqIn('a', 'accounts', 'account_code', [`'${PINNED_CODE}'`]) }] } }, visuals: [] },
      // page 3: a page filter searching account names for part of a real name
      { name: 'p3', json: { filterConfig: { filters: [{ name: 'f2', filter: containsF(PINNED_PART) }] } }, visuals: [] }
    ],
    bookmarks: [],
    theme: {},
    resources: []
  } as unknown as ReportDocument
  return { id: 'acc', name: 'Accounts', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

function values(p: ProjectDocument, table: string, column: string): Scalar[] {
  return p.data.tables.get(table)!.columns.find((x) => x.name === column)!.values
}

function generate(opts: Parameters<typeof generateSyntheticData>[1] = {}) {
  const p = project()
  const res = generateSyntheticData(p, { seed: 3, today: TODAY, factRows: 600, ...opts })
  const engine = createEngine(p.model, p.data)
  engine.processCalculated()
  return { p, res, engine }
}

const nameFilter = () => sqIn('a', 'accounts', 'account_name', [`'${PINNED_NAME}'`])
const amount = (e: ReturnType<typeof createEngine>, filters: SQFilter[]) => Number(e.evaluateScalar('[Amount]', filters).value ?? 0)
const quarter = sqIn('c', 'calendar', 'year_quarter', ["'2026-Q3'"])

describe('sample data stand-ins for pinned names and ids', () => {
  const g = generate()

  it('never copies the pinned literals into the data, but records a generated stand-in for each', () => {
    const all = [...g.p.data.tables.values()].flatMap((t) => t.columns.flatMap((c) => c.values)).map((v) => String(v).toLowerCase())
    expect(all).not.toContain(PINNED_NAME.toLowerCase())
    expect(all).not.toContain(PINNED_CODE.toLowerCase())
    expect(g.res.standIns).toEqual(
      expect.arrayContaining([
        { table: 'accounts', column: 'account_name', literals: 2 },
        { table: 'accounts', column: 'account_code', literals: 1 }
      ])
    )
    // counts only: the result never lists a literal, and the in-memory map keys are opaque
    expect(JSON.stringify(g.res).toLowerCase()).not.toContain('harbor')
    for (const s of g.p.data.literalStandIns ?? []) for (const k of s.values.keys()) expect(k.toLowerCase()).not.toContain('harbor')
    const standIn = standInFor(g.p.data, 'accounts', 'account_name', PINNED_NAME)
    expect(typeof standIn).toBe('string')
    expect(values(g.p, 'accounts', 'account_name')).toContain(standIn)
    // case-insensitive, like Power BI's text comparisons; other literals have none
    expect(standInFor(g.p.data, 'Accounts', 'ACCOUNT_NAME', PINNED_NAME.toUpperCase())).toBe(standIn)
    expect(standInFor(g.p.data, 'accounts', 'account_name', 'Someone Else')).toBeUndefined()
  })

  it('a filter pinned to a withheld name reads the stand-in: the page has data', () => {
    expect(amount(g.engine, [nameFilter()])).toBeGreaterThan(0)
    expect(amount(g.engine, [sqIn('a', 'accounts', 'account_code', [`'${PINNED_CODE}'`])])).toBeGreaterThan(0)
    // …and it is exactly the stand-in's data
    const s = standInFor(g.p.data, 'accounts', 'account_name', PINNED_NAME) as string
    expect(amount(g.engine, [nameFilter()])).toBe(amount(g.engine, [sqIn('a', 'accounts', 'account_name', [`'${s.replace(/'/g, "''")}'`])]))
    expect(amount(g.engine, [nameFilter()])).toBeLessThan(amount(g.engine, []))
  })

  it('a page filter searching a withheld name for a text reads the stand-in value: the page has data', () => {
    const all = values(g.p, 'accounts', 'account_name').map((v) => String(v).toLowerCase())
    expect(all.some((v) => v.includes(PINNED_PART))).toBe(false)
    const s = standInFor(g.p.data, 'accounts', 'account_name', PINNED_PART)
    expect(values(g.p, 'accounts', 'account_name')).toContain(s)
    const t = translateFilter(containsF(PINNED_PART), g.p.data)
    expect(t.translated).toBe(1)
    expect(amount(g.engine, [containsF(PINNED_PART)])).toBeGreaterThan(0)
  })

  it('without the privacy rule (reuse) the real literal is used and no stand-in is recorded', () => {
    const r = generate({ identifyingLiterals: 'reuse' })
    expect(r.res.standIns).toEqual([])
    expect(r.p.data.literalStandIns).toBeUndefined()
    expect(values(r.p, 'accounts', 'account_name')).toContain(PINNED_NAME)
  })

  it('stand-ins go stale when the table is replaced (refresh / regenerate)', () => {
    const h = generate()
    const before = standInFor(h.p.data, 'accounts', 'account_name', PINNED_NAME)
    expect(before).toBeDefined()
    h.p.data.tables.set('accounts', { ...h.p.data.tables.get('accounts')! })
    expect(standInFor(h.p.data, 'accounts', 'account_name', PINNED_NAME)).toBeUndefined()
    // regenerating with another seed records fresh stand-ins for the new rows
    generateSyntheticData(h.p, { seed: 9, today: TODAY, factRows: 600, replace: 'synthetic' })
    const after = standInFor(h.p.data, 'accounts', 'account_name', PINNED_NAME)
    expect(values(h.p, 'accounts', 'account_name')).toContain(after)
    expect(h.p.data.literalStandIns!.filter((s) => s.table === 'accounts' && s.column === 'account_name')).toHaveLength(1)
  })
})

describe('choosing stand-ins', () => {
  it('ranks generated values by weight (fact references), skips literals of the definitions, cycles when short', () => {
    const data = { rowCount: 4, columns: [{ name: 'n', type: 'string' as const, values: ['A', 'B', 'C', 'B'] }] }
    const pick = (lits: Scalar[], avoid?: Set<string>, w?: number[]) => [...chooseStandIns('t', 'n', data, lits, avoid, w)!.values.values()]
    expect(pick(['x'])).toEqual(['B'])
    expect(pick(['x'], undefined, [1, 0, 9, 0])).toEqual(['C'])
    // with fact references: a member at the top decile's edge, not the single busiest; unreferenced members last
    const names = Array.from({ length: 20 }, (_, i) => `M${i}`)
    const weights = names.map((_, i) => (i === 19 ? 1 : 100 - i * 5))
    const many = { rowCount: 20, columns: [{ name: 'n', type: 'string' as const, values: names }] }
    expect([...chooseStandIns('t', 'n', many, ['x', 'y'], undefined, weights)!.values.values()]).toEqual(['M1', 'M0'])
    expect(pick(['x', 'y'], new Set(['sb']))).toEqual(['A', 'C'])
    expect(pick(['x', 'y', 'z', 'w'])).toEqual(['B', 'A', 'C', 'B'])
    expect(chooseStandIns('t', 'n', { rowCount: 1, columns: [{ name: 'n', type: 'string', values: [null] }] }, ['x'])).toBeUndefined()
  })
})

describe('translating SQ filters', () => {
  const g = generate()
  const s = standInFor(g.p.data, 'accounts', 'account_name', PINNED_NAME) as string

  it('rewrites In values and comparisons against the pinned column (aliases, entities, Not, And), nothing else', () => {
    const lit = (v: string) => ({ Literal: { Value: v } })
    const enc = `'${s.replace(/'/g, "''")}'`
    const r = translateFilter(nameFilter(), g.p.data)
    expect(r.translated).toBe(1)
    expect(r.filter.Where[0].Condition.In.Values).toEqual([[lit(enc)]])
    const cmp: SQFilter = {
      From: [{ Name: 'x', Entity: 'accounts', Type: 0 }],
      Where: [
        {
          Condition: {
            Not: {
              Expression: {
                And: {
                  Left: { Comparison: { ComparisonKind: 0, Left: C('x', 'account_name'), Right: lit(`'${PINNED_NAME.toLowerCase()}'`) } },
                  Right: { Comparison: { ComparisonKind: 0, Left: C('x', 'segment'), Right: lit("'Enterprise'") } }
                }
              }
            }
          }
        }
      ]
    }
    const t = translateFilter(cmp, g.p.data)
    expect(t.translated).toBe(1)
    const and = t.filter.Where[0].Condition.Not.Expression.And
    expect(and.Left.Comparison.Right).toEqual(lit(enc))
    expect(and.Right.Comparison.Right).toEqual(lit("'Enterprise'"))
    // the input is never mutated; untouched filters are returned as they are
    expect(cmp.Where[0].Condition.Not.Expression.And.Left.Comparison.Right).toEqual(lit(`'${PINNED_NAME.toLowerCase()}'`))
    const other = [sqIn('a', 'accounts', 'segment', ["'Enterprise'"])]
    expect(translateFilters(other, g.p.data).filters).toBe(other)
    expect(translateFilters([nameFilter()], emptyDataStore()).translated).toBe(0)
    expect(literalKey('ABC')).toBe(literalKey('abc'))
  })
})

describe('slicers on sample data are interactive', () => {
  const g = generate()
  const items = (table: string, column: string, filters: SQFilter[]) => g.engine.distinctValues({ column: { table, column }, filters }).values

  it('a dimension slicer (also a calculated column) keeps its items under a quarter selection on another slicer', () => {
    // Power BI: the calendar does not filter accounts; another fact that misses some accounts in that quarter must not empty the list
    const all = items('accounts', 'account_name', [])
    expect(items('accounts', 'account_name', [quarter])).toEqual(all)
    expect(items('accounts', 'status_label', [quarter]).sort()).toEqual(['Active', 'Inactive'])
  })

  it('picking an item cuts the facts to a non-empty, smaller result; keys are referentially consistent', () => {
    const ids = new Set(values(g.p, 'accounts', 'account_id'))
    expect(values(g.p, 'visits', 'account_id').every((v) => ids.has(v))).toBe(true)
    expect(values(g.p, 'invoices', 'account_id').every((v) => ids.has(v))).toBe(true)
    const total = amount(g.engine, [quarter])
    expect(total).toBeGreaterThan(0)
    const pick = (column: string, v: string) => amount(g.engine, [quarter, sqIn('a', 'accounts', column, [`'${v.replace(/'/g, "''")}'`])])
    const active = pick('status_label', 'Active')
    expect(active).toBeGreaterThan(0)
    expect(active).toBeLessThan(total)
    // the busiest account has visits in that quarter
    const top = g.engine.runDaxQuery('EVALUATE TOPN ( 1, SUMMARIZECOLUMNS ( accounts[account_name], "n", [Visits] ), [n], DESC )').tables[0].rows[0][0] as string
    const one = pick('account_name', top)
    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThan(total)
  })
})
