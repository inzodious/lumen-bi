import { describe, expect, it } from 'vitest'
import type { SemanticModel, TableDef } from '@core/model/types'
import { emptyDataStore, type DataStore } from '@core/model/data'
import { defaultTable, emptyTableInfo, isMeasureHolder, viewableTables } from './tableChoice'
import { estimateWidth } from './gridModel'

function table(name: string, columns: string[], extra: Partial<TableDef> = {}): TableDef {
  return { name, columns: columns.map((c) => ({ name: c, dataType: 'string', kind: 'data' })), measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: 'let s = 1 in s' }], ...extra }
}
const measure = (name: string) => ({ name, expression: '1' })

function fixture(): { model: SemanticModel; data: DataStore } {
  const model: SemanticModel = {
    name: 'm',
    tables: [
      table('_Measures', ['Column1'], { measures: [measure('Total'), measure('Share')] }),
      table('_Hidden measures', ['x'], { measures: [measure('A')], columns: [{ name: 'key', dataType: 'string', kind: 'data', isHidden: true }] }),
      table('Stores', ['store', 'city']),
      table('Sales', ['store', 'amount'], { isHidden: true }),
      table('Combined', ['store'], { partitions: [{ name: 'Combined', sourceType: 'calculated', expression: 'UNION ( A, B )' }] }),
      table('Time intelligence', ['Name'], { calculationGroup: { items: [] } as never }),
      table('LocalDateTable_1', ['Date'], { isPrivate: true })
    ],
    relationships: [],
    expressions: [],
    roles: []
  }
  const data = emptyDataStore()
  const fill = (name: string, rows: number, source: 'synthetic' | 'query' | 'calculated' = 'synthetic') => {
    data.tables.set(name, { rowCount: rows, columns: [] })
    data.status.set(name, { state: 'loaded', source, rowCount: rows })
  }
  fill('_Measures', 0)
  fill('Sales', 500)
  return { model, data }
}

describe('Table view: which table to open on', () => {
  it('recognises tables that only hold measures', () => {
    const { model } = fixture()
    expect(model.tables.filter(isMeasureHolder).map((t) => t.name)).toEqual(['_Measures', '_Hidden measures'])
    expect(isMeasureHolder(table('Notes', ['Column1']))).toBe(false) // no measures: an ordinary one-column table
  })

  it('opens on a table with rows rather than on the measure table the model lists first', () => {
    const { model, data } = fixture()
    // only the hidden fact has rows: better than an empty grid
    expect(defaultTable(model, data)).toBe('Sales')
    data.tables.set('Stores', { rowCount: 12, columns: [] })
    // visible tables with rows come first
    expect(defaultTable(model, data)).toBe('Stores')
  })

  it('without any data, opens on the first table that could hold rows', () => {
    const { model } = fixture()
    expect(defaultTable(model, emptyDataStore())).toBe('Stores')
    expect(defaultTable(model, undefined)).toBe('Stores')
    expect(defaultTable({ ...model, tables: model.tables.slice(0, 1) }, undefined)).toBe('_Measures')
    expect(defaultTable(undefined, undefined)).toBeNull()
  })

  it('never lists private tables', () => {
    expect(viewableTables(fixture().model).map((t) => t.name)).not.toContain('LocalDateTable_1')
  })
})

describe('Table view: why a table has no rows', () => {
  const { model, data } = fixture()
  const info = (name: string, store: DataStore | undefined = data) => emptyTableInfo(model.tables.find((t) => t.name === name)!, store)

  it('says a measure table has no rows by design, and offers nothing to load', () => {
    expect(info('_Measures')).toMatchObject({ kind: 'measures', loadable: false })
    expect(info('_Measures')!.message).toMatch(/only holds measures \(2\)/)
  })
  it('distinguishes calculation groups, calculated tables and tables that were never loaded', () => {
    expect(info('Time intelligence')).toMatchObject({ kind: 'calculationGroup', loadable: false })
    expect(info('Combined')).toMatchObject({ kind: 'calculated', loadable: false })
    expect(info('Stores')).toMatchObject({ kind: 'noData', loadable: true })
    expect(info('Stores')!.message).toMatch(/sample data/)
  })
  it('reports load errors and sources that returned nothing', () => {
    const d = emptyDataStore()
    d.status.set('Stores', { state: 'error', message: 'login failed' })
    expect(info('Stores', d)).toMatchObject({ kind: 'error', loadable: true, message: 'This table failed to load: login failed' })
    d.status.set('Stores', { state: 'loaded', source: 'query', rowCount: 0 })
    expect(info('Stores', d)).toMatchObject({ kind: 'empty', loadable: false })
    d.status.set('Stores', { state: 'pending' })
    expect(info('Stores', d)).toMatchObject({ kind: 'pending' })
  })
  it('is null for a table with rows', () => {
    expect(info('Sales')).toBeNull()
  })
})

describe('Table view: column widths', () => {
  it('always fits the whole header next to its icon and menu button', () => {
    // 12px semibold needs ~7.4px per character plus 58px of header chrome
    for (const name of ['Column1', 'id', 'recommend_score', 'A much longer column caption']) expect(estimateWidth(name, []), name).toBeGreaterThanOrEqual(Math.ceil(name.length * 7.4) + 58)
    expect(estimateWidth('Column1', [])).toBeGreaterThan(105)
  })
  it('widens for long values up to a limit and never goes below the minimum', () => {
    expect(estimateWidth('x', [])).toBe(70)
    expect(estimateWidth('x', ['a'.repeat(30)])).toBeGreaterThan(200)
    expect(estimateWidth('x', ['a'.repeat(500)])).toBe(320)
  })
})
