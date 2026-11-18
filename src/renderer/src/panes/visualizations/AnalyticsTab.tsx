/**
 * Analytics tab (cartesian charts): constant / min / max / average / median / percentile lines and
 * trend line. PBIR: each line is one entry of its object with `selector.id` (and `selector.metadata`
 * = series queryRef for statistical lines): objects `y1AxisReferenceLine`, `minLine`, `maxLine`,
 * `averageLine`, `medianLine`, `percentileLine`, `trend` — the names the chart workstream reads
 * (visuals/charts/cartesian/analytics.ts).
 *
 * Plus, per visual type like PBI's Analytics pane: X-axis constant line (continuous X), Find anomalies (line/area),
 * Error bars (column/bar/line/combo), Forecast (line charts: `objects.forecast` with a `transform` of algorithm
 * 'Forecast', read by visuals/charts/cartesian/forecast.ts), and for scatter charts Ratio line (`ratioLine`) and
 * Symmetry shading (`plotAreaShading`).
 */
import { useState } from 'react'
import { AddRegular, DeleteRegular } from '@fluentui/react-icons'
import type { ObjectEntry } from '@core/report/props'
import type { PageDocument, VisualDocument } from '@core/report/types'
import type { FormatPropDef } from '../../visuals/contract'
import { useApp } from '../../state/store'
import { findPage, findVisual, visualTypeOf } from '../../report/pbir'
import { CollapsibleCard, Dropdown, NumberField, Tip } from '../../app/ui'
import { nextEntryId, setRaw, visualBag } from './objects'
import { PropRow, writeProp } from './PropEditor'
import { visualTarget } from './FormatTab'
import { supportsAnalytics } from './catalog'
import { isValueProjection, nativeName, roleProjections } from './wells'

interface LineKind {
  object: string
  title: string
  stat: boolean
  extra: FormatPropDef[]
}

const KINDS: LineKind[] = [
  { object: 'xAxisReferenceLine', title: 'X-axis constant line', stat: false, extra: [{ name: 'value', displayName: 'Value', type: 'number' }] },
  { object: 'y1AxisReferenceLine', title: 'Constant line', stat: false, extra: [{ name: 'value', displayName: 'Value', type: 'number' }] },
  { object: 'minLine', title: 'Min line', stat: true, extra: [] },
  { object: 'maxLine', title: 'Max line', stat: true, extra: [] },
  { object: 'averageLine', title: 'Average line', stat: true, extra: [] },
  { object: 'medianLine', title: 'Median line', stat: true, extra: [] },
  { object: 'percentileLine', title: 'Percentile line', stat: true, extra: [{ name: 'percentile', displayName: 'Percentile', type: 'percent', min: 0, max: 100, default: 50 }] },
  { object: 'trend', title: 'Trend line', stat: true, extra: [] }
]

/** Scatter ▸ Ratio line: one line through the origin with slope ΣY/ΣX (single entry, like the trend line). */
const RATIO_LINE: LineKind = { object: 'ratioLine', title: 'Ratio line', stat: false, extra: [] }

const RATIO_PROPS: FormatPropDef[] = [
  { name: 'lineColor', displayName: 'Color', type: 'color', default: '#12239E' },
  { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'dashed', label: 'Dashed' }, { value: 'solid', label: 'Solid' }, { value: 'dotted', label: 'Dotted' }], default: 'solid' },
  { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 2 }
]

/** Scatter ▸ Symmetry shading (`plotAreaShading`): shades the areas above and below y = x. */
const SYMMETRY_PROPS: FormatPropDef[] = [
  { name: 'upperShadingColor', displayName: 'Upper shading color', type: 'color', default: '#1AAB40' },
  { name: 'lowerShadingColor', displayName: 'Lower shading color', type: 'color', default: '#D64554' },
  { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 66 }
]

