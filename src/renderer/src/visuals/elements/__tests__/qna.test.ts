import type { SemanticModel, TableDef } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { SQ_AGG, fieldKey, normalizeFilter } from '@core/report/sq'
import { createSampleEngine, sampleRows } from '../../common/sampleData'
import { createQnaEngine, suggestQuestions } from '../qna'
import { applyQnaResult, previewFilters } from '../qna/build'
import { buildSchema, type QnaField } from '../qna/schema'
import { stem, splitName, tokenize } from '../qna/text'

const col = (name: string, dataType: any, extra: Record<string, unknown> = {}) => ({ name, dataType, kind: 'data' as const, ...extra })
const table = (name: string, columns: any[], measures: any[] = [], extra: Partial<TableDef> = {}): TableDef => ({ name, columns, measures, hierarchies: [], partitions: [], ...extra })

const model: SemanticModel = {
  name: 'Sample',
  relationships: [],
  expressions: [],
  roles: [],
  tables: [
    table('Sales', [
      col('OrderId', 'int64', { summarizeBy: 'none' }),
      col('Region', 'string'),
      col('Country', 'string'),
      col('Category', 'string'),
      col('Subcategory', 'string'),
      col('Product', 'string'),
      col('Segment', 'string'),
      col('Date', 'dateTime'),
      col('Year', 'int64'),
      col('Quarter', 'string'),
      col('Month', 'string'),
      col('MonthNo', 'int64'),
      col('Quantity', 'int64'),
      col('Amount', 'decimal'),
      col('Cost', 'decimal'),
      col('Unit Price', 'decimal', { summarizeBy: 'average' }),
      col('RowKey', 'string', { isHidden: true })
    ]),
    table('_m', [], [
      { name: 'Total Sales', expression: 'SUM(Sales[Amount])' },
      { name: 'Total Cost', expression: 'SUM(Sales[Cost])' },
      { name: 'Orders', expression: 'COUNTROWS(Sales)' },
      { name: 'Units', expression: 'SUM(Sales[Quantity])' },
      { name: 'Margin %', expression: 'DIVIDE([Total Sales]-[Total Cost],[Total Sales])', annotations: { Synonyms: 'profitability, gross margin' } }
    ]),
    table('Customer', [col('CustomerName', 'string'), col('City', 'string')])
  ],
  cultures: [
    {
      name: 'en-US',
      raw: `cultureInfo en-US\n\n\tlinguisticMetadata =\n\t\t\t{\n\t\t\t  "Version": "1.0.0",\n\t\t\t  "Language": "en-US",\n\t\t\t  "Entities": {\n\t\t\t    "sales.amount": { "Binding": { "ConceptualEntity": "Sales", "ConceptualProperty": "Amount" }, "Terms": [ { "amount": { "State": "Generated" } }, { "revenue": { "State": "Authored" } }, { "turnover": { "State": "Suggested" } } ] },\n\t\t\t    "customer": { "Binding": { "ConceptualEntity": "Customer" }, "Terms": [ { "client": {} } ] }\n\t\t\t  }\n\t\t\t}\n\t\tcontentType: json\n`
    }
  ]
}

const rows = sampleRows()
const distinct = (f: QnaField): Scalar[] | undefined => {
  if (f.table !== 'Sales') return f.name === 'City' ? ['Seattle', 'Paris'] : undefined
  const s = new Set<Scalar>()
  for (const r of rows) s.add(r[f.name] ?? null)
  return [...s]
}
const qna = createQnaEngine({ model } as any, distinct)
const ask = (q: string) => qna.ask(q)
const names = (fs: Array<{ name: string }>) => fs.map((f) => f.name)
const proj = (spec: any, role: string) => (spec?.json.visual.query.queryState[role]?.projections ?? []).map((p: any) => p.queryRef)

describe('Q&A text', () => {
  it('stems plurals and splits names', () => {
    expect(['categories', 'boxes', 'sales', 'products', 'status', 'people', 'analysis'].map(stem)).toEqual(['category', 'box', 'sale', 'product', 'status', 'person', 'analysis'])
    expect(splitName('TotalSales_LY')).toEqual(['total', 'sales', 'ly'])
    expect(splitName('Margin %')).toEqual(['margin', '%'])
    expect(tokenize("men's sales over 1,000").map((t) => t.norm)).toEqual(['mens', 'sales', 'over', '1000'])
  })
})

