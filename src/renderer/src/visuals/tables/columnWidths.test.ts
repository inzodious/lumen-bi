import { describe, expect, it } from 'vitest'
import type { ObjectsBag } from '@core/report/props'
import { resolveTheme } from '@core/report/theme'
import { clearScopedWidths, resetColumnWidth, scopeSelector, setColumnWidth, setCustomWidthsEnabled, setDefaultWidth, setGranularWidths, setSizeBehavior, totalSelector, visualObjects } from './columnWidths'
import { outlineBorders, outlineOf, readTableFormat, scopedWidth } from './tableFormat'
import { customWidthRows, setLevelSubtotal, setRowHeadersFrozen } from './LayoutCard'
import { setColumnWidth as setVisualColumnWidth, validWidth } from './TableVisual'

const theme = resolveTheme()
const num = (n: number) => ({ expr: { Literal: { Value: `${n}D` } } })
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const YEAR = { Column: { Expression: { SourceRef: { Entity: 'Cal' } }, Property: 'Year' } }
const format = (type: string, objects: ObjectsBag) => readTableFormat({ visual: { visualType: type, objects } }, theme)

describe('custom column widths (columnWidth object)', () => {
  it('a width is stored under the column\'s queryRef, as Power BI writes it; reset removes it', () => {
    const bag: ObjectsBag = {}
    setColumnWidth(bag, 'Sales.Region', 180)
    setColumnWidth(bag, 'Sum(Sales.Amount)', 96.456)
    expect(bag.columnWidth).toEqual([
      { properties: { value: num(180) }, selector: { metadata: 'Sales.Region' } },
      { properties: { value: num(96.46) }, selector: { metadata: 'Sum(Sales.Amount)' } }
    ])
    // dragging does not write customColumnWidth: the stored widths are the custom widths
    expect(bag.columnHeaders).toBeUndefined()
    setColumnWidth(bag, 'Sales.Region', 200)
    expect(bag.columnWidth).toHaveLength(2)
    expect(format('tableEx', bag).widthByRef.get('Sales.Region')).toBe(200)
    expect(format('tableEx', bag).sizing.custom).toBe(true)
    resetColumnWidth(bag, 'Sales.Region')
    resetColumnWidth(bag, 'Sum(Sales.Amount)')
    expect(bag.columnWidth).toBeUndefined()
    expect(format('tableEx', bag).sizing.custom).toBe(false)
  })

  it('visual-level helper creates the objects bag', () => {
    const json: any = { visual: { visualType: 'tableEx' } }
    setVisualColumnWidth(json, 'T.A', 77)
    expect(visualObjects(json).columnWidth).toEqual([{ properties: { value: num(77) }, selector: { metadata: 'T.A' } }])
  })

  it('legacy general.columnWidth of the same column is dropped when the width is set or reset', () => {
    const bag: ObjectsBag = { general: [{ properties: { columnWidth: num(88), formatString: lit("'0'") }, selector: { metadata: 'a' } }, { properties: { columnWidth: num(70) }, selector: { metadata: 'b' } }] }
    setColumnWidth(bag, 'a', 120)
    expect(bag.general).toEqual([{ properties: { formatString: lit("'0'") }, selector: { metadata: 'a' } }, { properties: { columnWidth: num(70) }, selector: { metadata: 'b' } }])
    resetColumnWidth(bag, 'b')
    expect(bag.general).toHaveLength(1)
  })

  it('Custom widths off clears every custom width; on is remembered so the pane can show the inputs', () => {
    const bag: ObjectsBag = { columnWidth: [{ properties: { value: num(100) }, selector: { metadata: 'a' } }, { properties: { value: num(90) }, selector: { data: scopeSelector(YEAR, 2024) } }] }
    setCustomWidthsEnabled(bag, false)
    expect(bag.columnWidth).toBeUndefined()
    expect(bag.columnHeaders).toBeUndefined()
    setCustomWidthsEnabled(bag, true)
    expect(bag.columnHeaders).toEqual([{ properties: { customColumnWidth: lit('true') } }])
    expect(format('tableEx', bag).sizing.custom).toBe(true)
    // an explicit "off" in a file cannot stay next to a width set by hand
    bag.columnHeaders![0].properties.customColumnWidth = lit('false')
    setColumnWidth(bag, 'a', 50)
    expect(bag.columnHeaders).toBeUndefined()
  })

  it('Auto-size behavior writes columnAdjustment only and leaves autoSizeColumnWidth alone', () => {
    const bag: ObjectsBag = { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), bold: lit('true') } }], columnWidth: [{ properties: { value: num(100) }, selector: { metadata: 'a' } }] }
    setSizeBehavior(bag, 'fixedWidth', { legacyManual: false })
    setDefaultWidth(bag, 90)
    expect(bag.columnHeaders![0].properties).toEqual({ autoSizeColumnWidth: lit('true'), bold: lit('true'), columnAdjustment: lit("'fixedWidth'"), defaultColumnWidth: num(90) })
    expect(bag.columnWidth).toHaveLength(1) // custom widths survive a behavior change
    const s = format('tableEx', bag).sizing
    expect(s).toMatchObject({ behavior: 'fixedWidth', legacyManual: false, defaultWidth: 90, custom: true })
    setDefaultWidth(bag, undefined)
    expect(bag.columnHeaders![0].properties.defaultColumnWidth).toBeUndefined()
  })

  it('legacy "Auto-size width: off": shown as Fixed width; choosing an auto-size behavior clears the stored snapshot', () => {
    const legacy = (): ObjectsBag => ({
      columnHeaders: [{ properties: { autoSizeColumnWidth: lit('false') } }],
      columnWidth: ['a', 'b', 'c'].map((m) => ({ properties: { value: num(100) }, selector: { metadata: m } }))
    })
    expect(format('tableEx', legacy()).sizing).toMatchObject({ behavior: 'fixedWidth', legacyManual: true, custom: true })
    const bag = legacy()
    setSizeBehavior(bag, 'growToFit', { legacyManual: true })
    expect(bag.columnWidth).toBeUndefined()
    expect(format('tableEx', bag).sizing).toMatchObject({ behavior: 'growToFit', legacyManual: false, custom: false })
    // Fixed width keeps them (they are the fixed widths)
    const kept = legacy()
    setSizeBehavior(kept, 'fixedWidth', { legacyManual: true })
    expect(kept.columnWidth).toHaveLength(3)
    // columnAdjustment wins over the old switch, whatever it says
    expect(format('tableEx', { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), columnAdjustment: lit("'fixedWidth'") } }] }).sizing.behavior).toBe('fixedWidth')
    expect(format('tableEx', { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('false'), columnAdjustment: lit("'fitToContent'") } }] }).sizing).toMatchObject({ behavior: 'fitToContent', legacyManual: false })
    expect(format('tableEx', {}).sizing).toMatchObject({ behavior: 'fitToContent', legacyManual: false, custom: false, granular: false })
  })

  it('matrix: one column header / total column (data selectors), the uniform width of a value, the corner column', () => {
    const bag: ObjectsBag = {}
    setColumnWidth(bag, { data: scopeSelector(YEAR, 2024) }, 70)
    setColumnWidth(bag, { data: totalSelector(YEAR), metadata: 'Sum(Sales.Amount)' }, 110)
    setColumnWidth(bag, { id: 'cornerColumn' }, 140)
    expect(bag.columnWidth).toEqual([
      { properties: { value: num(70) }, selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: YEAR, Right: { Literal: { Value: '2024L' } } } } }] } },
      { properties: { value: num(110) }, selector: { data: [{ total: [YEAR] }], metadata: 'Sum(Sales.Amount)' } },
      { properties: { value: num(140) }, selector: { id: 'cornerColumn' } }
    ])
    const f = format('pivotTable', bag)
    expect(f.widthByScope).toEqual([
      { scope: scopeSelector(YEAR, 2024), ref: undefined, width: 70 },
      { scope: totalSelector(YEAR), ref: 'Sum(Sales.Amount)', width: 110 }
    ])
    // a scoped entry is not the uniform width of its value
    expect(f.widthByRef.size).toBe(0)
    expect(f.cornerWidth).toBe(140)
    expect(f.sizing).toMatchObject({ custom: true, granular: true })
    // a uniform width replaces the single-header widths of that value (and those stored for every value)
    setColumnWidth(bag, 'Sum(Sales.Amount)', 95)
    clearScopedWidths(bag, 'Sum(Sales.Amount)')
    expect(bag.columnWidth!.map((e) => e.selector)).toEqual([{ id: 'cornerColumn' }, { metadata: 'Sum(Sales.Amount)' }])
    // More granular off drops per-header widths, on is remembered
    setColumnWidth(bag, { data: scopeSelector(YEAR, 2025) }, 60)
    setGranularWidths(bag, false)
    expect(bag.columnWidth).toHaveLength(2)
    expect(bag.columnHeaders).toBeUndefined()
    setGranularWidths(bag, true)
    expect(format('pivotTable', bag).sizing.granular).toBe(true)
    resetColumnWidth(bag, { id: 'cornerColumn' })
    expect(format('pivotTable', bag).cornerWidth).toBeUndefined()
  })

  it('matrix: which stored width a leaf column gets', () => {
    const QUARTER = { Column: { Expression: { SourceRef: { Entity: 'Cal' } }, Property: 'Quarter' } }
    const bag: ObjectsBag = {}
    setColumnWidth(bag, { data: scopeSelector(QUARTER, 'Q1') }, 50)
    setColumnWidth(bag, { data: scopeSelector(QUARTER, 'Q1'), metadata: 'm2' }, 58)
    setColumnWidth(bag, { data: scopeSelector(YEAR, 2024) }, 70)
    setColumnWidth(bag, { data: totalSelector(QUARTER) }, 90)
    setColumnWidth(bag, { data: totalSelector(YEAR) }, 120)
    const w = format('pivotTable', bag).widthByScope
    const path = (...v: Array<number | string>) => v.map((value, i) => ({ expr: i === 0 ? YEAR : QUARTER, value }))
    // a quarter header shares its width under every year; a value-specific entry wins for that value
    expect(scopedWidth(w, { ref: 'm1', path: path(2023, 'Q1') })).toBe(50)
    expect(scopedWidth(w, { ref: 'm1', path: path(2024, 'Q1') })).toBe(50)
    expect(scopedWidth(w, { ref: 'm2', path: path(2024, 'Q1') })).toBe(58)
    expect(scopedWidth(w, { ref: 'm1', path: path(2024, 'Q2') })).toBeUndefined()
    // a collapsed year is a year header; an expanded year's quarters don't inherit the year's width
    expect(scopedWidth(w, { ref: 'm1', path: path(2024) })).toBe(70)
    // total columns: a year's subtotal totals the quarter level, the grand total the first level
    expect(scopedWidth(w, { ref: 'm1', path: path(2024), totalOf: QUARTER })).toBe(90)
    expect(scopedWidth(w, { ref: 'm1', path: [], totalOf: YEAR })).toBe(120)
    expect(scopedWidth([], { ref: 'm1', path: path(2024) })).toBeUndefined()
  })

  it('Set column width prompt validation', () => {
    expect(validWidth('120')).toBeUndefined()
    expect(validWidth('')).toBeTruthy()
    expect(validWidth('abc')).toBeTruthy()
    expect(validWidth('3')).toBeTruthy()
    expect(validWidth('5000')).toBeTruthy()
  })
})

