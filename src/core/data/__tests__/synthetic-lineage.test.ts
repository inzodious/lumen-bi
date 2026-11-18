import { describe, expect, it } from 'vitest'
import type { ColumnDef, DataType, SemanticModel, TableDef } from '../../model/types'
import { calculatedTableLineage, modelLineage } from '../synthetic-lineage'
import { domainKey, mineModel } from '../synthetic-mine'

function col(name: string, dataType: DataType = 'string', extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}
function imported(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: 'let Source = #table({}, {}) in Source' }], ...extra }
}
/** Calculated table whose model columns carry no declared type (as Power BI writes inferred ones). */
function calculated(name: string, expression: string, columns: string[], extra: Partial<TableDef> = {}): TableDef {
  return {
    name,
    columns: columns.map((c) => ({ name: c, dataType: 'unknown', kind: 'calculatedTableColumn', sourceColumn: `[${c}]` })),
    measures: [],
    hierarchies: [],
    partitions: [{ name, sourceType: 'calculated', expression }],
    ...extra
  }
}
function model(tables: TableDef[], extra: Partial<SemanticModel> = {}): SemanticModel {
  return { name: 'm', tables, relationships: [], expressions: [], roles: [], ...extra }
}

const web = imported('Web Orders', [col('order_no'), col('customer_key'), col('placed', 'dateTime'), col('score', 'int64'), col('state')])
const store = imported('Store Orders', [col('ticket'), col('cust'), col('sold_on', 'dateTime'), col('stars', 'int64')])

const UNION = `
UNION (
    SELECTCOLUMNS ( 'Web Orders', "id", 'Web Orders'[order_no], "key", 'Web Orders'[customer_key], "day", 'Web Orders'[placed], "channel", "Web", "score", 'Web Orders'[score], "state", [state] ),
    SELECTCOLUMNS ( 'Store Orders', "id", "n/a", "key", 'Store Orders'[cust], "day", 'Store Orders'[sold_on], "channel", "Store", "score", 'Store Orders'[stars] * 2, "state", BLANK () )
)`