describe('Q&A schema', () => {
  const schema = buildSchema(model)
  it('skips hidden columns and reads linguistic + annotation synonyms', () => {
    expect(schema.fields.some((f) => f.name === 'RowKey')).toBe(false)
    const amount = schema.fields.find((f) => f.name === 'Amount')!
    expect(amount.terms.map((t) => t.key)).toEqual(expect.arrayContaining(['amount', 'sale amount', 'revenue']))
    expect(amount.terms.map((t) => t.key)).not.toContain('turnover') // Suggested terms are not active
    expect(schema.tables.find((t) => t.name === 'Customer')!.terms.map((t) => t.key)).toContain('client')
    expect(schema.fields.find((f) => f.name === 'Margin %')!.terms.map((t) => t.key)).toEqual(expect.arrayContaining(['margin %', 'margin percent', 'margin', 'profitability', 'gross margin']))
  })
})

describe('Q&A interpretation', () => {
  it('total sales by region as bar chart', () => {
    const { interp, spec } = ask('total sales by region as bar chart')
    expect(names(interp.values.map((v) => v.field))).toEqual(['Total Sales'])
    expect(names(interp.categories)).toEqual(['Region'])
    expect(spec!.visualType).toBe('clusteredBarChart')
    expect(interp.explicitVisual).toBe(true)
    expect(proj(spec, 'Category')).toEqual(['Sales.Region'])
    expect(proj(spec, 'Y')).toEqual(['_m.Total Sales'])
    expect(spec!.json.visual.query.sortDefinition.sort[0]).toMatchObject({ direction: 'Descending', field: { Measure: { Property: 'Total Sales' } } })
    expect(interp.unrecognized).toEqual([])
  })

  it('top 5 products by margin → TopN filter card in PBI shape', () => {
    const { interp, spec } = ask('top 5 products by margin')
    expect(interp.topN).toMatchObject({ n: 5, dir: 'top' })
    expect(interp.topN!.category!.name).toBe('Product')
    expect(interp.topN!.by!.field.name).toBe('Margin %')
    expect(spec!.visualType).toBe('clusteredBarChart')
    const card = spec!.cards.find((c) => c.type === 'TopN')!
    expect(card.field).toEqual({ Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Product' } })
    const f = card.filter as any
    expect(f.From[0]).toMatchObject({ Name: 'subquery', Type: 2 })
    const sub = f.From[0].Expression.Subquery.Query
    expect(sub.Top).toBe(5)
    expect(sub.OrderBy[0].Direction).toBe(2)
    expect(sub.Select[0]).toMatchObject({ Name: 'field', Column: { Property: 'Product' } })
    expect(f.Where[0].Condition.In.Table).toEqual({ SourceRef: { Source: 'subquery' } })
    expect(f.From.find((x: any) => x.Entity === 'Sales')).toBeTruthy()
    expect(interp.restatement).toBe('top 5 Product by Margin %')
  })

  it('bottom three categories by orders sorts ascending', () => {
    const { interp } = ask('bottom three categories by orders')
    expect(interp.topN).toMatchObject({ n: 3, dir: 'bottom' })
    expect(interp.sort).toEqual({ kind: 'value', index: 0, dir: 'asc' })
  })

  it('sales by year as line', () => {
    const { interp, spec } = ask('sales by year as line')
    expect(names(interp.categories)).toEqual(['Year'])
    expect(names(interp.values.map((v) => v.field))).toEqual(['Total Sales'])
    expect(spec!.visualType).toBe('lineChart')
  })

  it('time category picks a line chart without "as"', () => {
    expect(ask('units by month').spec!.visualType).toBe('lineChart')
    expect(ask('units by date').spec!.visualType).toBe('lineChart')
  })

  it('average price by category sorted descending', () => {
    const { interp, spec } = ask('average unit price by category sorted descending')
    expect(interp.values[0]).toMatchObject({ agg: SQ_AGG.Avg })
    expect(interp.values[0].field.name).toBe('Unit Price')
    expect(interp.sort).toEqual({ kind: 'value', index: 0, dir: 'desc' })
    expect(proj(spec, 'Y')).toEqual(['Avg(Sales.Unit Price)'])
    expect(spec!.json.visual.query.queryState.Y.projections[0].nativeQueryRef).toBe('Average of Unit Price')
  })

  it('count of orders (measure) → card; count of products → distinct count', () => {
    const a = ask('count of orders')
    expect(a.spec!.visualType).toBe('card')
    expect(a.interp.values[0].field.name).toBe('Orders')
    const b = ask('how many products')
    expect(b.interp.values[0]).toMatchObject({ agg: SQ_AGG.Count })
    expect(b.interp.values[0].field.name).toBe('Product')
    expect(b.interp.restatement).toBe('Count of Product (Distinct)')
    const c = ask('number of clients')
    expect(c.interp.values[0]).toMatchObject({ agg: SQ_AGG.CountNonNull })
    expect(c.interp.values[0].field.table).toBe('Customer')
  })

  it('sales for Europe → categorical filter; multi-word values; not', () => {
    const { interp, spec } = ask('sales for Europe')
    expect(interp.filters).toHaveLength(1)
    expect(interp.filters[0].field.name).toBe('Region')
    expect(interp.filters[0].values).toEqual(['Europe'])
    expect(spec!.visualType).toBe('card')
    const card = spec!.cards[0]
    expect(card.type).toBe('Categorical')
    expect((card.filter as any).From).toEqual([{ Name: 's', Entity: 'Sales', Type: 0 }])
    expect((card.filter as any).Where[0].Condition.In.Values).toEqual([[{ Literal: { Value: "'Europe'" } }]])
    const two = ask('total cost by category for north america and asia pacific')
    expect(two.interp.filters[0].values).toEqual(['North America', 'Asia Pacific'])
    const neg = ask('sales by country not Germany')
    expect(neg.interp.filters[0]).toMatchObject({ not: true, values: ['Germany'] })
    expect((neg.spec!.cards[0].filter as any).Where[0].Condition.Not.Expression.In).toBeTruthy()
  })

  it('years are value filters', () => {
    const { interp } = ask('total sales by category in 2024')
    expect(interp.filters[0].field.name).toBe('Year')
    expect(interp.filters[0].values).toEqual([2024])
  })

  it('comparisons on columns and measures', () => {
    const a = ask('orders by region with quantity over 3')
    expect(a.interp.compares[0]).toMatchObject({ op: '>', value: 3 })
    expect(a.interp.compares[0].target.field.name).toBe('Quantity')
    expect(names(a.interp.values.map((v) => v.field))).toEqual(['Orders'])
    expect((a.spec!.cards[0].filter as any).Where[0].Condition.Comparison.ComparisonKind).toBe(1)
    const b = ask('products with total sales at least 1000')
    expect(b.interp.compares[0]).toMatchObject({ op: '>=', value: 1000 })
    expect(b.spec!.cards[0].field).toEqual({ Measure: { Expression: { SourceRef: { Entity: '_m' } }, Property: 'Total Sales' } })
  })

  it('explicit visual types and role mapping', () => {
    expect(ask('sales by segment as pie').spec!.visualType).toBe('pieChart')
    expect(ask('sales by segment as a donut chart').spec!.visualType).toBe('donutChart')
    expect(ask('total sales by region as table').spec!.visualType).toBe('tableEx')
    const m = ask('total sales by region and segment')
    expect(m.spec!.visualType).toBe('pivotTable')
    expect(proj(m.spec, 'Rows')).toEqual(['Sales.Region'])
    expect(proj(m.spec, 'Columns')).toEqual(['Sales.Segment'])
    const l = ask('total sales by segment and year')
    expect(l.spec!.visualType).toBe('lineChart')
    expect(proj(l.spec, 'Category')).toEqual(['Sales.Year'])
    expect(proj(l.spec, 'Series')).toEqual(['Sales.Segment'])
    expect(ask('total sales and total cost').spec!.visualType).toBe('multiRowCard')
    expect(ask('products').spec!.visualType).toBe('tableEx')
    expect(ask('sales vs cost by region as column chart').spec!.visualType).toBe('clusteredColumnChart')
  })

  it('alphabetical sorting and sort by a field', () => {
    expect(ask('total sales by country alphabetically').interp.sort).toEqual({ kind: 'category', index: 0, dir: 'asc' })
    const s = ask('units by product sorted by total sales')
    expect(s.interp.sort).toMatchObject({ kind: 'value', dir: 'desc' })
    expect(s.interp.values[s.interp.sort!.index].field.name).toBe('Total Sales')
  })

  it('implicit aggregation of numeric columns, qualified names, synonyms', () => {
    const a = ask('revenue by subcategory')
    expect(a.interp.values[0]).toMatchObject({ agg: SQ_AGG.Sum })
    expect(a.interp.values[0].field.name).toBe('Amount')
    expect(ask('profitability by region').interp.values[0].field.name).toBe('Margin %')
    expect(ask('max cost by segment').interp.values[0]).toMatchObject({ agg: SQ_AGG.Max })
  })

  it('reports unrecognized words', () => {
    const { interp } = ask('total sales by flibbertigibbet')
    expect(interp.unrecognized).toEqual(['flibbertigibbet'])
    expect(interp.spans.find((s) => s.role === 'unknown')!.text).toBe('flibbertigibbet')
    expect(interp.spans.filter((s) => s.role === 'field').map((s) => s.text)).toEqual(['total sales'])
  })

  it('"first"/"last" without a number are not top N', () => {
    expect(ask('sales by region last').interp.topN).toBeUndefined()
  })

  it('empty question → no visual', () => {
    expect(ask('').spec).toBeUndefined()
    expect(ask('hello there').spec).toBeUndefined()
  })
})

describe('Q&A suggestions and completion', () => {
  it('suggests questions that parse into visuals', () => {
    const s = suggestQuestions(qna.schema)
    expect(s.length).toBeGreaterThanOrEqual(4)
    for (const q of s) expect(ask(q).spec).toBeDefined()
    expect(s).toContain('total sales by region')
  })
  it('completes field names and values', () => {
    expect(qna.complete('sales by reg')).toContain('Region')
    expect(qna.complete('sales for Ger')).toContain('Germany')
    expect(qna.complete('sales ')).toEqual([])
  })
})

describe('Q&A preview filters (sample engine)', () => {
  it('resolves TopN to the top categories under the other filters', () => {
    const engine = createSampleEngine()
    const { interp, spec } = ask('top 3 products by total sales for europe')
    const pf = previewFilters(spec!, interp, engine, [])
    expect(pf.error).toBeUndefined()
    const r = engine.summarize({
      groupBy: [{ kind: 'sq', expr: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Product' } } }],
      values: [],
      filters: pf.filters
    })
    expect(r.rows.length).toBe(3)
    // the saved card normalizes to Entity refs + keeps the subquery
    const n = normalizeFilter(spec!.cards.find((c) => c.type === 'TopN')!.filter)
    expect(n.From?.[0].Name).toBe('subquery')
    expect(fieldKey(n.Where[0].Condition.In.Expressions[0])).toBe(fieldKey({ Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Product' } }))
  })
})

describe('Q&A visual rendering', () => {
  it('renders the generated visual inside the box and turns it into a standard visual', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createMockHost } = await import('../../common/mockHost')
    await import('../../index')
    const { QnaVisual } = await import('../QnaVisual')
    const engine = createSampleEngine()
    ;(engine as any).model = model
    const json: any = { name: 'q', visual: { visualType: 'qnaVisual', objects: { general: [{ properties: { question: { expr: { Literal: { Value: "'top 3 products by total sales'" } } } } }] } } }
    let updated: any
    const ctx = { ...createMockHost({ engine, mode: 'edit' }), updateVisual: (m: (j: any) => void) => m((updated = structuredClone(json))) }
    const html = renderToStaticMarkup(createElement(QnaVisual, { visual: { name: 'q', json }, pageName: 'p', width: 420, height: 300, ctx }))
    expect(html).toContain('Showing results for')
    expect(html).toContain('top 3 Product by Total Sales')
    expect(html).toContain('<svg') // the bar chart rendered
    expect(html).toContain('Turn this Q&amp;A result into a standard visual')
    const empty = renderToStaticMarkup(createElement(QnaVisual, { visual: { name: 'q', json: { visual: { visualType: 'qnaVisual' } } }, pageName: 'p', width: 420, height: 300, ctx }))
    expect(empty).toContain('Try one of these to get started')
    expect(empty).toContain('total sales by region')
    void updated
  })
})

describe('Turn into standard visual', () => {
  it('rewrites the Q&A visual.json into the generated visual, keeping position and container formatting', () => {
    const j: any = { name: 'v1', position: { x: 10, y: 20, width: 400, height: 300 }, visual: { visualType: 'qnaVisual', objects: { general: [{}] }, visualContainerObjects: { title: [{}] } } }
    const { spec } = ask('top 5 products by total sales for europe')
    applyQnaResult(j, spec!)
    expect(j.visual.visualType).toBe('clusteredBarChart')
    expect(j.visual.objects).toBeUndefined()
    expect(j.visual.visualContainerObjects).toEqual({ title: [{}] })
    expect(j.position.x).toBe(10)
    expect(j.visual.query.queryState.Category.projections[0].queryRef).toBe('Sales.Product')
    expect(j.filterConfig.filters.map((f: any) => f.type)).toEqual(['Categorical', 'TopN'])
    expect(j.filterConfig.filters.every((f: any) => /^[0-9a-f]{20}$/.test(f.name))).toBe(true)
  })
})