/** Line chart ▸ Forecast: formatting of the forecast line and its confidence band (`objects.forecast`). */
const FORECAST_PROPS: FormatPropDef[] = [
  { name: 'displayName', displayName: 'Name', type: 'text' },
  { name: 'lineColor', displayName: 'Line color', type: 'color', default: '#605E5C' },
  { name: 'strokeTransparency', displayName: 'Line transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'style', displayName: 'Line style', type: 'enum', options: [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }], default: 'solid' },
  { name: 'width', displayName: 'Line width', type: 'integer', min: 1, max: 10, default: 2 },
  { name: 'bandAreaShow', displayName: 'Confidence band', type: 'bool', default: true },
  { name: 'bandAreaMatchColor', displayName: 'Band matches line color', type: 'bool', default: true },
  { name: 'bandAreaColor', displayName: 'Band color', type: 'color' },
  { name: 'bandAreaTransparency', displayName: 'Band transparency', type: 'percent', min: 0, max: 100, default: 80 },
  { name: 'bandLineShow', displayName: 'Band outline', type: 'bool', default: false },
  { name: 'bandLinePattern', displayName: 'Outline style', type: 'enum', options: [{ value: 'dashed', label: 'Dashed' }, { value: 'solid', label: 'Solid' }, { value: 'dotted', label: 'Dotted' }], default: 'dashed' }
]

/**
 * Forecast options (`transform.parameters`, as written by PBI Desktop). Units: 7 = Points and 2 = Months are the values
 * observed in real files (see forecast.ts); the other unit codes are undocumented, so only these two are offered.
 */
const FORECAST_UNITS = [
  { value: '7', label: 'Points' },
  { value: '2', label: 'Months' }
]
const CONFIDENCE_LEVELS = [0.75, 0.8, 0.85, 0.9, 0.95, 0.99]

const LINE_PROPS: FormatPropDef[] = [
  { name: 'displayName', displayName: 'Name', type: 'text' },
  { name: 'lineColor', displayName: 'Color', type: 'color', default: '#605E5C' },
  { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'dashed', label: 'Dashed' }, { value: 'solid', label: 'Solid' }, { value: 'dotted', label: 'Dotted' }], default: 'dashed' },
  { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 1 },
  { name: 'position', displayName: 'Position', type: 'enum', options: [{ value: 'front', label: 'In front' }, { value: 'behind', label: 'Behind' }], default: 'front' },
  { name: 'dataLabelShow', displayName: 'Data label', type: 'bool', default: false },
  { name: 'dataLabelText', displayName: 'Label text', type: 'enum', options: [{ value: 'Value', label: 'Value' }, { value: 'Name', label: 'Name' }, { value: 'NameAndValue', label: 'Name and value' }], default: 'Value' },
  { name: 'dataLabelColor', displayName: 'Label color', type: 'color' },
  { name: 'dataLabelHorizontalPosition', displayName: 'Horizontal position', type: 'enum', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], default: 'left' },
  { name: 'dataLabelVerticalPosition', displayName: 'Vertical position', type: 'enum', options: [{ value: 'above', label: 'Above' }, { value: 'under', label: 'Under' }], default: 'above' },
  { name: 'dataLabelDisplayUnits', displayName: 'Display units', type: 'displayUnits', default: 0 },
  { name: 'dataLabelDecimalPoints', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
  { name: 'shadeShow', displayName: 'Shade area', type: 'bool', default: false },
  { name: 'shadeRegion', displayName: 'Shade region', type: 'enum', options: [{ value: 'before', label: 'Before' }, { value: 'after', label: 'After' }], default: 'before' },
  { name: 'shadeColor', displayName: 'Shade color', type: 'color' },
  { name: 'shadeTransparency', displayName: 'Shade transparency', type: 'percent', min: 0, max: 100, default: 60 }
]

const TREND_PROPS: FormatPropDef[] = [
  { name: 'lineColor', displayName: 'Color', type: 'color', default: '#605E5C' },
  { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'dashed', label: 'Dashed' }, { value: 'solid', label: 'Solid' }, { value: 'dotted', label: 'Dotted' }], default: 'dashed' },
  { name: 'combineSeries', displayName: 'Combine series', type: 'bool', default: true },
  { name: 'useHighlightValues', displayName: 'Use highlight values', type: 'bool', default: true }
]

