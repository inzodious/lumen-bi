import { afterAll, describe, expect, it } from 'vitest'
import * as T from '../transforms'
import { check, engineGaps, tableOf, BASE } from './helpers'
import { addStep } from '../steps'

const COLS: T.ColInfo[] = [
  { name: 'Region', type: 'text' },
  { name: 'Product', type: 'text' },
  { name: 'Amount', type: 'number' },
  { name: 'Qty', type: 'Int64.Type' },
  { name: 'Order Date', type: 'date' }
]
const col = (n: string) => COLS.find((c) => c.name === n)!
const P = '#"Changed Type"'

afterAll(() => {
  if (engineGaps.size) console.info(`[pq transforms] engine gaps (generated M not evaluated): ${[...engineGaps].sort().join(', ')}`)
})

describe('column transforms', () => {
  it('Removed Columns', () => {
    const p = check(T.removeColumns(['Product', 'Qty']), `Table.RemoveColumns(${P},{"Product", "Qty"})`)
    expect(tableOf(p)?.columns).toEqual(['Region', 'Amount', 'Order Date'])
    expect(T.removeColumns([]).name).toBe('Removed Columns')
  })
  it('Removed Other Columns', () => {
    const p = check(T.removeOtherColumns(['Region', 'Amount']), `Table.SelectColumns(${P},{"Region", "Amount"})`)
    expect(tableOf(p)?.columns).toEqual(['Region', 'Amount'])
  })
  it('Changed Type', () => {
    const p = check(T.changeType([{ name: 'Qty', type: 'number' }, { name: 'Region', type: 'text' }]), `Table.TransformColumnTypes(${P},{{"Qty", type number}, {"Region", type text}})`)
    expect(p?.kind).toBe('table')
    expect(T.changeType([{ name: 'A', type: 'int64' }]).name).toBe('Changed Type')
  })
  it('Renamed Columns', () => {
    const p = check(T.renameColumns([['Region', 'Area']]), `Table.RenameColumns(${P},{{"Region", "Area"}})`)
    expect(tableOf(p)?.columns[0]).toBe('Area')
  })
  it('Duplicated Column', () => {
    const p = check(T.duplicateColumn('Region'), `Table.DuplicateColumn(${P}, "Region", "Region - Copy")`)
    expect(tableOf(p)?.columns).toContain('Region - Copy')
    expect(T.duplicateColumn('A', ['A - Copy']).formula('x')).toBe('Table.DuplicateColumn(x, "A", "A - Copy.1")')
  })
  it('Reordered Columns + movedOrder', () => {
    expect(T.movedOrder(['A', 'B', 'C', 'D'], ['C'], 'left')).toEqual(['A', 'C', 'B', 'D'])
    expect(T.movedOrder(['A', 'B', 'C', 'D'], ['B'], 'right')).toEqual(['A', 'C', 'B', 'D'])
    expect(T.movedOrder(['A', 'B', 'C', 'D'], ['C', 'D'], 'beginning')).toEqual(['C', 'D', 'A', 'B'])
    expect(T.movedOrder(['A', 'B', 'C', 'D'], ['A'], 'end')).toEqual(['B', 'C', 'D', 'A'])
    const p = check(T.reorderColumns(['Amount', 'Region', 'Product', 'Qty', 'Order Date']), `Table.ReorderColumns(${P},{"Amount", "Region", "Product", "Qty", "Order Date"})`)
    expect(tableOf(p)?.columns[0]).toBe('Amount')
  })
  it('Merged Columns / Inserted Merged Column', () => {
    check(T.mergeColumns(['Region', 'Product'], '-'), `Table.CombineColumns(${P},{"Region", "Product"},Combiner.CombineTextByDelimiter("-", QuoteStyle.None),"Merged")`)
    const p = check(T.insertMergedColumn(['Region', 'Product'], '-'), `Table.AddColumn(${P}, "Merged", each Text.Combine({[Region], [Product]}, "-"), type text)`)
    expect(tableOf(p)?.rows[0]?.at(-1)).toBe('East-a')
  })
})

