import { describe, expect, it } from 'vitest'
import { emptyModel, type SemanticModel, type TableDef } from '@core/model/types'
import { buildTree, expandableKeys, folderPaths } from './tree'
import { addHierarchy, daxReference, deleteObject, renameObject, setHidden, unhideAll, validateName } from './modelOps'
import { addFieldToVisual, newVisualForField, pickRole, removeFieldFromVisual, visualUsesField } from './visualFieldOps'

function table(name: string, extra: Partial<TableDef> = {}): TableDef {
  return { name, columns: [], measures: [], hierarchies: [], partitions: [{ name, sourceType: 'm', expression: 'x' }], ...extra }
}

function model(): SemanticModel {
  const m = emptyModel('Test')
  m.tables = [
    table('Sales', {
      columns: [
        { name: 'Amount', dataType: 'double', kind: 'data' },
        { name: 'ProductKey', dataType: 'int64', kind: 'data', isHidden: true, summarizeBy: 'none' },
        { name: 'Margin', dataType: 'double', kind: 'calculated', expression: '1', displayFolder: 'Calc\\Deep' }
      ],
      measures: [{ name: 'Total Sales', expression: 'SUM(Sales[Amount])', displayFolder: 'KPIs;Calc' }]
    }),
    table('Product', {
      columns: [
        { name: 'Category', dataType: 'string', kind: 'data' },
        { name: 'Name', dataType: 'string', kind: 'data' }
      ],
      hierarchies: [{ name: 'Product Hierarchy', levels: [{ name: 'Name', column: 'Name', ordinal: 1 }, { name: 'Category', column: 'Category', ordinal: 0 }] }]
    }),
    table('_Measures', { columns: [{ name: 'Value', dataType: 'string', kind: 'data', isHidden: true }], measures: [{ name: 'KPI', expression: '1' }] }),
    table('LocalDateTable_abc', { isHidden: true }),
    table('Secret', { isHidden: true })
  ]
  return m
}

describe('data pane tree', () => {
  it('orders measure tables first then alphabetical, hides internal/hidden tables', () => {
    expect(buildTree(model()).map((n) => (n.kind === 'table' ? n.table.name : ''))).toEqual(['_Measures', 'Product', 'Sales'])
    expect(buildTree(model(), { showHidden: true }).map((n) => (n.kind === 'table' ? n.table.name : ''))).toEqual(['_Measures', 'Product', 'Sales', 'Secret'])
  })
  it('builds folders first, nested folders and multi-folder items', () => {
    const sales = buildTree(model()).find((n) => n.kind === 'table' && n.table.name === 'Sales')!
    if (sales.kind !== 'table') throw new Error()
    expect(sales.children.map((c) => c.kind + ':' + (c.kind === 'folder' ? c.name : c.kind === 'column' ? c.column.name : c.kind === 'measure' ? c.measure.name : ''))).toEqual(['folder:Calc', 'folder:KPIs', 'column:Amount'])
    const calc = sales.children[0]
    if (calc.kind !== 'folder') throw new Error()
    expect(calc.children.map((c) => (c.kind === 'folder' ? c.name : c.kind === 'measure' ? c.measure.name : '?'))).toEqual(['Deep', 'Total Sales'])
    expect(folderPaths('a\\b;c')).toEqual([['a', 'b'], ['c']])
  })
  it('sorts hierarchy levels by ordinal and supports search', () => {
    const tree = buildTree(model(), { search: 'categ' })
    expect(tree.length).toBe(1)
    const product = tree[0]
    if (product.kind !== 'table') throw new Error()
    const h = product.children.find((c) => c.kind === 'hierarchy')
    expect(h && h.kind === 'hierarchy' && h.children.map((l) => (l.kind === 'level' ? l.level.name : ''))).toEqual(['Category'])
    const full = buildTree(model())[1]
    if (full.kind !== 'table') throw new Error()
    const fh = full.children.find((c) => c.kind === 'hierarchy')!
    expect(fh.kind === 'hierarchy' && fh.children.map((l) => (l.kind === 'level' ? l.level.name : ''))).toEqual(['Category', 'Name'])
    expect(expandableKeys(buildTree(model())).length).toBeGreaterThan(3)
  })
})

