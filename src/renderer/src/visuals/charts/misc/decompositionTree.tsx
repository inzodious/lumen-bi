/**
 * Decomposition tree (Power BI `decompositionTreeVisual`).
 *
 *  - Root = the Analyze measure; "+" on a node of the last level opens the split menu: High value /
 *    Low value (AI splits, light bulb) and the Explain-by fields not used on the path yet.
 *  - Clicking a node of an earlier level moves the path (levels stay pinned); clicking a node of the last
 *    level cross-filters the page (Ctrl/⌘ = multi-select).
 *  - Level headers: field name, accent underline, selected node as subtitle, × to remove the level (and the
 *    ones after it), light bulb on AI levels (click = turn into a normal level), lock (edit mode).
 *  - Long levels show `barsPerLevel` bars with PBI's scroll chevrons ("+N" above / below).
 *  - The expansion (levels, path, AI method, locks) is persisted in `visual.expansionStates` like Power BI
 *    (see decomp/state.ts); scroll offsets and the open menu are runtime-only.
 *
 * Approximations: Power BI hides AI splits for "complex measures"; Lumen offers them for every measure.
 * Bars use Power BI's default scaling (level maximum); `dataBars.dataBarScalingType` switches it.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { LightbulbRegular } from '@fluentui/react-icons'
import type { Scalar } from '@core/model/data'
import type { VisualProps } from '../../contract'
import { EmptyVisual, VisualError, useVisualQuery } from '../../common/VisualState'
import { makeInteractions } from '../../common/interaction'
import { FormatReader } from '../../common/fmtProps'
import { ellipsize, fontAttrs, fontWeightOf, lineHeight, ptToPx, type FontSpec } from '../../common/text'
import { formatScalar, formatWithUnits, resolveDisplayUnit } from '../../common/units'
import { ICONS } from '../icons'
import { DECOMP_DEFAULTS } from './formatCards'
import { computeTree, splitCandidates, type TreeColumnData, type TreeData, type TreeNodeData } from './decomp/query'
import { addLevel, barFraction, removeLevel, revertAi, selectPathNode, setLocked, writeDecompState, type AiMethod, type AiMode, type BarScaling, type DecompState } from './decomp/state'

const BAR_H = 10
const COL_GAP = 50
const PAD = 8
const ARROW_H = 18
const FONT_STACK = "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"

interface TextFmt {
  font: FontSpec
  color: string
  underline: boolean
}

function readText(fmt: FormatReader, object: string, prefix: string, def: { size: number; color: string }): TextFmt {
  const family = fmt.str(object, `${prefix}FontFamily`, 'Segoe UI')
  const bold = fmt.bool(object, `${prefix}Bold`, false)
  return {
    font: { size: ptToPx(fmt.num(object, `${prefix}FontSize`, def.size)), family, weight: fontWeightOf(family, bold), italic: fmt.bool(object, `${prefix}Italic`, false) },
    color: fmt.color(object, `${prefix}FontColor`, def.color),
    underline: fmt.bool(object, `${prefix}Underline`, false)
  }
}

interface MenuState {
  /** level of the node the menu splits (-1 = root) */
  atLevel: number
  node: Scalar | undefined
  x: number
  y: number
}

