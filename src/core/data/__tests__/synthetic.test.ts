import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deflateSync } from 'fflate'
import { emptyDataStore, makeDate, type Scalar, type TableData } from '../../model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../model/types'
import type { ProjectDocument } from '../../project'
import type { FileSystem } from '../../io/fs'
import type { ReportDocument } from '../../report/types'
import { createEngine } from '../../engine/engine'
import { columnSemantics, generateSyntheticData, isIdentifyingColumn, mineValueDomains, mineModel, domainKey, PLACEHOLDER_IMAGES } from '../synthetic'
import { calculatedTableLiterals, isCalculatedTable } from '../synthetic-mine'
import { isEnterDataPartition } from '../synthetic-enterdata'
import { literalTableOf, parseDaxExpr, tokenizeDax } from '../synthetic-dax'
import { calendarValue, isPlaceholderLabel, tokensOf } from '../synthetic-values'
import { loadPbipLite, parseTmdl } from './tmdl-lite'

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}

function table(name: string, columns: ColumnDef[], extra: Partial<TableDef> = {}): TableDef {
  return {
    name,
    columns,
    measures: [],
    hierarchies: [],
    partitions: [{ name, sourceType: 'm', expression: `let Source = Sql.Database("srv", "db"), T = Source{[Schema="dbo",Item="${name}"]}[Data] in T` }],
    ...extra
  }
}

function rel(from: string, to: string, extra: Partial<RelationshipDef> = {}): RelationshipDef {
  const [ft, fc] = from.split('.')
  const [tt, tc] = to.split('.')
  return {
    name: `${from}->${to}`,
    fromTable: ft,
    fromColumn: fc,
    toTable: tt,
    toColumn: tc,
    fromCardinality: 'many',
    toCardinality: 'one',
    crossFilteringBehavior: 'oneDirection',
    isActive: true,
    ...extra
  }
}

function values(t: TableData | undefined, column: string): Scalar[] {
  const c = t?.columns.find((x) => x.name === column)
  if (!c) throw new Error(`missing column ${column}`)
  return c.values
}

function key(v: Scalar): string {
  if (v instanceof Date) return 'd' + v.getTime()
  if (typeof v === 'string') return 's' + v.toLowerCase()
  return typeof v + String(v)
}

const TODAY = makeDate(2026, 11, 17)

