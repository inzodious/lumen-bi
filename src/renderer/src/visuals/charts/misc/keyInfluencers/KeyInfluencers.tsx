/**
 * Key influencers (Power BI `keyDriversVisual`) — statistical approximation of Power BI's ML visual:
 *
 *  - Analyze: a categorical column ("What influences X to be [value]"), a numeric column or a measure
 *    ("What influences X to [Increase / Decrease]").
 *  - Key influencers tab: left = influencer list with impact bubbles (lift "1.53x" or mean difference),
 *    right = the selected influencer's field as bars vs. the dotted "Average (excluding selected)" line.
 *  - Top segments tab: best single segments / pairs of segments (see stats.ts topSegments).
 *  - Persisted like Power BI in `objects.keyDrivers`: targetValue, selectedAnalysis, numericTargetSelectedKind
 *    (0 = increase, 1 = decrease — Lumen's reading of the schema's numeric enum).
 *
 * The statistics are a per-field significance test, not Power BI's regression model; the visual says so in
 * its "?" help and footer.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { setObjectProp } from '@core/report/props'
import type { VisualProps } from '../../../contract'
import { EmptyVisual, VisualError, useVisualQuery } from '../../../common/VisualState'
import { FormatReader } from '../../../common/fmtProps'
import { computeValueAxis, valueToPx } from '../../../common/scale'
import { ellipsize, fontAttrs, measureText } from '../../../common/text'
import { formatFixed, formatWithUnits, resolveDisplayUnit } from '../../../common/units'
import { ICONS } from '../../icons'
import { KI_DEFAULTS } from '../formatCards'
import { computeKeyInfluencers, targetKey, type KiData } from './query'
import { mean, type Influencer, type Segment, type TopSegment } from './stats'

const FONT = "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"
const APPROX_NOTE = 'Lumen approximation: each Explain-by field is tested on its own (Welch t-test, 95%), numeric fields are binned into quantile ranges; Power BI uses a regression model.'

interface Colors {
  primary: string
  secondary: string
  canvas: string
  font: string
  primaryFont: string
  secondaryFont: string
  bubble: string
  refLine: string
}

export function KeyInfluencers({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const targetValue = fmt.optStr('keyDrivers', 'targetValue')
  const direction = fmt.num('keyDrivers', 'numericTargetSelectedKind', 0) === 1 ? 'decrease' : 'increase'
  const numericAsCategorical = fmt.str('keyDrivers', 'selectedNumericAnalysis', 'Continuous') === 'Categorical'
  const sort = fmt.str('keyDrivers', 'selectedSort', 'impact') === 'count' ? 'count' : 'impact'
  const allowKi = fmt.bool('keyDrivers', 'allowKeyDrivers', true)
  const allowSeg = fmt.bool('keyDrivers', 'allowProfiles', true)
  const savedTab = fmt.str('keyDrivers', 'selectedAnalysis', 'keyInfluencers')
  const tab = !allowSeg ? 'keyInfluencers' : !allowKi ? 'topProfiles' : savedTab === 'topProfiles' ? 'topProfiles' : 'keyInfluencers'
  const colors: Colors = {
    primary: fmt.color('keyInfluencersVisual', 'primaryColor', KI_DEFAULTS.primaryColor),
    secondary: fmt.color('keyInfluencersVisual', 'secondaryColor', KI_DEFAULTS.secondaryColor),
    canvas: fmt.color('keyInfluencersVisual', 'canvasColor', KI_DEFAULTS.canvasColor),
    font: fmt.color('keyInfluencersVisual', 'fontColor', KI_DEFAULTS.fontColor),
    primaryFont: fmt.color('keyInfluencersVisual', 'primaryFontColor', KI_DEFAULTS.primaryFontColor),
    secondaryFont: fmt.color('keyInfluencersVisual', 'secondaryFontColor', KI_DEFAULTS.secondaryFontColor),
    bubble: fmt.color('keyDriversDrillVisual', 'defaultColor', KI_DEFAULTS.defaultColor),
    refLine: fmt.color('keyDriversDrillVisual', 'referenceLineColor', KI_DEFAULTS.referenceLineColor)
  }
  const q = useVisualQuery(json, ctx, () => computeKeyInfluencers(json, ctx, { targetValue, direction, numericAsCategorical, sort }), `${targetValue}|${direction}|${numericAsCategorical}|${sort}`)
  const [selected, setSelected] = useState(0)
  const [segSel, setSegSel] = useState(0)
  const [onlyInfluencers, setOnlyInfluencers] = useState(false)

  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d) return <EmptyVisual icon={ICONS.keyDriversVisual} width={width} height={height} />

  const setProp = (prop: string, value: string | number) => ctx.updateVisual((j) => setObjectProp(j, 'keyDrivers', prop, value))
  const fmtY = (v: number) => fmtTarget(d, v, ctx.format)
  const compact = width < 420

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, padding: '2px 4px 0', height: 30, flex: 'none' }}>
      {allowKi ? <Tab label="Key influencers" active={tab === 'keyInfluencers'} color={colors.primary} onClick={() => setProp('selectedAnalysis', 'keyInfluencers')} /> : null}
      {allowSeg ? <Tab label="Top segments" active={tab === 'topProfiles'} color={colors.primary} onClick={() => setProp('selectedAnalysis', 'topProfiles')} /> : null}
    </div>
  )

  const question = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', fontSize: 13, color: colors.font, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tab === 'topProfiles' ? `When is ${d.analyze.label} more likely to be` : `What influences ${d.analyze.label} to${d.kind === 'categorical' ? ' be' : ''}`}
      </span>
      {d.kind === 'categorical' ? (
        <select
          value={targetKey(d.target)}
          onChange={(e) => setProp('targetValue', e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={selectStyle}
        >
          {d.targetValues.map((v) => (
            <option key={targetKey(v)} value={targetKey(v)}>
              {v === null ? '(Blank)' : ctx.format(v, d.analyze.formatString, d.analyze.desc?.dataType)}
            </option>
          ))}
        </select>
      ) : (
        <select value={direction} onChange={(e) => setProp('numericTargetSelectedKind', e.target.value === 'decrease' ? 1 : 0)} onClick={(e) => e.stopPropagation()} style={selectStyle}>
          <option value="increase">{tab === 'topProfiles' ? 'High' : 'Increase'}</option>
          <option value="decrease">{tab === 'topProfiles' ? 'Low' : 'Decrease'}</option>
        </select>
      )}
      <span title={APPROX_NOTE} style={{ color: '#605E5C', cursor: 'help' }}>
        ?
      </span>
    </div>
  )

  const bodyH = height - 30 - 40
  let body: ReactNode
  if (!d.explain.length) body = <Message text="Add fields to Explain by to see what influences the analyzed field." colors={colors} />
  else if (tab === 'keyInfluencers') {
    const sel = d.influencers.length ? d.influencers[Math.min(selected, d.influencers.length - 1)] : undefined
    const leftW = compact ? width : Math.round(width * 0.48)
    body = (
      <div style={{ display: 'flex', height: bodyH, background: colors.canvas }}>
        <InfluencerList d={d} width={leftW} height={bodyH} colors={colors} selected={sel} onSelect={(i) => setSelected(i)} fmtImpact={(i) => fmtImpact(d, i, ctx.format)} />
        {!compact && sel ? (
          <div style={{ flex: 1, minWidth: 0, padding: 8 }}>
            <DetailPane d={d} inf={sel} width={width - leftW - 16} height={bodyH - 16} colors={colors} onlyInfluencers={onlyInfluencers} setOnlyInfluencers={setOnlyInfluencers} fmtY={fmtY} format={ctx.format} />
          </div>
        ) : null}
      </div>
    )
  } else {
    body = <SegmentsView d={d} width={width} height={bodyH} colors={colors} selected={Math.min(segSel, Math.max(0, d.segments.length - 1))} onSelect={setSegSel} fmtY={fmtY} />
  }

  return (
    <div style={{ width, height, overflow: 'hidden', fontFamily: FONT, color: colors.font, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      {header}
      {question}
      {body}
    </div>
  )
}

const selectStyle: CSSProperties = { font: `12px ${FONT}`, color: '#252423', border: '1px solid #C8C6C4', borderRadius: 2, padding: '2px 4px', minWidth: 110, background: '#FFFFFF' }

function Tab({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick(): void }) {
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{ fontSize: 15, fontWeight: active ? 600 : 400, color: '#252423', paddingBottom: 3, borderBottom: `2px solid ${active ? color : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {label}
    </div>
  )
}

function Message({ text, colors }: { text: string; colors: Colors }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', fontSize: 12, color: '#605E5C', background: colors.canvas }}>{text}</div>
}

function fmtNumber(v: number, formatString: string | undefined, format: VisualProps['ctx']['format']): string {
  return formatWithUnits(v, { unit: resolveDisplayUnit(0, Math.abs(v)), formatString, format })
}

/** Value of the analyzed variable: a rate for categorical targets, the measure's own format otherwise. */
function fmtTarget(d: KiData, v: number, format: VisualProps['ctx']['format']): string {
  if (d.kind === 'categorical') return `${formatFixed(v * 100, 2)}%`
  return fmtNumber(v, d.analyze.formatString, format)
}