describe('row transforms', () => {
  it('Sorted Rows', () => {
    const p = check(T.sortRows([{ col: 'Amount', desc: true }]), `Table.Sort(${P},{{"Amount", Order.Descending}})`)
    expect(tableOf(p)?.rows[0]?.[2]).toBe(20)
    check(T.sortRows([{ col: 'Region', desc: false }, { col: 'Amount', desc: true }]), `Table.Sort(${P},{{"Region", Order.Ascending}, {"Amount", Order.Descending}})`)
  })
  it('Removed Duplicates', () => {
    const p = check(T.removeDuplicates(['Region']), `Table.Distinct(${P}, {"Region"})`)
    expect(tableOf(p)?.rows.length).toBe(3)
    check(T.removeDuplicates([]), `Table.Distinct(${P})`)
  })
  it('Change Column Type ▸ Replace current', () => {
    const f = 'Table.TransformColumnTypes(Source,{{"Region", type text}, {"Amount", type number}})'
    expect(T.changeTypeColumns(f)).toEqual(['Region', 'Amount'])
    expect(T.mergeChangeType(f, [{ name: 'Amount', type: 'currency' }, { name: 'Qty', type: 'int64' }])).toBe('Table.TransformColumnTypes(Source,{{"Region", type text}, {"Amount", Currency.Type}, {"Qty", Int64.Type}})')
    expect(T.mergeChangeType('Table.TransformColumnTypes(Source,{{"A", type text}}, "en-US")', [{ name: 'A', type: 'date' }])).toBe('Table.TransformColumnTypes(Source,{{"A", type date}}, "en-US")')
    expect(T.mergeChangeType('Table.RemoveColumns(Source,{"A"})', [{ name: 'A', type: 'date' }])).toBeNull()
  })
  it('Kept Duplicates', () => {
    const p = check(
      T.keepDuplicates(['Region']),
      `let columnNames = {"Region"}, addCount = Table.Group(${P}, columnNames, {{"Count", Table.RowCount, type number}}), selectDuplicates = Table.SelectRows(addCount, each [Count] > 1), removeCount = Table.RemoveColumns(selectDuplicates, "Count") in Table.Join(${P}, columnNames, removeCount, columnNames, JoinKind.Inner)`
    )
    const t = tableOf(p)
    if (t) expect(t.rows.map((r) => r[0])).toEqual(['East', 'East'])
  })
  it('Kept / Removed rows', () => {
    expect(tableOf(check(T.keepFirstRows(2), `Table.FirstN(${P},2)`))?.rows.length).toBe(2)
    expect(tableOf(check(T.keepLastRows(1), `Table.LastN(${P}, 1)`))?.rows.length).toBe(1)
    check(T.keepRange(2, 2), `Table.Range(${P},1,2)`)
    expect(tableOf(check(T.removeTopRows(3), `Table.Skip(${P},3)`))?.rows.length).toBe(1)
    check(T.removeBottomRows(1), `Table.RemoveLastN(${P},1)`)
    check(T.removeAlternateRows(1, 1, 1), `Table.AlternateRows(${P},0,1,1)`)
    expect(T.keepFirstRows(1).name).toBe('Kept First Rows')
    expect(T.removeTopRows(1).name).toBe('Removed Top Rows')
  })
  it('Removed Blank Rows', () => {
    check(T.removeBlankRows(), `Table.SelectRows(${P}, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null})))`)
  })
  it('Removed / Kept / Replaced Errors', () => {
    expect(tableOf(check(T.removeErrors(['Amount']), `Table.RemoveRowsWithErrors(${P}, {"Amount"})`))?.rows.length).toBe(4)
    check(T.keepErrors(['Amount']), `Table.SelectRowsWithErrors(${P}, {"Amount"})`)
    check(T.replaceErrors(['Amount'], '0'), `Table.ReplaceErrorValues(${P}, {{"Amount", 0}})`)
  })
  it('table-level steps', () => {
    const rev = tableOf(check(T.reverseRows(), `Table.ReverseRows(${P})`))
    if (rev) expect(rev.rows[0]?.[0]).toBe('North')
    const n = check(T.countRows(), `Table.RowCount(${P})`)
    expect(n && n.kind !== 'table' && n.kind !== 'list' && n.kind !== 'record' ? n.value : null).toBe(4)
    check(T.transpose(), `Table.Transpose(${P})`)
    check(T.promoteHeaders(), `Table.PromoteHeaders(${P}, [PromoteAllScalars=true])`)
    check(T.demoteHeaders(), `Table.DemoteHeaders(${P})`)
    expect(T.transpose().name).toBe('Transposed Table')
    expect(T.promoteHeaders().name).toBe('Promoted Headers')
    expect(T.demoteHeaders().name).toBe('Demoted Headers')
    expect(T.reverseRows().name).toBe('Reversed Rows')
  })
  it('Filled Down / Up', () => {
    const p = check(T.fillDown(['Amount']), `Table.FillDown(${P},{"Amount"})`)
    expect(tableOf(p)?.rows[2]?.[2]).toBe(20)
    check(T.fillUp(['Amount']), `Table.FillUp(${P},{"Amount"})`)
  })
})