function starSchema(): ProjectDocument {
  const measures = table('_measures', [col('Column1', 'string')], {
    partitions: [
      {
        name: '_measures',
        sourceType: 'm',
        expression:
          'let Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("i44FAA==", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Column1 = _t]) in Source'
      }
    ],
    measures: [
      { name: 'Total', expression: 'SUM ( fact_sales[amount] )' },
      { name: 'Won Amount', expression: 'CALCULATE ( SUM ( fact_sales[amount] ), fact_sales[outcome] = "Won" )' },
      { name: 'Enterprise Sales', expression: "CALCULATE ( [Total], 'dim_customer'[segment] IN { \"Enterprise\", \"Strategic \"\"A\"\" Accounts\" } ) // \"NotMe\"" },
      { name: 'Picked', expression: 'VAR _m = SELECTEDVALUE ( dim_product[category] )\nRETURN\n  SWITCH ( _m, "Gadgets", 1, "Widgets", 2, 0 )' },
      { name: 'Picked2', expression: 'VAR _s = SELECTEDVALUE ( dim_customer[account_status] ) RETURN SWITCH ( TRUE (), _s = "Gold", 1, _s = "Silver", 2, 3 )' },
      { name: 'Turbo Rows', expression: 'CALCULATE ( COUNTROWS ( fact_sales ), CONTAINSSTRING ( dim_product[product_name], "Turbo" ) )' },
      { name: 'Returned', expression: 'CALCULATE ( COUNTROWS ( fact_sales ), fact_sales[is_returned] = TRUE () )' },
      { name: 'Channel X', expression: 'CALCULATE ( [Total], FILTER ( fact_sales, [channel] = "Partner Portal" ) )' },
      { name: 'Treat', expression: 'CALCULATE ( [Total], TREATAS ( { "North Hub", "South Hub" }, fact_sales[hub] ) )' }
    ]
  })
  const fact = table('fact_sales', [
    col('date', 'dateTime', { annotations: { UnderlyingDateTimeDataType: 'Date' } }),
    col('customer_id', 'int64'),
    col('product_key', 'string'),
    col('stage', 'string'),
    col('outcome', 'string'),
    col('channel', 'string'),
    col('hub', 'string'),
    col('amount', 'double'),
    col('quantity', 'int64'),
    col('discount_pct', 'double'),
    col('is_returned', 'boolean'),
    col('created_at', 'dateTime'),
    col('modified_at', 'dateTime'),
    { name: 'amount_x2', dataType: 'double', kind: 'calculated', expression: 'fact_sales[amount] * 2' }
  ])
  const customer = table('dim_customer', [
    col('id', 'int64'),
    col('name', 'string'),
    col('email', 'string'),
    col('city', 'string'),
    col('state', 'string'),
    col('segment', 'string'),
    col('account_status', 'string'),
    col('is_active', 'int64'),
    col('created_date', 'dateTime')
  ])
  const product = table('dim_product', [col('product_key', 'string'), col('product_name', 'string'), col('category', 'string'), col('list_price', 'decimal')])
  const date = table(
    'dim_date',
    [
      col('date', 'dateTime'),
      col('year', 'int64'),
      col('month', 'int64'),
      col('month_name', 'string'),
      col('month_abbr', 'string'),
      col('quarter', 'string'),
      col('year_month', 'string'),
      col('day_of_week', 'int64'),
      col('day_name', 'string'),
      col('is_weekend', 'boolean'),
      col('date_key', 'int64'),
      col('month_end', 'dateTime')
    ],
    { dataCategory: 'Time' }
  )
  const stage = table(
    'dim_pipeline',
    [
      { name: 'stage', dataType: 'string', kind: 'calculatedTableColumn', sourceColumn: '[stage]' },
      { name: 'outcome', dataType: 'string', kind: 'calculatedTableColumn', sourceColumn: '[outcome]' }
    ],
    {
      partitions: [
        {
          name: 'dim_pipeline',
          sourceType: 'calculated',
          expression: 'DATATABLE ( "stage", STRING, "outcome", STRING, { { "Prospect", "Open" }, { "Won Sale", "Won" }, { "Lost Sale", "Lost" } } )'
        }
      ]
    }
  )
  const model: SemanticModel = {
    name: 'Star',
    tables: [measures, fact, customer, product, date, stage],
    relationships: [
      rel('fact_sales.date', 'dim_date.date'),
      rel('fact_sales.customer_id', 'dim_customer.id'),
      rel('fact_sales.product_key', 'dim_product.product_key'),
      rel('fact_sales.stage', 'dim_pipeline.stage', { crossFilteringBehavior: 'bothDirections' })
    ],
    expressions: [],
    roles: []
  }
  const report: ReportDocument = {
    origin: 'pbir',
    report: {},
    pagesMeta: { pageOrder: ['p1'] },
    pages: [
      {
        name: 'p1',
        json: {
          filterConfig: {
            filters: [
              {
                name: 'f1',
                filter: {
                  Version: 2,
                  From: [{ Name: 'c', Entity: 'dim_customer', Type: 0 }],
                  Where: [
                    {
                      Condition: {
                        In: {
                          Expressions: [{ Column: { Expression: { SourceRef: { Source: 'c' } }, Property: 'city' } }],
                          Values: [[{ Literal: { Value: "'Springfield'" } }], [{ Literal: { Value: "'Shelbyville'" } }]]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        },
        visuals: [
          {
            name: 'v1',
            json: {
              visual: {
                visualType: 'slicer',
                objects: {
                  general: [
                    {
                      properties: {
                        filter: {
                          filter: {
                            Version: 2,
                            From: [{ Name: 'p', Entity: 'dim_product', Type: 0 }],
                            Where: [
                              {
                                Condition: {
                                  Comparison: {
                                    ComparisonKind: 0,
                                    Left: { Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'category' } },
                                    Right: { Literal: { Value: "'Doohickeys'" } }
                                  }
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    ],
    bookmarks: [],
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics: []
  }
  return { id: 'star', name: 'Star', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

/** QueryEngine over the generated data, calculated columns/tables processed. */
function engineFor(project: ProjectDocument): ReturnType<typeof createEngine> {
  const engine = createEngine(project.model, project.data)
  engine.processCalculated()
  return engine
}

/** Measure value, or `undefined` when the engine rejects the expression (model references a missing object...). */
function measureValue(engine: ReturnType<typeof createEngine>, name: string): Scalar | undefined {
  try {
    return engine.evaluateScalar(`[${name}]`).value
  } catch {
    return undefined
  }
}

const LITERAL_FILTER = /\[[^\]]+\]\s*(=|IN)\s*\{?\s*"[^"]+"/
const CONTEXT_DEPENDENT = /SELECTEDVALUE|ISFILTERED|HASONEVALUE|USERPRINCIPAL|ISINSCOPE|ISCROSSFILTERED/i

// ---------------------------------------------------------------------------------------------
// DAX tokenizer / parser / miner units
// ---------------------------------------------------------------------------------------------

describe('synthetic-dax', () => {
  it('tokenizes strings with escapes, quoted tables, columns and comments', () => {
    const toks = tokenizeDax(`'My ''T'''[Col]]x] = "a""b" // "c"\n-- "d"\n/* "e" */ + 1.5e2`)
    expect(toks.map((t) => [t.kind, t.text])).toEqual([
      ['qtable', "My 'T'"],
      ['colref', 'Col]x'],
      ['op', '='],
      ['str', 'a"b'],
      ['op', '+'],
      ['num', '1.5e2'],
      ['eof', '']
    ])
  })

  it('parses VAR blocks, IN lists, NOT IN and table constructors', () => {
    const n = parseDaxExpr('VAR a = 1 VAR b = t[c] NOT IN { "x", "y" } RETURN IF ( a && b, { (1, "p"), (2, "q") } )')
    expect(n.k).toBe('var')
    const lit = literalTableOf('{ (1, "p", TRUE()), (2, "q", BLANK()) }')
    expect(lit?.columns).toEqual(['Value1', 'Value2', 'Value3'])
    expect(lit?.rows).toEqual([
      [1, 'p', true],
      [2, 'q', null]
    ])
    const dt = literalTableOf('DATATABLE("k", STRING, "v", INTEGER, {{"a", 1}, {"b", -2}})')
    expect(dt).toEqual({ columns: ['k', 'v'], rows: [['a', 1], ['b', -2]] })
  })

  it('calendarValue derives date-table columns by name', () => {
    const ctx = { today: TODAY, fiscalStartMonth: 7 }
    const d = makeDate(2025, 3, 9) // Sunday
    expect(calendarValue('month_name', 'string', d, ctx)).toBe('March')
    expect(calendarValue('MonthShort', 'string', d, ctx)).toBe('Mar')
    expect(calendarValue('quarter', 'string', d, ctx)).toBe('Q1')
    expect(calendarValue('quarter', 'int64', d, ctx)).toBe(1)
    expect(calendarValue('year_month', 'string', d, ctx)).toBe('2025-03')
    expect(calendarValue('day_name', 'string', d, ctx)).toBe('Sunday')
    expect(calendarValue('day_of_week', 'int64', d, ctx)).toBe(1)
    expect(calendarValue('is_weekend', 'boolean', d, ctx)).toBe(true)
    expect(calendarValue('date_key', 'int64', d, ctx)).toBe(20250309)
    expect(calendarValue('fiscal_year', 'int64', d, ctx)).toBe(2025)
    expect(calendarValue('fiscal_month', 'int64', d, ctx)).toBe(9)
    expect(calendarValue('month_end', 'dateTime', d, ctx)).toEqual(makeDate(2025, 3, 31))
    expect(calendarValue('is_future', 'boolean', d, ctx)).toBe(false)
    expect(tokensOf('MonthNameShort')).toEqual(['month', 'name', 'short'])
  })
})

describe('mineValueDomains', () => {
  it('mines DAX literals, SWITCH/VAR, CONTAINSSTRING, TREATAS, FILTER row context and report SQ literals', () => {
    const p = starSchema()
    const d = mineValueDomains(p)
    const vals = (t: string, c: string): unknown[] => d.get(domainKey(t, c))?.values ?? []
    expect(vals('fact_sales', 'outcome')).toEqual(['Won'])
    expect(vals('dim_customer', 'segment')).toEqual(['Enterprise', 'Strategic "A" Accounts'])
    expect(vals('dim_product', 'category')).toEqual(expect.arrayContaining(['Gadgets', 'Widgets', 'Doohickeys']))
    expect(vals('dim_customer', 'account_status')).toEqual(['Gold', 'Silver'])
    expect(d.get(domainKey('dim_product', 'product_name'))?.contains).toEqual(['Turbo'])
    expect(vals('fact_sales', 'is_returned')).toEqual([true])
    expect(vals('fact_sales', 'channel')).toEqual(['Partner Portal'])
    expect(vals('fact_sales', 'hub')).toEqual(['North Hub', 'South Hub'])
    expect(vals('dim_customer', 'city')).toEqual(['Springfield', 'Shelbyville'])
    // relationship to a DATATABLE calculated table: its literal rows flow into the data column
    expect(vals('fact_sales', 'stage')).toEqual(['Prospect', 'Won Sale', 'Lost Sale'])
    // nothing from comments
    expect([...d.values()].some((x) => x.values.includes('NotMe'))).toBe(false)
  })

  it('links TREATAS(VALUES(calc[c])) and LOOKUPVALUE targets to calculated-table literals', () => {
    const p = starSchema()
    p.model.relationships = p.model.relationships.filter((r) => r.toTable !== 'dim_pipeline')
    p.model.tables[0].measures.push({
      name: 'Raw',
      expression: 'VAR _raw = CALCULATETABLE ( VALUES ( dim_pipeline[stage] ), dim_pipeline[outcome] = "Won" ) RETURN CALCULATE ( [Total], TREATAS ( _raw, fact_sales[stage] ) )'
    })
    p.model.tables[0].measures.push({ name: 'LV', expression: 'LOOKUPVALUE ( dim_pipeline[outcome], dim_pipeline[stage], SELECTEDVALUE ( fact_sales[channel] ) )' })
    const d = mineValueDomains(p)
    expect(d.get(domainKey('fact_sales', 'stage'))?.values).toEqual(['Prospect', 'Won Sale', 'Lost Sale'])
    expect(d.get(domainKey('fact_sales', 'channel'))?.values).toEqual(expect.arrayContaining(['Partner Portal', 'Prospect', 'Won Sale', 'Lost Sale']))
  })
})

describe('mineValueDomains — guarded links and Enter-data tables', () => {
  it('filters calculated-table rows by the SWITCH(TRUE()) branch condition', () => {
    const layout = table('layout', [
      { name: 'dim', dataType: 'string', kind: 'calculatedTableColumn', sourceColumn: '[dim]' },
      { name: 'member', dataType: 'string', kind: 'calculatedTableColumn', sourceColumn: '[member]' }
    ], {
      partitions: [{ name: 'layout', sourceType: 'calculated', expression: 'DATATABLE("dim", STRING, "member", STRING, {{"region", "North"}, {"region", "South"}, {"gender", "Female"}, {"gender", "Male"}})' }]
    })
    const f = table('fact', [col('region', 'string'), col('gender', 'string')])
    f.measures.push({
      name: 'slice',
      expression:
        'VAR D = SELECTEDVALUE ( layout[dim] ) VAR M = SELECTEDVALUE ( layout[member] ) RETURN SWITCH ( TRUE (), D = "region", CALCULATE ( COUNTROWS ( fact ), fact[region] = M ), D = "gender", CALCULATE ( COUNTROWS ( fact ), KEEPFILTERS ( fact[gender] = M ) ) )'
    })
    const p: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model: { name: 'm', tables: [layout, f], relationships: [], expressions: [], roles: [] }, data: emptyDataStore(), diagnostics: [], dirty: false }
    const d = mineValueDomains(p)
    expect(d.get(domainKey('fact', 'region'))?.values).toEqual(['North', 'South'])
    expect(d.get(domainKey('fact', 'gender'))?.values).toEqual(['Female', 'Male'])
  })

  it('decodes non-empty Enter-data tables instead of inventing rows', () => {
    const rows = [['Start', '1'], ['Increase', '2'], ['End', '3']]
    const b64 = Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify(rows)))).toString('base64')
    const t = table('chart_steps', [col('type', 'string'), col('ord', 'int64')], {
      partitions: [
        {
          name: 'chart_steps',
          sourceType: 'm',
          expression: `let Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${b64}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [#"kind" = _t, Column2 = _t]), #"Renamed" = Table.RenameColumns(Source,{{"kind", "type"}, {"Column2", "ord"}}) in #"Renamed"`
        }
      ]
    })
    const p: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model: { name: 'm', tables: [t], relationships: [], expressions: [], roles: [] }, data: emptyDataStore(), diagnostics: [], dirty: false }
    generateSyntheticData(p, { today: TODAY })
    expect(values(p.data.tables.get('chart_steps'), 'type')).toEqual(['Start', 'Increase', 'End'])
    expect(values(p.data.tables.get('chart_steps'), 'ord')).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------------------------
// Generation on a hand-built star schema
// ---------------------------------------------------------------------------------------------

describe('generateSyntheticData — star schema', () => {
  const p = starSchema()
  const res = generateSyntheticData(p, { seed: 7, today: TODAY, factRows: 5000 })
  const T = (n: string): TableData => p.data.tables.get(n)!

  it('fills every non-calculated table and marks status', () => {
    expect(new Set(res.tables)).toEqual(new Set(['_measures', 'fact_sales', 'dim_customer', 'dim_product', 'dim_date']))
    expect(p.data.tables.has('dim_pipeline')).toBe(false)
    for (const n of res.tables) {
      const st = p.data.status.get(n)
      expect(st).toMatchObject({ state: 'loaded', source: 'synthetic' })
      expect(st && st.state === 'loaded' ? st.rowCount : -1).toBe(T(n).rowCount)
    }
    expect(T('_measures').rowCount).toBe(0)
    expect(T('fact_sales').rowCount).toBe(5000)
    expect(T('dim_customer').rowCount).toBeGreaterThan(5)
    // only data columns, model names & types
    expect(T('fact_sales').columns.map((c) => c.name)).not.toContain('amount_x2')
    expect(T('fact_sales').columns.find((c) => c.name === 'amount')?.type).toBe('double')
  })

  it('respects data types strictly', () => {
    for (const t of p.model.tables) {
      const data = p.data.tables.get(t.name)
      if (!data) continue
      for (const c of data.columns) {
        for (const v of c.values) {
          if (v === null) continue
          if (c.type === 'int64') expect(Number.isInteger(v)).toBe(true)
          else if (c.type === 'double' || c.type === 'decimal') expect(typeof v).toBe('number')
          else if (c.type === 'boolean') expect(typeof v).toBe('boolean')
          else if (c.type === 'string') expect(typeof v).toBe('string')
          else if (c.type === 'dateTime') expect(v).toBeInstanceOf(Date)
        }
      }
    }
    for (const v of values(T('dim_product'), 'list_price')) expect(Math.round((v as number) * 100) / 100).toBe(v)
  })

  it('keeps keys unique and foreign keys consistent', () => {
    const ids = values(T('dim_customer'), 'id')
    expect(new Set(ids).size).toBe(ids.length)
    const pk = values(T('dim_product'), 'product_key')
    expect(new Set(pk).size).toBe(pk.length)
    const idSet = new Set(ids.map(key))
    for (const v of values(T('fact_sales'), 'customer_id')) expect(idSet.has(key(v))).toBe(true)
    const pkSet = new Set(pk.map(key))
    for (const v of values(T('fact_sales'), 'product_key')) expect(pkSet.has(key(v))).toBe(true)
    const stageSet = new Set(['prospect', 'won sale', 'lost sale'])
    const stages = values(T('fact_sales'), 'stage')
    for (const v of stages) expect(stageSet.has(String(v).toLowerCase())).toBe(true)
    expect(new Set(stages).size).toBe(3)
    // skewed: the most frequent customer is well above the mean
    const counts = new Map<Scalar, number>()
    for (const v of values(T('fact_sales'), 'customer_id')) counts.set(v, (counts.get(v) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeGreaterThan((5000 / counts.size) * 3)
  })

  it('builds a contiguous calendar and keeps fact dates inside it and not in the future', () => {
    const dates = values(T('dim_date'), 'date') as Date[]
    expect(dates[0]).toEqual(makeDate(2024, 1, 1))
    expect(dates[dates.length - 1]).toEqual(makeDate(2026, 12, 31))
    for (let i = 1; i < dates.length; i++) expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(86400000)
    const i = dates.findIndex((d) => d.getTime() === makeDate(2025, 3, 9).getTime())
    expect(values(T('dim_date'), 'month_name')[i]).toBe('March')
    expect(values(T('dim_date'), 'quarter')[i]).toBe('Q1')
    expect(values(T('dim_date'), 'year_month')[i]).toBe('2025-03')
    expect(values(T('dim_date'), 'is_weekend')[i]).toBe(true)
    expect(values(T('dim_date'), 'date_key')[i]).toBe(20250309)
    const dateSet = new Set(dates.map((d) => d.getTime()))
    for (const v of values(T('fact_sales'), 'date') as Date[]) {
      expect(dateSet.has(v.getTime())).toBe(true)
      expect(v.getTime()).toBeLessThanOrEqual(TODAY.getTime())
    }
    // created ≤ modified
    const c = values(T('fact_sales'), 'created_at') as Date[]
    const m = values(T('fact_sales'), 'modified_at') as Date[]
    let ordered = 0
    for (let r = 0; r < c.length; r++) if (c[r].getTime() <= m[r].getTime() + 86400000) ordered++
    expect(ordered).toBe(c.length)
  })

  it('makes mined literals appear and dominate their columns', () => {
    const share = (t: string, c: string, v: Scalar): number => {
      const vs = values(T(t), c)
      return vs.filter((x) => x === v).length / vs.length
    }
    expect(share('fact_sales', 'outcome', 'Won')).toBeGreaterThan(0.6)
    expect(share('fact_sales', 'channel', 'Partner Portal')).toBeGreaterThan(0.6)
    expect(new Set(values(T('fact_sales'), 'hub'))).toEqual(new Set(['North Hub', 'South Hub']))
    expect(values(T('dim_customer'), 'segment')).toEqual(expect.arrayContaining(['Enterprise', 'Strategic "A" Accounts']))
    expect(values(T('dim_product'), 'category')).toEqual(expect.arrayContaining(['Gadgets', 'Widgets', 'Doohickeys']))
    expect(values(T('dim_customer'), 'city')).toEqual(expect.arrayContaining(['Springfield', 'Shelbyville']))
    expect(values(T('fact_sales'), 'is_returned')).toContain(true)
    expect(values(T('dim_product'), 'product_name').some((v) => typeof v === 'string' && v.includes('Turbo'))).toBe(true)
  })

  it('generates plausible values by column name', () => {
    const emails = values(T('dim_customer'), 'email') as string[]
    expect(emails.every((e) => /^[a-z.0-9]+@[a-z]+\.com$/.test(e))).toBe(true)
    const amounts = values(T('fact_sales'), 'amount') as number[]
    expect(Math.min(...amounts)).toBeGreaterThanOrEqual(0)
    expect(amounts.reduce((a, b) => a + b, 0) / amounts.length).toBeGreaterThan(100)
    const pct = values(T('fact_sales'), 'discount_pct') as number[]
    expect(pct.every((x) => x >= 0 && x <= 1)).toBe(true)
    expect(new Set(values(T('dim_customer'), 'is_active'))).toEqual(new Set([0, 1]))
  })

  it('fills image-URL columns with renderable placeholder pictures', () => {
    const badges = table('dim_badge', [col('badge_name', 'string'), col('badge_image', 'string', { dataCategory: 'ImageUrl' }), col('badge_link', 'string')])
    const model: SemanticModel = { name: 'M', culture: 'en-US', tables: [badges], relationships: [], expressions: [], roles: [] }
    const p: ProjectDocument = { model, data: emptyDataStore(), diagnostics: [] } as unknown as ProjectDocument
    generateSyntheticData(p, { seed: 3 })
    const t = p.data.tables.get('dim_badge')!
    const pictures = t.columns.find((c) => c.name === 'badge_image')!.values
    expect(pictures.length).toBeGreaterThan(0)
    for (const v of pictures) expect(String(v)).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/)
    expect(PLACEHOLDER_IMAGES).toContain(pictures[0])
    // other text columns are untouched by the image rule
    expect(String(t.columns.find((c) => c.name === 'badge_name')!.values[0])).not.toMatch(/^data:/)
  })

  it('is deterministic per seed', () => {
    const a = starSchema()
    const b = starSchema()
    const c = starSchema()
    generateSyntheticData(a, { seed: 42, today: TODAY, factRows: 2000 })
    generateSyntheticData(b, { seed: 42, today: TODAY, factRows: 2000 })
    generateSyntheticData(c, { seed: 43, today: TODAY, factRows: 2000 })
    expect(a.data.tables).toEqual(b.data.tables)
    expect(values(a.data.tables.get('fact_sales'), 'amount')).not.toEqual(values(c.data.tables.get('fact_sales'), 'amount'))
  })

  it('keeps loaded tables (onlyEmpty) and draws FKs from their real keys', () => {
    const q = starSchema()
    q.data.tables.set('dim_product', {
      rowCount: 2,
      columns: [
        { name: 'product_key', type: 'string', values: ['P1', 'P2'] },
        { name: 'product_name', type: 'string', values: ['One', 'Two'] },
        { name: 'category', type: 'string', values: ['A', 'B'] },
        { name: 'list_price', type: 'decimal', values: [1, 2] }
      ]
    })
    q.data.status.set('dim_product', { state: 'loaded', source: 'query', rowCount: 2 })
    const r = generateSyntheticData(q, { seed: 1, today: TODAY, factRows: 500 })
    expect(r.tables).not.toContain('dim_product')
    expect(new Set(values(q.data.tables.get('fact_sales'), 'product_key'))).toEqual(new Set(['P1', 'P2']))
  })

  it('evaluates literal-filtered measures to non-blank values with the DAX engine', () => {
    const engine = engineFor(p)
    for (const m of ['Won Amount', 'Enterprise Sales', 'Returned', 'Channel X', 'Treat', 'Turbo Rows', 'Total']) {
      const v = engine.evaluateScalar(`[${m}]`).value
      expect(v, m).not.toBeNull()
      expect(typeof v === 'number' ? v : 0, m).toBeGreaterThan(0)
    }
  })

  it('handles 1:1, many-to-many, snowflake and unique-FK relationships', () => {
    const customers = table('dim_client', [col('id', 'string'), col('name', 'string')])
    const orders = table('dim_orders', [col('id', 'string'), col('account_id', 'string'), col('owner_id', 'int64'), col('order_name', 'string')])
    const users = table('dim_employee', [col('id', 'int64'), col('full_name', 'string')])
    const profiles = table('dim_customer_profile', [col('account_id', 'string'), col('profile_group', 'string')])
    const lines = table('fact_order_lines', [col('order_id', 'string'), col('owner_id', 'int64'), col('report_date', 'dateTime'), col('amount', 'double')])
    const shipments = table('fact_shipments', [col('shipment_guid', 'string'), col('size', 'int64')])
    const returns = table('fact_returns', [col('id', 'string'), col('opened', 'dateTime')])
    const tags = table('fact_tags', [col('tag', 'string'), col('weight', 'double')])
    const tags2 = table('fact_tag_targets', [col('tag', 'string'), col('target', 'double')])
    const model: SemanticModel = {
      name: 'm',
      tables: [customers, orders, users, profiles, lines, shipments, returns, tags, tags2],
      relationships: [
        rel('fact_order_lines.order_id', 'dim_orders.id'),
        rel('dim_orders.account_id', 'dim_client.id'),
        rel('dim_orders.owner_id', 'dim_employee.id'),
        rel('fact_order_lines.owner_id', 'dim_employee.id', { isActive: false }),
        rel('dim_client.id', 'dim_customer_profile.account_id', { fromCardinality: 'one', crossFilteringBehavior: 'bothDirections' }),
        rel('fact_returns.id', 'fact_shipments.shipment_guid'),
        rel('fact_tags.tag', 'fact_tag_targets.tag', { fromCardinality: 'many', toCardinality: 'many' })
      ],
      expressions: [],
      roles: []
    }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    generateSyntheticData(q, { seed: 3, today: TODAY, factRows: 3000 })
    const get = (t: string, c: string): Scalar[] => values(q.data.tables.get(t), c)
    const subset = (many: Scalar[], one: Scalar[]): void => {
      const s = new Set(one.map(key))
      for (const v of many) if (v !== null) expect(s.has(key(v))).toBe(true)
    }
    const unique = (vs: Scalar[]): void => expect(new Set(vs.map(key)).size).toBe(vs.length)
    unique(get('dim_orders', 'id'))
    unique(get('dim_client', 'id'))
    unique(get('dim_employee', 'id'))
    unique(get('dim_customer_profile', 'account_id'))
    unique(get('fact_shipments', 'shipment_guid'))
    subset(get('fact_order_lines', 'order_id'), get('dim_orders', 'id'))
    subset(get('dim_orders', 'account_id'), get('dim_client', 'id'))
    subset(get('dim_orders', 'owner_id'), get('dim_employee', 'id'))
    subset(get('fact_order_lines', 'owner_id'), get('dim_employee', 'id'))
    subset(get('fact_returns', 'id'), get('fact_shipments', 'shipment_guid'))
    // 1:1 — the smaller side nests in the larger
    const a = get('dim_client', 'id')
    const b = get('dim_customer_profile', 'account_id')
    if (a.length <= b.length) subset(a, b)
    else subset(b, a)
    // m:m share one value domain
    const t1 = new Set(get('fact_tags', 'tag').map(key))
    expect(get('fact_tag_targets', 'tag').some((v) => t1.has(key(v)))).toBe(true)
    // guid-named keys look like GUIDs
    expect(String(get('fact_shipments', 'shipment_guid')[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(String(get('dim_employee', 'full_name')[0])).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
  })

  it('keeps sort-by columns consistent with the sorted column', () => {
    const f = table('fact_pipeline', [col('stage', 'string', { sortByColumn: 'stage_order' }), col('stage_order', 'int64'), col('report_date', 'dateTime', { sortByColumn: 'report_date_desc' }), col('report_date_desc', 'int64'), col('outcome', 'string'), col('order_outcome', 'int64')])
    f.measures.push({ name: 'm', expression: 'CALCULATE ( COUNTROWS ( fact_pipeline ), fact_pipeline[stage] IN { "Initiated", "Qualified", "Closed Won" } )' })
    const model: SemanticModel = { name: 'm', tables: [f], relationships: [], expressions: [], roles: [] }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    generateSyntheticData(q, { seed: 2, today: TODAY, factRows: 800 })
    const t = q.data.tables.get('fact_pipeline')!
    const check = (x: string, y: string): Map<string, Scalar> => {
      const m = new Map<string, Scalar>()
      const xs = values(t, x)
      const ys = values(t, y)
      xs.forEach((v, i) => {
        const k = key(v)
        if (m.has(k)) expect(ys[i]).toEqual(m.get(k))
        else m.set(k, ys[i])
      })
      return m
    }
    const stageOrder = check('stage', 'stage_order')
    expect(stageOrder.get(key('Initiated'))).toBe(1)
    expect(stageOrder.get(key('Closed Won'))).toBe(3)
    const dates = check('report_date', 'report_date_desc')
    for (const [k, v] of dates) expect(v).toBe(-(Math.round(Number(k.slice(1)) / 86400000) + 25569))
    check('outcome', 'order_outcome')
  })

  it('sizes tiny lookup dimensions to their mined domain', () => {
    const status = table('dim_status', [col('status', 'string'), col('sort_order', 'int64')])
    const f = table('fact_tickets', [col('status', 'string'), col('opened_at', 'dateTime'), col('minutes', 'int64')])
    f.measures.push({ name: 'Open', expression: 'CALCULATE ( COUNTROWS ( fact_tickets ), dim_status[status] IN { "Open", "Pending", "Closed" } )' })
    const model: SemanticModel = { name: 'm', tables: [status, f], relationships: [rel('fact_tickets.status', 'dim_status.status')], expressions: [], roles: [] }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    generateSyntheticData(q, { seed: 3, today: TODAY, factRows: 1000 })
    expect(values(q.data.tables.get('dim_status'), 'status')).toEqual(['Open', 'Pending', 'Closed'])
    expect(values(q.data.tables.get('dim_status'), 'sort_order')).toEqual([1, 2, 3])
    expect(new Set(values(q.data.tables.get('fact_tickets'), 'status'))).toEqual(new Set(['Open', 'Pending', 'Closed']))
  })

  it('keeps LOOKUPVALUE search columns unique so calculated-column lookups resolve', () => {
    const states = table('dim_region_states', [col('state', 'string'), col('state_code', 'string'), col('region', 'string')])
    const f = table('fact_visits', [
      col('visit_id', 'int64'),
      col('client_state', 'string'),
      col('visited_on', 'dateTime'),
      {
        name: 'visit_region',
        dataType: 'string',
        kind: 'calculated',
        expression:
          'VAR _s = fact_visits[client_state] RETURN COALESCE ( LOOKUPVALUE ( dim_region_states[region], dim_region_states[state_code], _s ), LOOKUPVALUE ( dim_region_states[region], dim_region_states[state], _s ), "Unknown" )'
      } as ColumnDef
    ])
    const model: SemanticModel = { name: 'm', tables: [states, f], relationships: [], expressions: [], roles: [] }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    expect(mineModel(q).domains.get(domainKey('dim_region_states', 'state_code'))?.lookupKey).toBe(true)
    generateSyntheticData(q, { seed: 5, today: TODAY, factRows: 2000, dimRows: 60 })
    const dim = q.data.tables.get('dim_region_states')!
    for (const c of ['state', 'state_code']) {
      const vs = values(dim, c).filter((v) => v !== null)
      expect(new Set(vs.map(key)).size).toBe(vs.length)
    }
    const engine = createEngine(q.model, q.data)
    expect(engine.processCalculated()).toEqual([])
  })

  it('takes the week-end weekday from mined week-end literals (eow / week_ending columns)', () => {
    expect(calendarValue('report_eow', 'dateTime', makeDate(2026, 9, 2), { today: TODAY, fiscalStartMonth: 7 })).toEqual(makeDate(2026, 9, 5))
    expect(calendarValue('report_eow', 'dateTime', makeDate(2026, 9, 2), { today: TODAY, fiscalStartMonth: 7, weekEndDow: 0 })).toEqual(makeDate(2026, 9, 6))
    expect(calendarValue('week_start', 'dateTime', makeDate(2026, 9, 6), { today: TODAY, fiscalStartMonth: 7, weekEndDow: 0 })).toEqual(makeDate(2026, 8, 31))
    const cal = table('dim_calendar', [col('date', 'dateTime'), col('year', 'int64'), col('month_name', 'string'), col('report_eow', 'dateTime')], { dataCategory: 'Time' })
    const f = table('fact_tickets', [col('ticket_id', 'int64'), col('opened_on', 'dateTime')])
    const model: SemanticModel = { name: 'm', tables: [cal, f], relationships: [rel('fact_tickets.opened_on', 'dim_calendar.date')], expressions: [], roles: [] }
    // a hierarchy slicer saved on (2026, September, Sunday 2026-09-06)
    const sundayEow = { Column: { Expression: { SourceRef: { Entity: 'dim_calendar' } }, Property: 'report_eow' } }
    const report = {
      origin: 'pbir',
      report: {},
      pagesMeta: { pageOrder: ['p1'] },
      pages: [{ name: 'p1', json: { filterConfig: { filters: [{ name: 'f', field: sundayEow, type: 'Categorical', filter: { Version: 2, From: [{ Name: 'd', Entity: 'dim_calendar', Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'd' } }, Property: 'report_eow' } }], Values: [[{ Literal: { Value: "datetime'2026-09-06T00:00:00'" } }]] } } }] } }] } }, visuals: [] }],
      bookmarks: [],
      theme: {},
      resources: {},
      extraFiles: {},
      diagnostics: []
    } as unknown as ReportDocument
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
    generateSyntheticData(q, { seed: 2, today: TODAY, factRows: 1000 })
    const eows = values(q.data.tables.get('dim_calendar'), 'report_eow') as Date[]
    expect(new Set(eows.map((d) => d.getUTCDay()))).toEqual(new Set([0]))
    expect(eows.some((d) => d.getTime() === makeDate(2026, 9, 6).getTime())).toBe(true)
  })

  it('ignores engine-derived calculated tables when the engine was built before generating (app order)', () => {
    const cal = table('dim_date', [col('date', 'dateTime'), col('year', 'int64')], { dataCategory: 'Time' })
    const local: TableDef = {
      name: 'LocalDateTable_x',
      columns: [{ name: 'Date', dataType: 'dateTime', kind: 'calculatedTableColumn', sourceColumn: '[Date]' } as ColumnDef],
      measures: [],
      hierarchies: [],
      partitions: [{ name: 'LocalDateTable_x', sourceType: 'calculated', expression: "Calendar(Date(Year(MIN('dim_date'[date])), 1, 1), Date(Year(MAX('dim_date'[date])), 12, 31))" }]
    }
    const f = table('fact_visits', [col('visit_id', 'int64'), col('visited_on', 'dateTime')])
    const model: SemanticModel = {
      name: 'm',
      tables: [cal, local, f],
      relationships: [rel('fact_visits.visited_on', 'dim_date.date'), rel('dim_date.date', 'LocalDateTable_x.Date')],
      expressions: [],
      roles: []
    }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    // the app builds the engine as soon as the project is set (no data yet), then generates sample data
    createEngine(q.model, q.data).processCalculated()
    generateSyntheticData(q, { seed: 4, today: TODAY, factRows: 500 })
    const dates = values(q.data.tables.get('dim_date'), 'date') as Array<Date | null>
    expect(dates.every((d) => d instanceof Date)).toBe(true)
    expect(Math.min(...dates.map((d) => d!.getUTCFullYear()))).toBeGreaterThanOrEqual(2020)
    expect(Math.max(...dates.map((d) => d!.getUTCFullYear()))).toBeLessThanOrEqual(2027)
  })

  it('keeps part/whole ratios at or below 100% (DIVIDE of filtered counts on one table)', () => {
    const calls = table('fact_calls', [col('call_id', 'int64'), col('sla_qualified', 'int64'), col('sla_passed', 'int64'), col('direction', 'string'), col('abandoned', 'boolean'), col('started_at', 'dateTime')])
    calls.measures.push(
      { name: 'Qualified', expression: 'CALCULATE ( COUNTROWS ( fact_calls ), KEEPFILTERS ( fact_calls[sla_qualified] = 1 ) )' },
      { name: 'Passed', expression: 'CALCULATE ( COUNTROWS ( fact_calls ), KEEPFILTERS ( fact_calls[sla_passed] = 1 ) )' },
      { name: 'Service Level', expression: 'DIVIDE ( [Passed], [Qualified] )' },
      { name: 'Inbound', expression: 'CALCULATE ( COUNTROWS ( fact_calls ), fact_calls[direction] = "Inbound" )' },
      { name: 'Abandon Rate', expression: 'VAR _a = CALCULATE ( [Inbound], fact_calls[abandoned] = TRUE () ) RETURN _a / [Inbound]' }
    )
    const model: SemanticModel = { name: 'm', tables: [calls], relationships: [], expressions: [], roles: [] }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model, data: emptyDataStore(), diagnostics: [], dirty: false }
    const mined = mineModel(q)
    expect(mined.implications).toContainEqual({ table: 'fact_calls', when: [{ column: 'sla_passed', values: [1] }], then: [{ column: 'sla_qualified', value: 1 }] })
    generateSyntheticData(q, { seed: 9, today: TODAY, factRows: 3000 })
    const t = q.data.tables.get('fact_calls')!
    const passed = values(t, 'sla_passed')
    const qualified = values(t, 'sla_qualified')
    expect(passed.some((v) => v === 1)).toBe(true)
    passed.forEach((v, r) => v === 1 && expect(qualified[r]).toBe(1))
    const engine = createEngine(q.model, q.data)
    engine.processCalculated()
    const sl = engine.evaluateScalar('[Service Level]').value as number
    expect(sl).toBeGreaterThan(0)
    expect(sl).toBeLessThanOrEqual(1)
  })

  it('generates 20 facts x 40 columns x 20k rows quickly', () => {
    const tables: TableDef[] = []
    const relationships: RelationshipDef[] = []
    tables.push(table('dim_customer', [col('id', 'int64'), col('name', 'string'), col('segment', 'string')]))
    tables.push(table('dim_date', [col('date', 'dateTime'), col('year', 'int64'), col('month_name', 'string')], { dataCategory: 'Time' }))
    const kinds: Array<[string, DataType]> = [
      ['amount', 'double'], ['quantity', 'int64'], ['status', 'string'], ['owner_name', 'string'], ['created_at', 'dateTime'], ['is_open', 'boolean'],
      ['rate', 'double'], ['notes', 'string'], ['city', 'string'], ['score', 'int64']
    ]
    for (let f = 0; f < 20; f++) {
      const cols = [col('customer_id', 'int64'), col('date', 'dateTime')]
      for (let i = 0; cols.length < 40; i++) {
        const [n, t] = kinds[i % kinds.length]
        cols.push(col(`${n}_${i}`, t))
      }
      tables.push(table(`fact_${f}`, cols))
      relationships.push(rel(`fact_${f}.customer_id`, 'dim_customer.id'), rel(`fact_${f}.date`, 'dim_date.date'))
    }
    const q: ProjectDocument = { id: 'x', name: 'x', source: { kind: 'new' }, model: { name: 'm', tables, relationships, expressions: [], roles: [] }, data: emptyDataStore(), diagnostics: [], dirty: false }
    const t0 = performance.now()
    generateSyntheticData(q, { seed: 1, today: TODAY, factRows: 100000 })
    const ms = performance.now() - t0
    const total = [...q.data.tables.values()].reduce((a, t) => a + t.rowCount * t.columns.length, 0)
    console.info(`[synthetic perf] ${total.toLocaleString()} values in ${ms.toFixed(0)} ms`)
    const n0 = q.data.tables.get('fact_0')!.rowCount
    expect(n0).toBeGreaterThan(16000)
    expect(n0).toBeLessThan(24000)
    expect(ms).toBeLessThan(6000)
  })
})

// ---------------------------------------------------------------------------------------------
// Report-aware generation: date literals, snapshots, coverage, conjunctions, calculated columns
// ---------------------------------------------------------------------------------------------

function sqIn(alias: string, entity: string, column: string, literals: string[]): unknown {
  return {
    Version: 2,
    From: [{ Name: alias, Entity: entity, Type: 0 }],
    Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: alias } }, Property: column } }], Values: literals.map((l) => [{ Literal: { Value: l } }]) } } }]
  }
}

function retailProject(): ProjectDocument {
  const date = table('dim_date', [col('date', 'dateTime'), col('year', 'int64'), col('month_name', 'string')], { dataCategory: 'Time' })
  const product = table('dim_product', [col('product_key', 'string'), col('product_name', 'string'), col('category', 'string')])
  const customer = table('dim_customer', [col('id', 'int64'), col('name', 'string'), col('segment', 'string'), col('customer_class', 'string')])
  const orders = table('fact_orders', [
    col('order_date', 'dateTime'),
    col('product_key', 'string'),
    col('customer_id', 'int64'),
    col('status', 'string'),
    col('excluded', 'int64'),
    col('channel', 'string'),
    col('amount', 'double'),
    { name: 'customer_type', dataType: 'string', kind: 'calculated', expression: 'COALESCE ( RELATED ( dim_customer[customer_class] ), "N/A" )' }
  ])
  const stock = table('fact_inventory_balance', [col('as_of_date', 'dateTime'), col('product_key', 'string'), col('quantity_on_hand', 'int64')])
  const measures = table('_measures', [col('Column1', 'string')], {
    partitions: [{ name: '_measures', sourceType: 'm', expression: 'let Source = Table.FromRows({}, type table [Column1 = text]) in Source' }],
    measures: [
      { name: 'Base', expression: 'CALCULATE ( SUM ( fact_orders[amount] ), fact_orders[excluded] = 0 )' },
      { name: 'Won Clean', expression: 'CALCULATE ( SUM ( fact_orders[amount] ), fact_orders[status] = "Won", fact_orders[excluded] = 0 )' },
      { name: 'Won Enterprise', expression: 'CALCULATE ( [Base], fact_orders[status] = "Won", dim_customer[segment] = "Enterprise" )' },
      { name: 'Employee Orders', expression: 'CALCULATE ( COUNTROWS ( fact_orders ), fact_orders[customer_type] = "Employee" )' },
      { name: 'Stock', expression: 'SUM ( fact_inventory_balance[quantity_on_hand] )' }
    ]
  })
  const model: SemanticModel = {
    name: 'Retail',
    tables: [measures, date, product, customer, orders, stock],
    relationships: [
      rel('fact_orders.order_date', 'dim_date.date'),
      rel('fact_orders.product_key', 'dim_product.product_key'),
      rel('fact_orders.customer_id', 'dim_customer.id'),
      rel('fact_inventory_balance.product_key', 'dim_product.product_key')
    ],
    expressions: [],
    roles: []
  }
  const slicer = (name: string, filter: unknown) => ({ name, json: { visual: { visualType: 'slicer', objects: { general: [{ properties: { filter: { filter } } }] } } } })
  const report: ReportDocument = {
    origin: 'pbir',
    report: {},
    pagesMeta: { pageOrder: ['p1'] },
    pages: [
      {
        name: 'p1',
        json: {},
        visuals: [
          slicer('s1', sqIn('d', 'dim_date', 'date', ["datetime'2019-06-28T00:00:00'"])),
          slicer('s2', sqIn('s', 'fact_inventory_balance', 'as_of_date', ["datetime'2026-03-15T00:00:00'"])),
          {
            name: 'card',
            json: {
              visual: { visualType: 'card', query: { queryState: { Values: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: '_measures' } }, Property: 'Won Clean' } } }] } } } },
              filterConfig: { filters: [{ name: 'f', filter: sqIn('p', 'dim_product', 'category', ["'Gadgets'"]) }] }
            }
          }
        ]
      }
    ],
    bookmarks: [],
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics: []
  }
  return { id: 'retail', name: 'Retail', source: { kind: 'new' }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

describe('generateSyntheticData — report-aware', () => {
  const p = retailProject()
  const mined = mineModel(p)
  generateSyntheticData(p, { seed: 3, today: TODAY, factRows: 8000 })
  const T = (n: string): TableData => p.data.tables.get(n)!
  const day = (y: number, m: number, d: number): number => makeDate(y, m, d).getTime()
  const countOn = (t: string, c: string, ms: number): number => values(T(t), c).filter((v) => v instanceof Date && v.getTime() === ms).length

  it('mines datetime literals from slicers and conjunctions from visuals + measures', () => {
    expect(mined.domains.get(domainKey('dim_date', 'date'))?.values).toEqual([makeDate(2019, 6, 28)])
    expect(mined.domains.get(domainKey('fact_inventory_balance', 'as_of_date'))?.values).toEqual([makeDate(2026, 3, 15)])
    const shapes = mined.conjunctions.map((c) => c.conds.map((x) => `${x.table}[${x.column}]`).sort().join(' & '))
    expect(shapes).toContain('fact_orders[excluded] & fact_orders[status]')
    expect(shapes).toContain('dim_customer[segment] & fact_orders[excluded] & fact_orders[status]')
    // the card: page slicers + visual filter + the measure's own filters
    expect(shapes.some((x) => x.includes('dim_date[date]') && x.includes('dim_product[category]') && x.includes('fact_orders[status]'))).toBe(true)
    // calculated column filter pushed back to the column it is computed from
    expect(mined.domains.get(domainKey('dim_customer', 'customer_class'))?.values).toContain('Employee')
  })

  it('extends the calendar to every mined date and puts fact rows on it', () => {
    const dates = values(T('dim_date'), 'date') as Date[]
    expect(dates[0]).toEqual(makeDate(2019, 1, 1))
    expect(dates[dates.length - 1]).toEqual(makeDate(2026, 12, 31))
    expect(countOn('fact_orders', 'order_date', day(2019, 6, 28))).toBeGreaterThanOrEqual(3)
  })

  it('generates periodic snapshots with many rows per snapshot date, including mined ones', () => {
    const snaps = values(T('fact_inventory_balance'), 'as_of_date') as Date[]
    const perDate = new Map<number, number>()
    for (const d of snaps) perDate.set(d.getTime(), (perDate.get(d.getTime()) ?? 0) + 1)
    expect(perDate.size).toBeGreaterThanOrEqual(24)
    const counts = [...perDate.values()].sort((a, b) => a - b)
    const median = counts[Math.floor(counts.length / 2)]
    expect(median).toBeGreaterThanOrEqual(10)
    expect(perDate.get(day(2026, 3, 15)) ?? 0).toBeGreaterThanOrEqual(median * 0.5)
    // month ends dominate the cadence
    expect(perDate.has(day(2025, 1, 31))).toBe(true)
  })

  it('gives every dimension member fact rows', () => {
    const covered = (fact: string, fk: string, dim: string, pk: string): void => {
      const present = new Set(values(T(fact), fk).map(key))
      for (const v of values(T(dim), pk)) expect(present.has(key(v)), `${dim}.${pk}=${String(v)}`).toBe(true)
    }
    covered('fact_orders', 'customer_id', 'dim_customer', 'id')
    covered('fact_orders', 'product_key', 'dim_product', 'product_key')
    covered('fact_inventory_balance', 'product_key', 'dim_product', 'product_key')
  })

  it('seeds rows that satisfy multi-column conditions at once', () => {
    const f = T('fact_orders')
    const status = values(f, 'status')
    const excluded = values(f, 'excluded')
    const cust = values(f, 'customer_id')
    const prod = values(f, 'product_key')
    const date = values(f, 'order_date') as Date[]
    const seg = new Map(values(T('dim_customer'), 'id').map((id, i) => [id, values(T('dim_customer'), 'segment')[i]]))
    const cat = new Map(values(T('dim_product'), 'product_key').map((k, i) => [k, values(T('dim_product'), 'category')[i]]))
    let wonClean = 0
    let wonEnterprise = 0
    let card = 0
    for (let r = 0; r < f.rowCount; r++) {
      if (status[r] !== 'Won' || excluded[r] !== 0) continue
      wonClean++
      if (seg.get(cust[r]) === 'Enterprise') wonEnterprise++
      if (cat.get(prod[r]) === 'Gadgets' && date[r].getTime() === day(2019, 6, 28)) card++
    }
    expect(wonClean).toBeGreaterThan(f.rowCount * 0.02)
    expect(wonEnterprise).toBeGreaterThanOrEqual(3)
    expect(card).toBeGreaterThanOrEqual(1)
  })

  it('makes the measures non-blank in the DAX engine, also under the report filters', () => {
    const engine = engineFor(p)
    for (const m of ['Base', 'Won Clean', 'Won Enterprise', 'Employee Orders', 'Stock']) {
      const v = engine.evaluateScalar(`[${m}]`).value
      expect(typeof v === 'number' ? v : 0, m).toBeGreaterThan(0)
    }
    const page = p.report!.pages[0]
    const filters = page.visuals.flatMap((v: any) => [v.json.visual?.objects?.general?.[0]?.properties?.filter?.filter, ...(v.json.filterConfig?.filters ?? []).map((f: any) => f.filter)]).filter(Boolean)
    const card = engine.evaluateScalar('[Won Clean]', filters.filter((f: any) => f.From[0].Entity !== 'fact_inventory_balance'))
    expect(typeof card.value === 'number' ? card.value : 0).toBeGreaterThan(0)
    const stock = engine.evaluateScalar('[Stock]', [filters.find((f: any) => f.From[0].Entity === 'fact_inventory_balance')])
    expect(typeof stock.value === 'number' ? stock.value : 0).toBeGreaterThan(0)
  })

  it('leaves calculated tables to the engine', () => {
    const q = starSchema()
    const res = generateSyntheticData(q, { seed: 1, today: TODAY, factRows: 1000 })
    expect(res.tables).not.toContain('dim_pipeline')
    expect(q.data.tables.has('dim_pipeline')).toBe(false)
    engineFor(q)
    expect(q.data.tables.get('dim_pipeline')?.rowCount).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------
// test-only TMDL loader sanity
// ---------------------------------------------------------------------------------------------

describe('tmdl-lite', () => {
  it('parses multi-line expressions, fences and properties', () => {
    const src = [
      'table T',
      '\tdataCategory: Time',
      '',
      '\tmeasure m1 = SUM(T[a])',
      '\t\tformatString: 0',
      '',
      '\tmeasure \'m 2\' =',
      '\t\t\t',
      '\t\t\tVAR x = 1',
      '\t\t\tRETURN x',
      '\t\tlineageTag: abc',
      '',
      '\tcolumn c = ```',
      '\t\t\tIF(',
      '\t\t\t  1, 2)',
      '\t\t\t```',
      '\t\tdataType: int64',
      '',
      '\tcolumn a',
      '\t\tdataType: double',
      '\t\tsourceColumn: a',
      '',
      '\tpartition T = m',
      '\t\tmode: import',
      '\t\tsource =',
      '\t\t\t\tlet',
      '\t\t\t\t    S = 1',
      '\t\t\t\tin S',
      ''
    ].join('\n')
    const [t] = parseTmdl(src)
    expect(t.keyword).toBe('table')
    const kids = Object.fromEntries(t.children.map((c) => [c.name || c.keyword, c]))
    expect(kids['m1'].value).toBe('SUM(T[a])')
    expect(kids['m 2'].value).toBe('VAR x = 1\nRETURN x')
    expect(kids['c'].value).toBe('IF(\n  1, 2)')
    expect(kids['T'].value).toBe('m')
    expect(kids['T'].children.find((c) => c.keyword === 'source')?.value).toBe('let\n    S = 1\nin S')
  })
})

// ---------------------------------------------------------------------------------------------
// Optional external corpus of PBIP projects (TMDL + PBIR, no data), read-only. Set LUMEN_CORPUS_DIR to enable.
// Only generic properties are asserted; nothing from the corpus is named here.
// ---------------------------------------------------------------------------------------------

const CORPUS = process.env.LUMEN_CORPUS_DIR ?? ''

function findSemanticModels(dir: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (!statSync(p).isDirectory()) continue
    if (e.endsWith('.SemanticModel')) out.push(p)
    else out.push(...findSemanticModels(p, depth + 1))
  }
  return out.sort()
}

/**
 * The corpus is client-confidential: its `.pbi/cache.abf` must never be read or decoded. Wrap the Node
 * FileSystem so that file is invisible (list/exists/stat) and unreadable, whatever the reader's options.
 */
function corpusSafeFs(base: FileSystem): FileSystem {
  const blocked = (p: string): boolean => /(^|\/)cache\.abf$/i.test(p)
  return {
    ...base,
    readFile: async (p) => {
      if (blocked(p)) throw new Error('cache.abf is off-limits in the corpus')
      return base.readFile(p)
    },
    readText: async (p) => {
      if (blocked(p)) throw new Error('cache.abf is off-limits in the corpus')
      return base.readText(p)
    },
    list: async (d) => (await base.list(d)).filter((e) => !blocked(e.path) && !blocked(e.name)),
    exists: async (p) => (blocked(p) ? false : base.exists(p)),
    stat: async (p) => (blocked(p) ? null : base.stat(p)),
    writeFile: async () => {
      throw new Error('corpus is read-only')
    },
    mkdirp: async () => {
      throw new Error('corpus is read-only')
    },
    remove: async () => {
      throw new Error('corpus is read-only')
    }
  }
}

async function loadCorpusProject(dir: string): Promise<ProjectDocument> {
  // Prefer the real reader when it is implemented (model + report only, never data); fall back to the test-only loader.
  try {
    const [{ openProject }, { nodeFs }] = await Promise.all([import('../../io/open'), import('../../io/nodefs')])
    const p = await openProject(dir, corpusSafeFs(nodeFs), { loadData: false })
    if (p.model.tables.length) {
      // defensive: whatever a reader put in the data store, start from an empty one
      p.data = emptyDataStore()
      if (!p.report) p.report = loadPbipLite(dir).report
      return p
    }
  } catch {
    /* reader not available yet */
  }
  return loadPbipLite(dir)
}

describe.skipIf(!process.env.LUMEN_CORPUS_DIR)('generateSyntheticData — external corpus', () => {
  const models = findSemanticModels(CORPUS)

  it('finds the corpus models', () => {
    expect(models.length).toBeGreaterThanOrEqual(3)
  })

  for (const dir of models) {
    const index = models.indexOf(dir) + 1
    it(`generates consistent data for corpus model #${index}`, async () => {
      const p = await loadCorpusProject(dir)
      expect(p.model.tables.length).toBeGreaterThan(0)
      const mined = mineModel(p)
      const domains = mined.domains
      const t0 = performance.now()
      const res = generateSyntheticData(p, { seed: 11, today: TODAY, factRows: 6000, domains, conjunctions: mined.conjunctions, implications: mined.implications })
      const ms = performance.now() - t0
      expect(ms).toBeLessThan(10000)
      expect(res.skipped.every((x) => !res.tables.includes(x.table) || x.reason === 'measureTable')).toBe(true)

      // every non-calculated table with data columns has data
      for (const t of p.model.tables) {
        const isCalc = isCalculatedTable(t) || !!t.calculationGroup || t.partitions.some((x) => x.sourceType === 'calculationGroup')
        const hasData = t.columns.some((c) => c.kind === 'data')
        if (isCalc || !hasData) {
          expect(res.tables, t.name).not.toContain(t.name)
          continue
        }
        expect(res.tables, t.name).toContain(t.name)
        const data = p.data.tables.get(t.name)!
        expect(data.columns.map((c) => c.name)).toEqual(t.columns.filter((c) => c.kind === 'data').map((c) => c.name))
        // "Enter data" tables are decoded (empty measure-holder tables legitimately have 0 rows)
        const enterData = t.partitions.some((x) => x.sourceType === 'm' && isEnterDataPartition(x.expression))
        const emptyLiteral = t.partitions.some((x) => x.sourceType === 'm' && /Table\.FromRows\s*\(\s*\{\s*\}/.test(x.expression ?? ''))
        if (!enterData && !emptyLiteral) expect(data.rowCount, t.name).toBeGreaterThan(0)
      }

      // FK integrity for active and inactive relationships whose one side is generated (or a DATATABLE)
      const valuesOf = (tn: string, cn: string): Scalar[] | undefined => {
        const t = p.model.tables.find((x) => x.name.toLowerCase() === tn.toLowerCase())
        if (!t) return undefined
        const data = p.data.tables.get(t.name)
        const c = data?.columns.find((x) => x.name.toLowerCase() === cn.toLowerCase())
        if (c) return c.values
        return calculatedTableLiterals(t)?.get(t.columns.find((x) => x.name.toLowerCase() === cn.toLowerCase())?.name ?? '') ?? undefined
      }
      let checked = 0
      for (const r of p.model.relationships) {
        const from = valuesOf(r.fromTable, r.fromColumn)
        const to = valuesOf(r.toTable, r.toColumn)
        if (!from || !to) continue
        const pairs: Array<[Scalar[], Scalar[]]> = []
        if (r.toCardinality !== 'many' && r.fromCardinality !== 'one') pairs.push([from, to])
        if (r.fromCardinality === 'one' && r.toCardinality === 'many') pairs.push([to, from])
        for (const [many, one] of pairs) {
          const set = new Set(one.map(key))
          const bad = many.filter((v) => v !== null && !set.has(key(v)))
          expect(bad.length, `${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}`).toBe(0)
          checked++
        }
        const fromGenerated = res.tables.includes(r.fromTable)
        const toGenerated = res.tables.includes(r.toTable)
        if (r.toCardinality !== 'many' && toGenerated) {
          expect(new Set(to.map(key)).size, `${r.toTable}.${r.toColumn} unique`).toBe(to.length)
        }
        if (r.fromCardinality === 'one' && fromGenerated) {
          expect(new Set(from.map(key)).size, `${r.fromTable}.${r.fromColumn} unique`).toBe(from.length)
        }
      }
      expect(checked).toBeGreaterThanOrEqual(0)

      // mined literals appear in their (generated, data) columns
      let minedChecked = 0
      let withheldChecked = 0
      for (const d of domains.values()) {
        if (!res.tables.includes(d.table)) continue
        const t = p.model.tables.find((x) => x.name === d.table)!
        const c = t.columns.find((x) => x.name === d.column)!
        if (c.kind !== 'data') continue
        const data = p.data.tables.get(d.table)!
        if (data.rowCount < d.values.length) continue
        const vs = values(data, d.column)
        const present = new Set(vs.map(key))
        const isDateTable = c.dataType !== 'dateTime' && (t.dataCategory === 'Time' || /calendar|date/i.test(t.name))
        if (isDateTable) continue
        // privacy: literals are never copied into name-like / id-like / free-text columns (placeholders and rows of
        // the model's own literal tables excepted) — and an invented value never equals one either
        const sem = columnSemantics(c, t)
        const isKey = p.model.relationships.some((r) => (r.fromTable === t.name && r.fromColumn === c.name) || (r.toTable === t.name && r.toColumn === c.name))
        if (isIdentifyingColumn(sem) || (isKey && c.dataType === 'string' && ['idCode', 'idSeq', 'guid', 'generic'].includes(sem.sem))) {
          for (const v of d.values) {
            if (typeof v !== 'string' || isPlaceholderLabel(v) || d.linked.includes(v)) continue
            if (isKey && !isIdentifyingColumn(sem)) continue
            expect(present.has(key(v)), `an identifying literal was copied into column #${t.columns.indexOf(c) + 1} of table #${p.model.tables.indexOf(t) + 1}`).toBe(false)
            withheldChecked++
          }
          continue
        }
        // survey scales keep their skew; literals outside the scale are not forced in
        if ((sem.sem === 'score' || sem.sem === 'nps') && c.dataType !== 'string') continue
        // whole-number keys: only literals in the generated range are kept
        if (isKey && c.dataType === 'int64') continue
        for (const v of d.values) {
          if (v instanceof Date && c.dataType !== 'dateTime') continue
          const coerced =
            v instanceof Date
              ? v
              : c.dataType === 'string'
                ? String(typeof v === 'boolean' ? (v ? 'True' : 'False') : v)
                : c.dataType === 'boolean'
                  ? typeof v === 'boolean'
                    ? v
                    : v !== 0
                  : typeof v === 'number'
                    ? v
                    : Number(v)
          if (typeof coerced === 'number' && !Number.isFinite(coerced)) continue
          if (c.dataType === 'int64' && typeof coerced === 'number' && !Number.isInteger(coerced)) continue
          expect(present.has(key(coerced as Scalar)), `${d.table}[${d.column}] should contain ${JSON.stringify(v)}`).toBe(true)
          minedChecked++
        }
        for (const s of d.contains) {
          if (c.dataType !== 'string') continue
          expect(vs.some((v) => typeof v === 'string' && v.toLowerCase().includes(s.toLowerCase())), `${d.table}[${d.column}] contains ${s}`).toBe(true)
        }
      }
      expect(minedChecked).toBeGreaterThanOrEqual(0)
      expect(withheldChecked).toBeGreaterThanOrEqual(0)

      // determinism on the real model
      const again = await loadCorpusProject(dir)
      generateSyntheticData(again, { seed: 11, today: TODAY, factRows: 6000 })
      for (const n of res.tables) expect(again.data.tables.get(n), n).toEqual(p.data.tables.get(n))
    })
  }

  it('literal-filtered measures are non-blank through the DAX engine in every model', async () => {
    let evaluatedAll = 0
    let nonBlankAll = 0
    for (const dir of models) {
      const p = await loadCorpusProject(dir)
      generateSyntheticData(p, { seed: 5, today: TODAY, factRows: 6000 })
      const engine = engineFor(p)
      // with the calculated tables computed: the "one" side of every relationship is unique, whatever kind of table
      // is on its many side (a calculated fact related to imported dimensions included)
      for (const r of p.model.relationships) {
        const sides: Array<[string, string]> = []
        if (r.toCardinality !== 'many') sides.push([r.toTable, r.toColumn])
        if (r.fromCardinality === 'one') sides.push([r.fromTable, r.fromColumn])
        for (const [tn, cn] of sides) {
          const vs = p.data.tables.get(tn)?.columns.find((c) => c.name.toLowerCase() === cn.toLowerCase())?.values.filter((v) => v !== null)
          if (!vs?.length) continue
          const n = models.indexOf(dir) + 1
          expect(new Set(vs.map(key)).size, `corpus model #${n}, relationship #${p.model.relationships.indexOf(r) + 1}: one side unique`).toBe(vs.length)
        }
      }
      const candidates = p.model.tables.flatMap((t) => t.measures).filter((m) => LITERAL_FILTER.test(m.expression) && !CONTEXT_DEPENDENT.test(m.expression))
      let evaluated = 0
      let nonBlank = 0
      for (const meas of candidates) {
        const v = measureValue(engine, meas.name)
        if (v === undefined) continue
        evaluated++
        if (v !== null && v !== 0) nonBlank++
      }
      evaluatedAll += evaluated
      nonBlankAll += nonBlank
      if (evaluated >= 3) expect(nonBlank / evaluated, `corpus model #${models.indexOf(dir) + 1}: ${nonBlank}/${evaluated}`).toBeGreaterThanOrEqual(0.8)
    }
    console.info(`[synthetic test] corpus: ${nonBlankAll}/${evaluatedAll} literal-filtered measures non-blank`)
    expect(evaluatedAll).toBeGreaterThan(0)
    expect(nonBlankAll / evaluatedAll).toBeGreaterThan(0.9)
  })
})
