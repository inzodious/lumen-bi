import type { QueryEngine, SummarizeRequest } from '@core/engine/api'
import { columnExpr, fieldKey, measureExpr } from '@core/report/sq'
import { createMockHost } from '../common/mockHost'
import { createSampleEngine, proj, S } from '../common/sampleData'
import { buildMatrixLayout, pathKey, blockKey, pinnedGrandTotalStart, type MatrixSpec } from './matrixModel'
import { buildMatrixView, matrixData } from './matrixView'
import { readToggled, toggleExpansion } from './matrixQuery'
import { applySort, buildTableModel, nextSort, tableData } from './tableModel'
import { headerAlignment, readTableFormat } from './tableFormat'
import { resolveTheme } from '@core/report/theme'
import { resolveIcon } from './cfIcons'

const engine = createSampleEngine()
const theme = resolveTheme()

function total(measure: string, filters: any[] = []): number {
  return engine.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr: S.m(measure) } }], filters }).rows[0][0] as number
}

function tableJson(objects: any = {}, sort?: any) {
  return {
    name: 't',
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: { Values: { projections: [proj(S.col('Region'), 'Sales.Region'), proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Margin %'), '_m.Margin %')] } },
        ...(sort ? { sortDefinition: { sort } } : {})
      },
      objects
    }
  }
}

describe('table model', () => {
  it('groups by columns, evaluates measures and a real total row', () => {
    const ctx = createMockHost({ engine })
    const m = buildTableModel(tableJson(), ctx)
    expect(m.columns.map((c) => c.label)).toEqual(['Region', 'Total Sales', 'Margin %'])
    expect(m.rows.map((r) => r[0].text)).toEqual(['Asia Pacific', 'Europe', 'North America'])
    expect(m.columns[1].align).toBe('right')
    expect(m.total![0].text).toBe('Total')
    // the total margin is a re-evaluation, not the sum/average of row margins
    expect(m.total![2].value).toBeCloseTo(total('Margin %'), 10)
    expect(m.total![1].value).toBeCloseTo(total('Total Sales'), 6)
    expect(m.rows[0][2].text).toMatch(/^\d+\.\d%$/)
    expect(tableData(m).rows.length).toBe(3)
  })

  it('sort definition, header click toggling and slicer filters', () => {
    const json: any = tableJson({}, [{ field: S.m('Total Sales'), direction: 'Descending' }])
    const ctx = createMockHost({ engine, filters: [{ Version: 2, Where: [{ Condition: { Not: { Expression: { In: { Expressions: [S.col('Region')], Values: [[{ Literal: { Value: "'Europe'" } }]] } } } } }] }] })
    const m = buildTableModel(json, ctx)
    expect(m.rows.length).toBe(2)
    const vals = m.rows.map((r) => r[1].value as number)
    expect(vals[0]).toBeGreaterThan(vals[1])
    expect(m.columns[1].sort).toBe('desc')
    // clicking the sorted measure flips it; clicking a text column starts ascending
    expect(nextSort(json, m.columns[1]).direction).toBe('Ascending')
    expect(nextSort(json, m.columns[0]).direction).toBe('Ascending')
    applySort(json, nextSort(json, m.columns[0]))
    expect(json.visual.query.sortDefinition.sort[0].field).toEqual(S.col('Region'))
  })

  it('conditional formatting on cells (field value color, gradient, totals scope)', () => {
    const objects = {
      values: [
        { properties: { fontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Margin %', data: [{ dataViewWildcard: { matchingOption: 1 } }] } },
        {
          properties: {
            backColor: {
              solid: {
                color: {
                  expr: {
                    FillRule: {
                      Input: S.m('Total Sales'),
                      FillRule: { linearGradient2: { min: { color: { Literal: { Value: "'#FFFFFF'" } } }, max: { color: { Literal: { Value: "'#000000'" } } } } }
                    }
                  }
                }
              }
            }
          },
          selector: { metadata: '_m.Total Sales' }
        }
      ]
    }
    const m = buildTableModel(tableJson(objects), createMockHost({ engine }))
    // Margin Color is not a projection → fetched as a hidden value per row
    for (const r of m.rows) expect(r[2].color).toMatch(/^#/)
    expect(m.total![2].color).toBeUndefined() // instances only
    const backs = m.rows.map((r) => r[1].background)
    const sales = m.rows.map((r) => r[1].value as number)
    const maxI = sales.indexOf(Math.max(...sales))
    const minI = sales.indexOf(Math.min(...sales))
    expect(backs[maxI]).toBe('#000000')
    expect(backs[minI]).toBe('#FFFFFF')
  })

  it('reads table formatting with PBI defaults and quirky font stacks', () => {
    const f = readTableFormat(
      {
        visual: {
          visualType: 'tableEx',
          objects: {
            columnHeaders: [{ properties: { fontFamily: { expr: { Literal: { Value: "''Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif'" } } }, fontSize: { expr: { Literal: { Value: '11D' } } } } }],
            grid: [{ properties: { gridHorizontal: { expr: { Literal: { Value: 'true' } } }, textSize: { expr: { Literal: { Value: '9D' } } } } }],
            columnWidth: [{ properties: { value: { expr: { Literal: { Value: '120.5D' } } } }, selector: { metadata: 'Sales.Region' } }],
            columnFormatting: [{ properties: { alignment: { expr: { Literal: { Value: "'Center'" } } } }, selector: { metadata: '_m.Total Sales' } }]
          }
        }
      },
      theme
    )
    expect(f.header.font.size).toBe(11)
    expect(f.values.font.size).toBe(9) // legacy grid text size
    expect(f.grid.horizontal).toBe(true)
    expect(f.widthByRef.get('Sales.Region')).toBe(120.5)
    expect(f.columnOverrides.get('_m.Total Sales')!.alignment).toBe('center')
    expect(f.header.outline).toBe('BottomOnly')
    expect(f.grid.outlineColor).toBe(theme.tableAccent)
  })
})

describe('matrix layout (pure)', () => {
  // two row levels (A: x,y / B: z), one column level (c1, c2), one value
  const rows = (d: number, e: number) => {
    const data: Record<string, Array<any[]>> = {
      '0:0': [[100]],
      '1:0': [['A', 60], ['B', 40]],
      '2:0': [['A', 'x', 25], ['A', 'y', 35], ['B', 'z', 40]],
      '0:1': [['c1', 70], ['c2', 30]],
      '1:1': [['A', 'c1', 50], ['A', 'c2', 10], ['B', 'c1', 20], ['B', 'c2', 20]],
      '2:1': [['A', 'x', 'c1', 20], ['A', 'x', 'c2', 5], ['A', 'y', 'c1', 30], ['A', 'y', 'c2', 5], ['B', 'z', 'c1', 20], ['B', 'z', 'c2', 20]]
    }
    return data[`${d}:${e}`]
  }
  const spec = (over: Partial<MatrixSpec> = {}): MatrixSpec => {
    const blocks = new Map()
    for (let d = 0; d <= 2; d++) for (let e = 0; e <= 1; e++) blocks.set(blockKey(d, e), { rowDepth: d, colDepth: e, rows: rows(d, e) })
    return {
      rowLevels: 2,
      colLevels: 1,
      valueCount: 1,
      blocks,
      expandedDepth: 1,
      toggled: new Set(),
      rowSubtotal: () => true,
      rowSubtotalPosition: 'top',
      colSubtotal: () => true,
      valuesOnRow: false,
      ...over
    }
  }

  it('collapsed by default: top level nodes + grand total; column leaves + total column', () => {
    const l = buildMatrixLayout(spec())
    expect(l.items.map((i) => [i.kind, i.label])).toEqual([
      ['node', 'A'],
      ['node', 'B'],
      ['grand', 'Total']
    ])
    expect(l.items[0].node!.canExpand).toBe(true)
    expect(l.leaves.map((x) => [x.path.join('/'), x.isTotal])).toEqual([
      ['c1', false],
      ['c2', false],
      ['', true]
    ])
    expect(l.headerRows[0].map((h) => h.label)).toEqual(['c1', 'c2', 'Total'])
    expect(l.lookup(['A'], ['c2'])!.values[0]).toBe(10)
    expect(l.lookup([], [])!.values[0]).toBe(100)
  })

  it('toggling a node expands it; subtotal position bottom adds a Total row', () => {
    const l = buildMatrixLayout(spec({ toggled: new Set([pathKey(['A'])]), rowSubtotalPosition: 'bottom' }))
    expect(l.items.map((i) => `${i.kind}:${i.label}:${i.level}:${i.showValues}`)).toEqual([
      'node:A:0:false',
      'node:x:1:true',
      'node:y:1:true',
      'subtotal:Total:1:true',
      'node:B:0:true',
      'grand:Total:0:true'
    ])
  })

  it('expand all (expandedDepth 2), subtotals off, per-level column subtotal off, value sort', () => {
    const l = buildMatrixLayout(
      spec({ expandedDepth: 2, rowSubtotal: () => false, colSubtotal: (d) => d !== 0, sort: { kind: 'value', index: 0, dir: 'asc' } })
    )
    // B (40) sorts before A (60); expanded parents show no values when row subtotals are off
    expect(l.items.map((i) => `${i.label}:${i.showValues}`)).toEqual(['B:false', 'z:true', 'A:false', 'x:true', 'y:true'])
    expect(l.leaves.some((x) => x.isTotal)).toBe(false)
  })

  it('a toggled node under expand-all collapses', () => {
    const l = buildMatrixLayout(spec({ expandedDepth: 2, toggled: new Set([pathKey(['B'])]) }))
    expect(l.items.map((i) => i.label)).toEqual(['A', 'x', 'y', 'B', 'Total'])
    expect(l.items[3].node!.expanded).toBe(false)
  })

  it('multiple values produce a value header level; values on rows', () => {
    const blocks = new Map([
      [blockKey(0, 0), { rowDepth: 0, colDepth: 0, rows: [[10, 1]] }],
      [blockKey(1, 0), { rowDepth: 1, colDepth: 0, rows: [['A', 6, 0.5], ['B', 4, 0.5]] }]
    ])
    const base: MatrixSpec = { ...spec(), rowLevels: 1, colLevels: 0, valueCount: 2, blocks }
    const l = buildMatrixLayout(base)
    expect(l.showValueHeaders).toBe(true)
    expect(l.leaves.map((x) => x.valueIndex)).toEqual([0, 1])
    const r = buildMatrixLayout({ ...base, valuesOnRow: true })
    expect(r.leaves.map((x) => x.valueIndex)).toEqual([-1])
    expect(r.items.map((i) => `${i.kind}:${i.valueIndex ?? ''}`)).toEqual(['node:', 'value:0', 'value:1', 'node:', 'value:0', 'value:1', 'grand:', 'value:0', 'value:1'])
  })
})

function matrixJson(opts: { activeRows?: boolean[]; objects?: any; columns?: any[]; expansion?: any } = {}) {
  const active = opts.activeRows ?? [true, false]
  return {
    name: 'm',
    visual: {
      visualType: 'pivotTable',
      query: {
        queryState: {
          Rows: { projections: [proj(S.col('Region'), 'Sales.Region', { active: active[0] }), proj(S.col('Country'), 'Sales.Country', { active: active[1] })] },
          ...(opts.columns ? { Columns: { projections: opts.columns } } : {}),
          Values: { projections: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Margin %'), '_m.Margin %')] }
        }
      },
      objects: opts.objects ?? {},
      ...(opts.expansion ? { expansionStates: opts.expansion } : {})
    }
  }
}

describe('matrix with the sample engine', () => {
  it('subtotals and grand totals are measure re-evaluations', () => {
    const v = buildMatrixView(matrixJson({ activeRows: [true, true] }), createMockHost({ engine }))
    const items = v.layout.items
    const europe = items.findIndex((i) => i.label === 'Europe')
    const germany = items.findIndex((i) => i.label === 'Germany')
    expect(items[europe].showValues).toBe(true) // subtotal position top
    expect(germany).toBeGreaterThan(europe)
    const marginLeaf = v.layout.leaves.findIndex((l) => l.valueIndex === 1)
    const euMargin = v.cells[europe][marginLeaf].value as number
    expect(euMargin).toBeCloseTo(total('Margin %', [{ Version: 2, Where: [{ Condition: { In: { Expressions: [S.col('Region')], Values: [[{ Literal: { Value: "'Europe'" } }]] } } }] }]), 10)
    const grand = items.length - 1
    expect(items[grand].kind).toBe('grand')
    expect(v.cells[grand][0].value).toBeCloseTo(total('Total Sales'), 6)
    expect(matrixData(v).columns.slice(0, 2)).toEqual(['Region', 'Country'])
  })

  it('Power BI expansion state: collapsed levels with single nodes expanded (the next level is active, but not expanded)', () => {
    // what Power BI saves after expanding only Europe with its + icon: both row levels active, both levels collapsed
    const expansion = [
      {
        roles: ['Rows'],
        levels: [
          { queryRefs: ['Sales.Region'], isCollapsed: true, identityKeys: [S.col('Region')], isPinned: true },
          { queryRefs: ['Sales.Country'], isCollapsed: true, isPinned: true }
        ],
        root: { children: [{ identityValues: [{ Literal: { Value: "'Europe'" } }], isToggled: true }] }
      }
    ]
    const v = buildMatrixView(matrixJson({ activeRows: [true, true], expansion }), createMockHost({ engine }))
    const nodes = v.layout.items.filter((i) => i.kind === 'node')
    const regions = nodes.filter((n) => n.path.length === 1)
    expect(regions.length).toBeGreaterThan(1)
    expect(regions.filter((n) => n.node!.expanded).map((n) => n.label)).toEqual(['Europe'])
    expect(nodes.filter((n) => n.path.length === 2).every((n) => n.path[0] === 'Europe')).toBe(true)
    expect(v.data.spec.rowLevelExpanded).toEqual([false, false])
    // a level the file marks as expanded (no isCollapsed) with one region collapsed by hand
    const open = [{ roles: ['Rows'], levels: [{ queryRefs: ['Sales.Region'], isPinned: true }, { queryRefs: ['Sales.Country'], isCollapsed: true, isPinned: true }], root: { children: [{ identityValues: [{ Literal: { Value: "'Europe'" } }], isToggled: true }] } }]
    const w = buildMatrixView(matrixJson({ activeRows: [true, true], expansion: open }), createMockHost({ engine }))
    const wr = w.layout.items.filter((i) => i.kind === 'node' && i.path.length === 1)
    expect(wr.filter((n) => !n.node!.expanded).map((n) => n.label)).toEqual(['Europe'])
    // "Expand all down one level" at run time forces the first level open on top of the saved state
    const forced = buildMatrixView(matrixJson({ activeRows: [true, true], expansion }), createMockHost({ engine, state: { selection: [], log: [], drill: { level: 0, path: [], expandedLevel: 1 } } }))
    expect(forced.data.spec.rowLevelExpanded).toEqual([true, false])
  })

  it('expansion state round-trips through PBIR expansionStates', () => {
    const json: any = matrixJson()
    toggleExpansion(json, ['Europe'], ['Sales.Region', 'Sales.Country'])
    expect(readToggled(json)).toEqual(new Set([pathKey(['Europe'])]))
    const v = buildMatrixView(json, createMockHost({ engine }))
    const labels = v.layout.items.map((i) => i.label)
    expect(labels).toContain('Germany')
    expect(labels).not.toContain('Canada')
    toggleExpansion(json, ['Europe'], ['Sales.Region', 'Sales.Country'])
    expect(readToggled(json).size).toBe(0)
    expect(json.visual.expansionStates[0].root.children).toBeUndefined()
  })

  it('column fields with subtotals; Year columns', () => {
    const v = buildMatrixView(matrixJson({ columns: [proj(S.col('Year'), 'Sales.Year', { active: true })] }), createMockHost({ engine }))
    // 2 years × 2 values + total × 2 values
    expect(v.layout.leaves.length).toBe(6)
    expect(v.layout.headerRows.length).toBe(2)
    expect(v.layout.headerRows[0].map((h) => h.label)).toEqual([2023, 2024, 'Total'])
  })

  it('calculation-group columns are evaluated one item at a time under an item filter', () => {
    const calc = { table: 'Time Calc', column: 'Item' }
    const seen: string[] = []
    const cgEngine: QueryEngine = {
      ...engine,
      model: { ...engine.model, tables: [{ name: 'Time Calc', columns: [], measures: [], hierarchies: [], partitions: [], calculationGroup: { items: [{ name: 'Current', expression: 'SELECTEDMEASURE()', ordinal: 0 }, { name: 'Half', expression: 'SELECTEDMEASURE()/2', ordinal: 1 }] } }] } as any,
      summarize(req: SummarizeRequest) {
        const f = (req.filters ?? []).find((x) => JSON.stringify(x).includes('"Time Calc"'))
        const item = f ? (f.Where[0].Condition.In.Values[0][0].Literal.Value as string) : undefined
        if (item) seen.push(item)
        const r = engine.summarize({ ...req, filters: (req.filters ?? []).filter((x) => x !== f) })
        if (item !== "'Half'") return r
        const g = req.groupBy.length
        return { ...r, rows: r.rows.map((row) => row.map((v, i) => (i >= g && typeof v === 'number' ? v / 2 : v))) }
      }
    }
    const json = matrixJson({ columns: [proj(columnExpr(calc.table, calc.column), 'Time Calc.Item', { active: true })] })
    const v = buildMatrixView(json, createMockHost({ engine: cgEngine }))
    expect(seen).toContain("'Half'")
    const leaves = v.layout.leaves
    const cur = leaves.findIndex((l) => l.path[0] === 'Current' && l.valueIndex === 0)
    const half = leaves.findIndex((l) => l.path[0] === 'Half' && l.valueIndex === 0)
    const row = v.layout.items.findIndex((i) => i.label === 'Europe')
    expect(v.cells[row][half].value as number).toBeCloseTo((v.cells[row][cur].value as number) / 2, 6)
    void fieldKey
    void measureExpr
  })
})

describe('CF icons', () => {
  it('resolves icon names by keywords', () => {
    expect(resolveIcon('CircleGreen')).toMatchObject({ shape: 'circle', color: '#79C75B' })
    expect(resolveIcon('ArrowDownRed')).toMatchObject({ shape: 'arrowDown' })
    expect(resolveIcon('triangleUpGreen')!.shape).toBe('triangleUp')
    expect(resolveIcon('checkGreen')!.shape).toBe('check')
    expect(resolveIcon('quarters3')).toMatchObject({ shape: 'quarter', level: 3 })
    expect(resolveIcon('')).toBeUndefined()
  })
})

describe('column header alignment (Power BI renders)', () => {
  const theme = resolveTheme(undefined)
  const json = (columnFormatting: any[], columnHeaders?: any) => ({
    visual: { visualType: 'tableEx', objects: { columnFormatting, ...(columnHeaders ? { columnHeaders: [columnHeaders] } : {}) } }
  })
  const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
  it('Auto is left, also over a column whose values are aligned right', () => {
    const f = readTableFormat(json([{ properties: { alignment: lit("'Right'") }, selector: { metadata: 'm.A' } }]), theme)
    const ov = f.columnOverrides.get('m.A')!
    expect(ov.alignment).toBe('right')
    expect(ov.alignHeader).toBe(false)
    expect(headerAlignment(f, ov)).toBe('left')
    expect(headerAlignment(f)).toBe('left')
  })
  it('a stored "Apply to header" moves the header with the column; columnHeaders.alignment wins', () => {
    const f = readTableFormat(json([{ properties: { alignment: lit("'Right'"), styleHeader: lit('true') }, selector: { metadata: 'm.A' } }]), theme)
    expect(headerAlignment(f, f.columnOverrides.get('m.A'))).toBe('right')
    const g = readTableFormat(json([{ properties: { alignment: lit("'Right'"), styleHeader: lit('true') }, selector: { metadata: 'm.A' } }], { properties: { alignment: lit("'Center'") } }), theme)
    expect(headerAlignment(g, g.columnOverrides.get('m.A'))).toBe('center')
  })
})

describe('matrix grand total pinning', () => {
  const it0 = (kind: any, totalKind?: any): any => ({ kind, level: 0, path: [], showValues: true, isTotal: !!totalKind, totalKind })
  it('pins the trailing grand-total rows (values on rows too), not a matrix that is only its total', () => {
    expect(pinnedGrandTotalStart([it0('node'), it0('node'), it0('grand', 'grand')])).toBe(2)
    expect(pinnedGrandTotalStart([it0('node'), it0('grand', 'grand'), it0('value', 'grand'), it0('value', 'grand')])).toBe(1)
    expect(pinnedGrandTotalStart([it0('node'), it0('subtotal', 'subtotal')])).toBe(2)
    expect(pinnedGrandTotalStart([it0('grand', 'grand')])).toBe(1)
    expect(pinnedGrandTotalStart([])).toBe(0)
  })
})