describe('replace / split / group', () => {
  it('Replaced Value (text → ReplaceText, number → ReplaceValue)', () => {
    const p = check(T.replaceValues([col('Region')], 'East', 'E'), `Table.ReplaceValue(${P},"East","E",Replacer.ReplaceText,{"Region"})`)
    expect(tableOf(p)?.rows[0]?.[0]).toBe('E')
    check(T.replaceValues([col('Region')], 'East', 'E', true), `Table.ReplaceValue(${P},"East","E",Replacer.ReplaceValue,{"Region"})`)
    const q = check(T.replaceValues([col('Amount')], '', '0'), `Table.ReplaceValue(${P},null,0,Replacer.ReplaceValue,{"Amount"})`)
    expect(tableOf(q)?.rows[2]?.[2]).toBe(0)
  })
  it('Split Column by Delimiter', () => {
    expect(T.splitCount(['a,b', 'a,b,c', null], ',')).toBe(3)
    check(T.splitByDelimiter('Product', ',', 'each', 2), `Table.SplitColumn(${P}, "Product", Splitter.SplitTextByDelimiter(",", QuoteStyle.Csv), {"Product.1", "Product.2"})`)
    check(T.splitByDelimiter('Product', ',', 'left', 2), `Table.SplitColumn(${P}, "Product", Splitter.SplitTextByEachDelimiter({","}, QuoteStyle.Csv, false), {"Product.1", "Product.2"})`)
    check(T.splitByDelimiter('Product', ',', 'right', 5), `Table.SplitColumn(${P}, "Product", Splitter.SplitTextByEachDelimiter({","}, QuoteStyle.Csv, true), {"Product.1", "Product.2"})`)
    check(T.splitByPositions('Product', 2, 2), `Table.SplitColumn(${P}, "Product", Splitter.SplitTextByRepeatedLengths(2), {"Product.1", "Product.2"})`)
  })
  it('Grouped Rows (basic + advanced)', () => {
    const p = check(T.groupBy(['Region'], [{ name: 'Count', op: 'count' }], COLS), `Table.Group(${P}, {"Region"}, {{"Count", each Table.RowCount(_), Int64.Type}})`)
    expect(tableOf(p)?.rows).toEqual([
      ['East', 2],
      ['West', 1],
      ['North', 1]
    ])
    const q = check(
      T.groupBy(
        ['Region'],
        [
          { name: 'Total', op: 'sum', column: 'Amount' },
          { name: 'Avg', op: 'average', column: 'Amount' },
          { name: 'Min', op: 'min', column: 'Product' },
          { name: 'Max', op: 'max', column: 'Qty' },
          { name: 'Distinct', op: 'countDistinct' }
        ],
        COLS
      ),
      `Table.Group(${P}, {"Region"}, {{"Total", each List.Sum([Amount]), type nullable number}, {"Avg", each List.Average([Amount]), type nullable number}, {"Min", each List.Min([Product]), type nullable text}, {"Max", each List.Max([Qty]), type nullable number}, {"Distinct", each Table.RowCount(Table.Distinct(_)), Int64.Type}})`
    )
    expect(tableOf(q)?.rows[0]?.[1]).toBe(10.5)
    check(
      T.groupBy(['Region'], [{ name: 'All', op: 'all' }], COLS),
      `Table.Group(${P}, {"Region"}, {{"All", each _, type table [Region=nullable text, Product=nullable text, Amount=nullable number, Qty=nullable number, Order Date=nullable date]}})`
    )
    check(T.groupBy(['Region'], [{ name: 'Med', op: 'median', column: 'Amount' }], COLS), `Table.Group(${P}, {"Region"}, {{"Med", each List.Median([Amount]), type nullable number}})`)
  })
})

