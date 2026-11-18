/** Range slicers: Between / Before / After / Single value (numbers & dates) and Relative date/time. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { SQExpr, SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { fontStyle, ptToPx } from '../common/textStyle'
import {
  DATE_PRESETS,
  datePresetFilter,
  detectDatePreset,
  equalsFilter,
  snapTo,
  parseRangeFilter,
  parseRelativeFilter,
  rangeFilter,
  relativeFilter,
  relativeRange,
  resolveRelativeFilter,
  wallClockNow,
  type RangeSelection,
  type RelativeSelection,
  type RelUnit
} from './filterModel'
import { CalendarIcon, ChevronDown } from './icons'
import { applyUpdate } from './ListSlicer'
import { SlicerHeader, SlicerMessage } from './SlicerChrome'
import { loadDomain, loadSnapValues } from './slicerData'
import type { SlicerFormat } from './slicerFormat'

interface RangeProps {
  ctx: VisualHostContext
  fmt: SlicerFormat
  /** override of fmt.mode (What-if parameter slicers render as 'Single') */
  mode?: SlicerFormat['mode']
  field: SQExpr
  filter: SQFilter | undefined
  headerText: string
  width: number
  height: number
}

const DAY = 86400000

function fmtDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}

function parseDateText(s: string): Date | undefined {
  const t = s.trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]))
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return undefined
}

function toNum(v: number | Date | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined
  return v instanceof Date ? v.getTime() : v
}

export function RangeSlicer(p: RangeProps) {
  const { ctx, fmt, field, filter } = p
  const filtersKey = JSON.stringify(ctx.filters)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domain = useMemo(() => loadDomain(ctx, field), [ctx.engine, filtersKey, JSON.stringify(field)])
  const isDate = domain.min instanceof Date || domain.dataType === 'dateTime'
  // relative selections (date presets) show their current concrete dates in the inputs
  const persisted = useMemo(() => parseRangeFilter(resolveRelativeFilter(filter, wallClockNow()), field) ?? {}, [filter, field])
  const mode = p.mode ?? fmt.mode
  // single-value sliders snap to the existing values (What-if series, small integer domains)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapValues = useMemo(() => (mode === 'Single' && !(domain.min instanceof Date) ? loadSnapValues(ctx, field) : undefined), [ctx.engine, filtersKey, JSON.stringify(field), mode])
  const dmin = toNum(domain.min)
  const dmax = toNum(domain.max)
  // working range (numbers / epoch ms)
  const initial = (): [number | undefined, number | undefined] => [toNum(persisted.min) ?? dmin, toNum(persisted.max) ?? dmax]
  const [range, setRange] = useState(initial)
  useEffect(() => setRange(initial()), [JSON.stringify(persisted), dmin, dmax]) // eslint-disable-line react-hooks/exhaustive-deps

  const describe = useMemo(() => {
    try {
      return ctx.engine.describeField(field)
    } catch {
      return undefined
    }
  }, [ctx.engine, field])
  const display = (n: number | undefined) => {
    if (n === undefined) return ''
    if (isDate) return fmtDate(new Date(n))
    return ctx.format(n, describe?.formatString, describe?.dataType)
  }

  const commit = (lo: number | undefined, hi: number | undefined) => {
    const conv = (n: number | undefined) => (n === undefined ? undefined : isDate ? new Date(n) : n)
    let sel: RangeSelection
    if (mode === 'Before') sel = { max: conv(hi) }
    else if (mode === 'After') sel = { min: conv(lo) }
    else if (mode === 'Single') {
      const v = conv(lo)
      return applyUpdate(ctx, fmt, { filter: v === undefined ? undefined : equalsFilter(field, v), inverted: false })
    } else {
      // full domain = no filter, like PBI clearing the slicer
      const full = lo !== undefined && hi !== undefined && lo <= (dmin ?? lo) && hi >= (dmax ?? hi)
      if (full) return applyUpdate(ctx, fmt, { filter: undefined, inverted: false })
      sel = { min: conv(lo), max: conv(hi) }
    }
    applyUpdate(ctx, fmt, { filter: rangeFilter(field, sel), inverted: false })
  }

  const fs = fontStyle(fmt.items.font)
  // PBI styles range inputs with `numericInputStyle` (numbers) / `date` (dates)
  const inputFont = isDate ? fmt.date.font : fmt.numericInput.font
  const inputFs = fontStyle(inputFont)
  const lineH = Math.ceil(ptToPx(inputFont.size) * 1.36)
  const inputH = lineH + 10
  const header = (
    <SlicerHeader
      show={fmt.header.show}
      text={fmt.header.text ?? p.headerText}
      font={fmt.header.font}
      background={fmt.header.background}
      outline={fmt.header.outline}
      outlineColor={fmt.header.outlineColor}
      outlineWeight={fmt.header.outlineWeight}
      canClear={!!filter}
      onClear={() => applyUpdate(ctx, fmt, { filter: undefined, inverted: false })}
    />
  )
  if (domain.error) return (<>{header}<SlicerMessage text={domain.error} font={fmt.items.font} /></>)
  if (dmin === undefined || dmax === undefined) return (<>{header}<SlicerMessage text="No values" font={fmt.items.font} /></>)

  const step = isDate ? DAY : domain.integer ? 1 : Math.max((dmax - dmin) / 200, Number.EPSILON)
  const snap = snapValues && snapValues.length > 1 ? (v: number) => snapTo(snapValues, v) : undefined
  const [lo, hi] = range
  const showLo = mode !== 'Before'
  const showHi = mode === 'Between' || mode === 'Before'
  const input = (value: number | undefined, onCommit: (n: number | undefined) => void, key: string) => (
    <RangeInput key={key} text={display(value)} isDate={isDate && !fmt.date.hidePicker} font={inputFs} background={isDate ? fmt.date.background : fmt.numericInput.background} height={inputH} onCommit={(t) => {
      if (isDate) {
        const d = parseDateText(t)
        onCommit(d ? d.getTime() : undefined)
      } else {
        const n = Number(t.replace(/[^0-9.eE+-]/g, ''))
        onCommit(Number.isFinite(n) && t.trim() !== '' ? n : undefined)
      }
    }} />
  )
  return (
    <>
      {header}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flex: 'none' }}>
        {showLo && input(lo, (n) => {
          const raw = n === undefined ? dmin : Math.max(dmin, Math.min(n, mode === 'Single' ? dmax : hi ?? dmax))
          const v = snap ? snap(raw) : raw
          setRange([v, hi])
          commit(v, hi)
        }, 'lo')}
        {showHi && input(hi, (n) => {
          const v = n === undefined ? dmax : Math.min(dmax, Math.max(n, lo ?? dmin))
          setRange([lo, v])
          commit(lo, v)
        }, 'hi')}
      </div>
      {fmt.slider.show && (
        <RangeSliderTrack
          min={dmin}
          max={dmax}
          step={step}
          snap={snap}
          single={mode === 'Single'}
          handle={{ fill: fmt.slider.handleFill, border: fmt.slider.handleBorder, size: fmt.slider.handleSize, bar: fmt.slider.bar }}
          track={fmt.slider.secondaryLine}
          lo={mode === 'Before' ? undefined : lo}
          hi={mode === 'Between' || mode === 'Before' ? hi : undefined}
          color={fmt.slider.color}
          onChange={(a, b) => setRange([a ?? lo, b ?? hi])}
          onCommit={(a, b) => commit(a ?? lo, b ?? hi)}
        />
      )}
      {isDate && fmt.ext.datePresets && mode === 'Between' && <RangePresets ctx={ctx} fmt={fmt} field={field} filter={filter} />}
    </>
  )
}