export function DecompositionTree({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const aiEnabled = fmt.bool('analysis', 'aiEnabled', true)
  const aiMode: AiMode = fmt.str('analysis', 'aiMode', 'absolute') === 'relative' ? 'relative' : 'absolute'
  const q = useVisualQuery(json, ctx, () => computeTree(json, ctx, { aiMode, aiEnabled }), `${aiMode}|${aiEnabled}`)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // scroll offset per level, keyed by level + field + parent path (a new parent starts at the top)
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [hoverHeader, setHoverHeader] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nCols = q.ok && q.data ? q.data.columns.length : 0
  useEffect(() => {
    const el = scroller.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth
  }, [nCols])

  if (!q.ok) return <VisualError error={q.error} height={height} />
  const tree = q.data
  if (!tree) return <EmptyVisual icon={ICONS.decompositionTreeVisual} width={width} height={height} />

  const inter = makeInteractions(ctx)
  const persist = (next: DecompState) => {
    const ids = new Map(tree.explain.map((f) => [f.proj.queryRef, f.identityExpr]))
    ctx.updateVisual((j) => writeDecompState(j, next, (r) => ids.get(r)))
  }
  const clearSelection = () => {
    if (ctx.selection.length) ctx.select([])
  }

  // ---- formatting ----
  const accent = fmt.color('tree', 'accentColor', ctx.theme.dataColors[0] ?? '#118DFF')
  const connColor = fmt.color('tree', 'connectorDefaultColor', DECOMP_DEFAULTS.connectorDefaultColor)
  const connectorType = fmt.str('tree', 'connectorType', 'curve')
  const density = fmt.str('tree', 'density', 'default')
  const barsPerLevel = Math.max(2, Math.round(fmt.num('tree', 'barsPerLevel', DECOMP_DEFAULTS.barsPerLevel)))
  const posColor = fmt.color('dataBars', 'positiveBarColor', fmt.color('dataBars', 'dataBarColor', ctx.theme.dataColors[0] ?? '#118DFF'))
  const negColor = fmt.color('dataBars', 'negativeBarColor', DECOMP_DEFAULTS.negativeBarColor)
  const trackColor = fmt.color('dataBars', 'dataBarBackgroundColor', DECOMP_DEFAULTS.dataBarBackgroundColor)
  const scaling = (fmt.str('dataBars', 'dataBarScalingType', 'levelMaximum') as BarScaling) ?? 'levelMaximum'
  const widthPct = Math.max(50, Math.min(300, fmt.num('dataBars', 'dataBarWidthPercent', DECOMP_DEFAULTS.dataBarWidthPercent)))
  const cat = readText(fmt, 'categoryLabels', 'categoryLabel', { size: DECOMP_DEFAULTS.categoryLabelFontSize, color: DECOMP_DEFAULTS.categoryLabelFontColor })
  const dl = readText(fmt, 'dataLabels', 'dataLabel', { size: DECOMP_DEFAULTS.dataLabelFontSize, color: DECOMP_DEFAULTS.dataLabelFontColor })
  const title = readText(fmt, 'levelHeader', 'levelTitle', { size: DECOMP_DEFAULTS.levelTitleFontSize, color: DECOMP_DEFAULTS.levelTitleFontColor })
  const sub = readText(fmt, 'levelHeader', 'levelSubtitle', { size: DECOMP_DEFAULTS.levelSubtitleFontSize, color: DECOMP_DEFAULTS.levelSubtitleFontColor })
  const showSubtitles = fmt.bool('levelHeader', 'showSubtitles', true)
  const headerBg = fmt.optStr('levelHeader', 'levelHeaderBackgroundColor')
  const unitSetting = fmt.optNum('dataLabels', 'dataLabelDisplayUnits') ?? 0
  const precision = fmt.optNum('dataLabels', 'dataLabelPrecision')
  const unit = resolveDisplayUnit(unitSetting, Math.abs(tree.total ?? 0) || Math.max(0, ...tree.columns.map((c) => c.levelMax)))
  const fmtVal = (v: number | null) => (v === null ? '(Blank)' : formatWithUnits(v, { unit, decimals: precision, formatString: tree.measure.formatString, format: ctx.format }))

  // ---- geometry ----
  const colW = Math.round(Math.max(60, Math.min(width - 2 * PAD - 20, 120 * (widthPct / 100))))
  const catLH = lineHeight(cat.font)
  const dlLH = lineHeight(dl.font)
  const gap = density === 'dense' ? 4 : density === 'sparse' ? 22 : 12
  const nodeH = BAR_H + 3 + catLH + dlLH + gap
  const titleLH = lineHeight(title.font)
  const subLH = showSubtitles ? lineHeight(sub.font) : 0
  const headerH = tree.columns.length ? titleLH + 4 + subLH + 6 : 0
  const bodyTop = headerH + 6
  const bodyH = Math.max(nodeH, height - bodyTop - 6)
  const xOf = (c: number) => PAD + c * (colW + COL_GAP)
  const lastLevel = tree.state.levels.length - 1
  const hasPlus = (c: TreeColumnData | null) => (c === null ? tree.state.levels.length === 0 : c.levelIndex === lastLevel) && splitCandidates(tree, c ? c.levelIndex : -1).length > 0
  const contentW = Math.max(width, xOf(tree.columns.length) + colW + 30)

  const out: ReactNode[] = []
  const overlay: ReactNode[] = []

  const nodeView = (key: string, x: number, y: number, n: { label: string; valueText: string; frac: number; negative: boolean; onPath: boolean; selected?: boolean }) => (
    <g key={key}>
      <rect x={x} y={y} width={colW} height={nodeH} fill="transparent" />
      <rect x={x} y={y} width={colW} height={BAR_H} fill={trackColor} />
      <rect x={x} y={y} width={Math.max(n.frac > 0 ? 1 : 0, n.frac * colW)} height={BAR_H} fill={n.negative ? negColor : posColor} />
      {n.onPath ? <rect x={x + 0.5} y={y + 0.5} width={colW - 1} height={BAR_H - 1} fill="none" stroke="#8A8886" strokeWidth={1} /> : null}
      <text x={x + 2} y={y + BAR_H + 3 + cat.font.size} {...fontAttrs({ ...cat.font, weight: n.onPath || n.selected ? 700 : cat.font.weight })} fill={cat.color} textDecoration={cat.underline ? 'underline' : undefined}>
        {ellipsize(n.label, colW - 2, cat.font)}
      </text>
      <text x={x + 2} y={y + BAR_H + 3 + catLH + dl.font.size} {...fontAttrs(dl.font)} fill={dl.color} textDecoration={dl.underline ? 'underline' : undefined}>
        {n.valueText}
      </text>
    </g>
  )

  const plusButton = (key: string, x: number, cy: number, atLevel: number, node: Scalar | undefined) => (
    <g
      key={key}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        ctx.showTooltip(null)
        setMenu((m) => (m && m.atLevel === atLevel && m.node === node ? null : { atLevel, node, x: x + 14, y: cy - 8 }))
      }}
    >
      <title>Expand</title>
      <rect x={x - 3} y={cy - 9} width={18} height={18} fill="transparent" />
      <path d={`M${x + 6},${cy - 5.5} v11 M${x + 0.5},${cy} h11`} stroke="#605E5C" strokeWidth={1.1} />
    </g>
  )

  const connector = (key: string, x1: number, y1: number, x2: number, y2: number, kind: 'path' | 'ai' | 'plain') => {
    let d: string
    if (connectorType === 'round' && Math.abs(y2 - y1) > 1) {
      const mx = (x1 + x2) / 2
      const r = Math.min(8, Math.abs(y2 - y1) / 2, (x2 - x1) / 4)
      const s = y2 > y1 ? 1 : -1
      d = `M${x1},${y1} H${mx - r} Q${mx},${y1} ${mx},${y1 + s * r} V${y2 - s * r} Q${mx},${y2} ${mx + r},${y2} H${x2}`
    } else {
      const mx = (x1 + x2) / 2
      d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
    }
    return (
      <path
        key={key}
        d={d}
        fill="none"
        stroke={kind === 'plain' ? connColor : accent}
        strokeWidth={kind === 'plain' ? 1 : 1.5}
        strokeDasharray={kind === 'ai' ? '2 2' : undefined}
      />
    )
  }

  // ---- root ----
  const rootY = bodyTop + Math.max(0, (bodyH - nodeH) / 2)
  out.push(nodeView('root', xOf(0), rootY, { label: tree.measure.label, valueText: fmtVal(tree.total), frac: tree.total === null ? 0 : 1, negative: (tree.total ?? 0) < 0, onPath: false, selected: true }))
  if (hasPlus(null)) out.push(plusButton('plus-root', xOf(0) + colW + 6, rootY + BAR_H / 2, -1, undefined))

  let parentCY = rootY + BAR_H / 2
  let parentX = xOf(0) + colW
  tree.columns.forEach((col, c) => {
    const x = xOf(c + 1)
    const nAll = col.nodes.length
    const fullFit = Math.max(1, Math.floor(bodyH / nodeH))
    const visCount = nAll <= Math.min(barsPerLevel, fullFit) ? nAll : Math.max(1, Math.min(barsPerLevel, Math.floor((bodyH - 2 * ARROW_H) / nodeH)))
    const maxOff = Math.max(0, nAll - visCount)
    const offKey = `${col.levelIndex}|${col.field.proj.queryRef}|${tree.columns
      .slice(0, c)
      .map((p) => String(p.nodes[p.pathIndex]?.value))
      .join('\u0001')}`
    let off = offsets[offKey]
    if (off === undefined) off = col.pathIndex >= visCount ? col.pathIndex - Math.floor(visCount / 2) : 0
    off = Math.max(0, Math.min(maxOff, off))
    const up = off > 0
    const down = off + visCount < nAll
    // center the visible bars on the parent's bar, then keep the block (incl. chevrons) inside the body
    let top = parentCY - BAR_H / 2 - ((visCount - 1) * nodeH) / 2
    top = Math.min(top, bodyTop + bodyH - visCount * nodeH - (down ? ARROW_H : 0))
    top = Math.max(top, bodyTop + (up ? ARROW_H : 0))

    // header
    out.push(
      <LevelHeader
        key={`h${c}`}
        x={x}
        w={colW}
        col={col}
        tree={tree}
        title={title}
        sub={sub}
        showSub={showSubtitles}
        titleLH={titleLH}
        accent={accent}
        bg={headerBg}
        editMode={ctx.mode === 'edit'}
        hovered={hoverHeader === c}
        onHover={(on) => setHoverHeader(on ? c : null)}
        selectedLabel={
          col.pathIndex >= 0
            ? col.nodes[col.pathIndex]?.label
            : ((col.levelIndex === lastLevel ? selectedLabel(col, inter.isSelected) : undefined) ?? (col.aiNode !== undefined ? col.nodes[col.aiNode]?.label : undefined))
        }
        onRemove={() => {
          clearSelection()
          setMenu(null)
          persist(removeLevel(tree.state, col.levelIndex))
        }}
        onToggleLock={() => persist(setLocked(tree.state, col.levelIndex, !tree.state.levels[col.levelIndex]?.locked))}
        onRevertAi={() => persist(revertAi(tree.state, col.levelIndex, col.field.proj.queryRef))}
        onAiHover={(e) => {
          const best = col.aiNode !== undefined ? col.nodes[col.aiNode] : undefined
          if (!best) return
          inter.showTooltip(e, [{ label: `${tree.measure.label} is ${col.ai === 'MinSplit' ? 'lowest' : 'highest'} when`, value: `${col.field.label} is ${best.label}` }])
        }}
        onLeave={() => inter.hideTooltip()}
      />
    )

    let nextCY = parentCY
    for (let k = 0; k < visCount; k++) {
      const i = off + k
      const n = col.nodes[i]
      const y = top + k * nodeH
      const cy = y + BAR_H / 2
      const onPath = i === col.pathIndex
      const isAi = col.aiNode === i
      if (onPath) nextCY = cy
      out.push(connector(`l${c}-${i}`, parentX + 2, parentCY, x - 2, cy, onPath ? (isAi ? 'ai' : 'path') : isAi ? 'ai' : 'plain'))
      const isLast = col.levelIndex === lastLevel
      const op = isLast ? inter.opacityFor(n.identity) : 1
      out.push(
        <g
          key={`n${c}-${i}`}
          opacity={op}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            ctx.showTooltip(null)
            setMenu(null)
            if (isLast) inter.onPointClick(n.identity, e)
            else if (!onPath) {
              clearSelection()
              persist(selectPathNode(tree.state, col.levelIndex, n.value))
            }
          }}
          onContextMenu={(e) => inter.onContextMenu(n.identity, e)}
          onMouseMove={(e) => inter.showTooltip(e, nodeTooltip(tree, col, n, ctx.format), n.identity)}
          onMouseLeave={() => inter.hideTooltip()}
        >
          {nodeView('v', x, y, {
            label: n.label,
            valueText: fmtVal(n.measure),
            frac: barFraction(n.measure, scaling, { root: tree.total, parent: col.parentValue, levelMax: col.levelMax }),
            negative: (n.measure ?? 0) < 0,
            onPath: onPath || isAi,
            selected: isLast && inter.hasSelection && inter.isSelected(n.identity)
          })}
        </g>
      )
      if (isLast && hasPlus(col)) out.push(plusButton(`p${c}-${i}`, x + colW + 6, cy, col.levelIndex, n.value))
    }
    const scrollTo = (o: number) => setOffsets((s) => ({ ...s, [offKey]: Math.max(0, Math.min(maxOff, o)) }))
    if (up) out.push(<ScrollChevron key={`up${c}`} x={x} y={top - ARROW_H} w={colW} dir="up" count={off} font={dl.font} onClick={() => scrollTo(off - visCount)} />)
    if (down) out.push(<ScrollChevron key={`dn${c}`} x={x} y={top + visCount * nodeH} w={colW} dir="down" count={nAll - off - visCount} font={dl.font} onClick={() => scrollTo(off + visCount)} />)
    parentCY = nextCY
    parentX = x + colW
  })

  // ---- split menu ----
  if (menu) {
    const fields = splitCandidates(tree, menu.atLevel)
    const pick = (level: { queryRef: string; ai?: AiMethod }) => {
      setMenu(null)
      clearSelection()
      let next = addLevel(tree.state, menu.atLevel, menu.node, level, tree.resolved)
      if (level.ai) {
        // store the field the AI split picks right now (Power BI writes it into queryRefs)
        const probe = structuredClone(json)
        const ids = new Map(tree.explain.map((f) => [f.proj.queryRef, f.identityExpr]))
        writeDecompState(probe, next, (r) => ids.get(r))
        try {
          const t = computeTree(probe, ctx, { aiMode, aiEnabled })
          const chosen = t?.resolved[next.levels.length - 1]
          if (chosen) next = { ...next, levels: next.levels.map((l, i) => (i === next.levels.length - 1 ? { ...l, queryRef: chosen } : l)) }
        } catch {
          /* keep the provisional field; the render reports engine errors */
        }
      }
      persist(next)
    }
    overlay.push(
      <SplitMenu
        key="menu"
        x={menu.x}
        y={menu.y}
        maxX={contentW}
        maxY={height}
        ai={aiEnabled && fields.length > 0}
        fields={fields.map((f) => ({ queryRef: f.proj.queryRef, label: f.label }))}
        onPick={pick}
        onClose={() => setMenu(null)}
      />
    )
  }

  const scrollsX = contentW > width
  return (
    <div
      ref={scroller}
      style={{ width, height, overflowX: scrollsX ? 'auto' : 'hidden', overflowY: 'hidden', position: 'relative', fontFamily: FONT_STACK }}
      onClick={(e) => {
        setMenu(null)
        inter.onBackgroundClick(e)
      }}
      onScroll={() => setMenu(null)}
    >
      <div style={{ position: 'relative', width: contentW, height: height - (scrollsX ? 12 : 0) }}>
        <svg width={contentW} height={height - (scrollsX ? 12 : 0)} style={{ display: 'block', userSelect: 'none' }}>
          {out}
        </svg>
        {overlay}
      </div>
    </div>
  )
}