/** Find anomalies (line charts): `objects.anomalyDetection` (one entry per measure via selector.metadata). */
const ANOMALY_PROPS: FormatPropDef[] = [
  { name: 'sensitivity', displayName: 'Sensitivity', type: 'percent', min: 0, max: 100, default: 70 },
  { name: 'markerColor', displayName: 'Anomaly color', type: 'color', default: '#6B007B' },
  { name: 'confidenceBandShow', displayName: 'Expected range', type: 'bool', default: true },
  { name: 'confidenceBandStyle', displayName: 'Range style', type: 'enum', options: [{ value: 'fill', label: 'Fill' }, { value: 'line', label: 'Dotted line' }, { value: 'none', label: 'None' }], default: 'fill' },
  { name: 'confidenceBandColor', displayName: 'Range color', type: 'color' },
  { name: 'transparency', displayName: 'Range transparency', type: 'percent', min: 0, max: 100, default: 80 }
]

/** Error bars: `objects.error` per measure (selector.metadata); bounds are field expressions. */
const ERROR_BAR_PROPS: FormatPropDef[] = [
  { name: 'barShow', displayName: 'Bar', type: 'bool', default: true },
  { name: 'barMatchSeriesColor', displayName: 'Match series color', type: 'bool', default: false },
  { name: 'barColor', displayName: 'Bar color', type: 'color' },
  { name: 'barWidth', displayName: 'Bar width', type: 'integer', min: 1, max: 10, default: 1 },
  { name: 'markerShow', displayName: 'Markers', type: 'bool', default: true },
  { name: 'markerShape', displayName: 'Marker shape', type: 'enum', options: [{ value: 'shortDash', label: 'Dash' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'diamond', label: 'Diamond' }], default: 'shortDash' },
  { name: 'markerSize', displayName: 'Marker size', type: 'integer', min: 1, max: 30, default: 8 },
  { name: 'shadeShow', displayName: 'Error band', type: 'bool', default: false },
  { name: 'shadeBandStyle', displayName: 'Band style', type: 'enum', options: [{ value: 'fill', label: 'Fill' }, { value: 'line', label: 'Line' }, { value: 'fillAndLine', label: 'Fill and line' }], default: 'fill' },
  { name: 'shadeColor', displayName: 'Band color', type: 'color' },
  { name: 'shadeTransparency', displayName: 'Band transparency', type: 'percent', min: 0, max: 100, default: 80 },
  { name: 'tooltipShow', displayName: 'Tooltip', type: 'bool', default: true },
  { name: 'tooltipFormat', displayName: 'Tooltip format', type: 'enum', options: [{ value: 'absolute', label: 'Absolute' }, { value: 'relative', label: 'Relative' }, { value: 'relativePercent', label: 'Relative (%)' }], default: 'absolute' }
]

function seriesOf(visualJson: any): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  for (const role of ['Y', 'Y2', 'Values', 'X', 'Size']) for (const p of roleProjections(visualJson, role)) if (isValueProjection(p.field)) out.push({ value: p.queryRef, label: p.displayName ?? p.nativeQueryRef ?? nativeName(p.field) })
  return out
}