describe('format pane helpers', () => {
  const rowsWell = (refs: string[]) => ({ projections: refs.map((queryRef) => ({ queryRef, nativeQueryRef: queryRef.split('.')[1], field: { Column: { Expression: { SourceRef: { Entity: queryRef.split('.')[0] } }, Property: queryRef.split('.')[1] } } })) })
  const measure = (name: string, displayName?: string) => ({ queryRef: `_m.${name}`, nativeQueryRef: name, ...(displayName ? { displayName } : {}), field: { Measure: { Expression: { SourceRef: { Entity: '_m' } }, Property: name } } })

  it('table: one row per column with its custom width', () => {
    const json = { visual: { visualType: 'tableEx', query: { queryState: { Values: { projections: [...rowsWell(['Geo.Region']).projections, measure('Sales', 'Revenue')] } } } } }
    const bag: ObjectsBag = { columnWidth: [{ properties: { value: num(150) }, selector: { metadata: '_m.Sales' } }] }
    expect(customWidthRows(json, bag, theme).rows.map((r) => [r.label, r.target, r.width])).toEqual([
      ['Region', { metadata: 'Geo.Region' }, undefined],
      ['Revenue', { metadata: '_m.Sales' }, 150]
    ])
  })

  it('matrix: the stepped row-header column is stored under the outermost row field; tabular layout has one per row field', () => {
    const json = { visual: { visualType: 'pivotTable', query: { queryState: { Rows: rowsWell(['Geo.Region', 'Geo.Country']), Columns: rowsWell(['Cal.Year']), Values: { projections: [measure('Sales')] } } } } }
    const bag: ObjectsBag = { columnWidth: [{ properties: { value: num(210) }, selector: { metadata: 'Geo.Region' } }, { properties: { value: num(64) }, selector: { data: scopeSelector(YEAR, 2024) } }, { properties: { value: num(80) }, selector: { data: totalSelector(YEAR) } }] }
    const stepped = customWidthRows(json, bag, theme)
    expect(stepped.rows.map((r) => [r.label, r.target, r.width])).toEqual([
      ['Region (row headers)', { metadata: 'Geo.Region' }, 210],
      ['Sales', { metadata: '_m.Sales' }, undefined]
    ])
    expect(stepped.scoped.map((r) => [r.label, r.width])).toEqual([['2024', 64], ['Total', 80]])
    const tabular = customWidthRows(json, { ...bag, general: [{ properties: { layout: lit("'Tabular'") } }] }, theme)
    expect(tabular.rows.map((r) => r.label)).toEqual(['Region', 'Country', 'Sales'])
  })

  it('Freeze ▸ Row headers and per-level subtotals', () => {
    const bag: ObjectsBag = { rowHeaders: [{ properties: { bold: lit('true') } }] }
    setRowHeadersFrozen(bag, false)
    expect(format('pivotTable', bag).rowHeaders.unfrozen).toBe(true)
    setRowHeadersFrozen(bag, true)
    expect(bag.rowHeaders).toEqual([{ properties: { bold: lit('true') } }])
    setRowHeadersFrozen({}, true)
    setLevelSubtotal(bag, 'Geo.Region', false)
    setLevelSubtotal(bag, 'Geo.Region', true)
    setLevelSubtotal(bag, 'Geo.Country', false)
    expect(bag.subTotals).toEqual([
      { properties: { levelSubtotalEnabled: lit('true') }, selector: { metadata: 'Geo.Region' } },
      { properties: { levelSubtotalEnabled: lit('false') }, selector: { metadata: 'Geo.Country' } }
    ])
    const f = format('pivotTable', bag)
    expect([f.subTotals.levelEnabled.get('Geo.Region'), f.subTotals.levelEnabled.get('Geo.Country')]).toEqual([true, false])
  })
})