describe('combine / pivot', () => {
  const other = 'let Source = #table({"Region", "Manager"}, {{"East", "Ann"}, {"West", "Bob"}}) in Source'
  it('Merged Queries + Expanded column', () => {
    const p = check(T.mergeQueries(['Region'], 'Managers', ['Region'], 'LeftOuter'), `Table.NestedJoin(${P}, {"Region"}, Managers, {"Region"}, "Managers", JoinKind.LeftOuter)`, { queries: { Managers: other } })
    expect(tableOf(p)?.columns.at(-1)).toBe('Managers')
    expect(T.mergeQueries(['k'], 'Other Q', ['k'], 'Inner', ['Other Q']).formula('x')).toBe('Table.NestedJoin(x, {"k"}, #"Other Q", {"k"}, "Other Q.1", JoinKind.Inner)')
    const merged = addStep(BASE, null, 'Merged Queries', T.mergeQueries(['Region'], 'Managers', ['Region'], 'LeftOuter').formula)!.source
    const e = T.expandColumn('Managers', ['Manager'], 'table')
    expect(e.name).toBe('Expanded Managers')
    const q = check(e, `Table.ExpandTableColumn(${P}, "Managers", {"Manager"}, {"Managers.Manager"})`, { source: merged, evaluate: false })
    expect(q).toBeNull()
    expect(T.expandColumn('R', ['a'], 'record', false).formula('x')).toBe('Table.ExpandRecordColumn(x, "R", {"a"}, {"a"})')
  })
  it('Appended Query', () => {
    const p = check(T.appendQueries(['Other']), `Table.Combine({${P}, Other})`, { queries: { Other: other } })
    expect(tableOf(p)?.rows.length).toBe(6)
    expect(T.appendQueries(['A', 'B C']).formula('x')).toBe('Table.Combine({x, A, #"B C"})')
  })
  it('Pivoted / Unpivoted columns', () => {
    check(T.pivotColumn('Region', 'Amount', 'sum'), `Table.Pivot(${P}, List.Distinct(${P}[Region]), "Region", "Amount", List.Sum)`)
    check(T.pivotColumn('Region', 'Amount', 'none'), `Table.Pivot(${P}, List.Distinct(${P}[Region]), "Region", "Amount")`, { evaluate: false })
    const u = check(T.unpivotColumns(['Amount', 'Qty'], ['Region', 'Product', 'Amount', 'Qty']), `Table.UnpivotOtherColumns(${P}, {"Region", "Product"}, "Attribute", "Value")`, {
      source: addStep(BASE, null, 'X', (p) => `Table.RemoveColumns(${p},{"Order Date"})`)!.source.replace('in\n    X', 'in\n    X')
    })
    expect(u).not.toBeNull()
    expect(T.unpivotColumns(['A'], ['A', 'B']).name).toBe('Unpivoted Columns')
    check(T.unpivotOtherColumns(['Region']), `Table.UnpivotOtherColumns(${P}, {"Region"}, "Attribute", "Value")`, { evaluate: false })
    check(T.unpivotOnlySelected(['Amount']), `Table.Unpivot(${P}, {"Amount"}, "Attribute", "Value")`)
  })
})

describe('add column', () => {
  it('Added Custom', () => {
    const p = check(T.addCustomColumn('Double', '[Amount] * 2'), `Table.AddColumn(${P}, "Double", each [Amount] * 2)`)
    expect(tableOf(p)?.rows[1]?.at(-1)).toBe(40)
    check(T.addCustomColumn('D', '[Qty] + 1', 'int64'), `Table.AddColumn(${P}, "D", each [Qty] + 1, Int64.Type)`)
  })
  it('Added Conditional Column', () => {
    const p = check(
      T.addConditionalColumn('Big', [{ column: 'Amount', op: 'greater', value: '10', output: '"Yes"' }, { column: 'Region', op: 'beginsWith', value: '"N"', output: '"North"' }], '"No"'),
      `Table.AddColumn(${P}, "Big", each if [Amount] > 10 then "Yes" else if Text.StartsWith([Region], "N") then "North" else "No")`
    )
    // `null > 10` is null and `if null` is an error — exactly as in Power Query
    const out = tableOf(p)?.rows.map((r) => r.at(-1))
    expect(out?.[0]).toBe('Yes')
    expect(out?.[2]).toHaveProperty('$error')
    expect(out?.[3]).toBe('North')
  })
  it('Added Index', () => {
    const p = check(T.addIndexColumn(1), `Table.AddIndexColumn(${P}, "Index", 1, 1, Int64.Type)`)
    expect(tableOf(p)?.rows.map((r) => r.at(-1))).toEqual([1, 2, 3, 4])
    check(T.addIndexColumn(0), `Table.AddIndexColumn(${P}, "Index", 0, 1, Int64.Type)`)
  })
})