export function AnalyticsTab() {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const theme = useApp((s) => s.theme)
  const page = findPage(project?.report, activePage)
  const visual = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  if (!page || !visual) return <div className="wbi-pane__empty">Select a visual to add analytics such as reference lines.</div>
  const type = visualTypeOf(visual)
  if (!supportsAnalytics(type)) return <div className="wbi-pane__empty">Analytics features aren't available for this visual.</div>
  return (
    <div className="wbi-fmt__cards">
      {KINDS.filter((k) => k.object !== 'xAxisReferenceLine' || hasContinuousX(type)).map((k) => (
        <LineCard key={k.object} kind={k} page={page} visual={visual} theme={theme} />
      ))}
      {type === 'scatterChart' && <LineCard kind={RATIO_LINE} page={page} visual={visual} theme={theme} />}
      {type === 'scatterChart' && <SymmetryShadingCard page={page} visual={visual} theme={theme} />}
      {/^(lineChart|areaChart)$/.test(type) && <PerSeriesCard object="anomalyDetection" title="Find anomalies" props={ANOMALY_PROPS} page={page} visual={visual} theme={theme} />}
      {type === 'lineChart' && <ForecastCard page={page} visual={visual} theme={theme} />}
      {/^(lineChart|clusteredColumnChart|columnChart|clusteredBarChart|barChart|lineClusteredColumnComboChart|lineStackedColumnComboChart)$/.test(type) && (
        <PerSeriesCard object="error" title="Error bars" toggleProp="enabled" props={ERROR_BAR_PROPS} page={page} visual={visual} theme={theme} bounds />
      )}
    </div>
  )
}

function LineCard({ kind, page, visual, theme }: { kind: LineKind; page: PageDocument; visual: VisualDocument; theme: any }) {
  const target = visualTarget(page.name, visual, false, theme)
  const entries: ObjectEntry[] = visual.json?.visual?.objects?.[kind.object] ?? []
  const series = seriesOf(visual.json)
  const mutate = (label: string, fn: (vj: any) => void) =>
    useApp.getState().mutateReport(label, (r) => {
      const v = findVisual(findPage(r, page.name), visual.name)
      if (v) fn(v.json)
    })
  const add = () =>
    mutate(`Add ${kind.title.toLowerCase()}`, (vj) => {
      const bag = visualBag(vj, false, true)!
      const id = nextEntryId(bag, kind.object)
      const selector = kind.stat && series[0] ? { metadata: series[0].value, id } : { id }
      setRaw(bag, kind.object, 'show', { expr: { Literal: { Value: 'true' } } }, selector)
      if (!single) setRaw(bag, kind.object, 'displayName', { expr: { Literal: { Value: `'${kind.title} ${id}'` } } }, selector)
    })
  const remove = (e: ObjectEntry) =>
    mutate(`Remove ${kind.title.toLowerCase()}`, (vj) => {
      const bag = visualBag(vj, false)
      if (!bag?.[kind.object]) return
      bag[kind.object] = bag[kind.object].filter((x) => JSON.stringify(x.selector) !== JSON.stringify(e.selector))
      if (!bag[kind.object].length) delete bag[kind.object]
    })
  const setSeries = (e: ObjectEntry, queryRef: string) =>
    mutate('Change series', (vj) => {
      const bag = visualBag(vj, false)
      const hit = bag?.[kind.object]?.find((x) => JSON.stringify(x.selector) === JSON.stringify(e.selector))
      if (hit) hit.selector = { ...(hit.selector ?? {}), metadata: queryRef }
    })
  const isTrend = kind.object === 'trend'
  const single = isTrend || kind.object === 'ratioLine'
  const canAdd = !single || entries.length === 0
  return (
    <CollapsibleCard
      title={`${kind.title}${entries.length ? ` (${entries.length})` : ''}`}
      actions={
        canAdd ? (
          <Tip title={`Add ${kind.title.toLowerCase()}`}>
            <button
              type="button"
              className="wbi-btn wbi-btn--icon"
              style={{ width: 24, height: 24 }}
              aria-label={`Add ${kind.title}`}
              onClick={(ev) => {
                ev.stopPropagation()
                add()
              }}
            >
              <AddRegular fontSize={14} />
            </button>
          </Tip>
        ) : undefined
      }
    >
      {!entries.length && (
        <button type="button" className="wbi-link" onClick={add}>
          + Add line
        </button>
      )}
      {entries.map((e, i) => {
        const sel = e.selector
        const on = e.properties?.show?.expr?.Literal?.Value === 'true'
        const label = (e.properties?.displayName?.expr?.Literal?.Value as string | undefined)?.replace(/^'|'$/g, '') ?? `${kind.title} ${i + 1}`
        return (
          <CollapsibleCard
            key={JSON.stringify(sel) + i}
            level={2}
            defaultOpen={i === entries.length - 1}
            title={label}
            toggle={{ on, onChange: (v) => writeProp(target, kind.object, 'show', { expr: { Literal: { Value: String(v) } } }, sel) }}
            actions={
              <button type="button" className="wbi-btn wbi-btn--icon" style={{ width: 24, height: 24 }} aria-label="Delete line" onClick={(ev) => (ev.stopPropagation(), remove(e))}>
                <DeleteRegular fontSize={14} />
              </button>
            }
          >
            {kind.stat && series.length > 0 && (
              <div className="wbi-fmt__row">
                <div className="wbi-fmt__label">
                  <span>Series</span>
                </div>
                <Dropdown size="small" value={sel?.metadata ?? series[0].value} options={series} onChange={(v) => setSeries(e, v)} />
              </div>
            )}
            {[...kind.extra, ...(isTrend ? TREND_PROPS : kind.object === 'ratioLine' ? RATIO_PROPS : LINE_PROPS)].map((p) => (
              <PropRow key={p.name} def={p} object={kind.object} target={target} selector={sel} />
            ))}
          </CollapsibleCard>
        )
      })}
    </CollapsibleCard>
  )
}

