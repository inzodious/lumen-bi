import { resolveTheme } from '@core/report/theme'
import { createMockHost } from '../common/mockHost'
import { createSampleEngine, proj, S } from '../common/sampleData'
import { blockKey, buildMatrixLayout, pathKey, type MatrixSpec } from './matrixModel'
import { buildMatrixView, matrixData } from './matrixView'
import { readToggled, savedExpansion, toggleExpansion } from './matrixQuery'
import { applyExpansion, setAllExpanded, setLevelExpanded } from '../common/expansion'
import { buildTableModel, tableData } from './tableModel'
import { readTableFormat } from './tableFormat'
import { computeWidths } from './widths'
import { copyValueText, toTsv, tsvField } from './copy'
import { markerPoints, MARKER, seriesFromRows, sparkKey, sparklineGeometry, sparklineSpec, readSparklineFormats } from './sparklineModel'
import { makePropContext } from '@core/report/props'
import { buildCell } from './cellModel'

const engine = createSampleEngine()
const theme = resolveTheme()
const L = (v: string) => ({ expr: { Literal: { Value: v } } })
const sparkField = (measure: any, axis: any) => ({ SparklineData: { Measure: measure, Groupings: [axis] } })

// ---------------------------------------------------------------------------------------------
describe('sparkline model', () => {
  it('parses SparklineData projections', () => {
    const f = sparkField(S.m('Total Sales'), S.col('Month'))
    expect(sparklineSpec(f)).toEqual({ measure: S.m('Total Sales'), axis: S.col('Month') })
    expect(sparklineSpec(S.m('Total Sales'))).toBeUndefined()
    expect(sparklineSpec({ SparklineData: { Measure: S.m('x'), Groupings: [] } })).toBeUndefined()
  })

  it('splits rows into aligned series per key (missing axis points → null)', () => {
    const rows = [
      ['A', 1, 10],
      ['B', 1, 5],
      ['A', 2, 12],
      ['B', 3, 7]
    ]
    const s = seriesFromRows(rows, 1)
    expect(s.get(sparkKey(['A']))!.map((p) => p.y)).toEqual([10, 12, null])
    expect(s.get(sparkKey(['B']))!.map((p) => [p.x, p.y])).toEqual([
      [1, 5],
      [2, null],
      [3, 7]
    ])
  })

  it('line geometry breaks at blanks and scales to its own range', () => {
    const g = sparklineGeometry(
      [
        { x: 1, y: 0 },
        { x: 2, y: 10 },
        { x: 3, y: null },
        { x: 4, y: 5 }
      ],
      { chartType: 'line', markers: 0, strokeWidth: 1, markerSize: 3 },
      101,
      21
    )
    expect(g.path!.match(/M/g)!.length).toBe(2)
    const ys = [...g.path!.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
    expect(Math.max(...ys)).toBeCloseTo(21 - 1, 0) // y=0 at the bottom (inset 1px)
    expect(Math.min(...ys)).toBeCloseTo(1, 0)
  })

  it('column geometry draws from zero, negatives below the axis', () => {
    const g = sparklineGeometry(
      [
        { x: 1, y: 4 },
        { x: 2, y: -2 }
      ],
      { chartType: 'column', markers: 0, strokeWidth: 1, markerSize: 3 },
      40,
      13
    )
    expect(g.bars).toHaveLength(2)
    expect(g.bars![1].negative).toBe(true)
    // the positive bar ends where the negative bar starts (the zero line)
    expect(g.bars![0].y + g.bars![0].h).toBeCloseTo(g.bars![1].y, 5)
  })

  it('markers: highest / lowest / first / last / negative / isolated', () => {
    const pts = [
      { x: 1, y: 3 },
      { x: 2, y: -1 },
      { x: 3, y: null },
      { x: 4, y: 8 },
      { x: 5, y: null }
    ]
    const m = markerPoints(pts, MARKER.highest | MARKER.lowest | MARKER.first | MARKER.last | MARKER.negative | MARKER.isolated)
    const byIdx = new Map(m.map((x) => [x.index, x.kinds]))
    expect(byIdx.get(3)).toEqual(expect.arrayContaining(['highest', 'last', 'isolated']))
    expect(byIdx.get(1)).toEqual(expect.arrayContaining(['lowest', 'negative']))
    expect(byIdx.get(0)).toEqual(['first'])
    expect(markerPoints(pts, 0)).toEqual([])
  })

  it('reads sparklines formatting per queryRef with theme defaults', () => {
    const pc = makePropContext(
      { visual: { visualType: 'tableEx', objects: { sparklines: [{ properties: { chartType: L("'column'"), strokeWidth: L('2D'), markers: L('6L') }, selector: { metadata: 'sp1' } }] } } },
      theme
    )
    const m = readSparklineFormats(pc, theme)
    expect(m.get('sp1')).toMatchObject({ chartType: 'column', strokeWidth: 2, markers: 6, color: theme.dataColors[0] })
    expect(m.get('')!.chartType).toBe('line')
  })
})

// ---------------------------------------------------------------------------------------------
describe('table: sparklines, totals label, defaults', () => {
  const json = (objects: any = {}) => ({
    name: 't',
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: {
          Values: {
            projections: [
              proj(S.col('Region'), 'Sales.Region'),
              proj(S.m('Total Sales'), '_m.Total Sales'),
              { field: sparkField(S.m('Total Sales'), S.col('Month')), queryRef: 'SparklineData(_m.Total Sales_[Sales.Month])' }
            ]
          }
        }
      },
      objects
    }
  })

  it('evaluates one series per row (and for the total row) ordered by the axis sort-by column', () => {
    const m = buildTableModel(json({ total: [{ properties: { label: L("'Grand total'") } }] }), createMockHost({ engine }))
    expect(m.error).toBeUndefined()
    const sc = m.columns.findIndex((c) => c.sparkline)
    expect(m.columns[sc].label).toBe('Total Sales by Month')
    const cell = m.rows[0][sc]
    expect(cell.spark!.points.length).toBe(12)
    expect(cell.spark!.points[0].x).toBe('January') // MonthNo sort-by column
    const sum = cell.spark!.points.reduce((a, p) => a + (p.y ?? 0), 0)
    expect(sum).toBeCloseTo(m.rows[0][1].value as number, 4)
    expect(m.total![sc].spark!.points.length).toBe(12)
    expect(m.total![0].text).toBe('Grand total')
    // export data skips sparkline columns
    expect(tableData(m).columns).toEqual(['Region', 'Total Sales'])
  })

  it('PBI default look: label class headers, banded rows, horizontal gridlines = backgroundLight', () => {
    const t = readTableFormat(json(), theme)
    expect(t.header.font.family).toBe('Segoe UI')
    expect(t.header.font.bold).toBe(false)
    expect(t.header.font.color).toBe(theme.foreground)
    expect(t.total.font.bold).toBe(true)
    expect(t.values.backSecondary).toBe(theme.backgroundLight)
    expect(t.grid.horizontal).toBe(true)
    expect(t.grid.horizontalColor).toBe(theme.backgroundLight)
    expect(t.grid.outlineColor).toBe(theme.tableAccent)
    const m = readTableFormat({ visual: { visualType: 'pivotTable' } }, theme)
    // matrices band their rows too (Power BI render of an unformatted matrix)
    expect(m.values.backSecondary).toBe(theme.backgroundLight)
    expect(m.grid.horizontal).toBe(false)
    expect(m.header.buttons.show).toBe(true)
    expect(m.subTotals.label).toBe('Total')
  })

  it('matrix subtotal styles per $id Row / Column; grand totals inherit the subtotal background', () => {
    const color = (c: string) => ({ solid: { color: { expr: { Literal: { Value: `'${c}'` } } } } })
    const f = readTableFormat(
      {
        visual: {
          visualType: 'pivotTable',
          objects: {
            subTotals: [
              { properties: { rowSubtotals: L('false') } },
              { properties: { backColor: color('#EEEEEE'), applyToHeaders: L('true') }, selector: { id: 'Row' } },
              { properties: { fontColor: color('#FF0000') }, selector: { id: 'Column' } }
            ]
          }
        }
      },
      theme
    )
    expect(f.subTotals.rows).toBe(false)
    expect(f.subTotals.style.background).toBe('#EEEEEE')
    expect(f.subTotals.style.applyToHeaders).toBe(true)
    expect(f.subTotals.style.font.bold).toBe(true)
    expect(f.subTotals.columnStyle.font.color).toBe('#FF0000')
    expect(f.subTotals.columnStyle.background).toBeUndefined()
  })

  it('specific column: apply to values / subtotals / total', () => {
    const info = { override: { fontColor: '#FF0000', styleHeader: true, styleValues: true, styleTotal: false, styleSubtotals: true } }
    const host = { format: (v: any) => String(v), theme }
    const opts = { get: () => undefined, stats: {} }
    expect(buildCell(1, info, host, { ...opts, isTotal: false }).color).toBe('#FF0000')
    expect(buildCell(1, info, host, { ...opts, isTotal: true, totalKind: 'subtotal' }).color).toBe('#FF0000')
    expect(buildCell(1, info, host, { ...opts, isTotal: true, totalKind: 'grand' }).color).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
describe('matrix layout: column expand/collapse, subtotal styling, labels, blank rows', () => {
  // rows: A(x,y) B(z); columns: G1(p,q) G2(r)
  const data: Record<string, any[][]> = {
    '0:0': [[100]],
    '1:0': [['A', 60], ['B', 40]],
    '2:0': [['A', 'x', 25], ['A', 'y', 35], ['B', 'z', 40]],
    '0:1': [['G1', 70], ['G2', 30]],
    '1:1': [['A', 'G1', 50], ['A', 'G2', 10], ['B', 'G1', 20], ['B', 'G2', 20]],
    '0:2': [['G1', 'p', 30], ['G1', 'q', 40], ['G2', 'r', 30]],
    '1:2': [['A', 'G1', 'p', 20], ['A', 'G1', 'q', 30], ['A', 'G2', 'r', 10], ['B', 'G1', 'p', 10], ['B', 'G1', 'q', 10], ['B', 'G2', 'r', 20]]
  }
  const spec = (over: Partial<MatrixSpec> = {}): MatrixSpec => {
    const blocks = new Map()
    for (const [k, rows] of Object.entries(data)) {
      const [d, e] = k.split(':').map(Number)
      blocks.set(blockKey(d, e), { rowDepth: d, colDepth: e, rows })
    }
    return {
      rowLevels: 2,
      colLevels: 2,
      valueCount: 1,
      blocks,
      expandedDepth: 1,
      toggled: new Set(),
      rowSubtotal: () => true,
      rowSubtotalPosition: 'top',
      colSubtotal: () => true,
      valuesOnRow: false,
      colExpandedDepth: 1,
      ...over
    }
  }

  it('collapsed column groups show their subtotal under a +/- header spanning the header rows', () => {
    const l = buildMatrixLayout(spec())
    expect(l.colHeaderLevels).toBe(1)
    expect(l.leaves.map((x) => [x.path.join('/'), x.collapsed ?? false, x.isTotal])).toEqual([
      ['G1', true, false],
      ['G2', true, false],
      ['', false, true]
    ])
    expect(l.headerRows[0].map((h) => [h.label, h.canExpand, h.expanded])).toEqual([
      ['G1', true, false],
      ['G2', true, false],
      ['Total', undefined, undefined]
    ])
    expect(l.lookup(['A'], ['G1'])!.values[0]).toBe(50)
  })

  it('expanding one column group: mixed state, collapsed sibling is subtotal-level (bold)', () => {
    const l = buildMatrixLayout(spec({ colToggled: new Set([pathKey(['G1'])]) }))
    expect(l.colHeaderLevels).toBe(2)
    expect(l.leaves.map((x) => `${x.path.join('/')}:${x.isTotal ? x.totalKind : '-'}${x.collapsed ? ':C' : ''}`)).toEqual(['G1/p:-', 'G1/q:-', 'G1:subtotal', 'G2:subtotal:C', ':grand'])
    const g1 = l.headerRows[0].find((h) => h.label === 'G1')!
    expect(g1).toMatchObject({ expanded: true, isSubtotalLevel: true, colSpan: 3, rowSpan: 1 })
    const g2 = l.headerRows[0].find((h) => h.label === 'G2')!
    expect(g2).toMatchObject({ expanded: false, rowSpan: 2, colSpan: 1 })
    expect(l.headerRows[1].map((h) => h.label)).toEqual(['p', 'q', 'Total'])
  })

  it('collapsed rows above the lowest visible level are styled as subtotals', () => {
    const l = buildMatrixLayout(spec({ toggled: new Set([pathKey(['A'])]) }))
    const b = l.items.find((i) => i.label === 'B')!
    expect(b.isTotal).toBe(true)
    expect(b.totalKind).toBe('subtotal')
    const x = l.items.find((i) => i.label === 'x')!
    expect(x.isTotal).toBe(false)
    // all collapsed: the top level is the lowest visible level → plain values
    expect(buildMatrixLayout(spec()).items[0].isTotal).toBe(false)
  })

  it('subtotal / grand total labels per level and blank rows between top-level groups', () => {
    const l = buildMatrixLayout(
      spec({
        expandedDepth: 2,
        colExpandedDepth: 2,
        rowSubtotalPosition: 'bottom',
        rowTotalLabel: (d) => (d === 0 ? 'Grand' : `Sub ${d}`),
        colTotalLabel: (d) => (d === 0 ? 'All' : 'Group total'),
        blankRows: true
      })
    )
    expect(l.items.map((i) => (i.kind === 'blank' ? '_' : String(i.label)))).toEqual(['A', 'x', 'y', 'Sub 1', '_', 'B', 'z', 'Sub 1', '_', 'Grand'])
    expect(l.headerRows[0].at(-1)!.label).toBe('All')
    expect(l.headerRows[1].filter((h) => h.kind === 'total').map((h) => h.label)).toEqual(['Group total', 'Group total'])
  })
})

// ---------------------------------------------------------------------------------------------
function matrixJson(extra: { objects?: any; expansion?: any; values?: any[]; colActive?: boolean[] } = {}) {
  const ca = extra.colActive ?? [true, false]
  return {
    name: 'm',
    visual: {
      visualType: 'pivotTable',
      query: {
        queryState: {
          Rows: { projections: [proj(S.col('Region'), 'Sales.Region', { active: true })] },
          Columns: { projections: [proj(S.col('Year'), 'Sales.Year', { active: ca[0] }), proj(S.col('Quarter'), 'Sales.Quarter', { active: ca[1] })] },
          Values: { projections: extra.values ?? [proj(S.m('Total Sales'), '_m.Total Sales')] }
        }
      },
      objects: extra.objects ?? {},
      ...(extra.expansion ? { expansionStates: extra.expansion } : {})
    }
  }
}

describe('matrix with the sample engine: columns, values on rows, sparklines', () => {
  it('column +/- expansion round-trips through expansionStates (roles Columns)', () => {
    const json: any = matrixJson()
    let v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.layout.leaves.map((l) => l.path.join('/'))).toEqual(['2023', '2024', ''])
    toggleExpansion(json, [2024], ['Sales.Year', 'Sales.Quarter'], 'Columns')
    expect(readToggled(json, 'Columns')).toEqual(new Set([pathKey([2024])]))
    expect(readToggled(json, 'Rows').size).toBe(0)
    v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.layout.leaves.map((l) => l.path.join('/'))).toEqual(['2023', '2024/Qtr 1', '2024/Qtr 2', '2024/Qtr 3', '2024/Qtr 4', '2024', ''])
    // the collapsed 2023 group is above the lowest visible level → subtotal styling
    expect(v.layout.leaves[0]).toMatchObject({ collapsed: true, totalKind: 'subtotal' })
    const eu = v.layout.items.findIndex((i) => i.label === 'Europe')
    const q = [1, 2, 3, 4].map((n) => v.cells[eu][n].value as number).reduce((a, b) => a + b, 0)
    expect(v.cells[eu][5].value as number).toBeCloseTo(q, 4)
  })

  it('column headers: Expand ▸ Entire level / Collapse ▸ All (the context menu commands) drive the layout', () => {
    const json: any = matrixJson()
    const refs = ['Sales.Year', 'Sales.Quarter']
    const levels = refs.map((queryRef) => ({ queryRef }))
    applyExpansion(json, 'Columns', levels, savedExpansion(json, 'Columns', refs), (e) => setLevelExpanded(e, 0, true))
    let v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.data.spec.colLevelExpanded).toEqual([true, false])
    expect(v.layout.colHeaderLevels).toBe(2)
    expect(v.layout.leaves.filter((l) => l.path.length === 2).length).toBe(8)
    expect(json.visual.query.queryState.Columns.projections.map((p: any) => !!p.active)).toEqual([true, true])
    // one year collapsed by hand keeps the others open
    toggleExpansion(json, [2023], refs, 'Columns')
    v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.layout.leaves.filter((l) => l.path.length === 2).every((l) => l.path[0] === 2024)).toBe(true)
    applyExpansion(json, 'Columns', levels, savedExpansion(json, 'Columns', refs), (e) => setAllExpanded(e, false))
    v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.layout.leaves.map((l) => l.path.join('/'))).toEqual(['2023', '2024', ''])
    expect(json.visual.expansionStates.find((s: any) => s.roles.includes('Columns')).root).toEqual({})
  })

  it('auto expand on column headers shows every column level', () => {
    const v = buildMatrixView(matrixJson({ objects: { columnHeaders: [{ properties: { autoExpand: L('true') } }] } }), createMockHost({ engine }))
    expect(v.layout.colHeaderLevels).toBe(2)
    expect(v.layout.leaves.length).toBe(2 * 5 + 1)
  })

  it('values on rows: one row per value under each node, columns keep their groups', () => {
    const v = buildMatrixView(
      matrixJson({ values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders')], objects: { values: [{ properties: { valuesOnRow: L('true') } }] } }),
      createMockHost({ engine })
    )
    const kinds = v.layout.items.slice(0, 3).map((i) => `${i.kind}:${i.valueIndex ?? ''}`)
    expect(kinds).toEqual(['node:', 'value:0', 'value:1'])
    expect(v.rowLabels[1]).toBe('Total Sales')
    expect(v.layout.leaves.every((l) => l.valueIndex === -1)).toBe(true)
    expect(matrixData(v).columns[1]).toBe('Value')
  })

  it('sparklines in a matrix: per cell series, blank value slot in the summarize result', () => {
    const v = buildMatrixView(
      matrixJson({
        colActive: [true, false],
        values: [proj(S.m('Total Sales'), '_m.Total Sales'), { field: sparkField(S.m('Orders'), S.col('Month')), queryRef: 'sp' }]
      }),
      createMockHost({ engine })
    )
    expect(v.data.values[1].label).toBe('Orders by Month')
    const eu = v.layout.items.findIndex((i) => i.label === 'Europe')
    const leaf = v.layout.leaves.findIndex((l) => l.path[0] === 2023 && l.valueIndex === 1)
    const cell = v.cells[eu][leaf]
    expect(cell.spark!.points.length).toBe(12)
    const sales = v.cells[eu][v.layout.leaves.findIndex((l) => l.path[0] === 2023 && l.valueIndex === 0)]
    expect(typeof sales.value).toBe('number')
  })

  it('per-level subtotal label from subTotals.levelSubtotalLabel', () => {
    const v = buildMatrixView(
      matrixJson({
        colActive: [true, true],
        objects: { subTotals: [{ properties: { columnSubtotalsLabel: L("'Sum'") } }, { properties: { levelSubtotalLabel: L("'Year total'") }, selector: { metadata: 'Sales.Year' } }] }
      }),
      createMockHost({ engine })
    )
    const labels = v.layout.headerRows[1].filter((h) => h.kind === 'total').map((h) => h.label)
    expect(new Set(labels)).toEqual(new Set(['Year total']))
    expect(v.layout.headerRows[0].at(-1)!.label).toBe('Sum')
  })
})

