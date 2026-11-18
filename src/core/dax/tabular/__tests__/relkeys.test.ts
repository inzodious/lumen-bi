/**
 * Relationship key matching between columns of different data types (text vs number): the key matches stored with
 * PBIX data (VertiPaq relationship indexes) are authoritative; otherwise the text side converts like VALUE.
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildModel, processCalculated, runQuery } from '../index.ts'
import { build } from './build.ts'
import { openProject } from '../../../io/open'
import { nodeFs } from '../../../io/nodefs'

function model(factKeys: Array<string | null>, stored?: { from: string[]; to: Array<number | null> }) {
  const { model: sm, data } = build({
    tables: {
      Product: { columns: { Key: 'int64', Name: 'string' }, rows: [[50, 'Fifty'], [100, 'Hundred'], [7, 'Seven']] },
      Sales: { columns: { ProductKey: 'string', Qty: 'int64' }, rows: factKeys.map((k) => [k, 1]), measures: { Units: 'SUM ( Sales[Qty] )' } }
    },
    relationships: [{ name: 'r1', from: 'Sales.ProductKey', to: 'Product.Key' }]
  })
  if (stored) data.relationshipKeys = new Map([['r1', { fromData: data.tables.get('Sales')!, toData: data.tables.get('Product')!, ...stored }]])
  const m = buildModel(sm, data)
  processCalculated(m)
  return { m, sm, data }
}
const byProduct = (m: ReturnType<typeof model>['m']) => runQuery(m, `EVALUATE SUMMARIZECOLUMNS ( Product[Name], "u", [Units] ) ORDER BY Product[Name]`)[0].rows

describe('text vs number relationship keys', () => {
  it('without stored matches, text keys convert like VALUE (trimmed, decimal / exponent), others are unmatched', () => {
    const { m } = model(['50', ' 050 ', '1e2', '100.0', '', 'x7', '0x7', '7'])
    expect(byProduct(m)).toEqual([
      [null, 3], // the blank row: '', 'x7', '0x7' do not match
      ['Fifty', 2],
      ['Hundred', 2],
      ['Seven', 1]
    ])
  })
  it('stored key matches (PBIX relationship index) win over the conversion rule', () => {
    // the index says ' 050 ' has no match and '7' joins 100 (deliberately unlike the conversion rule)
    const { m } = model(['50', ' 050 ', '7'], { from: ['50', ' 050 ', '7'], to: [50, null, 100] })
    expect(byProduct(m)).toEqual([
      [null, 1],
      ['Fifty', 1],
      ['Hundred', 1]
    ])
  })
  it('stored matches are ignored once the table data was replaced (refresh)', () => {
    const { sm, data } = model(['50', '7'], { from: ['50', '7'], to: [null, null] })
    data.tables.set('Sales', { ...data.tables.get('Sales')! })
    const m = buildModel(sm, data)
    processCalculated(m)
    expect(byProduct(m)).toEqual([
      ['Fifty', 1],
      ['Seven', 1]
    ])
  })
})

const SAMPLES = process.env.LUMEN_SAMPLES_DIR ?? ''
const CP = join(SAMPLES, 'Customer Profitability Sample PBIX.pbix')
describe.skipIf(!SAMPLES || !existsSync(CP))('PBIX relationship indexes (Microsoft sample)', () => {
  it('the text Fact[Product Key] -> whole-number Product[Product Key] matches are read from the file', async () => {
    const doc = await openProject(CP, nodeFs)
    const rel = doc.model.relationships.find((r) => r.fromTable === 'Fact' && r.fromColumn === 'Product Key')!
    const keys = doc.data.relationshipKeys?.get(rel.name!)
    expect(keys).toBeTruthy()
    const pairs = new Map(keys!.from.map((v, k) => [v, keys!.to[k]]))
    // numeric text joins the equal whole number; a key without product has no match (blank row)
    expect(pairs.get('10')).toBe(10)
    expect(pairs.get('82')).toBe(82)
    expect(pairs.get('50')).toBeNull()
    // every stored match of every sample relationship joins equal values (by number for mixed types)
    for (const r of doc.model.relationships) {
      const k = doc.data.relationshipKeys?.get(r.name!)
      if (!k) continue
      k.from.forEach((v, i) => {
        const t = k.to[i]
        if (t !== null) expect(String(t instanceof Date ? t.getTime() : t)).toBe(String(v instanceof Date ? v.getTime() : v))
      })
    }
  })
})

describe('trailing spaces in stored text (Microsoft Learn: the engine trims trailing, not leading, spaces)', () => {
  it("Microsoft's Dylan Williams example: four loaded rows, two values", () => {
    const { model: sm, data } = build({
      tables: {
        Customer: {
          columns: { Name: 'string', Index: 'int64' },
          rows: [['Dylan Williams', 1], ['Dylan Williams ', 10], [' Dylan Williams', 20], [' Dylan Williams ', 40]],
          measures: { Total: 'SUM ( Customer[Index] )' }
        }
      }
    })
    const m = buildModel(sm, data)
    processCalculated(m)
    const rows = runQuery(m, `EVALUATE SUMMARIZECOLUMNS ( Customer[Name], "Index", [Total], "Len", MAX ( Customer[Name] ) ) ORDER BY Customer[Name]`)[0].rows
    expect(rows.map((r) => [r[0], r[1], (r[2] as string).length])).toEqual([
      [' Dylan Williams', 60, 15],
      ['Dylan Williams', 11, 14]
    ])
    expect(runQuery(m, `EVALUATE { COUNTROWS ( Customer ), CALCULATE ( SUM ( Customer[Index] ), Customer[Name] = "Dylan Williams" ) }`)[0].rows).toEqual([[4], [11]])
  })
  it('a one-side key that differs only by trailing spaces joins (and duplicates it)', () => {
    const { m } = model(['50 ', '50'])
    expect(byProduct(m)).toEqual([['Fifty', 2]])
  })
})
