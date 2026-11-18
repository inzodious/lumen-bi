import { describe, expect, it } from 'vitest'
import { normalizeFilter } from '../../report/sq'
import { engineFor, inF } from './fixture'

/** A model with Power BI's auto date/time LocalDateTable for Sales[OrderDate] (generated shape, neutral names). */
const { engine } = engineFor((s) => {
  ;(s.tables.Sales.columns as any).OrderDate = { type: 'dateTime', variations: [{ name: 'Variation', relationship: 'auto_rel', defaultHierarchy: "LocalDateTable_1.'Date Hierarchy'" }] }
  s.tables['LocalDateTable_1'] = {
    expression: "Calendar(Date(Year(MIN('Sales'[OrderDate])), 1, 1), Date(Year(MAX('Sales'[OrderDate])), 12, 31))",
    columns: {
      Date: { type: 'dateTime', sourceColumn: '[Date]' },
      Year: { type: 'int64', expression: 'YEAR([Date])' },
      MonthNo: { type: 'int64', expression: 'MONTH([Date])' },
      Month: { type: 'string', expression: 'FORMAT([Date], "MMMM")', sortBy: 'MonthNo' },
      QuarterNo: { type: 'int64', expression: 'INT(([MonthNo] + 2) / 3)' },
      Quarter: { type: 'string', expression: '"Qtr " & [QuarterNo]', sortBy: 'QuarterNo' },
      Day: { type: 'int64', expression: 'DAY([Date])' }
    },
    hierarchies: [{ name: 'Date Hierarchy', levels: ['Year', 'Quarter', 'Month', 'Day'].map((l) => ({ name: l, column: l })) }]
  }
  s.relationships!.push({ name: 'auto_rel', from: 'Sales.OrderDate', to: 'LocalDateTable_1.Date', joinOnDateBehavior: 'datePartOnly' })
  s.tables['Employee'] = {
    columns: { Id: 'int64', Manager: 'int64', Path: { type: 'string', expression: 'PATH ( Employee[Id], Employee[Manager] )' } },
    rows: [
      [1, null],
      [2, 1],
      [3, 2]
    ]
  }
})

const lvl = (level: string) => ({
  HierarchyLevel: {
    Expression: { Hierarchy: { Expression: { PropertyVariationSource: { Expression: { SourceRef: { Entity: 'Sales' } }, Name: 'Variation', Property: 'OrderDate' } }, Hierarchy: 'Date Hierarchy' } },
    Level: level
  }
})

describe('auto date/time variations', () => {
  it('group by the LocalDateTable levels, ordered by their sort-by columns', () => {
    const r = engine.summarize({
      groupBy: [{ kind: 'sq', expr: lvl('Year') }, { kind: 'sq', expr: lvl('Quarter') }],
      values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }]
    })
    expect(r.rows).toEqual([
      [2024, 'Qtr 1', 70],
      [2024, 'Qtr 2', 10],
      [2025, 'Qtr 1', 93]
    ])
    expect(r.columns[0].id).toBe('LocalDateTable_1.Year')
    expect(engine.describeField(lvl('Month'))).toMatchObject({ kind: 'hierarchyLevel', table: 'LocalDateTable_1', sortBy: { column: 'MonthNo' } })
  })
  it('filters on a level', () => {
    const f = { Version: 2, From: [{ Name: 's', Entity: 'Sales', Type: 0 }], Where: [{ Condition: { In: { Expressions: [lvl('Month')], Values: [[{ Literal: { Value: "'February'" } }]] } } }] }
    expect(engine.evaluateScalar('[Sales]', [f]).value).toBe(75)
  })
})

describe('misc', () => {
  it('PATH builds parent-child paths in calculated columns', () => {
    expect(engine.runDaxQuery('EVALUATE SELECTCOLUMNS ( Employee, "p", Employee[Path] ) ORDER BY [p]').tables[0].rows).toEqual([['1'], ['1|2'], ['1|2|3']])
    expect(engine.evaluateScalar('PATHCONTAINS ( "1|2|3", 2 )').value).toBe(true)
    expect(() => engine.evaluateScalar('ERROR ( "boom" )')).toThrow('boom')
    expect(engine.evaluateScalar('BITAND ( 13, 11 )').value).toBe(9)
  })
  it('TopN filters survive normalizeFilter (subquery-only From)', () => {
    const topN = {
      Version: 2,
      From: [
        {
          Name: 'sub',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [{ Name: 'p', Entity: 'Product', Type: 0 }, { Name: 's', Entity: 'Sales', Type: 0 }],
                Select: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Category' }, Name: 'f' }],
                OrderBy: [{ Direction: 1, Expression: { Measure: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sales' } } }],
                Top: 1
              }
            }
          },
          Type: 2
        },
        { Name: 'p', Entity: 'Product', Type: 0 }
      ],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Category' } }], Table: { SourceRef: { Source: 'sub' } } } } }]
    }
    const n = normalizeFilter(topN as any)
    expect(n.From?.map((f) => f.Name)).toEqual(['sub'])
    expect(engine.evaluateScalar('[Sales]', [n]).value).toBe(15) // bottom 1 (ascending) = Accessories
    expect(engine.evaluateScalar('[Sales]', [inF('Product', 'Category', ["'Bikes'"]), n]).value).toBe(130) // TopN is evaluated under the other filters
  })
})
