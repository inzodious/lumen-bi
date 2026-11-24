/** Legacy card (`card`) and multi-row card (`multiRowCard`) renderers. */
import { summarizeAny } from '../common/visualCalcs'
import { useMemo, type CSSProperties } from 'react'
import type { VisualHostContext, VisualProps } from '../contract'
import { fontStyle, measureText, ptToPx } from '../common/textStyle'
import { kpiAwareLabel } from '../tables/kpiLabel'
import { getProjections, expandParameters, labelOf, valueId, type Projection } from '../common/query'
import type { SortSpec } from '@core/engine/api'
import { fieldKey } from '@core/report/sq'
import { CFIcon } from '../tables/cfIcons'
import { buildLegacyCardModel, buildMultiRowRecords, fitFontSize, fitWrappedFontSize, multiRowStyle, type LegacyCardModel, type MultiRowCardRecord, type MultiRowStyle, type ResolvedValue } from './legacyCardModel'
import { COUNT_MARK } from '../common/motionMarks'

// ---------------------------------------------------------------------------------------------
// Legacy card
// ---------------------------------------------------------------------------------------------

export function computeLegacyCard(visualJson: any, ctx: VisualHostContext): LegacyCardModel | undefined {
  const roles = getProjections(visualJson)
  const p = expandParameters(roles.Values ?? roles.Fields ?? roles.Data ?? [], ctx)[0]
  if (!p) return undefined
  const res = summarizeAny(ctx, { groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr: p.expr } }], filters: ctx.filters, keepBlankRows: true })
  const col = res.columns.find((c) => c.id === 'v')
  const v: ResolvedValue = { value: res.rows[0]?.[0] ?? null, formatString: res.formats?.[0]?.[0] ?? col?.formatString, dataType: col?.dataType, kpi: kpiOf(ctx, p) }
  return buildLegacyCardModel(visualJson, ctx.theme, ctx.format, kpiAwareLabel(p.displayName, safeDescribe(ctx, p), () => labelOf(ctx, p)), v)
}

function safeDescribe(ctx: VisualHostContext, p: Projection) {
  try {
    return ctx.engine.describeField(p.expr)
  } catch {
    return undefined
  }
}

function kpiOf(ctx: VisualHostContext, p: Projection): ResolvedValue['kpi'] {
  try {
    return ctx.engine.describeField(p.expr)?.kpi
  } catch {
    return undefined
  }
}

