import { describe, expect, it } from 'vitest'
import { evaluateQuery, parseExpression } from '@core/m/index.ts'
import * as S from '../steps'
import * as F from '../filters'
import * as Pm from '../params'
import { fieldRef, mText, pqTypeOf } from '../mtext'
import { check } from './helpers'

const Q = `let
    Source = #table({"A", "Order Date"}, {{1, 2}, {3, 4}}),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"A", Int64.Type}}),
    Date = Table.SelectRows(#"Changed Type", each [Order Date] > 1),
    #"Sorted Rows" = Table.Sort(Date,{{"A", Order.Descending}})
in
    #"Sorted Rows"`

describe('mtext', () => {
  it('quotes text, fields and types like PQ', () => {
    expect(mText('a"b')).toBe('"a""b"')
    expect(mText('x\ny')).toBe('"x#(lf)y"')
    expect(mText('#(')).toBe('"#(#)("')
    expect(fieldRef('Amount')).toBe('[Amount]')
    expect(fieldRef('Order Date')).toBe('[Order Date]')
    expect(fieldRef('Column 1')).toBe('[Column 1]')
    expect(fieldRef('Sales (USD)')).toBe('[#"Sales (USD)"]')
    expect(fieldRef('Name.1')).toBe('[#"Name.1"]')
    expect(fieldRef('type')).toBe('[#"type"]')
    expect(pqTypeOf('nullable number')).toBe('number')
    expect(pqTypeOf('Int64.Type')).toBe('int64')
    expect(pqTypeOf('table')).toBe('any')
    // every generated field reference parses
    for (const n of ['Amount', 'Order Date', 'Sales (USD)', 'Name.1', 'a"b', 'type', 'Column 1'])
      expect(() => parseExpression(`each ${fieldRef(n)}`)).not.toThrow()
  })
})

describe('step editing', () => {
  it('renames a step and its references (not field names)', () => {
    const out = S.renameStep(Q, 'Date', 'Filtered Rows')!
    expect(out).toContain('#"Filtered Rows" = Table.SelectRows(#"Changed Type", each [Order Date] > 1)')
    expect(out).toContain('Table.Sort(#"Filtered Rows",')
    expect(evaluateQuery(out).result.ok).toBe(true)
    const r = S.renameStep(Q, 'Sorted Rows', 'Final')!
    expect(r.trim().endsWith('Final')).toBe(true)
    expect(S.renameStep(Q, 'Date', 'Source')).toBeNull()
  })
  it('renames references but skips record field names', () => {
    expect(S.renameReferences('Source{[Schema="dbo",Item=Source]}[Data]', 'Source', 'S')).toBe('S{[Schema="dbo",Item=S]}[Data]')
    expect(S.renameReferences('each [Source] + Source', 'Source', 'X Y')).toBe('each [Source] + #"X Y"')
  })
  it('adds steps after the selected one and rewires the next step', () => {
    const r = S.addStep(Q, 'Changed Type', 'Kept First Rows', (p) => `Table.FirstN(${p},1)`)!
    expect(r.name).toBe('Kept First Rows')
    expect(r.source).toContain('#"Kept First Rows" = Table.FirstN(#"Changed Type",1)')
    expect(r.source).toContain('Date = Table.SelectRows(#"Kept First Rows", each [Order Date] > 1)')
    const end = S.addStep(Q, null, 'Sorted Rows', (p) => `Table.Sort(${p},{{"A", Order.Ascending}})`)!
    expect(end.name).toBe('Sorted Rows1')
    expect(end.source.trim().endsWith('#"Sorted Rows1"')).toBe(true)
  })
  it('wraps non-let queries', () => {
    expect(S.ensureLet('#table({"a"}, {{1}})')).toBe('let\n    Source = #table({"a"}, {{1}})\nin\n    Source')
    const r = S.addStep('#table({"a"}, {{1}})', null, 'Added Index', (p) => `Table.AddIndexColumn(${p}, "Index", 0, 1, Int64.Type)`)!
    expect(evaluateQuery(r.source).result.ok).toBe(true)
  })
  it('removes steps, deletes until end, inserts and moves', () => {
    const del = S.removeStep(Q, 'Date')!
    expect(del).toContain('Table.Sort(#"Changed Type",')
    expect(S.removeStep(Q, 'Sorted Rows')!.trim().endsWith('Date')).toBe(true)
    const until = S.deleteUntilEnd(Q, 'Date')!
    expect(S.outlineQuery(until)!.steps.map((s) => s.name)).toEqual(['Source', 'Changed Type'])
    expect(until.trim().endsWith('#"Changed Type"')).toBe(true)
    const ins = S.insertEmptyStepAfter(Q, 'Changed Type')!
    expect(ins.name).toBe('Custom1')
    expect(ins.source).toContain('Custom1 = #"Changed Type"')
    expect(ins.source).toContain('Table.SelectRows(Custom1,')
    const up = S.moveStep(Q, 'Sorted Rows', 'up')!
    const o = S.outlineQuery(up)!
    expect(o.steps.map((s) => s.name)).toEqual(['Source', 'Changed Type', 'Sorted Rows', 'Date'])
    expect(o.steps[2]!.formula).toBe('Table.Sort(#"Changed Type",{{"A", Order.Descending}})')
    expect(o.steps[3]!.formula).toBe('Table.SelectRows(#"Sorted Rows", each [Order Date] > 1)')
    expect(o.result).toBe('Date')
    expect(evaluateQuery(up).result.ok).toBe(true)
    expect(S.moveStep(Q, 'Changed Type', 'up')).toBeNull()
    expect(S.moveStep(Q, 'Date', 'down')).toBe(up)
    expect(S.setStepFormula(Q, 'Date', 'Table.FirstN(#"Changed Type", 1)')).toContain('Date = Table.FirstN(#"Changed Type", 1)')
    expect(S.stepsAfter(Q, 'Changed Type')).toEqual(['Date', 'Sorted Rows'])
  })
  it('parses calls, lists and literals for settings dialogs', () => {
    const c = S.parseCall('Table.AddColumn(#"Changed Type", "Custom", each [A] * 2, type number)')!
    expect(c.callee).toBe('Table.AddColumn')
    expect(c.args).toEqual(['#"Changed Type"', '"Custom"', 'each [A] * 2', 'type number'])
    expect(S.parseCall('Source{0}[Data]')).toBeNull()
    expect(S.splitList('{{"A", type text}, {"B", Int64.Type}}')).toEqual(['{"A", type text}', '{"B", Int64.Type}'])
    expect(S.textListLiteral('{"A", "B"}')).toEqual(['A', 'B'])
    expect(S.textLiteral('"a""b"')).toBe('a"b')
    expect(S.eachBody('each [A] * 2')).toBe('[A] * 2')
    expect(S.firstArgStep('Table.Sort(#"Filtered Rows",{})')).toBe('Filtered Rows')
  })
})

