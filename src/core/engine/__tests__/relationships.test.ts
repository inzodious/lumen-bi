import { describe, expect, it } from 'vitest'
import { engineFor, inF } from './fixture'

const { engine, model, data } = engineFor((s) => {
  // weak many-to-many: Target[Country] <-> Customer[Country]; filters flow Customer -> Target (oneDirection = to -> from)
  s.tables['Target'] = { columns: { Country: 'string', Goal: 'int64' }, rows: [['US', 100], ['US', 50], ['DE', 40], ['FR', 7]], measures: { Goal: 'SUM ( Target[Goal] )' } }
  // one-to-one: Product <-> ProductInfo
  s.tables['ProductInfo'] = { columns: { ProductKey: 'int64', Weight: 'int64' }, rows: [[1, 10], [2, 20], [3, 30], [4, 40]] }
  // calculated table
  s.tables['TopCategories'] = { expression: 'FILTER ( VALUES ( Product[Category] ), [Sales] > 20 )', columns: { Category: { type: 'string', sourceColumn: 'Product[Category]' } } }
  s.relationships!.push(
    { from: 'Target.Country', to: 'Customer.Country', fromCardinality: 'many', toCardinality: 'many' },
    { from: 'Product.ProductKey', to: 'ProductInfo.ProductKey', fromCardinality: 'one', toCardinality: 'one', crossFilteringBehavior: 'bothDirections' }
  )
})
const s = (expr: string, filters?: any[]) => engine.evaluateScalar(expr, filters).value

describe('relationship kinds', () => {
  it('weak many-to-many relationships filter by key values in their direction', () => {
    expect(s('[Goal]')).toBe(197)
    expect(s('[Goal]', [inF('Customer', 'Country', ["'US'"])])).toBe(150)
    expect(s('[Goal]', [inF('Customer', 'CustomerKey', ['3L'])])).toBe(40)
    // single direction: Target does not filter Customer
    expect(s('COUNTROWS ( Customer )', [inF('Target', 'Country', ["'DE'"])])).toBe(3)
    expect(s("CALCULATE ( COUNTROWS ( Customer ), CROSSFILTER ( Target[Country], Customer[Country], BOTH ) )", [inF('Target', 'Country', ["'DE'"])])).toBe(1)
  })
  it('one-to-one relationships filter in both directions', () => {
    expect(s('[Sales]', [inF('ProductInfo', 'Weight', ['30L'])])).toBe(28)
    expect(s('SUM ( ProductInfo[Weight] )', [inF('Product', 'Category', ["'Bikes'"])])).toBe(30)
    expect(s('SUMX ( Sales, RELATED ( ProductInfo[Weight] ) )')).toBe(10 + 20 + 30 + 10 + 20 + 40 + 10 + 30)
  })
})

describe('calculated objects and model edits', () => {
  it('writes calculated tables and columns back into the DataStore', () => {
    const top = data.tables.get('TopCategories')!
    expect(top.columns[0].values.slice().sort()).toEqual(['Bikes', 'Clothing'])
    expect(data.status.get('TopCategories')).toMatchObject({ state: 'loaded', source: 'calculated', rowCount: 2 })
    const sales = data.tables.get('Sales')!
    expect(sales.columns.find((c) => c.name === 'Amount')?.values).toEqual([20, 30, 20, 10, 60, 15, 10, 8])
  })
  it('invalidate picks up model edits', () => {
    model.tables.find((t) => t.name === 'Sales')!.measures.push({ name: 'Avg Price', expression: 'AVERAGE ( Sales[Price] )' })
    engine.invalidate()
    expect(s('[Avg Price]')).toBe(12.875)
    expect(s('[Sales]')).toBe(173)
    model.tables.find((t) => t.name === 'Sales')!.columns.push({ name: 'Big', dataType: 'boolean', kind: 'calculated', expression: 'Sales[Amount] > 25' })
    engine.invalidate()
    expect(engine.processCalculated()).toEqual([])
    expect(s('CALCULATE ( [Sales], Sales[Big] = TRUE () )')).toBe(90)
  })
  it('collects calculated column errors without throwing', () => {
    model.tables.find((t) => t.name === 'Sales')!.columns.push({ name: 'Bad', dataType: 'double', kind: 'calculated', expression: 'Sales[Nope] * 2' })
    engine.invalidate()
    const issues = engine.processCalculated()
    expect(issues).toEqual([{ table: 'Sales', column: 'Bad', error: expect.stringMatching(/Nope/) }])
    expect(s('[Sales]')).toBe(173)
  })
})