describe('borders (outlineStyle)', () => {
  it('outlineStyle is a side mask: top 1, right 2, bottom 4, left 8; legacy outline names still read', () => {
    expect([0, 1, 2, 4, 8, 5, 10, 15].map((n) => outlineOf(n, 'None'))).toEqual(['None', 'TopOnly', 'RightOnly', 'BottomOnly', 'LeftOnly', 'TopBottom', 'LeftRight', 'Frame'])
    expect(outlineOf('bottomonly', 'None')).toBe('BottomOnly')
    expect(outlineOf(undefined, 'TopOnly')).toBe('TopOnly')
    // other combinations keep their mask
    expect(outlineBorders(outlineOf(6, 'None'), '#000', 2)).toEqual({ borderRight: '2px solid #000', borderBottom: '2px solid #000' })
    expect(outlineBorders('Frame', '#111', 1)).toEqual({ borderTop: '1px solid #111', borderBottom: '1px solid #111', borderLeft: '1px solid #111', borderRight: '1px solid #111' })
    const f = format('pivotTable', { columnHeaders: [{ properties: { outlineStyle: { expr: { Literal: { Value: '4L' } } } } }], rowHeaders: [{ properties: { outlineStyle: { expr: { Literal: { Value: '2L' } } } } }], values: [{ properties: { outlineStyle: { expr: { Literal: { Value: '10D' } } } } }] })
    expect([f.header.outline, f.rowHeaders.outline, f.values.outline]).toEqual(['BottomOnly', 'RightOnly', 'LeftRight'])
  })
})