describe('filter menu M', () => {
  it('checked values → = … or …', () => {
    const s = F.filterByValues('Region', 'text', ['East', 'West', 'North', 'South'], ['East', 'West'])!
    expect(s.name).toBe('Filtered Rows')
    expect(s.formula('#"Changed Type"')).toBe('Table.SelectRows(#"Changed Type", each ([Region] = "East" or [Region] = "West"))')
    check(s, 'Table.SelectRows(#"Changed Type", each ([Region] = "East" or [Region] = "West"))')
  })
  it('unchecked few values → <> … and …', () => {
    const s = F.filterByValues('Region', 'text', ['East', 'West', 'North'], ['East', 'West'])!
    expect(s.formula('P')).toBe('Table.SelectRows(P, each ([Region] <> "North"))')
    const p = check(s, 'Table.SelectRows(#"Changed Type", each ([Region] <> "North"))')
    expect(p?.kind === 'table' && p.rows.length).toBe(3)
    expect(F.filterByValues('Region', 'text', ['a'], ['a'])).toBeNull()
  })
  it('typed literals: numbers, dates, null, logical', () => {
    expect(F.filterByValues('Order Date', 'date', ['2024-01-05', '2024-02-10', null], ['2024-01-05'])!.formula('P')).toBe('Table.SelectRows(P, each ([Order Date] = #date(2024, 1, 5)))')
    expect(F.filterByValues('Amount', 'number', [1, 2, null], [1, 2])!.formula('P')).toBe('Table.SelectRows(P, each ([Amount] <> null))')
    expect(F.cellLiteral('2024-01-05T13:04:05', 'datetime')).toBe('#datetime(2024, 1, 5, 13, 4, 5)')
    expect(F.cellLiteral(true, 'logical')).toBe('true')
    expect(F.typedLiteral('1/31/2024', 'date')).toBe('#date(2024, 1, 31)')
    expect(F.typedLiteral('1,000.5', 'number')).toBe('1000.5')
    const p = check(F.filterByValues('Order Date', 'date', ['2024-01-05', '2024-02-10', '2024-03-15', '2023-12-31'], ['2024-01-05'])!, 'Table.SelectRows(#"Changed Type", each ([Order Date] = #date(2024, 1, 5)))')
    expect(p?.kind === 'table' && p.rows.length).toBe(1)
  })
  it('Remove Empty and condition filters', () => {
    expect(F.removeEmpty('Region', 'text').formula('P')).toBe('Table.SelectRows(P, each [Region] <> null and [Region] <> "")')
    expect(F.removeEmpty('Amount', 'number').formula('P')).toBe('Table.SelectRows(P, each [Amount] <> null)')
    check(F.removeEmpty('Amount', 'number'), 'Table.SelectRows(#"Changed Type", each [Amount] <> null)')
    const s = F.filterByConditions('Region', 'text', { op: 'beginsWith', value: 'E' }, 'or', { op: 'contains', value: 'or' })
    const p = check(s, 'Table.SelectRows(#"Changed Type", each Text.StartsWith([Region], "E") or Text.Contains([Region], "or"))')
    expect(p?.kind === 'table' && p.rows.length).toBe(3)
    expect(F.filterByConditions('Amount', 'number', { op: 'greater', value: '10' }).formula('P')).toBe('Table.SelectRows(P, each [Amount] > 10)')
    expect(F.filterByConditions('Region', 'text', { op: 'notContains', value: 'x' }).formula('P')).toBe('Table.SelectRows(P, each not Text.Contains([Region], "x"))')
    check(F.filterByConditions('Order Date', 'date', { op: 'after', value: '1/1/2024' }), 'Table.SelectRows(#"Changed Type", each [Order Date] > #date(2024, 1, 1))')
    check(F.filterExtreme('Order Date', 'latest'), 'let latest = List.Max(#"Changed Type"[Order Date]) in Table.SelectRows(#"Changed Type", each [Order Date] = latest)')
  })
})

