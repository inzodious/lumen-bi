/** Card visual (`cardVisual`, the "new card") renderer. Model: ./cardVisualModel.ts */
import { summarizeAny } from '../common/visualCalcs'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { VisualHostContext, VisualProps } from '../contract'
import { fontStyle, ptToPx } from '../common/textStyle'
import { fieldInfo, identityKey } from '@core/report/sq'
import { CFIcon } from '../tables/cfIcons'
import { kpiAwareLabel } from '../tables/kpiLabel'
import {
  applyKpiIcons,
  buildCardVisualModel,
  buildCategorizedModel,
  cardCategoryFields,
  cardFields,
  cardSummarizeRequest,
  cardValuesFromResult,
  gridGeometry,
  planCardQuery,
  type Box,
  type CalloutImageModel,
  type CalloutModel,
  type CardArea,
  type CardImageModel,
  type CardLayoutModel,
  type CardVisualModel,
  type CategorySectionModel,
  type Corners,
  type ImageFit,
  type MultiCategoryLayoutModel,
  type RefLabelModel,
  type TileStyle
} from './cardVisualModel'

export function computeCardVisual(visualJson: any, ctx: VisualHostContext): CardVisualModel {
  const labelOf = (p: any) => {
    const d = ctx.engine.describeField(p.field)
    return kpiAwareLabel(undefined, d, () => d?.displayName ?? fieldInfo(p.field).property ?? p.queryRef)
  }
  const fields = cardFields(visualJson, labelOf, (p) => {
    const k = fieldInfo(p.field).kind
    return k === 'measure' || k === 'aggregation'
  })
  const categories = fields.length ? cardCategoryFields(visualJson, labelOf) : []
  const plan = planCardQuery(visualJson, ctx.theme, fields, categories)
  const fieldLabel = (e: any) => ctx.engine.describeField(e)?.displayName
  const kpiOf = (e: any) => {
    try {
      return ctx.engine.describeField(e)?.kpi
    } catch {
      return undefined
    }
  }
  if (categories.length && plan.values.length) {
    return applyKpiIcons(buildCategorizedModel(visualJson, ctx.theme, ctx.format, plan, summarizeAny(ctx, cardSummarizeRequest(plan, ctx.filters)), fieldLabel), fields, kpiOf)
  }
  const vals = plan.values.length ? cardValuesFromResult(summarizeAny(ctx, cardSummarizeRequest(plan, ctx.filters))) : { get: () => undefined }
  return applyKpiIcons(buildCardVisualModel(visualJson, ctx.theme, ctx.format, plan, vals, fieldLabel), fields, kpiOf)
}

const pad = (b: Box) => `${b.top}px ${b.right}px ${b.bottom}px ${b.left}px`
const radius = (c: Corners) => `${c[0]}px ${c[1]}px ${c[2]}px ${c[3]}px`
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
const HJUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const
const OBJECT_FIT: Record<ImageFit, CSSProperties['objectFit']> = { fit: 'contain', fill: 'cover', stretch: 'fill', center: 'none' }
const OBJECT_Y = { top: 'top', middle: 'center', bottom: 'bottom' } as const
const NAV_H = 22