describe('column operations (transform in place / add column)', () => {
  it('text format', () => {
    const p = check(T.transformColumns([col('Region')], 'upper'), `Table.TransformColumns(${P},{{"Region", Text.Upper, type text}})`)
    expect(tableOf(p)?.rows[0]?.[0]).toBe('EAST')
    expect(T.transformColumns([col('Region')], 'upper').name).toBe('Uppercased Text')
    check(T.transformColumns([col('Region'), col('Product')], 'lower'), `Table.TransformColumns(${P},{{"Region", Text.Lower, type text}, {"Product", Text.Lower, type text}})`)
    expect(tableOf(check(T.transformColumns([col('Product')], 'trim'), `Table.TransformColumns(${P},{{"Product", Text.Trim, type text}})`))?.rows[3]?.[1]).toBe('d')
    expect(T.transformColumns([col('Product')], 'trim').name).toBe('Trimmed Text')
    check(T.transformColumns([col('Product')], 'proper'), `Table.TransformColumns(${P},{{"Product", Text.Proper, type text}})`)
    check(T.transformColumns([col('Product')], 'clean'), `Table.TransformColumns(${P},{{"Product", Text.Clean, type text}})`)
    const pre = check(T.transformColumns([col('Region')], 'prefix', 'R-'), `Table.TransformColumns(${P}, {{"Region", each "R-" & _, type text}})`)
    expect(tableOf(pre)?.rows[0]?.[0]).toBe('R-East')
    check(T.transformColumns([col('Region')], 'suffix', '!'), `Table.TransformColumns(${P}, {{"Region", each _ & "!", type text}})`)
    const add = check(T.insertColumnOp(col('Region'), 'upper'), `Table.AddColumn(${P}, "UPPERCASE", each Text.Upper([Region]), type text)`)
    expect(tableOf(add)?.rows[0]?.at(-1)).toBe('EAST')
    expect(T.insertColumnOp(col('Region'), 'upper').name).toBe('Inserted Uppercased Text')
    check(T.insertColumnOp(col('Region'), 'prefix', 'x'), `Table.AddColumn(${P}, "Prefix", each "x" & [Region], type text)`)
  })
  it('text extract', () => {
    check(T.transformColumns([col('Region')], 'length'), `Table.TransformColumns(${P},{{"Region", Text.Length, Int64.Type}})`)
    expect(tableOf(check(T.transformColumns([col('Region')], 'first', '2'), `Table.TransformColumns(${P}, {{"Region", each Text.Start(_, 2), type text}})`))?.rows[0]?.[0]).toBe('Ea')
    check(T.transformColumns([col('Region')], 'last', '2'), `Table.TransformColumns(${P}, {{"Region", each Text.End(_, 2), type text}})`)
    check(T.transformColumns([col('Region')], 'range', '1', '2'), `Table.TransformColumns(${P}, {{"Region", each Text.Middle(_, 1, 2), type text}})`)
    check(T.transformColumns([col('Region')], 'beforeDelimiter', 's'), `Table.TransformColumns(${P}, {{"Region", each Text.BeforeDelimiter(_, "s"), type text}})`)
    check(T.insertColumnOp(col('Region'), 'length'), `Table.AddColumn(${P}, "Length", each Text.Length([Region]), Int64.Type)`)
    check(T.insertColumnOp(col('Region'), 'first', '1'), `Table.AddColumn(${P}, "First Characters", each Text.Start([Region], 1), type text)`)
    expect(T.transformColumns([col('Region')], 'first', '1').name).toBe('Extracted First Characters')
  })
  it('number standard / rounding / statistics', () => {
    const p = check(T.transformColumns([col('Amount')], 'multiply', '2'), `Table.TransformColumns(${P}, {{"Amount", each _ * 2, type number}})`)
    expect(tableOf(p)?.rows[1]?.[2]).toBe(40)
    check(T.transformColumns([col('Qty')], 'add', '1'), `Table.TransformColumns(${P}, {{"Qty", each _ + 1, Int64.Type}})`)
    check(T.transformColumns([col('Amount')], 'round', '0'), `Table.TransformColumns(${P},{{"Amount", each Number.Round(_, 0), type number}})`)
    check(T.transformColumns([col('Amount')], 'roundUp'), `Table.TransformColumns(${P},{{"Amount", Number.RoundUp, Int64.Type}})`)
    check(T.transformColumns([col('Amount')], 'abs'), `Table.TransformColumns(${P},{{"Amount", Number.Abs, type number}})`)
    check(T.insertColumnOp(col('Amount'), 'multiply', '3'), `Table.AddColumn(${P}, "Multiplication", each [Amount] * 3, type number)`)
    expect(T.transformColumns([col('Amount')], 'add', '1').name).toBe('Added to Column')
    const s = check(T.statistic('Amount', 'sum'), `List.Sum(${P}[Amount])`)
    expect(s && 'value' in s ? s.value : null).toBe(37.75)
    expect(T.statistic('Amount', 'sum').name).toBe('Calculated Sum')
    check(T.statistic('Amount', 'countDistinct'), `List.NonNullCount(List.Distinct(${P}[Amount]))`)
  })
  it('date parts', () => {
    const d = col('Order Date')
    const p = check(T.transformColumns([d], 'year'), `Table.TransformColumns(${P},{{"Order Date", Date.Year, Int64.Type}})`)
    expect(tableOf(p)?.rows[0]?.[4]).toBe(2024)
    expect(T.transformColumns([d], 'year').name).toBe('Extracted Year')
    const q = check(T.insertColumnOp(d, 'year'), `Table.AddColumn(${P}, "Year", each Date.Year([Order Date]), Int64.Type)`)
    expect(tableOf(q)?.rows[3]?.at(-1)).toBe(2023)
    expect(T.insertColumnOp(d, 'year').name).toBe('Inserted Year')
    check(T.insertColumnOp(d, 'monthName'), `Table.AddColumn(${P}, "Month Name", each Date.MonthName([Order Date]), type text)`)
    check(T.transformColumns([d], 'monthName'), `Table.TransformColumns(${P}, {{"Order Date", each Date.MonthName(_), type text}})`)
    check(T.insertColumnOp(d, 'quarter'), `Table.AddColumn(${P}, "Quarter", each Date.QuarterOfYear([Order Date]), Int64.Type)`)
    check(T.transformColumns([d], 'startOfMonth'), `Table.TransformColumns(${P},{{"Order Date", Date.StartOfMonth, type date}})`)
    check(T.insertColumnOp(d, 'dayName'), `Table.AddColumn(${P}, "Day Name", each Date.DayOfWeekName([Order Date]), type text)`)
    expect(T.insertColumnOp(d, 'year', '', '', ['Year']).formula('x')).toBe('Table.AddColumn(x, "Year.1", each Date.Year([Order Date]), Int64.Type)')
  })
})