function fmtImpact(d: KiData, i: Influencer, format: VisualProps['ctx']['format']): string {
  if (d.kind === 'categorical') return Number.isFinite(i.impact) ? `${formatFixed(i.impact, 2)}x` : '∞'
  return fmtNumber(i.impact, d.analyze.formatString, format)
}

function influencerText(d: KiData, i: Influencer): string {
  return `${d.explain[i.field].label} is ${i.segment.label}`
}

function yTitle(d: KiData): string {
  return d.kind === 'categorical' ? `%${d.analyze.label} is ${d.targetLabel}` : d.grain === 'measure' ? d.analyze.label : `Average of ${d.analyze.label}`
}

function InfluencerList(p: { d: KiData; width: number; height: number; colors: Colors; selected?: Influencer; onSelect(i: number): void; fmtImpact(i: Influencer): string }) {
  const { d, colors } = p
  const rowH = 58
  const headRight = d.kind === 'categorical' ? `....the likelihood of ${d.analyze.label} being ${d.targetLabel} increases by` : `....the average of ${d.analyze.label} ${p.d.influencers[0] && p.d.influencers[0].diff < 0 ? 'decreases' : 'increases'} by`
  const finite = d.influencers.map((i) => i.impact).filter(Number.isFinite)
  const lo = Math.min(...finite, Infinity)
  const hi = Math.max(...finite, -Infinity)
  const textW = Math.round(p.width * 0.48)
  const trackX = textW + 8
  const trackW = Math.max(40, p.width - trackX - 40)
  const posOf = (i: Influencer) => {
    if (!Number.isFinite(i.impact)) return 1
    return hi > lo ? (i.impact - lo) / (hi - lo) : 1
  }
  return (
    <div style={{ width: p.width, height: p.height, display: 'flex', flexDirection: 'column', flex: 'none' }}>
      <div style={{ display: 'flex', fontSize: 12, color: '#605E5C', padding: '8px 12px 4px', flex: 'none' }}>
        <div style={{ width: textW - 12 }}>When...</div>
        <div style={{ flex: 1, textAlign: 'right', paddingRight: 8 }}>{headRight}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {d.influencers.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: '#605E5C' }}>
            {`No influencer is significant for ${d.analyze.label}${d.kind === 'categorical' ? ` being ${d.targetLabel}` : ''} with the current data (minimum ${d.minSupport.toLocaleString('en-US')} rows per segment).`}
          </div>
        ) : (
          d.influencers.map((inf, idx) => {
            const sel = inf === p.selected
            const pos = posOf(inf)
            const r = 20 + pos * 7
            const cx = trackX + 30 + pos * (trackW - 30)
            return (
              <div
                key={`${inf.field}|${inf.segment.key}`}
                onClick={(e) => {
                  e.stopPropagation()
                  p.onSelect(idx)
                }}
                style={{ position: 'relative', height: rowH, cursor: 'pointer' }}
              >
                {sel ? <div style={{ position: 'absolute', left: 4, top: rowH / 2 - 9, width: 3, height: 18, background: colors.primary }} /> : null}
                <div
                  style={{ position: 'absolute', left: 14, top: 0, width: textW - 16, height: rowH, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: sel ? 600 : 400, color: colors.font, lineHeight: '15px', overflow: 'hidden' }}
                  title={influencerText(d, inf)}
                >
                  {influencerText(d, inf)}
                </div>
                <svg width={p.width} height={rowH} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                  <line x1={trackX} y1={rowH / 2} x2={cx - r - 4} y2={rowH / 2} stroke="#A19F9D" strokeWidth={1} />
                  <path d={`M${cx - r - 8},${rowH / 2 - 3.5} L${cx - r - 2},${rowH / 2} L${cx - r - 8},${rowH / 2 + 3.5} Z`} fill="#A19F9D" />
                  <circle cx={cx} cy={rowH / 2} r={r} fill={sel ? colors.primary : colors.bubble} />
                  <text x={cx} y={rowH / 2 + 4} textAnchor="middle" {...fontAttrs({ size: 11, family: 'Segoe UI' })} fill={sel ? colors.primaryFont : colors.secondaryFont}>
                    {ellipsize(p.fmtImpact(inf), r * 2 - 4, { size: 11, family: 'Segoe UI' })}
                  </text>
                </svg>
              </div>
            )
          })
        )}
      </div>
      <div style={{ flex: 'none', fontSize: 10, color: '#8A8886', padding: '3px 12px 4px', fontStyle: 'italic' }} title={APPROX_NOTE}>
        Statistical approximation (not Power BI's AI model)
      </div>
    </div>
  )
}