export function CardVisualView({ visual, width, height, ctx }: VisualProps) {
  const key = JSON.stringify([visual.json?.visual?.query, visual.json?.visual?.objects])
  const state = useMemo(() => {
    try {
      return { model: computeCardVisual(visual.json, ctx) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx.engine, ctx.filters, ctx.theme, ctx.format])
  if ('error' in state) return <div className="wbi-card-error" style={{ padding: 8, color: '#A4262C', fontSize: 12 }}>{state.error}</div>
  const model = state.model!
  if (model.empty) return <div className="wbi-card-empty" style={{ width, height, display: 'grid', placeItems: 'center', color: '#605E5C', fontSize: 12 }}>{model.empty}</div>
  const L = model.layout
  const frame: CSSProperties = {
    width,
    height,
    boxSizing: 'border-box',
    padding: pad(L.outerMargin),
    background: L.background,
    border: L.border ? `${L.border.width}px ${L.border.style} ${L.border.color}` : undefined,
    borderRadius: radius(L.radius),
    overflow: 'hidden'
  }
  const innerW = width - L.outerMargin.left - L.outerMargin.right - (L.border ? 2 * L.border.width : 0)
  const innerH = height - L.outerMargin.top - L.outerMargin.bottom - (L.border ? 2 * L.border.width : 0)
  return (
    <div className="wbi-card-visual" style={frame}>
      {model.sections && model.categoryLayout ? (
        <CategoryGrid sections={model.sections} CL={model.categoryLayout} L={L} width={innerW} height={innerH} ctx={ctx} />
      ) : (
        <CardGrid callouts={model.callouts} L={L} width={innerW} height={innerH} ctx={ctx} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Grids + overflow
// ---------------------------------------------------------------------------------------------

function Pager({ page, pages, onPage, color = '#605E5C' }: { page: number; pages: number; onPage(p: number): void; color?: string }) {
  const btn = (enabled: boolean, label: string, to: number, glyph: string) => (
    <button
      aria-label={label}
      disabled={!enabled}
      onClick={(e) => {
        e.stopPropagation()
        if (enabled) onPage(to)
      }}
      style={{ border: 0, background: 'none', padding: '0 4px', cursor: enabled ? 'pointer' : 'default', color: enabled ? color : '#C8C6C4', fontSize: 14, lineHeight: `${NAV_H}px` }}
    >
      {glyph}
    </button>
  )
  return (
    <div className="wbi-card-pager" style={{ height: NAV_H, flex: 'none', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, fontSize: 11, color }}>
      {btn(page > 0, 'Previous page', page - 1, '‹')}
      <span>
        {page + 1} / {pages}
      </span>
      {btn(page < pages - 1, 'Next page', page + 1, '›')}
    </div>
  )
}

/** Lay out `items` in pages of a grid with continuous scroll or pagination. */
function PagedGrid<T>(p: {
  items: T[]
  geometry: ReturnType<typeof gridGeometry>
  overflow: CardLayoutModel['overflow']
  rowGap: number
  columnGap: number
  width: number
  height: number
  justify?: 'left' | 'center' | 'right'
  render(item: T, index: number, w: number, h: number): ReactNode
}) {
  const [page, setPage] = useState(0)
  const g = p.geometry
  const pages: T[][] = []
  for (let i = 0; i < p.items.length; i += g.pageSize) pages.push(p.items.slice(i, i + g.pageSize))
  if (!pages.length) pages.push([])
  const pageGrid = (items: T[], offset: number, extra?: CSSProperties) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${g.columns}, ${g.cellWidth}px)`,
        gridAutoRows: `${g.cellHeight}px`,
        rowGap: p.rowGap,
        columnGap: p.columnGap,
        justifyContent: HJUSTIFY[p.justify ?? 'left'],
        alignContent: 'start',
        ...extra
      }}
    >
      {items.map((it, i) => p.render(it, offset + i, g.cellWidth, g.cellHeight))}
    </div>
  )
  if (!g.overflow) return pageGrid(p.items, 0, { width: p.width, height: p.height })
  if (p.overflow.style === 'paginate') {
    const cur = Math.min(page, pages.length - 1)
    return (
      <div style={{ width: p.width, height: p.height, display: 'flex', flexDirection: 'column' }}>
        {pageGrid(pages[cur], cur * g.pageSize, { flex: 1, minHeight: 0 })}
        <Pager page={cur} pages={pages.length} onPage={setPage} />
      </div>
    )
  }
  if (p.overflow.direction === 'horizontal') {
    return (
      <div className="wbi-card-scroll" style={{ width: p.width, height: p.height, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: p.columnGap }}>
        {pages.map((items, i) => (
          <div key={i} style={{ flex: 'none', width: p.width }}>
            {pageGrid(items, i * g.pageSize)}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="wbi-card-scroll" style={{ width: p.width, height: p.height, overflowY: 'auto', overflowX: 'hidden' }}>
      {pageGrid(p.items, 0)}
    </div>
  )
}

function CardGrid({ callouts, L, width, height, ctx }: { callouts: CalloutModel[]; L: CardLayoutModel; width: number; height: number; ctx: VisualHostContext }) {
  const table = L.style === 'table'
  const rowGap = table ? 0 : L.rowGap
  const columnGap = table ? 0 : L.columnGap
  const g = gridGeometry({ ...L, rowGap, columnGap }, callouts.length, width, height, NAV_H)
  return (
    <PagedGrid
      items={callouts}
      geometry={g}
      overflow={L.overflow}
      rowGap={rowGap}
      columnGap={columnGap}
      width={width}
      height={height}
      justify={L.justify}
      render={(c, i, w, h) => {
        const lines: CSSProperties = {}
        if (L.lines) {
          const b = `${L.lines.width}px ${L.lines.style} ${L.lines.color}`
          const col = i % g.columns
          const row = Math.floor((i % g.pageSize) / g.columns)
          if (col < g.columns - 1 && i < callouts.length - 1) lines.borderRight = b
          if (row < Math.ceil(Math.min(callouts.length, g.pageSize) / g.columns) - 1) lines.borderBottom = b
        }
        return <CalloutTile key={c.queryRef + i} c={c} layout={L} ctx={ctx} width={w} height={h} cellStyle={lines} />
      }}
    />
  )
}

function CategoryGrid({ sections, CL, L, width, height, ctx }: { sections: CategorySectionModel[]; CL: MultiCategoryLayoutModel; L: CardLayoutModel; width: number; height: number; ctx: VisualHostContext }) {
  const g = gridGeometry({ columns: CL.columns, rows: CL.rows, fixedRows: CL.fixedRows, rowGap: CL.rowGap, columnGap: CL.columnGap, overflow: CL.overflow }, sections.length, width, height, NAV_H)
  const selected = new Set(ctx.selection.map(identityKey))
  const H = CL.header
  const lineH = Math.ceil(ptToPx(H.font.size) * 1.3)
  const side = H.position === 'left' || H.position === 'right'
  const headerSize = Math.min(H.maxSize ?? Infinity, side ? (H.rotate ? lineH : 90) + H.padding.left + H.padding.right : lineH + H.padding.top + H.padding.bottom)
  return (
    <PagedGrid
      items={sections}
      geometry={g}
      overflow={CL.overflow}
      rowGap={CL.rowGap}
      columnGap={CL.columnGap}
      width={width}
      height={height}
      render={(s, i, w, h) => {
        const isSel = selected.has(identityKey(s.identity))
        const dim = selected.size > 0 && !isSel
        const cellLines: CSSProperties = {}
        if (CL.grid) {
          const b = `${CL.grid.width}px ${CL.grid.style} ${CL.grid.color}`
          const col = i % g.columns
          const row = Math.floor(i / g.columns)
          const lastRow = Math.ceil(sections.length / g.columns) - 1
          if (CL.grid.region !== 'innerHorizontal' && (CL.grid.region === 'all' || col < g.columns - 1)) cellLines.borderRight = b
          if (CL.grid.region !== 'innerVertical' && (CL.grid.region === 'all' || row < lastRow)) cellLines.borderBottom = b
        }
        const border = CL.cell.border ? `${CL.cell.border.width}px ${CL.cell.border.style} ${CL.cell.border.color}` : undefined
        const bw = CL.cell.border ? CL.cell.border.width * 2 : 0
        const bodyW = Math.max(1, w - bw - (side ? headerSize : 0))
        const bodyH = Math.max(1, h - bw - (side ? 0 : headerSize))
        const headerText = H.concatenate ? s.title : s.parts.join('\n')
        const header = (
          <div
            className="wbi-card-section-header"
            title={s.title}
            onClick={(e) => {
              const multi = e.ctrlKey || e.metaKey
              if (!multi && isSel && selected.size === 1) ctx.select([])
              else ctx.select([s.identity], { multi })
            }}
            style={{
              flex: `0 0 ${headerSize}px`,
              display: 'flex',
              alignItems: side ? HJUSTIFY[H.align === 'left' ? 'left' : H.align === 'right' ? 'right' : 'center'] : JUSTIFY[H.verticalAlign],
              justifyContent: side ? JUSTIFY[H.verticalAlign] : HJUSTIFY[H.align],
              padding: pad(H.padding),
              background: H.background,
              cursor: 'pointer',
              overflow: 'hidden',
              boxSizing: 'border-box',
              minWidth: 0,
              minHeight: 0
            }}
          >
            <span
              style={{
                ...fontStyle(H.font),
                lineHeight: 1.3,
                whiteSpace: H.wrap && !(side && H.rotate) ? 'pre-wrap' : 'pre',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: H.align,
                ...(side && H.rotate ? { writingMode: 'vertical-rl', transform: H.position === 'left' ? 'rotate(180deg)' : undefined, maxHeight: '100%' } : { maxWidth: '100%' })
              }}
            >
              {headerText}
            </span>
          </div>
        )
        const bar = CL.accentBar
        return (
          <div
            key={s.key}
            className="wbi-card-section"
            data-selected={isSel || undefined}
            style={{
              position: 'relative',
              width: w,
              height: h,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: H.position === 'top' ? 'column' : H.position === 'bottom' ? 'column-reverse' : H.position === 'right' ? 'row-reverse' : 'row',
              background: CL.cell.background,
              border,
              borderRadius: radius(CL.cell.radius),
              opacity: dim ? 0.4 : 1,
              overflow: 'hidden',
              ...cellLines
            }}
          >
            {bar && (
              <div
                style={{
                  position: 'absolute',
                  background: bar.color,
                  zIndex: 1,
                  ...(bar.position === 'left' || bar.position === 'right' ? { top: 0, bottom: 0, width: bar.width, [bar.position]: 0 } : { left: 0, right: 0, height: bar.width, [bar.position]: 0 })
                }}
              />
            )}
            {header}
            <div style={{ width: bodyW, height: bodyH, flex: 'none' }}>
              <CardGrid callouts={s.callouts} L={L} width={bodyW} height={bodyH} ctx={ctx} />
            </div>
          </div>
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------------------------

function textBlock(text: string, style: CSSProperties, wrap: boolean): CSSProperties {
  return {
    ...style,
    lineHeight: 1.2,
    whiteSpace: wrap ? 'normal' : 'nowrap',
    overflow: 'hidden',
    textOverflow: wrap ? undefined : 'ellipsis',
    // wrap at spaces only (numbers like "$2.84M" never split)
    overflowWrap: wrap ? 'normal' : undefined,
    minWidth: 0,
    ...(text ? {} : { display: 'none' })
  }
}

function tileCss(t: TileStyle): CSSProperties {
  const bar = t.accentBar
  const p = { ...t.padding }
  if (bar) p[bar.position] += bar.width
  return {
    background: t.fill,
    border: t.outline ? `${t.outline.width}px solid ${t.outline.color}` : undefined,
    borderRadius: radius(t.radius),
    boxShadow: t.shadow?.css,
    padding: pad(p)
  }
}

function Img({ img, style }: { img: { src?: string; fit: ImageFit; radius?: Corners; opacity: number }; style?: CSSProperties }) {
  if (!img.src) return null
  return (
    <img
      src={img.src}
      alt=""
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: OBJECT_FIT[img.fit], borderRadius: img.radius ? radius(img.radius) : undefined, opacity: img.opacity, display: 'block', ...style }}
    />
  )
}

export function CalloutTile({ c, layout, ctx, width, height, cellStyle }: { c: CalloutModel; layout: CardLayoutModel; ctx: VisualHostContext; width?: number; height?: number; cellStyle?: CSSProperties }) {
  const [hover, setHover] = useState(false)
  const t = hover && c.tileHover ? c.tileHover : c.tile
  const image = hover && c.imageHover ? c.imageHover : c.image
  const cardImage = hover && c.cardImageHover ? c.cardImageHover : c.cardImage
  const bar = t.accentBar
  const R = layout.refLayout
  const rowAxis = R.position === 'right'

  const areas = layout.contentOrder.filter((a) => a === 'callout' || (a === 'referenceLabel' && layout.areas.referenceLabel) || (a === 'image' && layout.areas.image))
  const multi = areas.length > 1
  const basis = (a: CardArea) => (a === 'callout' ? `0 0 ${layout.calloutSize}%` : '1 1 0')

  const calloutArea = <CalloutArea key="callout" c={c} image={image} layout={layout} />
  const refIdx = areas.indexOf('referenceLabel')
  const calloutIdx = areas.indexOf('callout')
  const dividerSide: 'start' | 'end' = calloutIdx < refIdx ? 'start' : 'end'
  const div = c.divider
  const refStyle: CSSProperties = {}
  if (div && refIdx >= 0 && Math.abs(refIdx - calloutIdx) === 1) {
    const b = `${div.width}px ${div.style} ${div.color}`
    const edge = rowAxis ? (dividerSide === 'start' ? 'Left' : 'Right') : dividerSide === 'start' ? 'Top' : 'Bottom'
    ;(refStyle as any)[`border${edge}`] = b
    ;(refStyle as any)[`margin${edge}`] = R.paddingBeforeDivider
    if (div.ignorePadding && !rowAxis) Object.assign(refStyle, { marginLeft: -t.padding.left, marginRight: -t.padding.right, paddingLeft: t.padding.left, paddingRight: t.padding.right })
  }
  const refArea = (
    <RefLabels key="referenceLabel" refs={c.refLabels} layout={layout} align={R.horizontalAlignment ?? c.value.align} area={c.refArea} extra={{ ...refStyle, [`padding${rowAxis ? (dividerSide === 'start' ? 'Left' : 'Right') : dividerSide === 'start' ? 'Top' : 'Bottom'}`]: R.paddingAfterDivider || undefined }} />
  )
  const imageArea = <CardImageArea key="image" img={cardImage} />
  const node = (a: CardArea) => (a === 'callout' ? calloutArea : a === 'referenceLabel' ? refArea : imageArea)
  // Every area keeps its share of the card (`calloutSize`% for the callout, the rest for the others)
  // and clips what does not fit, so a tall callout never pushes or overlaps the reference labels.
  // Approximation: Power BI lets the neighbouring area cover the overflow; without an area background
  // the texts would overlap there — clipping is the readable equivalent.
  const wrap = (a: CardArea, flex: string) => (
    <div key={a} className={`wbi-card-area wbi-card-area-${a}`} style={{ flex, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {node(a)}
    </div>
  )

  let content: ReactNode
  if (!multi) content = wrap('callout', '1 1 auto')
  else if (layout.collage !== 'none' && areas.length === 3) {
    // collage: one area takes its share along the main axis, the other two stack across the rest
    const hero = layout.collage === 'default' ? areas[0] : areas[2]
    const rest = areas.filter((a) => a !== hero)
    const heroBasis = hero === 'callout' ? `0 0 ${layout.calloutSize}%` : `0 0 ${100 - layout.calloutSize}%`
    const stack = (
      <div key="stack" style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: rowAxis ? 'column' : 'row' }}>
        {rest.map((a) => wrap(a, '1 1 0'))}
      </div>
    )
    content = layout.collage === 'default' ? [wrap(hero, heroBasis), stack] : [stack, wrap(hero, heroBasis)]
  } else content = areas.map((a) => wrap(a, basis(a)))

  return (
    <div
      className="wbi-card-tile"
      onMouseEnter={() => setHover(true)}
      onMouseMove={(e) => ctx.showTooltip({ x: e.clientX, y: e.clientY, items: [{ label: c.label.text, value: c.value.text }, ...c.refLabels.map((r) => ({ label: r.title.text || r.id, value: r.value.text }))] })}
      onMouseLeave={() => {
        setHover(false)
        ctx.showTooltip(null)
      }}
      style={{
        position: 'relative',
        width,
        height,
        minWidth: 0,
        minHeight: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: rowAxis ? 'row' : 'column',
        ...tileCss(t),
        ...cellStyle
      }}
    >
      {t.backgroundImage && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <Img img={{ ...t.backgroundImage, radius: t.radius }} />
        </div>
      )}
      {bar && (
        <div
          className="wbi-card-accent"
          style={{
            position: 'absolute',
            background: bar.color,
            ...(bar.position === 'left' || bar.position === 'right' ? { top: 0, bottom: 0, width: bar.width, [bar.position]: 0 } : { left: 0, right: 0, height: bar.width, [bar.position]: 0 })
          }}
        />
      )}
      {content}
    </div>
  )
}

function CalloutArea({ c, image, layout }: { c: CalloutModel; image?: CalloutImageModel; layout: CardLayoutModel }) {
  const label = c.label.show ? (
    <div className="wbi-card-label" style={{ ...textBlock(c.label.text, fontStyle(c.label.font), c.label.wrap), textAlign: c.label.align, flex: 'none' }}>
      {c.label.text}
    </div>
  ) : null
  const gap = c.labelGap ? <div style={{ height: c.labelGap, flex: 'none' }} /> : null
  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: JUSTIFY[layout.alignment], textAlign: c.value.align, minWidth: 0, minHeight: 0, flex: '1 1 auto' }}>
      {c.label.position === 'above' && label}
      {c.label.position === 'above' && label && gap}
      {c.value.show && (
        c.kpiIcon ? (
          <div className="wbi-card-value" style={{ display: 'flex', justifyContent: HJUSTIFY[c.value.align], flex: 'none' }}>
            <CFIcon name={c.kpiIcon} size={Math.round(ptToPx(c.value.font.size) * 1.1)} />
          </div>
        ) : (
          <div className="wbi-card-value" style={{ ...textBlock(c.value.text, fontStyle(c.value.font), c.value.wrap), flex: 'none' }}>
            {c.value.text}
          </div>
        )
      )}
      {c.label.position === 'below' && label && gap}
      {c.label.position === 'below' && label}
    </div>
  )
  let body: ReactNode = text
  if (image) {
    const horizontal = image.position === 'left' || image.position === 'right'
    const size = image.size !== undefined ? `0 0 ${image.size}px` : `0 0 ${image.areaSize}%`
    const imgBox = (
      <div
        className="wbi-card-image"
        style={{
          flex: size,
          display: 'flex',
          alignItems: horizontal ? JUSTIFY[image.verticalAlignment] : 'stretch',
          justifyContent: horizontal ? 'stretch' : HJUSTIFY[image.horizontalAlignment],
          minWidth: 0,
          minHeight: 0,
          [horizontal ? (image.position === 'left' ? 'marginRight' : 'marginLeft') : image.position === 'top' ? 'marginBottom' : 'marginTop']: image.gap
        }}
      >
        <div style={{ width: horizontal ? '100%' : image.size ?? '100%', height: horizontal ? image.size ?? '100%' : '100%', maxHeight: '100%', maxWidth: '100%' }}>
          {/* the image is fitted inside its area and anchored by the alignment settings (top / middle / bottom, left / center / right) */}
          <Img img={image} style={{ objectPosition: `${image.horizontalAlignment} ${OBJECT_Y[image.verticalAlignment]}` }} />
        </div>
      </div>
    )
    body = (
      <div style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0 }}>
        {(image.position === 'left' || image.position === 'top') && imgBox}
        {text}
        {(image.position === 'right' || image.position === 'bottom') && imgBox}
      </div>
    )
  }
  return (
    <div
      className="wbi-card-callout"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: JUSTIFY[layout.alignment],
        padding: pad(c.calloutArea.padding),
        background: c.calloutArea.background,
        borderRadius: radius(c.calloutArea.radius),
        minWidth: 0,
        minHeight: 0,
        flex: '1 1 auto'
      }}
    >
      {body}
    </div>
  )
}

function CardImageArea({ img }: { img?: CardImageModel }) {
  if (!img) return <div className="wbi-card-image-area" style={{ flex: '1 1 auto' }} />
  return (
    <div className="wbi-card-image-area" style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, padding: pad(img.padding), background: img.background, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: img.height > 0 ? img.height : '100%', maxHeight: '100%' }}>
        <Img img={img} />
      </div>
    </div>
  )
}

function RefLabels({ refs, layout, align, area, extra }: { refs: RefLabelModel[]; layout: CardLayoutModel; align: 'left' | 'center' | 'right'; area: CalloutModel['refArea']; extra?: CSSProperties }) {
  const R = layout.refLayout
  const base: CSSProperties = {
    padding: pad(area.padding),
    background: area.background,
    borderRadius: radius(area.radius),
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    flex: '1 1 auto',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: JUSTIFY[R.verticalAlignment],
    ...extra
  }
  const detail = (r: RefLabelModel) =>
    r.detail && (
      <span style={{ ...textBlock(r.detail.text, fontStyle(r.detail.font), r.detail.wrap), background: r.detail.background, padding: '0 3px', borderRadius: 2, marginLeft: 4 }}>{r.detail.text}</span>
    )
  let inner: ReactNode
  if (!refs.length) inner = null
  else if (R.arrangement === 'columns') {
    inner = (
      <div style={{ display: 'flex', gap: 12 + R.labelSpace, justifyContent: HJUSTIFY[align] }}>
        {refs.map((r) => (
          <div key={r.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: align }}>
            {r.title.show && <span style={textBlock(r.title.text, fontStyle(r.title.font), r.title.wrap)}>{r.title.text}</span>}
            {r.value.show && <span style={textBlock(r.value.text, fontStyle(r.value.font), r.value.wrap)}>{r.value.text}</span>}
            {r.detail && <span style={{ ...textBlock(r.detail.text, fontStyle(r.detail.font), r.detail.wrap), background: r.detail.background, padding: '0 3px', alignSelf: HJUSTIFY[align] }}>{r.detail.text}</span>}
          </div>
        ))}
      </div>
    )
  } else if (R.style === 'compact') {
    // "Sentence" style: title, value and detail flow on one line
    inner = (
      <div style={{ display: 'flex', flexDirection: 'column', textAlign: align, rowGap: R.labelSpace }}>
        {refs.map((r) => (
          <div key={r.id} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
            {r.title.show && <span style={fontStyle(r.title.font)}>{r.title.text} </span>}
            {r.value.show && <span style={fontStyle(r.value.font)}>{r.value.text}</span>}
            {detail(r)}
          </div>
        ))}
      </div>
    )
  } else {
    // Tabular: a two-column table across the reference-label area — titles left-aligned in the first
    // column, values (+ details) right-aligned in the second (`valueArea`% wide when set, else as wide
    // as the values need). An explicit horizontal alignment packs both columns to that side instead.
    // Approximation: the default column split is not documented; with content-sized values the look is
    // the same whenever titles and values fit.
    const packed = R.horizontalAlignment !== undefined
    const cols = R.valueArea ? `minmax(0, ${100 - R.valueArea}fr) minmax(0, ${R.valueArea}fr)` : packed ? 'max-content minmax(0, max-content)' : 'minmax(0, 1fr) minmax(0, max-content)'
    inner = (
      <div className="wbi-card-ref-table" style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 8, rowGap: 2 + R.labelSpace, alignContent: 'start', justifyContent: packed ? HJUSTIFY[align] : undefined }}>
        {refs.map((r) => [
          <span key={r.id + 't'} className="wbi-card-ref-title" style={{ ...textBlock(r.title.text || ' ', fontStyle(r.title.font), r.title.wrap), textAlign: 'left', visibility: r.title.show ? 'visible' : 'hidden' }}>
            {r.title.text}
          </span>,
          <span key={r.id + 'v'} className="wbi-card-ref-value" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', minWidth: 0 }}>
            <span style={{ ...textBlock(r.value.text, fontStyle(r.value.font), r.value.wrap), textAlign: 'right', visibility: r.value.show ? 'visible' : 'hidden' }}>{r.value.text}</span>
            {detail(r)}
          </span>
        ])}
      </div>
    )
  }
  return (
    <div className="wbi-card-refs" style={base}>
      {inner}
    </div>
  )
}