describe('parameters', () => {
  it('writes PQ parameter expressions', () => {
    expect(Pm.parameterExpression({ type: 'Text', required: true, value: 'server.example' })).toBe('"server.example" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]')
    expect(Pm.parameterExpression({ type: 'Number', required: false, value: '42' })).toBe('42 meta [IsParameterQuery=true, Type="Number", IsParameterQueryRequired=false]')
    expect(Pm.parameterExpression({ type: 'Date', required: true, value: '1/31/2024' })).toBe('#date(2024, 1, 31) meta [IsParameterQuery=true, Type="Date", IsParameterQueryRequired=true]')
    expect(Pm.parameterExpression({ type: 'Text', required: true, value: 'b', list: ['a', 'b'] })).toBe('"b" meta [IsParameterQuery=true, List={"a", "b"}, DefaultValue="b", Type="Text", IsParameterQueryRequired=true]')
    expect(Pm.parameterExpression({ type: 'Logical', required: true, value: 'TRUE' })).toBe('true meta [IsParameterQuery=true, Type="Logical", IsParameterQueryRequired=true]')
    for (const src of [Pm.parameterExpression({ type: 'Text', required: true, value: 'x' }), Pm.parameterExpression({ type: 'DateTime', required: true, value: '1/2/2024 3:04 PM' })]) expect(evaluateQuery(src).result.ok).toBe(true)
  })
  it('reads them back', () => {
    const p = Pm.readParameter('#date(2024, 1, 31) meta [IsParameterQuery=true, Type="Date", IsParameterQueryRequired=true]')!
    expect(p).toEqual({ type: 'Date', required: true, value: '1/31/2024', list: undefined })
    const q = Pm.readParameter('"a""b" meta [IsParameterQuery=true, List={"x", "y"}, DefaultValue="x", Type="Text", IsParameterQueryRequired=false]')!
    expect(q.value).toBe('a"b')
    expect(q.list).toEqual(['x', 'y'])
    expect(q.required).toBe(false)
    expect(Pm.readParameter('let a = 1 in a')).toBeNull()
    expect(Pm.paramLiteral('12:30', 'Time')).toBe('#time(12, 30, 0)')
    expect(Pm.paramLiteral('1.02:03:04', 'Duration')).toBe('#duration(1, 2, 3, 4)')
  })
})