/** Date preset chips under a Between date slicer (Lumen extra `lumenSlicer.datePresets`). */
function RangePresets({ ctx, fmt, field, filter }: { ctx: VisualHostContext; fmt: SlicerFormat; field: SQExpr; filter: SQFilter | undefined }) {
  const active = detectDatePreset(filter, field)
  const f = { ...fmt.items.font, size: Math.max(7, fmt.items.font.size - 1) }
  const accent = ctx.theme.dataColors?.[0] ?? '#118DFF'
  return (
    <div className="wbi-slicer-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, minHeight: 0 }}>
      {DATE_PRESETS.map((d) => {
        const on = active === d.id
        return (
          <button
            key={d.id}
            className="wbi-slicer-chip"
            onClick={() => applyUpdate(ctx, fmt, { filter: on ? undefined : datePresetFilter(field, d.id), inverted: false })}
            style={{ ...fontStyle({ ...f, color: on ? '#FFFFFF' : f.color }), background: on ? accent : '#FFFFFF', borderColor: on ? accent : '#C8C6C4' }}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

function RangeInput({ text, isDate, font, height, background, onCommit }: { text: string; isDate: boolean; font: CSSProperties; height: number; background?: string; onCommit(t: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  return (
    <div className="wbi-slicer-input" style={{ flex: 1, display: 'flex', alignItems: 'center', height, padding: '0 6px', gap: 4, background }}>
      <input
        value={draft ?? text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onCommit(draft)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
        style={{ ...font, border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, padding: 0 }}
      />
      {isDate && (
        <span style={{ position: 'relative', display: 'flex', cursor: 'pointer', color: '#605E5C' }} onClick={() => (dateRef.current as any)?.showPicker?.()}>
          <CalendarIcon />
          <input
            ref={dateRef}
            type="date"
            tabIndex={-1}
            onChange={(e) => e.target.value && onCommit(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', pointerEvents: 'none' }}
          />
        </span>
      )}
    </div>
  )
}

/** Two-thumb (or one-thumb) slider like PBI's: thin gray track, filled selection, white round thumbs. */
export function RangeSliderTrack(p: {
  min: number
  max: number
  step: number
  lo?: number
  hi?: number
  color: string
  /** single-value slider (one thumb at `lo`) */
  single?: boolean
  /** snap to discrete values (What-if series) */
  snap?(v: number): number
  /** PBI slider.handleFillColor / handleBorderColor / handleSize; `bar` = rectangular handles (responsive off) */
  handle?: { fill: string; border: string; size: number; bar?: { width: number; height: number } }
  /** PBI slider.secondaryLineColor (unselected track) */
  track?: string
  onChange(lo: number | undefined, hi: number | undefined): void
  onCommit(lo: number | undefined, hi: number | undefined): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const span = p.max - p.min || 1
  const frac = (v: number) => Math.max(0, Math.min(1, (v - p.min) / span))
  const snap = (v: number) => {
    const c = Math.max(p.min, Math.min(p.max, v))
    return p.snap ? p.snap(c) : Math.max(p.min, Math.min(p.max, p.min + Math.round((c - p.min) / p.step) * p.step))
  }
  const drag = (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let lo = p.lo
    let hi = p.hi
    const move = (ev: PointerEvent) => {
      const v = snap(p.min + ((ev.clientX - rect.left) / rect.width) * span)
      if (which === 'lo') lo = Math.min(v, hi ?? p.max)
      else hi = Math.max(v, lo ?? p.min)
      p.onChange(lo, hi)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      p.onCommit(lo, hi)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // single value: the track fills from the minimum to the thumb (PBI); ranges fill between the thumbs
  const a = p.lo !== undefined && !p.single ? frac(p.lo) : 0
  const b = p.single && p.lo !== undefined ? frac(p.lo) : p.hi !== undefined ? frac(p.hi) : 1
  const thumb = Math.max(6, Math.min(30, p.handle?.size ?? 12))
  const hFill = p.handle?.fill ?? '#FFFFFF'
  const hBorder = p.handle?.border ?? p.color
  const bar = p.handle?.bar
  // rectangular handles (responsive off): a filled rounded bar in the border color
  const thumbStyle = (left: number): CSSProperties =>
    bar
      ? { left: `${left * 100}%`, width: bar.width, height: bar.height, borderRadius: Math.min(bar.width, bar.height) / 2, border: 0, background: hBorder }
      : { left: `${left * 100}%`, width: thumb, height: thumb, border: `2px solid ${hBorder}`, background: hFill }
  const hW = bar ? bar.width : thumb
  return (
    <div style={{ position: 'relative', height: Math.max(24, (bar?.height ?? thumb) + 4), margin: `6px ${hW / 2}px 0`, flex: 'none' }} ref={ref}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1, background: p.track ?? '#C8C6C4' }} />
      <div style={{ position: 'absolute', left: `${a * 100}%`, width: `${(b - a) * 100}%`, top: '50%', height: 2, marginTop: -1, background: p.color }} />
      {p.lo !== undefined && (
        <div className="wbi-slicer-thumb" onPointerDown={drag('lo')} style={thumbStyle(p.single ? b : a)} />
      )}
      {p.hi !== undefined && (
        <div className="wbi-slicer-thumb" onPointerDown={drag('hi')} style={thumbStyle(b)} />
      )}
    </div>
  )
}

const DATE_UNITS: Array<{ label: string; unit: RelUnit; calendar: boolean }> = [
  { label: 'Days', unit: 'days', calendar: false },
  { label: 'Weeks', unit: 'weeks', calendar: false },
  { label: 'Weeks (Calendar)', unit: 'weeks', calendar: true },
  { label: 'Months', unit: 'months', calendar: false },
  { label: 'Months (Calendar)', unit: 'months', calendar: true },
  { label: 'Years', unit: 'years', calendar: false },
  { label: 'Years (Calendar)', unit: 'years', calendar: true }
]
const TIME_UNITS: Array<{ label: string; unit: RelUnit; calendar: boolean }> = [
  { label: 'Minutes', unit: 'minutes', calendar: false },
  { label: 'Hours', unit: 'hours', calendar: false }
]

export function RelativeSlicer(p: RangeProps) {
  const { ctx, fmt, field, filter } = p
  const isTime = fmt.mode === 'RelativeTime'
  const units = isTime ? TIME_UNITS : DATE_UNITS
  const parsed = useMemo(() => parseRelativeFilter(filter, field), [filter, field])
  const [state, setState] = useState<RelativeSelection & { nText: string }>(() => ({
    ...(parsed ?? { anchor: 'last', n: NaN, unit: isTime ? 'hours' : 'days', calendar: false }),
    nText: parsed && parsed.anchor !== 'this' ? String(parsed.n) : ''
  }))
  useEffect(() => {
    if (parsed) setState({ ...parsed, nText: parsed.anchor !== 'this' ? String(parsed.n) : '' })
  }, [JSON.stringify(parsed)]) // eslint-disable-line react-hooks/exhaustive-deps

  const withOpts = (s: RelativeSelection): RelativeSelection => ({ ...s, includeToday: fmt.date.includeToday, anchorDate: fmt.date.anchorDate })
  const commit = (s: RelativeSelection) => {
    const f = relativeFilter(field, withOpts(s))
    applyUpdate(ctx, fmt, { filter: f, inverted: false })
  }
  const fs = fontStyle(fmt.items.font)
  const lineH = Math.ceil(ptToPx(fmt.items.font.size) * 1.36)
  const h = lineH + 10
  const unitIdx = Math.max(0, units.findIndex((u) => u.unit === state.unit && (u.calendar === state.calendar || u.unit === 'days' || isTime)))
  const update = (patch: Partial<RelativeSelection & { nText: string }>) => {
    const next = { ...state, ...patch }
    setState(next)
    if (next.anchor === 'this' || next.n > 0) commit(next)
    else if (filter) applyUpdate(ctx, fmt, { filter: undefined, inverted: false })
  }
  const range = state.anchor === 'this' || state.n > 0 ? relativeRange(withOpts(state), wallClockNow()) : undefined
  const select = (value: string, options: Array<[string, string]>, onChange: (v: string) => void, flex: number) => (
    <div style={{ position: 'relative', flex, minWidth: 0, display: 'flex' }}>
      <select className="wbi-slicer-select" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...fs, height: h, width: '100%', padding: '0 22px 0 6px' }}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronDown size={11} color={fmt.items.font.color} style={{ position: 'absolute', right: 6, top: (h - 11) / 2, pointerEvents: 'none' }} />
    </div>
  )
  const anchorLabel = (a: string) => (a === 'last' ? 'Last' : a === 'next' ? 'Next' : 'This')
  return (
    <>
      <SlicerHeader
        show={fmt.header.show}
        text={fmt.header.text ?? p.headerText}
        font={fmt.header.font}
        background={fmt.header.background}
        outline={fmt.header.outline}
        outlineColor={fmt.header.outlineColor}
        outlineWeight={fmt.header.outlineWeight}
        canClear={!!filter}
        onClear={() => {
          setState({ ...state, n: NaN, nText: '' })
          applyUpdate(ctx, fmt, { filter: undefined, inverted: false })
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flex: 'none' }}>
        {select(state.anchor, ['last', 'next', 'this'].map((a) => [a, anchorLabel(a)]), (v) => update({ anchor: v as RelativeSelection['anchor'] }), 1)}
        {state.anchor !== 'this' && (
          <input
            className="wbi-slicer-input"
            value={state.nText}
            onChange={(e) => {
              const t = e.target.value.replace(/[^0-9]/g, '')
              update({ nText: t, n: t ? Number(t) : NaN })
            }}
            style={{ ...fs, height: h, width: 0, flex: 0.8, padding: '0 6px' }}
          />
        )}
        {select(
          String(unitIdx),
          units.filter((u) => state.anchor !== 'this' || !u.calendar || u.unit === 'days').map((u) => [String(units.indexOf(u)), state.anchor === 'this' ? u.label.replace(' (Calendar)', '').replace(/s$/, '') : u.label]),
          (v) => update({ unit: units[+v].unit, calendar: units[+v].calendar }),
          1.6
        )}
      </div>
      {range && (
        <div style={{ ...fontStyle({ ...fmt.items.font, color: '#605E5C', size: Math.max(7, fmt.items.font.size - 1) }), marginTop: 6, flex: 'none' }}>
          {isTime
            ? `${fmtDate(range.start)} ${String(range.start.getUTCHours()).padStart(2, '0')}:${String(range.start.getUTCMinutes()).padStart(2, '0')} - ${fmtDate(range.end)} ${String(range.end.getUTCHours()).padStart(2, '0')}:${String(range.end.getUTCMinutes()).padStart(2, '0')}`
            : `${fmtDate(range.start)} - ${fmtDate(range.end)}`}
        </div>
      )}
    </>
  )
}
