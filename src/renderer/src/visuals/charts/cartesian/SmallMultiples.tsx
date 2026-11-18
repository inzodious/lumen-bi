/**
 * Small multiples (PBIR role `Rows`) for column / bar / line / area / combo charts and pie /
 * donut charts: one panel per value of the field, laid out in a grid, with consistent series
 * colors and a single legend on top like Power BI.
 *
 *  - Layout (`smallMultiplesLayout`): "Auto grid" picks columns from the visual's aspect ratio
 *    (≤ 3 rows visible, vertical scrolling beyond); "Custom" uses rowCount × columnCount.
 *  - Shared y-axis (`valueAxis.sharedAxis`, default on): one value range for every panel, value
 *    axis drawn on the first column only and the category axis on the last row only (the outer
 *    cells get the extra room so all plot areas line up). Off = each panel scales on its own.
 *  - Gridlines between panels: `gridLineShow` / `gridLineType` (inner, all, innerHorizontal,
 *    innerVertical) / color / width / style; panel background; titles from `subheader`.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { VisualProps } from '../../contract'
import { literalExpr } from '@core/report/sq'
import { buildCategorical, fieldRef, formatCategoryValue, type CategoricalData } from '../../common/categorical'
import { expandParameters, getProjections } from '../../common/query'
import { FormatReader, PBI } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { rgba, staticFill } from '../../common/color'
import { ellipsize, fontAttrs, fontWeightOf, lineHeight, measureText, ptToPx } from '../../common/text'
import { computeValueAxis, stackValues } from '../../common/scale'
import { EmptyVisual, VisualError, useVisualQuery } from '../../common/VisualState'
import { CartesianChart, categoricalOptions, panelMargins, type CartesianConfig, type PanelOptions } from './CartesianChart'
import { readErrorBars } from './errorBars'
import { maxLabelWidth, valueTickFormatter } from './axisLayout'
import { PieChart, pieQueryOptions } from '../pie/PieChart'

interface Panel {
  key: string
  label: string
  data: CategoricalData
  ctx: VisualProps['ctx']
}

export type SmallMultipleKind = { kind: 'cartesian'; config: CartesianConfig } | { kind: 'pie'; donut: boolean; icon: string }

/** Grid dimensions: custom rows × columns, or PBI's auto grid from the aspect ratio. */
export function gridSize(n: number, width: number, height: number, custom?: { rows: number; cols: number }): { rows: number; cols: number } {
  if (custom) return { rows: Math.max(1, custom.rows), cols: Math.max(1, custom.cols) }
  if (n <= 1) return { rows: 1, cols: 1 }
  const aspect = width / Math.max(1, height)
  let best = { rows: 1, cols: n, score: Infinity }
  for (let cols = 1; cols <= Math.min(n, 6); cols++) {
    const rows = Math.min(3, Math.ceil(n / cols))
    const cellAspect = width / cols / (height / rows)
    // prefer cells close to 4:3 and few empty slots
    const empty = cols * Math.ceil(n / cols) - n
    const score = Math.abs(Math.log(cellAspect / 1.33)) + empty * 0.05 + (Math.ceil(n / cols) > 3 ? 0.4 : 0)
    if (score < best.score) best = { rows, cols, score }
  }
  void aspect
  return { rows: best.rows, cols: best.cols }
}