function selectedLabel(col: TreeColumnData, isSelected: (id: TreeNodeData['identity']) => boolean): string | undefined {
  const hits = col.nodes.filter((n) => isSelected(n.identity))
  return hits.length === 1 ? hits[0].label : hits.length > 1 ? `${hits.length} selected` : undefined
}

function nodeTooltip(tree: TreeData, col: TreeColumnData, n: TreeNodeData, format: VisualProps['ctx']['format']) {
  const items = [
    { label: col.field.label, value: n.label },
    { label: tree.measure.label, value: formatScalar(n.measure, tree.measure.formatString, format) }
  ]
  tree.tooltips.forEach((t, i) => items.push({ label: t.label, value: formatScalar(n.tips[i] ?? null, t.formatString, format, t.desc?.dataType) }))
  if (col.aiNode !== undefined && col.nodes[col.aiNode] === n) items.push({ label: 'AI split', value: col.ai === 'MinSplit' ? 'Low value' : 'High value' })
  return items
}

function LevelHeader(p: {
  x: number
  w: number
  col: TreeColumnData
  tree: TreeData
  title: TextFmt
  sub: TextFmt
  showSub: boolean
  titleLH: number
  accent: string
  bg?: string
  editMode: boolean
  hovered: boolean
  selectedLabel?: string
  onHover(on: boolean): void
  onRemove(): void
  onToggleLock(): void
  onRevertAi(): void
  onAiHover(e: ReactMouseEvent): void
  onLeave(): void
}) {
  const locked = !!p.tree.state.levels[p.col.levelIndex]?.locked
  const bulbW = p.col.ai ? 14 : 0
  const iconsW = (locked || p.editMode ? 14 : 0) + (locked ? 0 : 14)
  const baseY = 2 + p.title.font.size
  const lineY = 2 + p.titleLH + 2
  return (
    <g onMouseEnter={() => p.onHover(true)} onMouseLeave={() => p.onHover(false)} onClick={(e) => e.stopPropagation()}>
      {p.bg ? <rect x={p.x - 2} y={0} width={p.w + 4} height={lineY + (p.showSub ? p.titleLH : 0) + 4} fill={p.bg} /> : null}
      {p.col.ai ? (
        <g style={{ cursor: 'pointer' }} onClick={p.onRevertAi} onMouseMove={p.onAiHover} onMouseLeave={p.onLeave}>
          <rect x={p.x} y={baseY - 11} width={12} height={13} fill="transparent" />
          <Bulb x={p.x + 1} y={baseY - 10} color={p.accent} />
        </g>
      ) : null}
      <text x={p.x + bulbW} y={baseY} {...fontAttrs(p.title.font)} fill={p.title.color} textDecoration={p.title.underline ? 'underline' : undefined}>
        {ellipsize(p.col.field.label, p.w - bulbW - iconsW - 2, p.title.font)}
      </text>
      {p.editMode || locked ? (
        <g style={{ cursor: p.editMode ? 'pointer' : 'default' }} onClick={() => p.editMode && p.onToggleLock()} opacity={locked || p.hovered ? 1 : 0}>
          <title>{locked ? 'Unlock level' : 'Lock level'}</title>
          <rect x={p.x + p.w - iconsW} y={baseY - 11} width={13} height={13} fill="transparent" />
          <Lock x={p.x + p.w - iconsW + 2} y={baseY - 10} closed={locked} />
        </g>
      ) : null}
      {!locked ? (
        <g style={{ cursor: 'pointer' }} onClick={p.onRemove}>
          <title>Remove level</title>
          <rect x={p.x + p.w - 13} y={baseY - 11} width={13} height={13} fill="transparent" />
          <path d={`M${p.x + p.w - 10},${baseY - 8} l7,7 M${p.x + p.w - 3},${baseY - 8} l-7,7`} stroke="#605E5C" strokeWidth={1} />
        </g>
      ) : null}
      <rect x={p.x} y={lineY} width={p.w} height={2} fill={p.accent} />
      {p.showSub && p.selectedLabel ? (
        <text x={p.x} y={lineY + 4 + p.sub.font.size} {...fontAttrs(p.sub.font)} fill={p.sub.color} textDecoration={p.sub.underline ? 'underline' : undefined}>
          {ellipsize(p.selectedLabel, p.w, p.sub.font)}
        </text>
      ) : null}
    </g>
  )
}