describe('visual field ops', () => {
  it('adds measures to value wells and columns to grouping wells', () => {
    const md = model()
    const v: any = { visual: { visualType: 'clusteredColumnChart' } }
    expect(addFieldToVisual(v, { kind: 'column', table: 'Product', name: 'Category' }, md)).toBe('Category')
    expect(addFieldToVisual(v, { kind: 'measure', table: 'Sales', name: 'Total Sales' }, md)).toBe('Y')
    expect(addFieldToVisual(v, { kind: 'column', table: 'Sales', name: 'Amount' }, md)).toBe('Y')
    const y = v.visual.query.queryState.Y.projections
    expect(y[1].field.Aggregation.Function).toBe(0)
    expect(y[1].queryRef).toBe('Sum(Sales.Amount)')
    expect(y[1].nativeQueryRef).toBe('Sum of Amount')
    expect(visualUsesField(v, { kind: 'column', table: 'Sales', name: 'Amount' })).toBe(true)
    removeFieldFromVisual(v, { kind: 'column', table: 'Sales', name: 'Amount' })
    expect(visualUsesField(v, { kind: 'column', table: 'Sales', name: 'Amount' })).toBe(false)
    expect(visualUsesField(v, { kind: 'measure', table: 'Sales', name: 'Total Sales' })).toBe(true)
  })
  it('respects role max and table "both" roles', () => {
    const md = model()
    const card: any = { visual: { visualType: 'card' } }
    expect(addFieldToVisual(card, { kind: 'measure', table: 'Sales', name: 'Total Sales' }, md)).toBe('Values')
    expect(pickRole(card, { kind: 'measure', table: '_Measures', name: 'KPI' }, md)).toBeUndefined()
    const t: any = { visual: { visualType: 'tableEx' } }
    addFieldToVisual(t, { kind: 'column', table: 'Product', name: 'Category' }, md)
    addFieldToVisual(t, { kind: 'column', table: 'Sales', name: 'Amount' }, md)
    expect(t.visual.query.queryState.Values.projections.map((p: any) => p.queryRef)).toEqual(['Product.Category', 'Sum(Sales.Amount)'])
  })
  it('expands hierarchies into levels and picks a new visual type', () => {
    const md = model()
    const v: any = { visual: { visualType: 'pivotTable' } }
    addFieldToVisual(v, { kind: 'hierarchy', table: 'Product', name: 'Product Hierarchy', levels: ['Category', 'Name'] }, md)
    expect(v.visual.query.queryState.Rows.projections.length).toBe(2)
    expect(v.visual.query.queryState.Rows.projections[0].active).toBe(true)
    expect(newVisualForField({ kind: 'measure', table: 'Sales', name: 'Total Sales' }, md).visualType).toBe('clusteredColumnChart')
    expect(newVisualForField({ kind: 'column', table: 'Product', name: 'Name' }, md).visualType).toBe('tableEx')
  })
})

describe('model ops', () => {
  function rel(m: SemanticModel) {
    m.relationships.push({ name: 'r1', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'Name', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true })
    return m
  }
  it('renames tables and columns keeping relationships / hierarchies consistent', () => {
    const m = rel(model())
    renameObject(m, { kind: 'table', table: 'Product' }, 'Products')
    expect(m.relationships[0].toTable).toBe('Products')
    renameObject(m, { kind: 'column', table: 'Products', name: 'Name' }, 'Product Name')
    expect(m.relationships[0].toColumn).toBe('Product Name')
    expect(m.tables.find((t) => t.name === 'Products')!.hierarchies[0].levels.find((l) => l.ordinal === 1)!.column).toBe('Product Name')
  })
  it('validates names', () => {
    const m = model()
    expect(validateName(m, { kind: 'table', table: 'Sales' }, 'product')).toMatch(/already exists/)
    expect(validateName(m, { kind: 'measure', table: 'Sales', name: 'Total Sales' }, 'kpi')).toMatch(/measure/)
    expect(validateName(m, { kind: 'column', table: 'Sales', name: 'Amount' }, 'Margin')).toMatch(/column/)
    expect(validateName(m, { kind: 'column', table: 'Sales', name: 'Amount' }, 'Net')).toBeUndefined()
    expect(validateName(m, { kind: 'column', table: 'Sales', name: 'Amount' }, ' ')).toMatch(/empty/)
  })
  it('deletes with cleanup, hides, unhides, adds hierarchies', () => {
    const m = rel(model())
    deleteObject(m, { kind: 'column', table: 'Product', name: 'Name' })
    expect(m.relationships.length).toBe(0)
    expect(m.tables.find((t) => t.name === 'Product')!.hierarchies[0].levels.map((l) => l.column)).toEqual(['Category'])
    setHidden(m, { kind: 'measure', table: 'Sales', name: 'Total Sales' }, true)
    expect(m.tables[0].measures[0].isHidden).toBe(true)
    unhideAll(m)
    expect(m.tables[0].measures[0].isHidden).toBeUndefined()
    expect(m.tables.find((t) => t.name === 'LocalDateTable_abc')!.isHidden).toBe(true)
    expect(addHierarchy(m, 'Sales', 'Amount')).toBe('Amount Hierarchy')
    expect(addHierarchy(m, 'Sales', 'Amount')).toBe('Amount Hierarchy 2')
    deleteObject(m, { kind: 'table', table: 'Sales' })
    expect(m.tables.some((t) => t.name === 'Sales')).toBe(false)
  })
  it('builds DAX references', () => {
    expect(daxReference({ kind: 'column', table: "Bob's", name: 'A]B' })).toBe("'Bob''s'[A]]B]")
    expect(daxReference({ kind: 'measure', table: 'T', name: 'M' })).toBe('[M]')
  })
})
