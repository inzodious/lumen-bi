/**
 * Date picker slicer (`data.mode = 'RelativeDatePicker'`). Model, PBIR keys and filter shapes: ./datePicker.ts.
 *
 * Canvas (after Microsoft Learn's screenshots): header, then a square calendar button next to the selected
 * range ("4/14/2026 – 4/24/2026", column format) and the relative restatement, an ⓘ indicator when the
 * selection extends past the available dates, and the slider. The button opens a flyout with two tabs:
 * **Manual** (start / end inputs, month calendar with ↑ ↓ month navigation, range band, Apply) and
 * **Relative** (Last/Next/This, N, period, anchor Today / First date / Last date, offset, Apply).
 *
 * Approximations (documented in the UI where it matters): the flyout's exact layout of the Relative tab and
 * the start/end inputs are not shown in any published screenshot; colors of the flyout accent (#377666) and
 * range band were measured on Microsoft Learn's screenshot. Date picker slicers filtering each other is a
 * host concern (PBI: "Date picker slicers don't filter other date picker slicers").
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown20Regular, ArrowUp20Regular, CalendarLtr20Regular, CalendarSync20Regular, Info16Regular } from '@fluentui/react-icons'
import type { SQExpr, SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { fontStyle, ptToPx, type FontSpec } from '../common/textStyle'
import {
  DAY_MS,
  MONTHS,
  PERIODS,
  WEEKDAYS,
  calendarClick,
  clipRange,
  monthGrid,
  parseDateInput,
  periodOf,
  pickerFilter,
  readPickerRule,
  relativeSummary,
  resolvePickerRange,
  ruleFromFilter,
  sameDay,
  shortDate,
  startOfDay,
  writePickerRule,
  type CalendarPick,
  type PickerAnchor,
  type PickerDomain,
  type PickerRelative,
  type PickerRule
} from './datePicker'
import { wallClockNow } from './filterModel'
import { RangeSliderTrack } from './RangeSlicer'
import { SlicerHeader, SlicerMessage } from './SlicerChrome'
import { loadDomain } from './slicerData'
import type { SlicerFormat } from './slicerFormat'

/** Flyout accent (selected day, tab underline, Apply) and range band, measured on Microsoft Learn's screenshot. */
export const PICKER_ACCENT = '#377666'
export const PICKER_BAND = '#C2D5D1'
const FLYOUT_TEXT = '#242424'
const FLYOUT_MUTED = '#616161'
const FLYOUT_W = 252

interface Props {
  ctx: VisualHostContext
  fmt: SlicerFormat
  field: SQExpr
  filter: SQFilter | undefined
  headerText: string
  width: number
  height: number
  visualJson: any
}

function toDate(v: unknown): Date | undefined {
  return v instanceof Date ? startOfDay(v) : undefined
}

/** Which rule the current state represents: the stored rule when it still matches the filter, else the filter's. */
export function effectiveRule(stored: PickerRule | undefined, filter: SQFilter | undefined, field: SQExpr, domain: PickerDomain, now: Date, opts: { includeToday?: boolean; anchorDate?: Date }): PickerRule | undefined {
  if (!filter) return undefined
  if (stored) {
    const want = pickerFilter(field, stored, domain, now, opts)
    if (want && JSON.stringify(want.Where) === JSON.stringify(filter.Where)) return stored
    // anchored rules whose anchor moved (data refreshed): still the stored rule; the slicer re-applies it
    if (stored.kind === 'relative' && (stored.anchor !== 'today' || stored.offset) && ruleFromFilter(filter, field)?.kind === 'relative') return stored
  }
  return ruleFromFilter(filter, field)
}