// ---------------------------------------------------------------------------------------------
describe('column widths and copy', () => {
  const font = { size: 10, color: '#000', family: 'Segoe UI', bold: false, italic: false, underline: false }
  it('grow to fit spreads leftover space evenly; explicit widths stay; min width for sparklines', () => {
    const cols = [
      { header: 'a', headerFont: font, texts: ['x'], valueFont: font },
      { header: 'b', headerFont: font, texts: ['x'], valueFont: font, explicit: 50 },
      { header: 'c', headerFont: font, texts: [], valueFont: font, minWidth: 100 }
    ]
    const fit = computeWidths(cols, { behavior: 'fitToContent', wrapHeader: true, available: 600 })
    expect(fit[1]).toBe(50)
    expect(fit[2]).toBeGreaterThanOrEqual(100)
    const grow = computeWidths(cols, { behavior: 'growToFit', wrapHeader: true, available: 600 })
    expect(grow[1]).toBe(50)
    expect(grow[0] - fit[0]).toBe(grow[2] - fit[2])
    expect(grow.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600)
    expect(grow.reduce((a, b) => a + b, 0)).toBeGreaterThan(597)
    expect(computeWidths(cols, { behavior: 'fixedWidth', wrapHeader: true, available: 600, defaultWidth: 80 })).toEqual([80, 50, 80])
  })

  it('Copy value: the data value, not its formatting', () => {
    expect(copyValueText({ value: 1234567.891, text: '$1.23M' })).toBe('1234567.891')
    expect(copyValueText({ value: 'Europe', text: 'Europe' })).toBe('Europe')
    expect(copyValueText({ value: null, text: '' })).toBe('')
    expect(copyValueText({ value: new Date(Date.UTC(2024, 0, 5)), text: '1/5/2024' })).toBe('1/5/2024')
  })

  it('TSV with headers and quoting', () => {
    expect(tsvField('a\tb')).toBe('"a\tb"')
    expect(toTsv(['Region', 'Sales'], [['Europe', '$1,000'], ['Say "hi"', '2']])).toBe('Region\tSales\nEurope\t$1,000\n"Say ""hi"""\t2')
  })
})