/** X-axis constant lines need a continuous X axis (scatter, or line/area/combos with a numeric/date axis). */
function hasContinuousX(type: string): boolean {
  return /^(scatterChart|lineChart|areaChart|stackedAreaChart|lineClusteredColumnComboChart|lineStackedColumnComboChart)$/.test(type)
}

/**
 * One entry per measure (selector.metadata): Find anomalies / Error bars. The toggle writes `toggleProp` (show /
 * enabled); error bars also pick the upper / lower bound fields (Measure / Aggregation expressions, the shape Desktop
 * writes under `errorRange.explicit`).
 */
function PerSeriesCard(props: { object: string; title: string; toggleProp?: string; props: FormatPropDef[]; page: PageDocument; visual: VisualDocument; theme: any; bounds?: boolean }) {
  const { object, title, page, visual, theme } = props
  const toggleProp = props.toggleProp ?? 'show'
  const target = visualTarget(page.name, visual, false, theme)
  const series = seriesOf(visual.json)
  const [sel, setSel] = useState(series[0]?.value ?? '')
  const model = useApp((s) => s.project?.model)
  if (!series.length) return null
  const metadata = series.some((s) => s.value === sel) ? sel : series[0].value
  const selector = { metadata }
  const entries: ObjectEntry[] = visual.json?.visual?.objects?.[object] ?? []
  const entry = entries.find((e) => e.selector?.metadata === metadata)
  const on = entry?.properties?.[toggleProp]?.expr?.Literal?.Value === 'true'
  const measures = (model?.tables ?? []).flatMap((t) => t.measures.map((m) => ({ value: `${t.name}\u0000${m.name}`, label: `${t.name}[${m.name}]` })))
  const boundOf = (which: 'upperBound' | 'lowerBound'): string => {
    const raw = (entry?.properties as any)?.errorRange?.explicit?.[which] ?? (entry?.properties as any)?.[which]
    const m = raw?.expr?.Measure
    return m ? `${m.Expression?.SourceRef?.Entity}\u0000${m.Property}` : ''
  }
  const setBound = (which: 'upperBound' | 'lowerBound', v: string) =>
    useApp.getState().mutateReport('Error bars', (r) => {
      const vj = findVisual(findPage(r, page.name), visual.name)?.json
      const bag = vj ? visualBag(vj, false, true) : undefined
      if (!bag) return
      const [table, measure] = v.split('\u0000')
      let e = bag[object]?.find((x) => x.selector?.metadata === metadata)
      if (!e) {
        setRaw(bag, object, toggleProp, { expr: { Literal: { Value: 'true' } } }, selector)
        e = bag[object]!.find((x) => x.selector?.metadata === metadata)!
      }
      const props: any = e.properties
      props.errorRange ??= { explicit: {} }
      props.errorRange.explicit ??= {}
      if (v) props.errorRange.explicit[which] = { expr: { Measure: { Expression: { SourceRef: { Entity: table } }, Property: measure } } }
      else delete props.errorRange.explicit[which]
    })
  return (
    <CollapsibleCard title={title} toggle={{ on, onChange: (v) => writeProp(target, object, toggleProp, { expr: { Literal: { Value: String(v) } } }, selector) }}>
      <div className="wbi-fmt__row">
        <div className="wbi-fmt__label">
          <span>Series</span>
        </div>
        <Dropdown size="small" value={metadata} options={series} onChange={(v) => setSel(String(v))} />
      </div>
      {props.bounds && (
        <>
          <div className="wbi-fmt__row">
            <div className="wbi-fmt__label">
              <span>Upper bound</span>
            </div>
            <Dropdown size="small" value={boundOf('upperBound')} options={[{ value: '', label: '(None)' }, ...measures]} onChange={(v) => setBound('upperBound', String(v))} />
          </div>
          <div className="wbi-fmt__row">
            <div className="wbi-fmt__label">
              <span>Lower bound</span>
            </div>
            <Dropdown size="small" value={boundOf('lowerBound')} options={[{ value: '', label: '(None)' }, ...measures]} onChange={(v) => setBound('lowerBound', String(v))} />
          </div>
        </>
      )}
      {props.props.map((p) => (
        <PropRow key={p.name} def={p} object={object} target={target} selector={selector} />
      ))}
    </CollapsibleCard>
  )
}