describe('calculated-table lineage', () => {
  it('traces a UNION of SELECTCOLUMNS to its source columns, constants and scaled columns', () => {
    const combined = calculated('Orders', UNION, ['id', 'key', 'day', 'channel', 'score', 'state'])
    const branches = calculatedTableLineage(combined, model([web, store, combined]))!
    expect(branches.map((b) => b.table)).toEqual(['Web Orders', 'Store Orders'])
    const [w, s] = branches
    expect(w.columns.get('key')).toEqual({ source: 'customer_key' })
    expect(w.columns.get('channel')).toEqual({ isConstant: true, constant: 'Web' })
    expect(w.columns.get('state')).toEqual({ source: 'state' })
    // positions decide in a UNION: the second table's columns take the first table's names
    expect(s.columns.get('key')).toEqual({ source: 'cust' })
    expect(s.columns.get('day')).toEqual({ source: 'sold_on' })
    expect(s.columns.get('id')).toEqual({ isConstant: true, constant: 'n/a' })
    expect(s.columns.get('score')).toEqual({ source: 'stars', scale: 2 })
    expect(s.columns.get('state')).toEqual({ isConstant: true, constant: null })
  })

  it('follows VAR / RETURN, FILTER, ADDCOLUMNS, DISTINCT, a bare table reference and nested calculated tables', () => {
    const recent = calculated('Recent', "VAR _t = FILTER ( 'Web Orders', 'Web Orders'[score] >= 3 ) RETURN ADDCOLUMNS ( _t, \"twice\", 'Web Orders'[score] * 2, \"label\", \"x\" & [state] )", ['order_no', 'customer_key', 'placed', 'score', 'state', 'twice', 'label'])
    const states = calculated('States', "DISTINCT ( 'Web Orders'[state] )", ['state'])
    const copy = { ...calculated('Copy', "'Web Orders'", []), columns: web.columns.map((c) => ({ ...c, kind: 'calculatedTableColumn' as const, dataType: 'unknown' as const, sourceColumn: `Web Orders[${c.name}]` })) }
    const nested = calculated('Nested', 'SELECTCOLUMNS ( Recent, "k", Recent[customer_key], "t", Recent[twice] )', ['k', 't'])
    const all = modelLineage(model([web, store, recent, states, copy, nested]))
    expect(all.get('recent')![0].columns.get('twice')).toEqual({ source: 'score', scale: 2 })
    expect(all.get('recent')![0].columns.get('label')).toEqual({}) // computed: cannot be traced
    expect(all.get('recent')![0].columns.get('customer_key')).toEqual({ source: 'customer_key' })
    expect([...all.get('states')![0].columns]).toEqual([['state', { source: 'state' }]])
    expect(all.get('copy')![0].columns.get('placed')).toEqual({ source: 'placed' })
    expect(all.get('nested')![0]).toMatchObject({ table: 'Web Orders' })
    expect(all.get('nested')![0].columns.get('k')).toEqual({ source: 'customer_key' })
    expect(all.get('nested')![0].columns.get('t')).toEqual({ source: 'score', scale: 2 })
  })

  it('leaves what it cannot trace alone: literal tables, field parameters, joins, imported tables', () => {
    const literal = calculated('Stages', 'DATATABLE ( "stage", STRING, { { "Open" }, { "Won" } } )', ['stage'])
    const params = calculated('Pick', "{ ( \"Score\", NAMEOF ( 'Web Orders'[score] ), 0 ) }", ['Pick', 'Pick Fields', 'Pick Order'])
    const joined = calculated('Joined', "NATURALLEFTOUTERJOIN ( 'Web Orders', 'Store Orders' )", ['order_no'])
    const m = model([web, store, literal, params, joined])
    expect(modelLineage(m).size).toBe(0)
    expect(calculatedTableLineage(web, m)).toBeUndefined()
  })
})

describe('mined values follow the lineage', () => {
  const combined = calculated('Orders', UNION, ['id', 'key', 'day', 'channel', 'score', 'state'], {
    measures: [
      { name: 'Web Top', expression: 'CALCULATE ( COUNTROWS ( Orders ), Orders[channel] = "Web", Orders[state] = "WA" )' },
      { name: 'Store Top', expression: 'CALCULATE ( COUNTROWS ( Orders ), Orders[channel] = "Store", Orders[score] = 10 )' },
      { name: 'Odd', expression: 'CALCULATE ( COUNTROWS ( Orders ), Orders[score] = 7 )' }
    ]
  })
  const mined = mineModel({ model: model([web, store, combined]), report: undefined })

  it('copies a domain to every source column, undoing a constant factor', () => {
    expect(mined.domains.get(domainKey('Web Orders', 'state'))?.values).toEqual(['WA'])
    expect(mined.domains.get(domainKey('Web Orders', 'score'))?.values).toEqual([10, 7])
    // stars * 2 = 10 → stars = 5; 7 is not reachable on the doubled whole-number scale
    expect(mined.domains.get(domainKey('Store Orders', 'stars'))?.values).toEqual([5])
    expect(mined.domains.has(domainKey('Store Orders', 'ticket'))).toBe(false)
  })

  it('rewrites conjunctions per branch: a constant column selects the branch', () => {
    const keys = mined.conjunctions.map((c) => c.conds.map((x) => `${x.table}[${x.column}]=${x.values.join('|')}`).join(' & '))
    expect(keys).toContain('Web Orders[state]=WA')
    expect(keys).toContain('Store Orders[stars]=5')
    // the Web branch never satisfies channel = "Store", so its score is not tied to that measure
    expect(keys).not.toContain('Web Orders[score]=10')
    expect(keys.some((k) => k.includes('Store Orders') && k.includes('WA'))).toBe(false)
  })
})