function useComputed<T>(visual: VisualProps['visual'], ctx: VisualHostContext, fn: () => T): { value?: T; error?: string } {
  const key = JSON.stringify([visual.json?.visual?.query, visual.json?.visual?.objects])
  return useMemo(() => {
    try {
      return { value: fn() }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx.engine, ctx.filters, ctx.theme, ctx.format])
}

const errorBox = (msg: string) => <div className="wbi-card-error" style={{ padding: 8, color: '#A4262C', fontSize: 12 }}>{msg}</div>

export function LegacyCardView({ visual, width, height, ctx }: VisualProps) {
  const st = useComputed(visual, ctx, () => computeLegacyCard(visual.json, ctx))
  if (st.error) return errorBox(st.error)
  const m = st.value
  if (!m) return <div style={{ width, height, display: 'grid', placeItems: 'center', color: '#605E5C', fontSize: 12 }}>Add a field to this card</div>
  const catLineH = ptToPx(m.category.font.size) * 1.35
  // with word wrap the category label may take two lines when it is wider than the card
  const catLines = m.category.show ? (m.wordWrap && measureText(m.category.text, m.category.font) > width * 0.95 ? 2 : 1) : 0
  const catH = catLines * catLineH
  const measure = (t: string, pt: number) => measureText(t, { ...m.font, size: pt })
  const availH = Math.max(10, height - catH)
  const fit = m.wordWrap ? fitWrappedFontSize(m.text, m.font.size, width, availH, measure) : { pt: fitFontSize(m.text, m.font.size, width, availH, measure), lines: [m.text] }
  const valueStyle: CSSProperties = {
    ...fontStyle({ ...m.font, size: fit.pt }),
    lineHeight: 1.2,
    whiteSpace: m.preserveWhitespace ? 'pre' : 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%'
  }
  return (
    <div
      className="wbi-card-legacy"
      style={{ width, height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', overflow: 'hidden' }}
      onMouseMove={(e) => ctx.showTooltip({ x: e.clientX, y: e.clientY, items: [{ label: m.category.text, value: m.text }] })}
      onMouseLeave={() => ctx.showTooltip(null)}
    >
      {m.kpiIcon ? (
        <div className="wbi-card-value" style={{ display: 'flex', justifyContent: 'center' }}>
          <CFIcon name={m.kpiIcon} size={Math.round(Math.min(ptToPx(m.font.size), availH * 0.95, width * 0.8))} />
        </div>
      ) : (
        fit.lines.map((line, i) => (
          <div key={i} className="wbi-card-value" style={valueStyle} {...(fit.lines.length === 1 ? COUNT_MARK : undefined)}>
            {line}
          </div>
        ))
      )}
      {m.category.show && (
        <div
          className="wbi-card-label"
          style={{
            ...fontStyle(m.category.font),
            lineHeight: 1.3,
            whiteSpace: m.category.preserveWhitespace ? 'pre-wrap' : m.wordWrap ? 'normal' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            maxHeight: catH || undefined,
            overflowWrap: 'anywhere'
          }}
        >
          {m.category.text}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Multi-row card
// ---------------------------------------------------------------------------------------------

export function computeMultiRow(visualJson: any, ctx: VisualHostContext): { records: MultiRowCardRecord[]; style: MultiRowStyle; fields: Projection[] } {
  const roles = getProjections(visualJson)
  const fields = expandParameters(roles.Values ?? [], ctx)
  const style = multiRowStyle(visualJson, ctx.theme)
  if (!fields.length) return { records: [], style, fields }
  const groups = fields.filter((f) => !f.isMeasure)
  const values = fields.filter((f) => f.isMeasure)
  const sorts: any[] = visualJson?.visual?.query?.sortDefinition?.sort ?? []
  const orderBy: SortSpec[] = []
  for (const s of sorts) {
    const k = fieldKey(s.field)
    const gi = groups.findIndex((g) => fieldKey(g.expr) === k)
    const vi = values.findIndex((v) => fieldKey(v.expr) === k)
    const direction = s.direction === 'Descending' ? 'desc' : 'asc'
    if (gi >= 0) orderBy.push({ target: { group: gi }, direction })
    else if (vi >= 0) orderBy.push({ target: { value: valueId(values[vi]) }, direction })
  }
  const res = summarizeAny(ctx, {
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: values.map((v) => ({ id: valueId(v), expr: { kind: 'sq', expr: v.expr } })),
    filters: ctx.filters,
    orderBy: orderBy.length ? orderBy : undefined,
    limit: 1000
  })
  const kpis = values.map((v) => kpiOf(ctx, v))
  const cells: ResolvedValue[][] = res.rows.map((row, r) =>
    fields.map((f) => {
      if (!f.isMeasure) {
        const gi = groups.indexOf(f)
        const c = res.columns[gi]
        return { value: row[gi], formatString: c?.formatString, dataType: c?.dataType }
      }
      const vi = values.indexOf(f)
      const c = res.columns[groups.length + vi]
      return { value: row[groups.length + vi], formatString: res.formats?.[r]?.[vi] ?? c?.formatString, dataType: c?.dataType, kpi: kpis[vi] }
    })
  )
  const records = buildMultiRowRecords(
    fields.map((f) => ({ queryRef: f.queryRef, label: kpiAwareLabel(f.displayName, safeDescribe(ctx, f), () => labelOf(ctx, f)), isMeasure: f.isMeasure })),
    cells,
    ctx.format,
    style.title.show
  )
  return { records, style, fields }
}

function outlineCss(s: MultiRowStyle['card']): CSSProperties {
  const b = `${s.outlineWeight}px solid ${s.outlineColor}`
  switch (s.outline) {
    case 'BottomOnly':
      return { borderBottom: b }
    case 'TopOnly':
      return { borderTop: b }
    case 'LeftOnly':
      return { borderLeft: b }
    case 'RightOnly':
      return { borderRight: b }
    case 'TopBottom':
      return { borderTop: b, borderBottom: b }
    case 'LeftRight':
      return { borderLeft: b, borderRight: b }
    case 'Frame':
      return { border: b }
    default:
      return {}
  }
}

/** Segoe UI's normal line height (ascent + descent = 1.33 em), as PBI lays out multi-row card lines. */
const MR_LINE_HEIGHT = 1.33

export function MultiRowCardView({ visual, width, height, ctx }: VisualProps) {
  const st = useComputed(visual, ctx, () => computeMultiRow(visual.json, ctx))
  if (st.error) return errorBox(st.error)
  const { records, style } = st.value!
  if (!records.length) return <div style={{ width, height, display: 'grid', placeItems: 'center', color: '#605E5C', fontSize: 12 }}>No data</div>
  const S = style.card
  return (
    <div className="wbi-card-multirow" style={{ width, height, overflowY: records.length > 1 ? 'auto' : 'hidden', overflowX: 'hidden' }}>
      {records.map((rec) => (
        <div
          key={rec.key}
          className="wbi-card-mr-card"
          // PBI (measured on Learn's Store Sales / Competitive Marketing screenshots): the accent bar and the
          // first text line start at the top of the content area (no top padding; the container padding
          // gives the 5px offset), the bar spans exactly the text lines, and cardPadding separates records.
          style={{ position: 'relative', padding: `0 ${S.padding}px ${S.padding}px ${S.padding + (S.barShow ? S.barWeight + 6 : 0)}px`, background: S.background, ...outlineCss(S) }}
        >
          {S.barShow && <div style={{ position: 'absolute', left: 0, top: 0, bottom: S.padding, width: S.barWeight, background: S.barColor }} />}
          {rec.title !== undefined && <div style={{ ...fontStyle(style.title.font), lineHeight: MR_LINE_HEIGHT, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.title}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 2 }}>
            {rec.items.map((it, i) => (
              <div key={i} style={{ minWidth: 0, maxWidth: '100%' }}>
                {it.kpiIcon ? (
                  <div style={{ height: Math.ceil(ptToPx(style.data.size) * MR_LINE_HEIGHT), display: 'flex', alignItems: 'center' }}>
                    <CFIcon name={it.kpiIcon} size={Math.round(ptToPx(style.data.size))} />
                  </div>
                ) : (
                  <div style={{ ...fontStyle(style.data), lineHeight: MR_LINE_HEIGHT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.text}</div>
                )}
                {style.category.show && <div style={{ ...fontStyle(style.category.font), lineHeight: MR_LINE_HEIGHT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