/** Scatter ▸ Symmetry shading: one toggle card on `plotAreaShading` (no selector). */
function SymmetryShadingCard({ page, visual, theme }: { page: PageDocument; visual: VisualDocument; theme: any }) {
  const target = visualTarget(page.name, visual, false, theme)
  const on = (visual.json?.visual?.objects?.plotAreaShading?.[0]?.properties as any)?.show?.expr?.Literal?.Value === 'true'
  return (
    <CollapsibleCard title="Symmetry shading" toggle={{ on, onChange: (v) => writeProp(target, 'plotAreaShading', 'show', { expr: { Literal: { Value: String(v) } } }) }}>
      {SYMMETRY_PROPS.map((p) => (
        <PropRow key={p.name} def={p} object="plotAreaShading" target={target} />
      ))}
    </CollapsibleCard>
  )
}

/** Read a numeric `transform.parameters` value of a forecast entry (`'10D'` → 10). */
export function forecastParam(entry: ObjectEntry | undefined, name: string): number | undefined {
  const params: any[] = (entry?.properties as any)?.transform?.parameters ?? []
  const v = params.find((q) => q?.Name === name)?.Literal?.Value
  if (typeof v !== 'string') return undefined
  const n = Number(v.replace(/[DLM]$/i, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Upsert a forecast `transform` parameter on a mutable entry (creates `transform` with algorithm 'Forecast'). */
export function setForecastParam(entry: ObjectEntry, name: string, value: number | undefined): void {
  const props: any = (entry.properties ??= {})
  props.transform ??= { algorithm: 'Forecast', parameters: [] }
  props.transform.parameters ??= []
  const list: any[] = props.transform.parameters
  const i = list.findIndex((q) => q?.Name === name)
  if (value === undefined) {
    if (i >= 0) list.splice(i, 1)
    return
  }
  const item = { Name: name, Literal: { Value: `${value}D` } }
  if (i >= 0) list[i] = item
  else list.push(item)
}

/** Line chart ▸ Forecast (one entry per measure: selector { metadata, id: '1' }, like PBI Desktop writes it). */
function ForecastCard({ page, visual, theme }: { page: PageDocument; visual: VisualDocument; theme: any }) {
  const target = visualTarget(page.name, visual, false, theme)
  const series = seriesOf(visual.json)
  const [sel, setSel] = useState(series[0]?.value ?? '')
  if (!series.length) return null
  const metadata = series.some((s) => s.value === sel) ? sel : series[0].value
  const entries: ObjectEntry[] = visual.json?.visual?.objects?.forecast ?? []
  const entry = entries.find((e) => e.selector?.metadata === metadata)
  const selector = entry?.selector ?? { metadata, id: '1' }
  const on = entry?.properties?.show?.expr?.Literal?.Value === 'true'
  const edit = (label: string, fn: (e: ObjectEntry) => void) =>
    useApp.getState().mutateReport(label, (r) => {
      const vj = findVisual(findPage(r, page.name), visual.name)?.json
      const bag = vj ? visualBag(vj, false, true) : undefined
      if (!bag) return
      let e = bag.forecast?.find((x) => x.selector?.metadata === metadata)
      if (!e) {
        setRaw(bag, 'forecast', 'show', { expr: { Literal: { Value: 'true' } } }, selector)
        e = bag.forecast!.find((x) => x.selector?.metadata === metadata)!
        // PBI's defaults when the forecast is first added
        setForecastParam(e, 'Unit', 7)
        setForecastParam(e, 'ForecastLength', 10)
        setForecastParam(e, 'IgnoreLast', 0)
        setForecastParam(e, 'ConfidenceLevel', 0.95)
      }
      fn(e)
    })
  const toggle = (v: boolean) =>
    edit(v ? 'Add forecast' : 'Turn off forecast', (e) => {
      ;(e.properties as any).show = { expr: { Literal: { Value: String(v) } } }
    })
  const param = (name: string, label: string, d: number, opts: { min?: number; max?: number; zeroUnset?: boolean } = {}) => (
    <div className="wbi-fmt__row" key={name}>
      <div className="wbi-fmt__label">
        <span>{label}</span>
      </div>
      <NumberField
        size="small"
        value={forecastParam(entry, name) ?? d}
        min={opts.min}
        max={opts.max}
        onChange={(n) => edit('Forecast options', (e) => setForecastParam(e, name, n === undefined || (opts.zeroUnset && n === 0) ? undefined : Math.round(n)))}
      />
    </div>
  )
  const conf = forecastParam(entry, 'ConfidenceLevel') ?? 0.95
  return (
    <CollapsibleCard title="Forecast" toggle={{ on, onChange: toggle }}>
      {series.length > 1 && (
        <div className="wbi-fmt__row">
          <div className="wbi-fmt__label">
            <span>Series</span>
          </div>
          <Dropdown size="small" value={metadata} options={series} onChange={(v) => setSel(String(v))} />
        </div>
      )}
      <CollapsibleCard title="Options" level={2} defaultOpen>
        <div className="wbi-fmt__row">
          <div className="wbi-fmt__label">
            <span>Units</span>
          </div>
          <Dropdown size="small" value={String(forecastParam(entry, 'Unit') ?? 7)} options={FORECAST_UNITS} onChange={(v) => edit('Forecast options', (e) => setForecastParam(e, 'Unit', Number(v)))} />
        </div>
        {param('ForecastLength', 'Forecast length', 10, { min: 1, max: 1000 })}
        {param('IgnoreLast', 'Ignore the last', 0, { min: 0, max: 1000 })}
        {param('MaxSeasonality', 'Seasonality (points, 0 = automatic)', 0, { min: 0, max: 1000, zeroUnset: true })}
        <div className="wbi-fmt__row">
          <div className="wbi-fmt__label">
            <span>Confidence interval</span>
          </div>
          <Dropdown
            size="small"
            value={String(conf > 1 ? conf / 100 : conf)}
            options={CONFIDENCE_LEVELS.map((c) => ({ value: String(c), label: `${Math.round(c * 100)}%` }))}
            onChange={(v) => edit('Forecast options', (e) => setForecastParam(e, 'ConfidenceLevel', Number(v)))}
          />
        </div>
      </CollapsibleCard>
      <CollapsibleCard title="Forecast line" level={2}>
        {FORECAST_PROPS.map((p) => (
          <PropRow key={p.name} def={p} object="forecast" target={target} selector={selector} />
        ))}
      </CollapsibleCard>
    </CollapsibleCard>
  )
}