function Bulb({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={1.1}>
      <path d="M5 0.8a3.9 3.9 0 0 0-2.4 7c.5.4.8.9.8 1.5V10h3.2v-.7c0-.6.3-1.1.8-1.5A3.9 3.9 0 0 0 5 .8z" />
      <path d="M3.5 11.6h3" />
    </g>
  )
}

function Lock({ x, y, closed }: { x: number; y: number; closed: boolean }) {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke="#605E5C" strokeWidth={1}>
      <rect x={0.5} y={5} width={9} height={6.5} rx={1} />
      <path d={closed ? 'M2.5 5V3.2a2.5 2.5 0 0 1 5 0V5' : 'M2.5 5V3.2a2.5 2.5 0 0 1 4.8-1'} />
    </g>
  )
}

function ScrollChevron({ x, y, w, dir, count, font, onClick }: { x: number; y: number; w: number; dir: 'up' | 'down'; count: number; font: FontSpec; onClick(): void }) {
  const cx = x + 8
  const cy = y + ARROW_H / 2
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <title>{dir === 'up' ? 'Scroll up' : 'Scroll down'}</title>
      <rect x={x} y={y} width={w} height={ARROW_H} fill="transparent" />
      <path d={dir === 'up' ? `M${cx - 4},${cy + 2} l4,-4 l4,4` : `M${cx - 4},${cy - 2} l4,4 l4,-4`} fill="none" stroke="#605E5C" strokeWidth={1.2} />
      <text x={cx + 9} y={cy + font.size * 0.35} {...fontAttrs(font)} fill="#605E5C">
        {`+${count}`}
      </text>
    </g>
  )
}