describe('drill down / detect type', () => {
  it('drill down', () => {
    const p = check(T.drillDownColumn('Region'), `${P}[Region]`)
    expect(p?.kind).toBe('list')
    expect(T.drillDownColumn('Order Date').formula('S')).toBe('S[Order Date]')
    expect(T.drillDownColumn('Sales (USD)').formula('S')).toBe('S[#"Sales (USD)"]')
    expect(T.drillDownCell('Data', 0).formula('Source')).toBe('Source{0}[Data]')
    expect(T.drillDownCell('Data', 0).name).toBe('Data')
  })
  it('detects types from preview values', () => {
    expect(T.detectType(['1', '2', null], 'text')).toBe('int64')
    expect(T.detectType(['1.5', '2'], 'any')).toBe('number')
    expect(T.detectType(['2024-01-02'], 'any')).toBe('date')
    expect(T.detectType(['TRUE', 'false'], 'any')).toBe('logical')
    expect(T.detectType(['x', '1'], 'any')).toBe('text')
    expect(T.detectType([1, 2], 'Int64.Type')).toBe('int64')
    const s = T.detectTypes([{ name: 'A', type: 'any' }], () => ['1'])
    expect(s.formula('x')).toBe('Table.TransformColumnTypes(x,{{"A", Int64.Type}})')
  })
})