export function DatePickerSlicer(p: Props) {
  const { ctx, fmt, field, filter } = p
  const filtersKey = JSON.stringify(ctx.filters)
  const fieldKey = JSON.stringify(field)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const domain = useMemo(() => loadDomain(ctx, field), [ctx.engine, filtersKey, fieldKey])
  // First / Last date anchors use the whole column (not the cross-filtered domain), so two date pickers on the
  // same column can't chase each other's anchors.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const column = useMemo(() => loadDomain({ ...ctx, filters: [] }, field), [ctx.engine, fieldKey])
  const anchors: PickerDomain = { first: toDate(column.min), last: toDate(column.max) }
  const lo = toDate(domain.min)
  const hi = toDate(domain.max)
  const now = wallClockNow()
  const opts = { includeToday: fmt.date.includeToday, anchorDate: fmt.date.anchorDate }
  const stored = readPickerRule(p.visualJson)
  const rule = effectiveRule(stored, filter, field, anchors, now, opts)
  const describe = useMemo(() => {
    try {
      return ctx.engine.describeField(field)
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.engine, fieldKey])
  const fmtDate = (d: Date) => {
    try {
      return describe?.formatString ? ctx.format(d, describe.formatString, 'dateTime') : shortDate(d)
    } catch {
      return shortDate(d)
    }
  }

  // anchored relative rule: keep the filter in sync with the anchor date (First / Last date moved after a refresh)
  const wanted = rule && rule === stored ? pickerFilter(field, rule, anchors, now, opts) : undefined
  const wantedKey = wanted ? JSON.stringify(wanted.Where) : ''
  useEffect(() => {
    if (wanted && filter && wantedKey !== JSON.stringify(filter.Where)) ctx.setSlicerFilter(wanted)
  }, [wantedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: PickerRule | undefined) => {
    ctx.updateVisual((j) => writePickerRule(j, next))
    ctx.setSlicerFilter(pickerFilter(field, next, anchors, now, opts))
  }

  const galleryOpen = p.visualJson?.__lumenGalleryOpen as 'manual' | 'relative' | undefined
  const [open, setOpen] = useState<false | 'manual' | 'relative'>(galleryOpen ?? false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [drag, setDrag] = useState<[number | undefined, number | undefined] | null>(null)

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
      onClear={() => commit(undefined)}
    />
  )
  if (domain.error) return (<>{header}<SlicerMessage text={domain.error} font={fmt.items.font} /></>)
  if (!lo || !hi) return (<>{header}<SlicerMessage text={domain.dataType && domain.dataType !== 'dateTime' ? 'Date picker needs a date column' : 'No values'} font={fmt.items.font} /></>)

  const selected = rule ? resolvePickerRange(rule, anchors, now, opts) : undefined
  const shown = selected ? clipRange(selected, lo, hi) : { start: lo, end: hi, clipped: false, empty: false }
  const single = fmt.picker.singleDate
  const rangeText = shown.empty && selected ? (sameDay(selected.start, selected.end) ? fmtDate(selected.start) : `${fmtDate(selected.start)} – ${fmtDate(selected.end)}`) : sameDay(shown.start, shown.end) ? fmtDate(shown.start) : `${fmtDate(shown.start)} – ${fmtDate(shown.end)}`
  const outside = selected && (shown.clipped || shown.empty) ? `The selection ${fmtDate(selected.start)} – ${fmtDate(selected.end)} extends beyond the available dates (${fmtDate(lo)} – ${fmtDate(hi)}).` : undefined
  const pf = fmt.picker
  const btnPx = Math.round(Math.max(22, ptToPx(pf.rangeFont.size) + 8))
  // second line: the relative restatement, or "Selected: <range>" for manual selections (Learn screenshots)
  const relLine = !pf.relativeShow || !rule ? undefined : rule.kind === 'relative' ? relativeSummary(rule) : `Selected: ${sameDay(rule.start, rule.end) ? fmtDate(rule.start) : `${fmtDate(rule.start)} – ${fmtDate(rule.end)}`}`
  const Icon = rule?.kind === 'relative' ? CalendarSync20Regular : CalendarLtr20Regular
  const sLo = drag ? drag[0] : shown.empty ? undefined : shown.start.getTime()
  const sHi = drag ? drag[1] : single || shown.empty ? undefined : shown.end.getTime()

  return (
    <>
      {header}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 2, flex: 'none', minWidth: 0 }}>
        <button
          ref={btnRef}
          className="wbi-picker-btn"
          aria-label="Open date picker"
          aria-expanded={!!open}
          title="Select dates"
          onClick={() => setOpen((o) => (o ? false : rule?.kind === 'relative' ? 'relative' : 'manual'))}
          style={{
            width: btnPx,
            height: btnPx,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
            color: pf.button.iconColor,
            background: pf.button.background ?? 'transparent',
            border: pf.button.stroke ? `${pf.button.stroke.width}px ${pf.button.stroke.pattern} ${pf.button.stroke.color}` : '0',
            borderRadius: pf.button.radius,
            boxSizing: 'border-box'
          }}
        >
          <Icon style={{ width: pf.button.iconSize + 2, height: pf.button.iconSize + 2 }} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: btnPx }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span className="wbi-picker-range" style={{ ...fontStyle(pf.rangeFont), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }} title={rangeText}>
              {rangeText}
            </span>
            {outside && (
              <span title={outside} aria-label={outside} style={{ display: 'flex', color: '#8A8886', flex: 'none' }}>
                <Info16Regular />
              </span>
            )}
          </div>
          {relLine && (
            <div className="wbi-picker-rel" style={{ ...fontStyle(pf.relativeFont), whiteSpace: 'normal', lineHeight: 1.35 }}>
              {relLine}
            </div>
          )}
        </div>
      </div>
      {fmt.slider.show && hi.getTime() > lo.getTime() && (
        <RangeSliderTrack
          min={lo.getTime()}
          max={hi.getTime()}
          step={DAY_MS}
          single={single}
          lo={sLo}
          hi={single ? undefined : sHi}
          color={shown.empty && !drag ? fmt.picker.trackColor : fmt.picker.sliderColor}
          track={fmt.picker.trackColor}
          handle={{ fill: fmt.slider.handleFill, border: fmt.picker.handleBorder, size: fmt.picker.handleSize, bar: fmt.slider.bar }}
          onChange={(a, b) => setDrag([a, b])}
          onCommit={(a, b) => {
            setDrag(null)
            const s = a !== undefined ? new Date(a) : lo
            const e = single ? s : b !== undefined ? new Date(b) : hi
            commit({ kind: 'manual', start: startOfDay(s), end: startOfDay(e) })
          }}
        />
      )}
      {open && (
        <PickerFlyout
          anchorRef={btnRef}
          tab={open}
          setTab={(t) => setOpen(t)}
          onClose={() => setOpen(false)}
          rule={rule}
          single={single}
          first={anchors.first ?? lo}
          last={anchors.last ?? hi}
          now={now}
          fmtDate={fmtDate}
          font={{ ...fmt.items.font, color: FLYOUT_TEXT, family: 'Segoe UI', bold: false, italic: false, underline: false }}
          fieldLabel={p.headerText}
          onApply={(r) => {
            commit(r)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Flyout
// ---------------------------------------------------------------------------------------------

interface FlyoutProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  tab: 'manual' | 'relative'
  setTab(t: 'manual' | 'relative'): void
  onClose(): void
  rule: PickerRule | undefined
  single: boolean
  first: Date
  last: Date
  now: Date
  fmtDate(d: Date): string
  font: FontSpec
  onApply(r: PickerRule): void
  /** field display name ("Date is in the …") */
  fieldLabel: string
}

function PickerFlyout(p: FlyoutProps) {
  const popRef = useRef<HTMLDivElement>(null)
  // portals can't be server-rendered: mount on the client only
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // follow the button while open (canvas scroll / zoom / layout changes move it)
  useLayoutEffect(() => {
    if (!mounted) return
    let raf = 0
    let last = ''
    const place = () => {
      const btn = p.anchorRef.current
      if (btn) {
        const r = btn.getBoundingClientRect()
        const h = popRef.current?.offsetHeight ?? 360
        const below = window.innerHeight - r.bottom - 8
        const top = below < h && r.top - 8 > below ? Math.max(4, r.top - 4 - h) : r.bottom + 4
        const left = Math.max(4, Math.min(r.left, window.innerWidth - FLYOUT_W - 4))
        const key = `${left},${top}`
        if (key !== last) {
          last = key
          setPos({ left, top })
        }
      }
      raf = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(raf)
  }, [mounted, p.tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || p.anchorRef.current?.contains(t)) return
      p.onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!mounted) return null

  const body = (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Date picker"
      className="wbi-picker-flyout"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          p.onClose()
        }
      }}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: FLYOUT_W,
        background: '#FFFFFF',
        borderRadius: 4,
        boxShadow: '0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        zIndex: 10000,
        ...fontStyle(p.font),
        color: FLYOUT_TEXT,
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', gap: 4, padding: '0 8px', borderBottom: '1px solid #EBEBEB' }}>
        <TabButton active={p.tab === 'manual'} onClick={() => p.setTab('manual')} icon={<CalendarLtr20Regular style={{ width: 14, height: 14 }} />} label="Manual" />
        <TabButton active={p.tab === 'relative'} onClick={() => p.setTab('relative')} icon={<CalendarSync20Regular style={{ width: 14, height: 14 }} />} label="Relative" />
      </div>
      {p.tab === 'manual' ? <ManualTab {...p} /> : <RelativeTab {...p} />}
    </div>
  )
  return createPortal(body, document.body)
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick(): void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        border: 0,
        background: 'transparent',
        padding: '8px 4px 7px',
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: active ? 600 : 400,
        color: active ? FLYOUT_TEXT : FLYOUT_MUTED,
        borderBottom: `2px solid ${active ? PICKER_ACCENT : 'transparent'}`,
        marginBottom: -1
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function ApplyButton({ disabled, onClick }: { disabled?: boolean; onClick(): void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px 10px' }}>
      <button
        className="wbi-picker-apply"
        disabled={disabled}
        onClick={onClick}
        style={{
          border: 0,
          borderRadius: 4,
          minWidth: 62,
          height: 28,
          padding: '0 12px',
          font: 'inherit',
          fontWeight: 600,
          background: disabled ? '#F0F0F0' : PICKER_ACCENT,
          color: disabled ? '#BDBDBD' : '#FFFFFF',
          cursor: disabled ? 'default' : 'pointer'
        }}
      >
        Apply
      </button>
    </div>
  )
}

function ManualTab(p: FlyoutProps) {
  const init: CalendarPick = p.rule?.kind === 'manual' ? { start: p.rule.start, end: p.rule.end } : {}
  const [pick, setPick] = useState<CalendarPick>(init)
  const focusInit = pick.end ?? pick.start ?? p.last
  const [view, setView] = useState(() => ({ y: focusInit.getUTCFullYear(), m: focusInit.getUTCMonth() }))
  const [focusDay, setFocusDay] = useState<Date>(startOfDay(focusInit))
  const grid = useMemo(() => monthGrid(view.y, view.m), [view.y, view.m])
  const today = startOfDay(p.now)
  const move = (dm: number) => setView((v) => ({ y: v.y + Math.floor((v.m + dm) / 12), m: (((v.m + dm) % 12) + 12) % 12 }))
  const show = (d: Date) => setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  const choose = (d: Date) => {
    setPick((cur) => calendarClick(cur, d, p.single))
    setFocusDay(startOfDay(d))
  }
  const onGridKey = (e: ReactKeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in step) {
      e.preventDefault()
      const d = new Date(focusDay.getTime() + step[e.key] * DAY_MS)
      setFocusDay(d)
      show(d)
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      move(e.key === 'PageUp' ? -1 : 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(focusDay)
    }
  }
  const complete = !!pick.start && (p.single || !!pick.end)
  const cell = 32
  const lo = pick.start
  const hi = pick.end ?? pick.start
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 10px 2px' }}>
        <DateField
          label={p.single ? 'Date' : 'Start date'}
          value={pick.start}
          fmtDate={p.fmtDate}
          onCommit={(d) => {
            setPick((cur) => (p.single ? { start: d, end: d } : { start: d, end: cur.end && cur.end >= d ? cur.end : d }))
            show(d)
            setFocusDay(d)
          }}
        />
        {!p.single && (
          <DateField
            label="End date"
            value={pick.end}
            fmtDate={p.fmtDate}
            onCommit={(d) => {
              setPick((cur) => ({ start: cur.start && cur.start <= d ? cur.start : d, end: d }))
              show(d)
              setFocusDay(d)
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 6px 4px 12px' }}>
        <span style={{ flex: 1, fontWeight: 600 }}>{`${MONTHS[view.m]} ${view.y}`}</span>
        <IconButton label="Previous month" onClick={() => move(-1)}>
          <ArrowUp20Regular style={{ width: 16, height: 16 }} />
        </IconButton>
        <IconButton label="Next month" onClick={() => move(1)}>
          <ArrowDown20Regular style={{ width: 16, height: 16 }} />
        </IconButton>
      </div>
      <div role="grid" tabIndex={0} onKeyDown={onGridKey} aria-label={`${MONTHS[view.m]} ${view.y}`} style={{ padding: '0 8px', outline: 'none' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cell}px)`, justifyContent: 'center' }}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.92em' }}>
              {w}
            </div>
          ))}
        </div>
        {grid.map((week, wi) => (
          <div key={wi} role="row" style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cell}px)`, justifyContent: 'center' }}>
            {week.map(({ date, inMonth }) => {
              const isStart = sameDay(date, lo)
              const isEnd = sameDay(date, hi)
              const inBand = !!lo && !!hi && date >= lo && date <= hi && !sameDay(lo, hi)
              const isToday = sameDay(date, today)
              const outside = date < startOfDay(p.first) || date > startOfDay(p.last)
              // PBI: a continuous band across the week rows, rounded only behind the start / end circles
              const bandStyle: CSSProperties = inBand
                ? {
                    background: isStart ? `linear-gradient(to right, transparent 50%, ${PICKER_BAND} 50%)` : isEnd ? `linear-gradient(to left, transparent 50%, ${PICKER_BAND} 50%)` : PICKER_BAND
                  }
                : {}
              const dot = isStart || isEnd
              const focused = sameDay(date, focusDay)
              return (
                <div key={date.getTime()} role="gridcell" aria-selected={inBand || dot} style={{ height: cell, display: 'flex', alignItems: 'center', justifyContent: 'center', ...bandStyle }}>
                  <button
                    className="wbi-picker-day"
                    tabIndex={-1}
                    title={outside ? `${p.fmtDate(date)} (no data)` : p.fmtDate(date)}
                    onClick={() => choose(date)}
                    style={{
                      width: cell - 4,
                      height: cell - 4,
                      borderRadius: '50%',
                      border: isToday && !dot ? `1px solid ${PICKER_ACCENT}` : focused ? '1px dashed #8A8886' : '1px solid transparent',
                      background: dot ? PICKER_ACCENT : 'transparent',
                      color: dot ? '#FFFFFF' : !inMonth ? '#C8C6C4' : outside ? '#8A8886' : FLYOUT_TEXT,
                      fontWeight: isToday || dot ? 600 : 400,
                      font: 'inherit',
                      padding: 0,
                      cursor: 'pointer'
                    }}
                  >
                    {date.getUTCDate()}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '6px 12px 0', fontSize: '0.92em' }}>
        <LinkButton onClick={() => (show(today), setFocusDay(today))}>Today</LinkButton>
        <LinkButton onClick={() => (show(p.first), setFocusDay(startOfDay(p.first)))}>First date</LinkButton>
        <LinkButton onClick={() => (show(p.last), setFocusDay(startOfDay(p.last)))}>Last date</LinkButton>
      </div>
      <ApplyButton disabled={!complete} onClick={() => pick.start && p.onApply({ kind: 'manual', start: pick.start, end: p.single ? pick.start : (pick.end ?? pick.start) })} />
    </div>
  )
}

function DateField({ label, value, fmtDate, onCommit }: { label: string; value: Date | undefined; fmtDate(d: Date): string; onCommit(d: Date): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const text = draft ?? (value ? fmtDate(value) : '')
  const done = () => {
    if (draft === null) return
    const d = parseDateInput(draft)
    if (d) {
      onCommit(d)
      setDraft(null)
      setBad(false)
    } else setBad(draft.trim() !== '')
  }
  return (
    <label style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.92em', color: FLYOUT_MUTED }}>
      {label}
      <input
        className="wbi-slicer-input"
        value={text}
        placeholder="M/D/YYYY"
        aria-invalid={bad}
        onChange={(e) => {
          setDraft(e.target.value)
          setBad(false)
        }}
        onBlur={done}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') done()
          if (e.key === 'Escape') setDraft(null)
        }}
        style={{ font: 'inherit', fontSize: '1.087em', color: FLYOUT_TEXT, height: 26, padding: '0 6px', borderRadius: 4, borderColor: bad ? '#C50F1F' : undefined, outline: 0 }}
      />
    </label>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button className="wbi-picker-icon" aria-label={label} title={label} onClick={onClick} style={{ border: 0, background: 'transparent', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: FLYOUT_MUTED, borderRadius: 4 }}>
      {children}
    </button>
  )
}

function LinkButton({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', color: PICKER_ACCENT, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

const ANCHORS: Array<{ value: PickerAnchor; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'first', label: 'First date' },
  { value: 'last', label: 'Last date' }
]

/**
 * Relative tab, laid out like Microsoft Learn's screenshot (desktop-slicer-filter-date-range):
 * "<Field> is in the [Last ▾]" / "[6] [Months ▾]" / "From [Last date ▾]" / "Offset by [0]" / Apply.
 */
function RelativeTab(p: FlyoutProps) {
  const init: PickerRelative = p.rule?.kind === 'relative' ? p.rule : { kind: 'relative', range: 'last', n: 1, unit: p.single ? 'days' : 'months', calendar: false, anchor: 'today', offset: 0 }
  const [r, setR] = useState<PickerRelative>(p.single ? { ...init, unit: 'days', calendar: false, n: 1 } : init)
  const [nText, setNText] = useState(String(r.n))
  const [offText, setOffText] = useState(r.offset ? String(r.offset) : '0')
  const periods = p.single ? PERIODS.filter((x) => x.unit === 'days') : PERIODS
  const preview = resolvePickerRange(r, { first: p.first, last: p.last }, p.now)
  const ctl: CSSProperties = { font: 'inherit', color: FLYOUT_TEXT, height: 28, borderRadius: 4, minWidth: 0, boxSizing: 'border-box', borderBottomColor: FLYOUT_MUTED }
  const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', minHeight: 32 }
  const lbl: CSSProperties = { flex: 'none', minWidth: 64, color: FLYOUT_TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }
  const unitWord = (periods.find((x) => x.unit === r.unit && x.calendar === r.calendar)?.label ?? 'periods').toLowerCase()
  return (
    <div style={{ padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={row}>
        <span style={lbl} title={`${p.fieldLabel} is in the`}>{`${p.fieldLabel} is in the`}</span>
        <Select value={r.range} style={{ ...ctl, flex: 1, padding: '0 24px 0 8px' }} options={[['last', 'Last'], ['next', 'Next'], ['this', 'This']]} onChange={(v) => setR({ ...r, range: v as PickerRelative['range'] })} />
      </div>
      <div style={row}>
        {r.range !== 'this' && (
          <input
            className="wbi-slicer-input"
            aria-label="Number of periods"
            type="number"
            min={1}
            value={nText}
            disabled={p.single}
            onChange={(e) => {
              const t = e.target.value.replace(/[^0-9]/g, '')
              setNText(t)
              if (Number(t) > 0) setR({ ...r, n: Number(t) })
            }}
            style={{ ...ctl, width: 76, flex: 'none', padding: '0 4px 0 8px' }}
          />
        )}
        <Select
          value={periodOf(r.unit, r.calendar)}
          style={{ ...ctl, flex: 1, padding: '0 24px 0 8px' }}
          options={periods.filter((x) => r.range !== 'this' || !x.calendar).map((x) => [x.value, r.range === 'this' ? x.label.replace(/s$/, '') : x.label])}
          onChange={(v) => {
            const per = PERIODS.find((x) => x.value === v)!
            setR({ ...r, unit: per.unit, calendar: per.calendar })
          }}
        />
      </div>
      <div style={row}>
        <span style={lbl}>From</span>
        <Select value={r.anchor} style={{ ...ctl, flex: 1, padding: '0 24px 0 8px' }} options={ANCHORS.map((a) => [a.value, a.label])} onChange={(v) => setR({ ...r, anchor: v as PickerAnchor })} />
      </div>
      <div style={row}>
        <span style={lbl}>Offset by</span>
        <input
          className="wbi-slicer-input"
          aria-label="Offset"
          value={offText}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '')
            setOffText(t)
            const n = Number(t)
            setR({ ...r, offset: Number.isFinite(n) ? n : 0 })
          }}
          style={{ ...ctl, width: 76, flex: 'none', padding: '0 8px' }}
        />
        <span style={{ color: FLYOUT_MUTED }}>{unitWord}</span>
      </div>
      <div style={{ marginTop: 4, color: FLYOUT_MUTED, fontSize: '0.92em', lineHeight: 1.35 }}>
        {relativeSummary(r)}
        {preview ? <div style={{ color: FLYOUT_TEXT }}>{sameDay(preview.start, preview.end) ? p.fmtDate(preview.start) : `${p.fmtDate(preview.start)} – ${p.fmtDate(preview.end)}`}</div> : null}
      </div>
      <ApplyButton disabled={r.range !== 'this' && !(r.n > 0)} onClick={() => p.onApply(r)} />
    </div>
  )
}

function Select({ value, options, onChange, style }: { value: string; options: Array<[string, string]>; onChange(v: string): void; style?: CSSProperties }) {
  return (
    <span style={{ position: 'relative', display: 'flex', flex: style?.flex, minWidth: 0 }}>
      <select className="wbi-slicer-select" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...style, flex: 1, width: '100%' }}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', right: 7, top: '50%', marginTop: -5, pointerEvents: 'none' }} aria-hidden>
        <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke={FLYOUT_MUTED} strokeWidth="1.1" />
      </svg>
    </span>
  )
}