export function SmallMultiples({ visual, width, height, ctx, config, pie }: VisualProps & { config?: CartesianConfig; pie?: { donut: boolean; icon: string } }) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => {
    const sm = expandParameters(getProjections(json)['Rows'] ?? [], ctx)[0]
    const ref = fieldRef(ctx, sm)
    const dv = ctx.engine.distinctValues({ column: { kind: 'sq', expr: sm.expr }, filters: ctx.filters, limit: 60, existsInFacts: true })
    const panels: Panel[] = []
    const opts = config ? categoricalOptions(config, fmt, readErrorBars(fmt)) : pieQueryOptions(fmt)
    for (const v of dv.values) {
      const filter = { Version: 2, Where: [{ Condition: { In: { Expressions: [ref.identityExpr], Values: [[literalExpr(v)]] } } }] }
      const pctx = { ...ctx, filters: [...ctx.filters, filter] }
      const data = buildCategorical(json, pctx, opts)
      if (!data.series.length || !data.categories.length) continue
      const smField = { expr: ref.identityExpr, value: v }
      for (const c of data.categories) {
        c.scope = [...c.scope, smField]
        c.identity = { fields: c.scope }
      }
      panels.push({ key: String(v instanceof Date ? v.getTime() : v), label: formatCategoryValue(ctx, ref, v), data, ctx: pctx })
    }
    // consistent colors: global series order across panels (cartesian); pies color by category scope
    const order: string[] = []
    for (const p of panels) for (const s of p.data.series) if (!order.includes(s.key)) order.push(s.key)
    if (config)
      for (const p of panels)
        for (const s of p.data.series) {
          const gi = order.indexOf(s.key)
          if (!s.pointColors) s.color = staticFill(fmt.pc, s.split ? { fields: s.scope, index: gi } : { metadata: s.metadata, index: gi })
        }
    // shared primary range
    let lo = 0
    let hi = 0
    if (config)
      for (const p of panels) {
        const prim = p.data.series.filter((s) => !config.secondaryRoles?.includes(s.role))
        if (config.stacking !== 'clustered') {
          const st = stackValues(
            prim.map((s) => s.values),
            config.stacking === 'percent'
          )
          for (const row of st) for (const seg of row) if (seg) ((lo = Math.min(lo, seg[0])), (hi = Math.max(hi, seg[1])))
        } else for (const s of prim) for (const v of s.values) if (v !== null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)))
      }
    return { panels, order, domain: [lo, hi] as [number, number], label: ref.label }
  })
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const { panels, domain } = q.data
  if (!panels.length) return <EmptyVisual icon={config?.icon ?? pie?.icon ?? ''} width={width} height={height} />

  // single legend (series for cartesian charts, legend categories for pies)
  const seen = new Map<string, LegendItem>()
  for (const p of panels) {
    if (config) for (const s of p.data.series) !seen.has(s.key) && seen.set(s.key, { key: s.key, label: s.name, color: s.color })
    else {
      const s0 = p.data.series[0]
      p.data.categories.forEach((c, ci) => !seen.has(c.label) && seen.set(c.label, { key: c.label, label: c.label, color: s0?.pointColors?.[ci] ?? s0?.color ?? '#118DFF' }))
    }
  }
  const items = [...seen.values()]
  const legendTitle = config ? (panels[0].data.seriesField?.label ?? '') : panels[0].data.levels.map((l) => l.label).join(', ')
  const legendStyle = readLegendStyle(fmt, { show: items.length > 1, title: legendTitle })
  if (legendStyle.position !== 'Top' && legendStyle.position !== 'TopCenter') legendStyle.position = 'Top'
  const lg = measureLegend(legendStyle, items, width, height)

  // grid
  const custom = fmt.str('smallMultiplesLayout', 'layoutType', fmt.raw('smallMultiplesLayout', 'rowCount') !== undefined || fmt.raw('smallMultiplesLayout', 'columnCount') !== undefined ? 'custom' : 'auto') === 'custom'
  const gridH = height - lg.size
  const { rows, cols } = gridSize(panels.length, width, gridH, custom ? { rows: Math.round(fmt.num('smallMultiplesLayout', 'rowCount', 2)), cols: Math.round(fmt.num('smallMultiplesLayout', 'columnCount', Math.min(3, panels.length))) } : undefined)
  const pad = Math.max(0, fmt.num('smallMultiplesLayout', 'gridPadding', 0))
  const vertical = config?.orientation !== 'horizontal'
  const shared = !!config && fmt.bool('valueAxis', 'sharedAxis', true)
  const nRows = Math.ceil(panels.length / cols)

  // outer axis room (shared axes): value labels on the first column, category labels on the last row
  const axisFont = { size: ptToPx(fmt.num('valueAxis', 'fontSize', PBI.axisFontPt)), family: fmt.str('valueAxis', 'fontFamily', PBI.fontFamily), weight: 400 }
  let firstColExtra = 0
  let lastRowExtra = 0
  if (shared && config) {
    const m = computeValueAxis({ dataMin: domain[0], dataMax: domain[1], includeZero: true, length: vertical ? gridH / Math.min(rows, nRows) : width / cols, tickSpacing: vertical ? 50 : 90 })
    const labels = m.ticks.map(valueTickFormatter(m, { displayUnits: fmt.optNum('valueAxis', 'labelDisplayUnits'), precision: fmt.optNum('valueAxis', 'labelPrecision'), formatString: panels[0].data.series[0]?.measure.formatString, format: ctx.format, percent: config.stacking === 'percent' }))
    const catLH = lineHeight(axisFont)
    if (vertical) {
      firstColExtra = Math.ceil(maxLabelWidth(labels, axisFont)) + 12
      lastRowExtra = catLH + 8
    } else {
      const catLabels = panels.flatMap((p) => p.data.categories.map((c) => c.label))
      firstColExtra = Math.min(width * 0.25, Math.ceil(maxLabelWidth(catLabels, axisFont)) + 12)
      lastRowExtra = catLH + 8
    }
  }
  // panel titles (subheader)
  const titleShow = fmt.bool('subheader', 'show', true)
  const tFam = fmt.str('subheader', 'fontFamily', PBI.fontFamily)
  const titleFont = { size: ptToPx(fmt.num('subheader', 'fontSize', fmt.num('smallMultiplesLayout', 'fontSize', 10))), family: tFam, weight: fontWeightOf(tFam, fmt.bool('subheader', 'bold', false)), italic: fmt.bool('subheader', 'italic', false) }
  const titleColor = fmt.color('subheader', 'fontColor', PBI.titleColor)
  const titleAlign = fmt.str('subheader', 'alignment', 'left')
  const titleBottom = fmt.str('subheader', 'position', 'top') === 'bottom'
  const titleH = titleShow ? lineHeight(titleFont) + 4 : 0

  // Shared plot geometry: measure each panel's natural margins (its axes / rotated labels / titles),
  // then give every panel the same plot size — the first column gets the extra width its value axis
  // needs and the last row the extra height of its category labels (rotated or not). Two passes,
  // because label rotation depends on the plot width.
  const flags = (i: number) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    // the category axis is drawn on the lowest panel of each column
    return { first: col === 0, last: i + cols >= panels.length, lastRow: row === nRows - 1 }
  }
  const panelOpts = (p: Panel, i: number): PanelOptions => {
    const { first, last } = flags(i)
    return {
      key: p.key,
      data: p.data,
      domain: shared ? domain : undefined,
      hideLegend: true,
      hideTitles: true,
      hideValueAxis: shared && (vertical ? !first : !last),
      hideCategoryAxis: shared && (vertical ? !last : !first)
    }
  }
  let cellW = Math.max(40, Math.floor((width - firstColExtra) / cols))
  let cellH = Math.max(70, Math.floor((gridH - lastRowExtra) / rows))
  const panelW = (i: number) => cellW + (flags(i).first ? firstColExtra : 0) - pad - 2
  const panelH = (i: number) => cellH + (flags(i).lastRow ? lastRowExtra : 0) - titleH - pad - 2
  let margins: { leftFirst: number; leftOther: number; right: number; top: number; bottomAxis: number; bottomOther: number } | null = null
  if (config) {
    for (let pass = 0; pass < 2; pass++) {
      const m = { leftFirst: 0, leftOther: 0, right: 0, top: 0, bottomAxis: 0, bottomOther: 0 }
      panels.forEach((p, i) => {
        const f = flags(i)
        const mm = panelMargins(p.data, json, ctx.theme, config, Math.max(20, panelW(i)), Math.max(20, panelH(i)), ctx.format, panelOpts(p, i))
        if (f.first) m.leftFirst = Math.max(m.leftFirst, mm.left)
        else m.leftOther = Math.max(m.leftOther, mm.left)
        if (f.last) m.bottomAxis = Math.max(m.bottomAxis, mm.bottom)
        else m.bottomOther = Math.max(m.bottomOther, mm.bottom)
        m.right = Math.max(m.right, mm.right)
        m.top = Math.max(m.top, mm.top)
      })
      if (cols === 1) m.leftOther = m.leftFirst
      if (!panels.some((_, i) => !flags(i).last)) m.bottomOther = Math.min(m.bottomAxis, m.bottomOther || m.bottomAxis)
      margins = m
      firstColExtra = Math.max(0, m.leftFirst - m.leftOther)
      lastRowExtra = Math.max(0, m.bottomAxis - m.bottomOther)
      cellW = Math.max(40, Math.floor((width - firstColExtra) / cols))
      cellH = Math.max(70, Math.floor((gridH - lastRowExtra) / rows))
    }
  }

  // borders between panels
  const gridOn = fmt.bool('smallMultiplesLayout', 'gridLineShow', true)
  const gridType = fmt.str('smallMultiplesLayout', 'gridLineType', 'inner')
  const gridColor = fmt.color('smallMultiplesLayout', 'gridLineColor', '#E1DFDD')
  const gridW = fmt.num('smallMultiplesLayout', 'gridLineWidth', 1)
  const gridStyle = fmt.str('smallMultiplesLayout', 'gridLineStyle', 'solid')
  const bg = fmt.optStr('smallMultiplesLayout', 'backgroundColor')
  const bgOp = 1 - fmt.num('smallMultiplesLayout', 'backgroundTransparency', 0) / 100
  const border = `${gridW}px ${gridStyle} ${gridColor}`
  const cellStyle = (i: number): CSSProperties => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const lastCol = col === cols - 1 || i === panels.length - 1
    const lastRow = row === nRows - 1
    const st: CSSProperties = { position: 'relative', boxSizing: 'border-box', padding: pad / 2 }
    if (bg) st.background = rgba(bg, bgOp)
    if (!gridOn) return st
    const all = gridType === 'all'
    if ((all || gridType === 'inner' || gridType === 'innerVertical') && !lastCol) st.borderRight = border
    if ((all || gridType === 'inner' || gridType === 'innerHorizontal') && !lastRow) st.borderBottom = border
    if (all) {
      if (col === 0) st.borderLeft = border
      if (row === 0) st.borderTop = border
      if (lastCol) st.borderRight = border
      if (lastRow) st.borderBottom = border
    }
    return st
  }

  const panelNode = (p: Panel, i: number): ReactNode => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const w = panelW(i)
    const h = panelH(i)
    const { first, last } = flags(i)

    const title = titleShow ? (
      <svg width={w} height={titleH} style={{ display: 'block' }}>
        <text
          x={titleAlign === 'center' ? (first ? firstColExtra : 0) + (w - (first ? firstColExtra : 0)) / 2 : titleAlign === 'right' ? w - 6 : (first ? firstColExtra : 0) + 6}
          y={titleH / 2}
          dy="0.35em"
          textAnchor={titleAlign === 'center' ? 'middle' : titleAlign === 'right' ? 'end' : 'start'}
          {...fontAttrs(titleFont)}
          fill={titleColor}
        >
          {ellipsize(p.label, w - 12, titleFont)}
        </text>
      </svg>
    ) : null
    const body = config ? (
      <CartesianChart
        visual={visual}
        pageName=""
        width={w}
        height={h}
        ctx={p.ctx}
        config={config}
        panel={{
          ...panelOpts(p, i),
          margins: margins
            ? {
                left: first ? margins.leftFirst : margins.leftOther,
                right: margins.right,
                top: margins.top,
                bottom: row === nRows - 1 ? margins.bottomAxis : margins.bottomOther
              }
            : undefined,
          // a panel above an empty grid cell draws its category labels into that cell
          overflowBottom: margins && last && row !== nRows - 1 ? Math.max(0, margins.bottomAxis - margins.bottomOther) : undefined
        }}
      />
    ) : (
      <PieChart visual={visual} pageName="" width={w} height={h} ctx={p.ctx} donut={!!pie?.donut} icon={pie?.icon ?? ''} panel={{ data: p.data, hideLegend: true, panelKey: p.key }} />
    )
    return (
      <div key={p.key} style={cellStyle(i)}>
        {titleBottom ? null : title}
        {body}
        {titleBottom ? title : null}
      </div>
    )
  }

  const colTemplate = Array.from({ length: cols }, (_, c) => `${cellW + (c === 0 ? firstColExtra : 0)}px`).join(' ')
  const rowTemplate = Array.from({ length: nRows }, (_, r) => `${cellH + (r === nRows - 1 ? lastRowExtra : 0)}px`).join(' ')
  void measureText
  return (
    <div style={{ width, height, display: 'flex', flexDirection: 'column' }}>
      {lg.size ? (
        <svg width={width} height={lg.size} style={{ display: 'block', flex: 'none' }}>
          <Legend style={legendStyle} items={items} x={0} y={0} width={width} height={lg.size} />
        </svg>
      ) : null}
      <div style={{ flex: 1, overflowY: nRows > rows ? 'auto' : 'hidden', overflowX: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}>{panels.map(panelNode)}</div>
      </div>
    </div>
  )
}
