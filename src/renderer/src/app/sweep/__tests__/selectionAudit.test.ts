/**
 * Selection audit (sweep --selections): each slicer's items applied one at a time on the page's saved state; visuals
 * that had rows and lose them are counted. Invented model: members ← events → calendar, a quarter slicer saved to a
 * quarter, a member slicer and a table of members with a measure (blank-measure rows are dropped).
 */
import { describe, expect, it } from 'vitest'
import { emptyDataStore, makeDate } from '@core/model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '@core/model/types'
import type { ProjectDocument } from '@core/project'
import type { ReportDocument } from '@core/report/types'
import { createEngine } from '@core/engine/engine'
import { generateSyntheticData } from '@core/data/synthetic'
import { auditPageSelections, checkEntityVisuals, entityVisuals, pickItems } from '../selectionAudit'

const col = (name: string, dataType: DataType): ColumnDef => ({ name, dataType, kind: 'data', sourceColumn: name })
const imported = (name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef => ({
  name,
  columns,
  measures: [],
  hierarchies: [],
  partitions: [{ name, sourceType: 'm', expression: `let Source = Sql.Database("server", "db"), T = Source{[Schema="dbo",Item="${name}"]}[Data] in T` }],
  ...extra
})
const rel = (from: string, to: string): RelationshipDef => {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return { name: `${from}->${to}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
}
const field = (entity: string, column: string) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: column } })
const savedIn = (entity: string, column: string, literal: string) => ({
  Version: 2,
  From: [{ Name: 'x', Entity: entity, Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'x' } }, Property: column } }], Values: [[{ Literal: { Value: literal } }]] } } }]
})
const slicer = (name: string, entity: string, column: string, filter?: object) => ({
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

function project(): ProjectDocument {
  const model: SemanticModel = {
    name: 'Members',
    tables: [
      imported('calendar', [col('date', 'dateTime'), col('year_quarter', 'string')], { dataCategory: 'Time' }),
      imported('dim_member', [col('member_id', 'string'), col('member_name', 'string')]),
      imported('fact_events', [col('event_id', 'string'), col('member_id', 'string'), col('event_date', 'dateTime'), col('amount', 'double')], {
        measures: [{ name: 'Amount', expression: 'SUM ( fact_events[amount] )' }]
      })
    ],
    relationships: [rel('fact_events.member_id', 'dim_member.member_id'), rel('fact_events.event_date', 'calendar.date')],
    expressions: [],
    roles: []
  }
  const report = {
    origin: 'pbir',
    report: {},
    pagesMeta: { pageOrder: ['p1'] },
    pages: [
      {
        name: 'p1',
        json: {},
        visuals: [
          slicer('quarter', 'calendar', 'year_quarter', savedIn('calendar', 'year_quarter', "'2025-Q3'")),
          slicer('member', 'dim_member', 'member_name'),
          {
            name: 'table',
            json: {
              name: 'table',
              visual: {
                visualType: 'tableEx',
                query: { queryState: { Values: { projections: [{ field: field('dim_member', 'member_name'), queryRef: 'm' }, { field: { Measure: { Expression: { SourceRef: { Entity: 'fact_events' } }, Property: 'Amount' } }, queryRef: 'a' }] } } }
              }
            }
          }
        ]
      }
    ],
    bookmarks: [],
    theme: {},
    resources: {}
  } as unknown as ReportDocument
  return { id: 'm', name: 'Members', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

function audit(coverageRows?: number) {
  const p = project()
  generateSyntheticData(p, { seed: 42, today: makeDate(2026, 11, 17), factRows: 1500, dimRows: 300, coverageRows })
  const engine = createEngine(p.model, p.data)
  engine.processCalculated()
  return auditPageSelections(engine, p.report!, p.report!.pages[0], { seed: 7, randomPicks: 6 })
}

describe('selection audit', () => {
  it('picks first, middle, last and seeded items deterministically (all of a short list)', () => {
    expect(pickItems(5, 'k', 1)).toEqual([0, 1, 2, 3, 4])
    const a = pickItems(300, 'k', 1)
    expect(a).toEqual(pickItems(300, 'k', 1))
    expect(a).toEqual(expect.arrayContaining([0, 149, 299]))
    expect(a.length).toBe(6)
    expect(pickItems(300, 'k', 2)).not.toEqual(a)
  })

  it('counts visuals emptied by a selection on sparse data, none on dense sample data', () => {
    const sparse = audit(0)
    expect(sparse.slicers).toBe(2)
    expect(sparse.withData).toBe(3)
    expect(sparse.emptied).toBeGreaterThan(0)
    expect(sparse.trials.every((t) => t.slicer === 'member' && t.emptied.includes('table'))).toBe(true)
    const dense = audit()
    // the member picks keep the table populated; only quarters after today (no events yet) may empty it
    expect(dense.trials.filter((t) => t.slicer === 'member')).toEqual([])
    expect(dense.selections).toBe(sparse.selections)
  })
})

/**
 * Exhaustive entity check: a table grouped by the member dimension, with a measure that only counts members whose
 * (never shown) flag holds a literal, must list every member the member slicer offers, and keep its row when each is
 * selected alone. The check itself must notice when the data breaks that.
 */
function flagged(): ProjectDocument {
  const p = project()
  const members = p.model.tables.find((t) => t.name === 'dim_member')!
  members.columns.push(col('counted_flag', 'string'))
  p.model.tables.find((t) => t.name === 'fact_events')!.measures.push({
    name: 'Counted amount',
    expression: 'CALCULATE ( SUM ( fact_events[amount] ), FILTER ( dim_member, dim_member[counted_flag] = "count_me" ) )'
  })
  const page = p.report!.pages[0]
  const t = page.visuals.find((v) => v.name === 'table')!
  t.json.visual.query.queryState.Values.projections[1] = { field: { Measure: { Expression: { SourceRef: { Entity: 'fact_events' } }, Property: 'Counted amount' } }, queryRef: 'c' }
  return p
}

describe('entity check', () => {
  it('finds the entity-level table and its member slicer', () => {
    const p = flagged()
    generateSyntheticData(p, { seed: 42, today: makeDate(2026, 11, 17), factRows: 1500, dimRows: 300 })
    const engine = createEngine(p.model, p.data)
    engine.processCalculated()
    const ev = entityVisuals(engine, p.report!.pages[0])
    expect(ev.map((e) => [e.visual.name, e.dimension, e.slicers.map((s) => s.slicer.name)])).toEqual([['table', 'dim_member', ['member']]])
  })

  it('every member the slicer offers is listed and keeps its row alone (flag-conditioned measure)', () => {
    const p = flagged()
    generateSyntheticData(p, { seed: 42, today: makeDate(2026, 11, 17), factRows: 1500, dimRows: 300 })
    const engine = createEngine(p.model, p.data)
    engine.processCalculated()
    const [c] = checkEntityVisuals(engine, p.report!, p.report!.pages[0])
    expect(c.offered).toBe(300)
    expect(c.listed).toBe(c.offered)
    expect(c.listedAll).toBe(c.offeredAll)
    expect(c.singles).toBe(300)
    expect(c.emptying).toBe(0)
  })

  it('fails on a deliberately broken model', () => {
    const p = flagged()
    generateSyntheticData(p, { seed: 42, today: makeDate(2026, 11, 17), factRows: 1500, dimRows: 300 })
    // break it: a third of the members lose the flag the measure filters on
    const flag = p.data.tables.get('dim_member')!.columns.find((c) => c.name === 'counted_flag')!
    flag.values = flag.values.map((v, i) => (i % 3 === 0 ? 'other' : v))
    const engine = createEngine(p.model, p.data)
    engine.processCalculated()
    const [c] = checkEntityVisuals(engine, p.report!, p.report!.pages[0], { cap: 60 })
    expect(c.offered).toBe(300)
    expect(c.listed).toBe(200)
    expect(c.singles).toBe(60)
    expect(c.capped).toBe(true)
    expect(c.emptying).toBeGreaterThanOrEqual(15)
    expect(c.examples.length).toBeGreaterThan(0)
  })
})
