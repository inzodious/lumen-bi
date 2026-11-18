/**
 * Icon picker: choose an icon from the built-in sets (Lucide, Fluent Color), with the Lucide colour (theme colour or
 * hex) and stroke width. Fluent Color icons are fixed artwork (no colour controls).
 *
 * Reusable: `openIconPicker({ initial })` resolves with the chosen IconRef (or null). Used by Insert ▸ Icon,
 * the image visual and the card image slots (Format pane, IconSourceRows). Hosted once by DialogsHost.
 *
 * Keyboard: Tab (or Down arrow from the search box) into the grid, arrow keys / Home / End / Page Up / Page Down move,
 * Enter chooses, Escape closes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ClockRegular, GridRegular, BriefcaseRegular } from '@fluentui/react-icons'
import { BUSINESS_GROUPS, curatedAll, curatedIcons, curatedInGroupOrder } from '@core/icons/curated'
import { ICON_SETS } from '@core/icons/sets'
import { iconColorValue, iconKey, iconTitle, refStrokeWidth, resolveRefColor, themeColor } from '@core/icons/ref'
import { ICON_SET_IDS, type IconRef, type IconSetId } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { useApp } from '../state/store'
import { Button, ColorPicker, Modal, Pivot, SearchBox, Slider, Spinner, cx } from '../app/ui'
import { useIconSet } from './useIconSet'
import { getLoadedIconSet, loadIconSets, searchIcons } from './registry'
import { IconGlyph } from './IconGlyph'
import { pushRecentIcon, readRecentIcons } from './recent'
import './icons.css'

// ---------------------------------------------------------------------------------------------
// Imperative API + host
// ---------------------------------------------------------------------------------------------

export interface IconPickerOptions {
  initial?: IconRef
  title?: string
  confirmLabel?: string
}

interface Request extends IconPickerOptions {
  id: number
  resolve(ref: IconRef | null): void
}

const usePicker = create<{ req: Request | null }>(() => ({ req: null }))
let nextId = 1

/** Open the icon picker; resolves with the chosen icon, or null when cancelled. */
export function openIconPicker(opts: IconPickerOptions = {}): Promise<IconRef | null> {
  usePicker.getState().req?.resolve(null)
  return new Promise((resolve) => usePicker.setState({ req: { ...opts, id: nextId++, resolve } }))
}

export function IconPickerHost() {
  const req = usePicker((s) => s.req)
  if (!req) return null
  const done = (ref: IconRef | null) => {
    usePicker.setState({ req: null })
    if (ref) pushRecentIcon(ref)
    req.resolve(ref)
  }
  return <IconPickerDialog key={req.id} initial={req.initial} title={req.title ?? 'Insert icon'} confirmLabel={req.confirmLabel ?? 'Insert'} onDone={done} />
}

// ---------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------

const CELL = 48
const LAST_SET_KEY = 'lumen.iconPicker.set'

type Category = 'recent' | 'curated' | `curated:${string}` | 'all'
/** The style part of a reference (what the controls edit), per set. */
type IconStyle = Omit<IconRef, 'name'>

function lastSet(): IconSetId {
  try {
    const v = localStorage.getItem(LAST_SET_KEY)
    return (ICON_SET_IDS as readonly string[]).includes(v ?? '') ? (v as IconSetId) : 'lucide'
  } catch {
    return 'lucide'
  }
}

function rememberSet(set: IconSetId): void {
  try {
    localStorage.setItem(LAST_SET_KEY, set)
  } catch {
    /* ignore */
  }
}

interface DialogProps {
  initial?: IconRef
  title: string
  confirmLabel: string
  onDone(ref: IconRef | null): void
}