function DetailPane(p: {
  d: KiData
  inf: Influencer
  width: number
  height: number
  colors: Colors
  onlyInfluencers: boolean
  setOnlyInfluencers(v: boolean): void
  fmtY(v: number): string
  format: VisualProps['ctx']['format']
}) {
  const { d, inf, colors } = p
  const field = d.fields[inf.field]
  const fLabel = d.explain[inf.field].label
  const infKeys = new Set(d.influencers.filter((i) => i.field === inf.field).map((i) => i.segment.key))
  let segs: Segment[] = field.segments.filter((s) => s.m.n > 0)
  if (p.onlyInfluencers) segs = segs.filter((s) => infKeys.has(s.key))
  if (!field.binned) segs = [...segs].sort((a, b) => mean(b.m) - mean(a.m))
  const sentence =
    d.kind === 'categorical'
      ? `${d.analyze.label} is more likely to be ${d.targetLabel} when ${fLabel} is ${inf.segment.label} than otherwise (on average).`
      : `On average, ${d.analyze.label} is ${fmtNumber(Math.abs(inf.diff), d.analyze.formatString, p.format)} ${inf.diff >= 0 ? 'higher' : 'lower'} when ${fLabel} is ${inf.segment.label} than otherwise.`

  const headH = 44
  const footH = 26
  const chartH = Math.max(60, p.height - headH - footH)
  const chartW = Math.max(80, p.width - 16)
  const tickFont = { size: 11, family: 'Segoe UI' }
  const means = segs.map((s) => mean(s.m))
  const axis = computeValueAxis({ dataMin: Math.min(...means, inf.restMean), dataMax: Math.max(...means, inf.restMean), includeZero: true, length: chartH - 50 })
  const tickLabels = axis.ticks.map((t) => p.fmtY(t))
  const yAxisW = Math.max(...tickLabels.map((t) => measureText(t, tickFont)), 10) + 22
  const plotX = yAxisW
  const plotY = 10
  const plotW = Math.max(20, chartW - plotX - 4)
  const plotH = Math.max(20, chartH - plotY - 44)
  const y = valueToPx(axis, plotH, true)
  const step = plotW / Math.max(1, segs.length)
  const bw = Math.min(64, step * 0.62)
  const avgY = plotY + y(inf.restMean)
  return (
    <div style={{ width: p.width, height: p.height, background: '#FFFFFF', boxShadow: '0 1.6px 3.6px rgba(0,0,0,0.13), 0 0.3px 0.9px rgba(0,0,0,0.11)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: headH, flex: 'none', display: 'flex', gap: 8, padding: '8px 12px 0', fontSize: 12, color: colors.font, lineHeight: '16px', overflow: 'hidden' }}>
        <span style={{ color: '#605E5C' }}>←</span>
        <span>{sentence}</span>
      </div>
      <svg width={chartW} height={chartH} style={{ display: 'block', marginLeft: 8 }}>
        {axis.ticks.map((t, i) => (
          <g key={i}>
            <line x1={plotX} x2={plotX + plotW} y1={plotY + y(t)} y2={plotY + y(t)} stroke="#EDEBE9" />
            <text x={plotX - 6} y={plotY + y(t) + 4} textAnchor="end" {...fontAttrs(tickFont)} fill="#605E5C">
              {tickLabels[i]}
            </text>
          </g>
        ))}
        <text transform={`translate(10,${plotY + plotH / 2}) rotate(-90)`} textAnchor="middle" {...fontAttrs(tickFont)} fill="#605E5C">
          {ellipsize(yTitle(d), plotH, tickFont)}
        </text>
        {segs.map((s, i) => {
          const v = means[i]
          const x = plotX + i * step + (step - bw) / 2
          const y0 = plotY + y(0)
          const y1 = plotY + y(v)
          const isSel = s.key === inf.segment.key
          return (
            <g key={s.key}>
              <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} fill={isSel ? colors.primary : colors.secondary}>
                <title>{`${s.label}: ${p.fmtY(v)} (${s.m.n.toLocaleString('en-US')} rows)`}</title>
              </rect>
              <text
                transform={`translate(${x + bw / 2},${plotY + plotH + 10}) rotate(${step < 60 ? -35 : 0})`}
                textAnchor={step < 60 ? 'end' : 'middle'}
                {...fontAttrs(tickFont)}
                fill="#605E5C"
                dy={step < 60 ? 0 : 4}
              >
                {ellipsize(s.label, step < 60 ? 70 : step - 4, tickFont)}
              </text>
            </g>
          )
        })}
        <line x1={plotX} x2={plotX + plotW} y1={avgY} y2={avgY} stroke={colors.refLine} strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={plotX + 4} y={avgY - 4} {...fontAttrs({ size: 11, family: 'Segoe UI' })} fill={colors.refLine} stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {`Average (excluding selected): ${p.fmtY(inf.restMean)}`}
        </text>
        <text x={plotX + plotW / 2} y={chartH - 2} textAnchor="middle" {...fontAttrs(tickFont)} fill="#605E5C">
          {ellipsize(fLabel, plotW, tickFont)}
        </text>
      </svg>
      <label style={{ height: footH, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', fontSize: 12, color: colors.font, cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={p.onlyInfluencers} onChange={(e) => p.setOnlyInfluencers(e.target.checked)} style={{ margin: 0 }} />
        Only show values that are influencers
      </label>
    </div>
  )
}

function SegmentsView(p: { d: KiData; width: number; height: number; colors: Colors; selected: number; onSelect(i: number): void; fmtY(v: number): string }) {
  const { d, colors } = p
  if (!d.segments.length) return <Message text={`No segment stands out for ${d.analyze.label} with the current data.`} colors={colors} />
  const seg: TopSegment | undefined = d.segments[p.selected]
  const overall = d.overall
  const r = 26
  return (
    <div style={{ height: p.height, background: colors.canvas, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, padding: '8px 12px', flex: 'none' }}>
        {d.segments.map((s, i) => (
          <svg key={i} width={r * 2} height={r * 2} style={{ cursor: 'pointer', flex: 'none' }} onClick={(e) => (e.stopPropagation(), p.onSelect(i))}>
            <title>{`Segment ${i + 1}`}</title>
            <circle cx={r} cy={r} r={r} fill={i === p.selected ? colors.primary : colors.bubble} />
            <text x={r} y={r + 4} textAnchor="middle" {...fontAttrs({ size: 11, family: 'Segoe UI' })} fill={i === p.selected ? colors.primaryFont : colors.secondaryFont}>
              {ellipsize(p.fmtY(s.mean), r * 2 - 6, { size: 11, family: 'Segoe UI' })}
            </text>
          </svg>
        ))}
      </div>
      {seg ? <SegmentCard d={d} seg={seg} index={p.selected} overall={overall} width={p.width - 24} height={p.height - r * 2 - 28} colors={colors} fmtY={p.fmtY} /> : null}
    </div>
  )
}

function SegmentCard(p: { d: KiData; seg: TopSegment; index: number; overall: number; width: number; height: number; colors: Colors; fmtY(v: number): string }) {
  const { d, seg, colors } = p
  const name = `Segment ${p.index + 1}`
  const diff = seg.mean - p.overall
  const what = d.kind === 'categorical' ? `%${d.analyze.label} is ${d.targetLabel}` : `the average ${d.analyze.label}`
  const diffText = d.kind === 'categorical' ? `${formatFixed(Math.abs(diff) * 100, 2)} percentage points` : p.fmtY(Math.abs(diff))
  const leftW = Math.min(220, Math.round(p.width * 0.32))
  const barMax = Math.max(Math.abs(seg.mean), Math.abs(p.overall)) || 1
  const barW = Math.max(60, p.width - leftW - 140)
  const share = seg.share
  const R = 32
  const rr = R - 7
  const a = share * Math.PI * 2
  const arc = share >= 0.9999 ? '' : `M${R},${R - rr} A${rr},${rr} 0 ${a > Math.PI ? 1 : 0} 1 ${R + rr * Math.sin(a)},${R - rr * Math.cos(a)}`
  return (
    <div style={{ margin: '0 12px 12px', height: p.height, background: '#FFFFFF', boxShadow: '0 1.6px 3.6px rgba(0,0,0,0.13)', display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: leftW, borderRight: '1px solid #E1DFDD', padding: '14px 16px', fontSize: 13, flex: 'none', overflow: 'hidden' }}>
        <div style={{ color: colors.primary, fontWeight: 600, marginBottom: 12 }}>{name}</div>
        {seg.conditions.map((c, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <b>{d.explain[c.field].label}</b> {c.segment.bin ? `is ${c.segment.label}` : `is ${c.segment.label}`}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: '14px 16px', fontSize: 13, overflow: 'hidden' }}>
        <div style={{ marginBottom: 10 }}>{`In ${name.toLowerCase()}, ${what} is ${p.fmtY(seg.mean)}. This is ${diffText} ${diff >= 0 ? 'higher' : 'lower'} than the overall average, ${p.fmtY(p.overall)}.`}</div>
        {[
          { label: name, v: seg.mean, color: colors.primary, text: '#FFFFFF' },
          { label: 'Overall', v: p.overall, color: colors.bubble, text: '#252423' }
        ].map((b) => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 70, textAlign: 'right', fontSize: 12, color: '#605E5C' }}>{b.label}</div>
            <div style={{ width: Math.max(40, (Math.abs(b.v) / barMax) * barW), height: 30, background: b.color, color: b.text, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', boxSizing: 'border-box', fontSize: 13 }}>
              {p.fmtY(b.v)}
            </div>
          </div>
        ))}
        <div style={{ margin: '12px 0 8px' }}>{`${name} contains ${seg.m.n.toLocaleString('en-US')} ${d.grain === 'measure' ? 'data points' : 'rows'} (${formatFixed(share * 100, 1)}% of the data).`}</div>
        {p.height > 220 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 11, color: '#605E5C' }}>
              <div>
                <span style={{ color: colors.primary }}>●</span> {name}
              </div>
              <div>
                <span style={{ color: colors.bubble }}>●</span> Other
              </div>
            </div>
            <svg width={R * 2} height={R * 2}>
              <circle cx={R} cy={R} r={rr} fill="none" stroke={colors.bubble} strokeWidth={14} />
              {arc ? <path d={arc} fill="none" stroke={colors.primary} strokeWidth={14} /> : <circle cx={R} cy={R} r={rr} fill="none" stroke={colors.primary} strokeWidth={14} />}
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  )
}