function SplitMenu(p: {
  x: number
  y: number
  maxX: number
  maxY: number
  ai: boolean
  fields: Array<{ queryRef: string; label: string }>
  onPick(level: { queryRef: string; ai?: AiMethod }): void
  onClose(): void
}) {
  const itemH = 26
  const h = (p.ai ? itemH * 2 + 9 : 0) + p.fields.length * itemH + 8
  const w = 180
  const left = Math.max(0, Math.min(p.x, p.maxX - w - 4))
  const top = Math.max(0, Math.min(p.y, p.maxY - h - 4))
  const first = p.fields[0]?.queryRef
  const item = (key: string, label: string, onClick: () => void, icon?: ReactNode) => (
    <div
      key={key}
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#F3F2F1')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{ height: itemH, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => undefined}
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        maxHeight: p.maxY - 8,
        overflowY: 'auto',
        background: '#FFFFFF',
        boxShadow: '0 3.2px 7.2px rgba(0,0,0,0.13), 0 0.6px 1.8px rgba(0,0,0,0.11)',
        borderRadius: 2,
        padding: '4px 0',
        fontSize: 12,
        color: '#252423',
        zIndex: 5
      }}
    >
      {p.ai && first ? (
        <>
          {item('hi', 'High value', () => p.onPick({ queryRef: first, ai: 'MaxSplit' }), <LightbulbRegular fontSize={14} color="#605E5C" />)}
          {item('lo', 'Low value', () => p.onPick({ queryRef: first, ai: 'MinSplit' }), <LightbulbRegular fontSize={14} color="#605E5C" />)}
          <div style={{ height: 1, background: '#E1DFDD', margin: '4px 0' }} />
        </>
      ) : null}
      {p.fields.map((f) => item(f.queryRef, f.label, () => p.onPick({ queryRef: f.queryRef })))}
    </div>
  )
}