function IconPickerDialog({ initial, title, confirmLabel, onDone }: DialogProps) {
  const theme = useApp((s) => s.theme)
  const [set, setSet] = useState<IconSetId>(initial?.set ?? lastSet())
  // style per set, so switching tabs back and forth keeps each set's choice
  const [styles, setStyles] = useState<Record<IconSetId, IconStyle>>(() => {
    const s = Object.fromEntries(ICON_SET_IDS.map((id) => [id, { set: id }])) as Record<IconSetId, IconStyle>
    if (initial) s[initial.set] = { set: initial.set, color: initial.color, strokeWidth: initial.strokeWidth, padding: initial.padding }
    return s
  })
  const [name, setName] = useState<string | undefined>(initial?.name)
  const [category, setCategory] = useState<Category>(initial ? 'all' : 'curated')
  const [query, setQuery] = useState('')
  const recent = useMemo(() => readRecentIcons(), [])
  const style = styles[set]
  const data = useIconSet(set)
  const current: IconRef | undefined = name && (!data || data.components.has(name)) ? { ...style, name } : undefined
  const spec = ICON_SETS[set]

  // a search looks in every set (the tab labels show the counts): load them all once the user types
  const [allLoaded, setAllLoaded] = useState(false)
  useEffect(() => {
    if (!query || allLoaded) return
    loadIconSets(ICON_SET_IDS).then(() => setAllLoaded(true), () => undefined)
  }, [query, allLoaded])

  useEffect(() => rememberSet(set), [set])

  const setStyle = (patch: Partial<IconStyle>) => setStyles((s) => ({ ...s, [set]: { ...s[set], ...patch } }))
  const changeSet = (next: IconSetId) => {
    setSet(next)
    if (name && !getLoadedIconSet(next)?.components.has(name)) setName(undefined)
  }

  // the icons of the grid
  const items: IconRef[] = useMemo(() => {
    if (category === 'recent' && !query) return recent
    if (!data) return []
    let names: readonly string[]
    if (query) names = searchIcons(data, query)
    else if (category === 'all') names = data.names
    else if (category === 'curated') names = curatedInGroupOrder(data.names)
    else if (category.startsWith('curated:')) names = curatedIcons(data.names)[category.slice('curated:'.length)] ?? []
    else names = []
    return names.map((n) => ({ ...style, name: n }))
  }, [category, query, data, style, recent])

  const counts = useMemo(() => {
    if (!query) return undefined
    const out: Partial<Record<IconSetId, number>> = {}
    for (const id of ICON_SET_IDS) {
      const d = getLoadedIconSet(id)
      if (d) out[id] = searchIcons(d, query).length
    }
    return out
    // allLoaded: recount once every set is in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, allLoaded])

  const choose = (ref: IconRef | undefined) => {
    if (ref) onDone(ref)
  }
  const pickItem = (ref: IconRef) => {
    if (ref.set !== set) setSet(ref.set)
    setStyles((s) => ({ ...s, [ref.set]: { set: ref.set, color: ref.color, strokeWidth: ref.strokeWidth, padding: ref.padding } }))
    setName(ref.name)
  }

  const groups = data ? curatedIcons(data.names) : undefined
  const curatedCount = data ? curatedAll(data.names).length : undefined

  return (
    <Modal
      title={title}
      onClose={() => onDone(null)}
      width={980}
      height={640}
      className="wbi-iconpicker"
      bodyClassName="wbi-iconpicker__body"
      footerLeft={
        <span className="wbi-iconpicker__credit">
          {spec.label} icons · {spec.author} · {spec.license} licence
        </span>
      }
      footer={
        <>
          <Button variant="primary" disabled={!current} onClick={() => choose(current)}>
            {confirmLabel}
          </Button>
          <Button onClick={() => onDone(null)}>Cancel</Button>
        </>
      }
    >
      <div
        className="wbi-iconpicker__top"
        onKeyDown={(e) => {
          // from the search box, Down arrow moves into the grid (to the current icon)
          if (e.key !== 'ArrowDown' || (e.target as HTMLElement).tagName !== 'INPUT') return
          const cell = (e.currentTarget.parentElement?.querySelector('.wbi-iconpicker__cell[tabindex="0"]') ?? null) as HTMLButtonElement | null
          if (cell) {
            e.preventDefault()
            cell.focus()
          }
        }}
      >
        <Pivot
          className="wbi-iconpicker__sets"
          tabs={ICON_SET_IDS.map((id) => ({ key: id, label: counts ? `${ICON_SETS[id].label} (${counts[id] ?? '…'})` : ICON_SETS[id].label }))}
          value={set}
          onChange={changeSet}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Search icons" autoFocus className="wbi-iconpicker__search" />
      </div>
      <div className="wbi-iconpicker__main">
        <nav className="wbi-iconpicker__cats" aria-label="Icon categories">
          <CatButton cur={category} id="recent" disabled={!!query} icon={<ClockRegular />} label={`Recently used (${recent.length})`} onPick={setCategory} />
          <CatButton cur={category} id="curated" disabled={!!query} icon={<BriefcaseRegular />} label={`Business & dashboards${curatedCount !== undefined ? ` (${curatedCount})` : ''}`} onPick={setCategory} />
          {BUSINESS_GROUPS.map((g) => {
            const n = groups?.[g.id].length
            if (n === 0) return null
            return <CatButton key={g.id} cur={category} id={`curated:${g.id}`} disabled={!!query} label={`${g.label}${n !== undefined ? ` (${n})` : ''}`} onPick={setCategory} indent />
          })}
          <CatButton cur={category} id="all" disabled={!!query} icon={<GridRegular />} label={`All ${spec.label} icons${data ? ` (${data.names.length.toLocaleString()})` : ''}`} onPick={setCategory} />
        </nav>
        <div className="wbi-iconpicker__gridwrap">
          {!data && category !== 'recent' ? (
            <div className="wbi-iconpicker__empty">
              <Spinner label={`Loading ${spec.label} icons…`} />
            </div>
          ) : items.length === 0 ? (
            <div className="wbi-iconpicker__empty">{query ? `No ${spec.label} icons match “${query}”.` : category === 'recent' ? 'Icons you insert show up here.' : 'No icons in this category.'}</div>
          ) : (
            <IconGrid items={items} selected={current} theme={theme} onSelect={pickItem} onChoose={(r) => choose(r)} />
          )}
        </div>
        <aside className="wbi-iconpicker__side" aria-label="Icon options">
          <Preview icon={current} theme={theme} />
          <div className="wbi-iconpicker__name" aria-live="polite">
            {current ? iconTitle(current.name) : 'Select an icon'}
          </div>
          <div className="wbi-iconpicker__sub">{current ? spec.label : `${data ? data.names.length.toLocaleString() : '…'} ${spec.label} icons`}</div>
          <StyleControls style={style} theme={theme} onChange={setStyle} />
        </aside>
      </div>
    </Modal>
  )
}

function CatButton({ cur, id, label, icon, onPick, indent, disabled }: { cur: Category; id: Category; label: string; icon?: React.ReactNode; onPick(c: Category): void; indent?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={cx('wbi-iconpicker__cat', indent && 'is-indent', cur === id && !disabled && 'is-active')} aria-current={cur === id && !disabled ? 'true' : undefined} disabled={disabled} onClick={() => onPick(id)} title={label}>
      {icon && <span className="wbi-iconpicker__caticon">{icon}</span>}
      <span className="wbi-iconpicker__catlabel">{label}</span>
    </button>
  )
}

/** Colour and stroke width of a single-colour set; a note for fixed-colour sets. */
export function StyleControls({ style, theme, onChange, compact }: { style: IconStyle; theme: ResolvedTheme; onChange(patch: Partial<IconRef>): void; compact?: boolean }) {
  const spec = ICON_SETS[style.set]
  const probe: IconRef = { ...style, name: '' }
  return (
    <div className={cx('wbi-iconpicker__controls', compact && 'is-compact')}>
      {spec.colorable ? (
        <div className="wbi-iconpicker__colors">
          <ColorPicker
            label="Color"
            value={resolveRefColor(probe, theme)}
            themeColors={theme}
            onChange={(h, t) => onChange({ color: t ? themeColor(t.colorId, t.percent) : h.toUpperCase() })}
            onReset={style.color && style.color !== iconColorValue({ set: style.set, name: '' }) ? () => onChange({ color: undefined }) : undefined}
            emptyTitle="Default"
          />
        </div>
      ) : (
        <div className="wbi-muted wbi-iconpicker__note">{spec.label} icons keep their own colors.</div>
      )}
      {spec.stroke && (
        <div className="wbi-iconpicker__stroke">
          <div className="wbi-iconpicker__label">Stroke width</div>
          <Slider value={refStrokeWidth(probe) ?? spec.stroke.default} min={spec.stroke.min} max={spec.stroke.max} step={spec.stroke.step} onChange={(w) => onChange({ strokeWidth: w })} />
        </div>
      )}
    </div>
  )
}

function Preview({ icon, theme }: { icon?: IconRef; theme: ResolvedTheme }) {
  return (
    <div className="wbi-iconpicker__preview" aria-hidden="true">
      {(['light', 'dark'] as const).map((bg) => (
        <div key={bg} className={cx('wbi-iconpicker__tile', `is-${bg}`)} title={bg === 'light' ? 'On a light background' : 'On a dark background'}>
          {icon ? <IconGlyph icon={icon} theme={theme} size={64} /> : null}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Virtualised grid with roving focus
// ---------------------------------------------------------------------------------------------

function IconGrid({ items, selected, theme, onSelect, onChoose }: { items: IconRef[]; selected?: IconRef; theme: ResolvedTheme; onSelect(r: IconRef): void; onChoose(r: IconRef): void }) {
  const scroll = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = scroll.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const cols = Math.max(1, Math.floor((width - 8) / CELL))
  const rows = Math.ceil(items.length / cols)
  const rv = useVirtualizer({ count: rows, getScrollElement: () => scroll.current, estimateSize: () => CELL, overscan: 4 })
  const selKey = selected ? iconKey(selected) : undefined
  const selIndex = selected ? items.findIndex((i) => i.set === selected.set && i.name === selected.name) : -1
  const [active, setActive] = useState(Math.max(0, selIndex))
  const focusWanted = useRef(false)
  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1))
  }, [items.length, active])
  // keep the selected icon in view when the grid opens on it
  useEffect(() => {
    if (selIndex >= 0) rv.scrollToIndex(Math.floor(selIndex / cols), { align: 'center' })
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!focusWanted.current) return
    focusWanted.current = false
    scroll.current?.querySelector<HTMLButtonElement>(`[data-i="${active}"]`)?.focus()
  })
  const move = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i))
    setActive(n)
    focusWanted.current = true
    rv.scrollToIndex(Math.floor(n / cols))
    onSelect(items[n])
  }
  const onKey = (e: React.KeyboardEvent) => {
    const page = cols * Math.max(1, Math.floor((scroll.current?.clientHeight ?? 300) / CELL) - 1)
    const k: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, PageDown: page, PageUp: -page }
    if (e.key in k) {
      e.preventDefault()
      move(active + k[e.key])
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(items.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (items[active]) onChoose(items[active])
    }
  }
  return (
    <div ref={scroll} className="wbi-iconpicker__grid" role="grid" aria-label="Icons" aria-rowcount={rows} aria-colcount={cols} onKeyDown={onKey}>
      <div style={{ height: rv.getTotalSize(), position: 'relative' }}>
        {rv.getVirtualItems().map((row) => (
          <div key={row.key} role="row" aria-rowindex={row.index + 1} className="wbi-iconpicker__row" style={{ transform: `translateY(${row.start}px)`, height: CELL }}>
            {items.slice(row.index * cols, row.index * cols + cols).map((it, c) => {
              const i = row.index * cols + c
              return (
                <Cell
                  key={iconKey(it)}
                  item={it}
                  index={i}
                  theme={theme}
                  on={iconKey(it) === selKey}
                  tabbable={i === active}
                  onClick={() => {
                    setActive(i)
                    onSelect(it)
                  }}
                  onDouble={() => onChoose(it)}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Cell({ item, index, theme, on, tabbable, onClick, onDouble }: { item: IconRef; index: number; theme: ResolvedTheme; on: boolean; tabbable: boolean; onClick(): void; onDouble(): void }) {
  const label = `${iconTitle(item.name)}, ${ICON_SETS[item.set].label}`
  return (
    <button
      type="button"
      role="gridcell"
      data-i={index}
      data-icon={iconKey(item)}
      aria-label={label}
      aria-selected={on}
      title={iconTitle(item.name)}
      tabIndex={tabbable ? 0 : -1}
      className={cx('wbi-iconpicker__cell', on && 'is-on')}
      onClick={onClick}
      onDoubleClick={onDouble}
    >
      <IconGlyph icon={item} theme={theme} size={28} className="wbi-iconpicker__glyph" />
    </button>
  )
}
