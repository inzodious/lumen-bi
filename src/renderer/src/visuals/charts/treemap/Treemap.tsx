/**
 * Treemap (PBI `treemap`): squarified two-level layout (see ./treemapLayout.ts) of Group ("Category",
 * drillable hierarchy) and optional Details, sized by Values.
 *
 *  - Each group gets its own palette color (`dataPoint.fill` per group, conditional fill per tile);
 *    detail tiles share the group color, separated by thin white lines.
 *  - With Details, the group label is drawn at the top-left of each group (in a header strip) and
 *    detail labels inside their tiles; without Details, every tile shows its category label.
 *  - `categoryLabels` (default on) and `labels` (data labels, default off) text; `legend` lists
 *    the groups (shown by default when Details are used).
 *  - Cross-highlight: the highlighted fraction fills the tile from the bottom over a faded tile.
 */
import { useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { VisualProps } from '../../contract'
import { buildCategorical, pointIdentity, type CategoricalData } from '../../common/categorical'
import { FormatReader, PBI } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { ellipsize, fontAttrs, lineHeight } from '../../common/text'
import { contrastText, rgba, staticFill } from '../../common/color'
import { formatWithUnits, resolveDisplayUnit } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { pointTooltip } from '../../common/tooltip'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { ICONS } from '../icons'
import type { DataPointIdentity } from '@core/report/sq'
import { layoutTreemap } from './treemapLayout'

interface Leaf {
  key: string
  group: string
  label: string
  value: number
  highlight?: number | null
  color: string
  identity: DataPointIdentity
  ci: number
  si: number
}

interface Group {
  key: string
  label: string
  color: string
  identity: DataPointIdentity
  ci: number
}

/** Groups = categories (Group role, drill-aware); leaves = Details series values per group. */
export function treemapNodes(d: CategoricalData, fmt: FormatReader, hasDetails: boolean): { groups: Group[]; leaves: Leaf[] } {
  const groups: Group[] = []
  const leaves: Leaf[] = []
  d.categories.forEach((c, ci) => {
    const color = hasDetails ? staticFill(fmt.pc, { fields: c.scope, index: ci }) : (d.series[0]?.pointColors?.[ci] ?? staticFill(fmt.pc, { fields: c.scope, index: ci }))
    const group: Group = { key: c.key, label: c.label, color, identity: pointIdentity(c, undefined), ci }
    let any = false
    d.series.forEach((s, si) => {
      if (hasDetails && !s.split) return
      const v = s.values[ci]
      if (v === null || !(v > 0)) return
      any = true
      leaves.push({
        key: hasDetails ? `${c.key}§${s.key}` : c.key,
        group: c.key,
        label: hasDetails ? s.name : c.label,
        value: v,
        highlight: s.highlights?.[ci],
        // per-tile conditional color (with Details); without Details pointColors already = group colors
        color: hasDetails ? (s.pointColors?.[ci] ?? color) : color,
        identity: pointIdentity(c, hasDetails ? s : undefined),
        ci,
        si
      })
    })
    if (any) groups.push(group)
  })
  return { groups, leaves }
}

export function Treemap({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const hasDetails = ((json?.visual?.query?.queryState?.Details?.projections ?? []) as any[]).length > 0
  const q = useVisualQuery(json, ctx, () =>
    buildCategorical(json, ctx, { categoryRole: 'Group', seriesRole: hasDetails ? 'Details' : undefined, splitRoles: ['Values'], defaultSort: 'measureDesc', applyDefaultSortWhenUnsaved: true, highlight: true, fmt, varyColors: !hasDetails, maxSeries: 2000, maxCategories: 2000 })
  )
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d.series.length) return <EmptyVisual icon={ICONS.treemap} width={width} height={height} />
  const { groups, leaves } = treemapNodes(d, fmt, hasDetails)
  if (!leaves.length) return <NoData height={height} />
  const inter = makeInteractions(ctx, { drillLevels: d.allLevels.length })

  const legendStyle = readLegendStyle(fmt, { show: hasDetails, position: 'Top', title: d.levels.map((l) => l.label).join(' ') })
  const items: LegendItem[] = groups.map((g) => ({ key: g.key, label: g.label, color: g.color, dimmed: inter.hasSelection && !inter.isSelected(g.identity) }))
  const lg = measureLegend(legendStyle, items, width, height)
  const vertical = legendStyle.position.startsWith('Left') || legendStyle.position.startsWith('Right')
  const box = {
    x: vertical && legendStyle.position.startsWith('Left') ? lg.size : 0,
    y: !vertical && legendStyle.position.startsWith('Top') ? lg.size : 0,
    w: Math.max(10, width - (vertical ? lg.size : 0)),
    h: Math.max(10, height - (vertical ? 0 : lg.size))
  }

  const catShow = fmt.bool('categoryLabels', 'show', true)
  const catT = fmt.text('categoryLabels', {}, { size: 10, color: '#FFFFFF' })
  const catColor = fmt.optStr('categoryLabels', 'color')
  const groupFont = { ...catT.font, weight: Math.max(catT.font.weight ?? 400, 600) }
  const headerH = hasDetails && catShow ? lineHeight(groupFont) + 6 : 0
  const labShow = fmt.bool('labels', 'show', false)
  const lT = fmt.text('labels', {}, { size: PBI.dataLabelFontPt, color: '#FFFFFF' })
  const lcolor = fmt.optStr('labels', 'color')
  const unit = resolveDisplayUnit(fmt.optNum('labels', 'labelDisplayUnits') ?? 0, Math.max(...leaves.map((l) => l.value)))
  const lay = layoutTreemap(
    groups.map((g) => ({ key: g.key, children: leaves.filter((l) => l.group === g.key).map((l) => ({ key: l.key, value: l.value })) })),
    { width: box.w, height: box.h, tiling: fmt.optStr('layout', 'tilingMethod'), innerPadding: fmt.num('layout', 'innerPadding', 1), outerPadding: fmt.num('layout', 'outerPadding', 0), groupHeader: headerH }
  )
  const leafByKey = new Map(leaves.map((l) => [l.key, l]))
  const groupByKey = new Map(groups.map((g) => [g.key, g]))
  const hl = d.hasHighlights
  const nodes: ReactNode[] = []
  const texts: ReactNode[] = []
  const lh = lineHeight(catT.font)
  const llh = lineHeight(lT.font)

  // group backgrounds + header labels (Details only)
  if (hasDetails)
    for (const gr of lay.groups) {
      const g = groupByKey.get(gr.key)!
      const op = hl ? 1 : inter.opacityFor(g.identity)
      const x0 = gr.rect.x0 + box.x
      const y0 = gr.rect.y0 + box.y
      const w = gr.rect.x1 - gr.rect.x0
      const h = gr.rect.y1 - gr.rect.y0
      nodes.push(<rect key={`g${g.key}`} x={x0} y={y0} width={Math.max(0, w)} height={Math.max(0, h)} fill={hl ? rgba(g.color, PBI.highlightBackOpacity) : g.color} opacity={op} />)
      if (gr.header && w > 24)
        texts.push(
          <text key={`gt${g.key}`} x={x0 + 5} y={y0 + gr.header / 2} dy="0.35em" {...fontAttrs(groupFont)} fill={catColor ?? contrastText(g.color)} opacity={op} pointerEvents="none">
            {ellipsize(g.label, w - 10, groupFont)}
          </text>
        )
    }

  for (const tile of lay.leaves) {
    const l = leafByKey.get(tile.key)!
    const x0 = tile.rect.x0 + box.x
    const y0 = tile.rect.y0 + box.y
    const w = tile.rect.x1 - tile.rect.x0
    const h = tile.rect.y1 - tile.rect.y0
    const s = d.series[l.si]
    const op = hl ? 1 : inter.opacityFor(l.identity)
    const handlers = {
      onClick: (e: ReactMouseEvent) => inter.onPointClick(l.identity, e, { categoryOnly: pointIdentity(d.categories[l.ci], undefined) }),
      onContextMenu: (e: ReactMouseEvent) => inter.onContextMenu(l.identity, e),
      onMouseMove: (e: ReactMouseEvent) => inter.showTooltip(e, pointTooltip(ctx, d, l.ci, s), l.identity),
      onMouseLeave: () => inter.hideTooltip()
    }
    if (hl) {
      const frac = l.highlight && l.value ? Math.max(0, Math.min(1, l.highlight / l.value)) : 0
      nodes.push(
        <g key={l.key} {...handlers} style={{ cursor: 'pointer' }}>
          <rect x={x0} y={y0} width={w} height={h} fill={rgba(l.color, PBI.highlightBackOpacity)} />
          <rect x={x0} y={y0 + h * (1 - frac)} width={w} height={h * frac} fill={l.color} />
        </g>
      )
    } else nodes.push(<rect key={l.key} x={x0} y={y0} width={Math.max(0, w)} height={Math.max(0, h)} fill={l.color} opacity={op} stroke={hasDetails ? '#FFFFFF' : undefined} strokeWidth={hasDetails ? 0.5 : undefined} style={{ cursor: 'pointer' }} {...handlers} />)
    const textColor = catColor ?? contrastText(l.color)
    let ty = y0 + 4
    if (catShow && h >= lh + 4 && w > 20) {
      texts.push(
        <text key={`t${l.key}`} x={x0 + 5} y={ty} dy="0.9em" {...fontAttrs(catT.font)} fill={textColor} pointerEvents="none" opacity={op}>
          {ellipsize(l.label, w - 10, catT.font)}
        </text>
      )
      ty += lh
    }
    if (labShow && h >= ty - y0 + llh && w > 20) {
      texts.push(
        <text key={`v${l.key}`} x={x0 + 5} y={ty} dy="0.9em" {...fontAttrs(lT.font)} fill={lcolor ?? contrastText(l.color)} pointerEvents="none" opacity={op}>
          {ellipsize(formatWithUnits(l.value, { unit, decimals: fmt.optNum('labels', 'labelPrecision'), formatString: s.formats[l.ci] ?? s.measure.formatString, format: ctx.format }), w - 10, lT.font)}
        </text>
      )
    }
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', userSelect: 'none' }} onClick={(e) => inter.onBackgroundClick(e)} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      {nodes}
      {texts}
      {lg.size ? (
        <Legend
          style={legendStyle}
          items={items}
          x={legendStyle.position.startsWith('Right') ? width - lg.size : 0}
          y={legendStyle.position.startsWith('Bottom') ? height - lg.size : 0}
          width={vertical ? lg.size : width}
          height={vertical ? height : lg.size}
          onItemClick={(key, e) => {
            const g = groupByKey.get(key)
            if (g) inter.onPointClick(g.identity, e, { drillable: false })
          }}
        />
      ) : null}
    </svg>
  )
}
