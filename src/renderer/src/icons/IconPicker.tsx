/**
 * Icon picker: choose an icon from the built-in libraries (Fluent UI, Phosphor, Tabler, IconPark), its
 * variant (weight / theme), colours (one to three slots, theme colours or hex) and stroke weight.
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
import { ClockRegular, GridRegular, BriefcaseRegular, TagRegular } from '@fluentui/react-icons'
import { BUSINESS_GROUPS, ICON_SETS, curatedAll, curatedIcons, getLoadedIconSet, listIcons, loadIconSets, searchIcons, setCategories, variantsOf } from '@core/icons/registry'
import { buildIconSvg } from '@core/icons/svg'
import { iconKey, iconTitle, refVariant, resolveIconColors, slotColors, themeColor, withVariant } from '@core/icons/ref'
import { ICON_SET_IDS, type IconRef, type IconSetData, type IconSetId } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { useApp } from '../state/store'
import { Button, ColorPicker, Modal, Pivot, SearchBox, Slider, Spinner, cx } from '../app/ui'
import { useIconSet } from './useIconSet'
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

type Category = 'recent' | 'curated' | `curated:${string}` | 'all' | `cat:${string}`

function lastSet(): IconSetId {
  try {
    const v = localStorage.getItem(LAST_SET_KEY)
    return (ICON_SET_IDS as readonly string[]).includes(v ?? '') ? (v as IconSetId) : 'fluent'
  } catch {
    return 'fluent'
  }
}

function rememberSet(set: IconSetId): void {
  try {
    localStorage.setItem(LAST_SET_KEY, set)
  } catch {
    /* ignore */
  }
}

function defaultRef(set: IconSetId): Omit<IconRef, 'name'> {
  return { set, variant: ICON_SETS[set].defaultVariant }
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
  // style per set (variant, colours, stroke), so switching tabs back and forth keeps each set's choice
  const [styles, setStyles] = useState<Record<IconSetId, Omit<IconRef, 'name'>>>(() => {
    const s = Object.fromEntries(ICON_SET_IDS.map((id) => [id, defaultRef(id)])) as Record<IconSetId, Omit<IconRef, 'name'>>
    if (initial) s[initial.set] = { set: initial.set, variant: initial.variant, colors: initial.colors, strokeWidth: initial.strokeWidth, padding: initial.padding }
    return s
  })
  const [name, setName] = useState<string | undefined>(initial?.name)
  const [category, setCategory] = useState<Category>(initial ? 'all' : 'curated')
  const [query, setQuery] = useState('')
  const recent = useMemo(() => readRecentIcons(), [])
  const style = styles[set]
  const data = useIconSet(set)
  const variant = refVariant({ ...style, name: '' })
  // an icon is only offered in the styles it is drawn in (e.g. not every Fluent icon has a Color version)
  const current: IconRef | undefined = name && (!data || variantsOf(data, name).includes(style.variant)) ? { ...style, name } : undefined

  // a search looks in every library: load them all once the user types
  const [allLoaded, setAllLoaded] = useState(false)
  useEffect(() => {
    if (!query || allLoaded) return
    loadIconSets(ICON_SET_IDS).then(() => setAllLoaded(true), () => undefined)
  }, [query, allLoaded])

  useEffect(() => rememberSet(set), [set])

  const setStyle = (patch: Partial<Omit<IconRef, 'name'>>) => setStyles((s) => ({ ...s, [set]: { ...s[set], ...patch } }))
  const changeSet = (next: IconSetId) => {
    // colours carry over slot by slot to the other library
    setStyles((s) => ({ ...s, [next]: { ...s[next], colors: s[next].colors ?? styles[set].colors } }))
    setSet(next)
    if (name && !getLoadedIconSet(next)?.icons[name]) setName(undefined)
    if (category.startsWith('cat:')) setCategory('curated')
  }

  // the icons of the grid
  const items: IconRef[] = useMemo(() => {
    if (category === 'recent' && !query) return recent
    if (!data) return []
    let names: string[]
    if (query) names = searchIcons(data, query, { variant: style.variant })
    else if (category === 'all') names = listIcons(data, style.variant).map((i) => i.name)
    else if (category === 'curated') names = curatedAll(data)
    else if (category.startsWith('curated:')) names = curatedIcons(data)[category.slice('curated:'.length)] ?? []
    else if (category.startsWith('cat:')) names = setCategories(data).find((c) => c.id === category)?.names ?? []
    else names = []
    if (!query && style.variant) {
      const avail = (n: string) => variantsOf(data, n).includes(style.variant)
      names = names.filter(avail)
    }
    return names.map((n) => ({ ...style, name: n }))
  }, [category, query, data, style, recent])

  const counts = useMemo(() => {
    if (!query) return undefined
    const out: Partial<Record<IconSetId, number>> = {}
    for (const id of ICON_SET_IDS) {
      const d = getLoadedIconSet(id)
      if (d) out[id] = searchIcons(d, query, { variant: styles[id].variant }).length
    }
    return out
  }, [query, styles, allLoaded])

  const choose = (ref: IconRef | undefined) => {
    if (ref) onDone(ref)
  }
  const pickItem = (ref: IconRef) => {
    if (ref.set !== set) setSet(ref.set)
    setStyles((s) => ({ ...s, [ref.set]: { set: ref.set, variant: ref.variant, colors: ref.colors, strokeWidth: ref.strokeWidth, padding: ref.padding } }))
    setName(ref.name)
  }

  const groups = data ? curatedIcons(data) : undefined
  const setCats = data ? setCategories(data) : []

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
          {ICON_SETS[set].label} icons · {ICON_SETS[set].author} · {ICON_SETS[set].license} licence
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
          <CatButton cur={category} id="curated" disabled={!!query} icon={<BriefcaseRegular />} label="Business & dashboards" onPick={setCategory} />
          {BUSINESS_GROUPS.map((g) => (
            <CatButton key={g.id} cur={category} id={`curated:${g.id}`} disabled={!!query} label={`${g.label}${groups ? ` (${groups[g.id].length})` : ''}`} onPick={setCategory} indent />
          ))}
          <CatButton cur={category} id="all" disabled={!!query} icon={<GridRegular />} label={`All ${ICON_SETS[set].label} icons`} onPick={setCategory} />
          {setCats.length > 0 && <div className="wbi-iconpicker__catgroup">{ICON_SETS[set].label} categories</div>}
          {setCats.map((c) => (
            <CatButton key={c.id} cur={category} id={c.id as Category} disabled={!!query} icon={<TagRegular />} label={`${c.label} (${c.names.length})`} onPick={setCategory} indent />
          ))}
        </nav>
        <div className="wbi-iconpicker__gridwrap">
          {!data && category !== 'recent' ? (
            <div className="wbi-iconpicker__empty">
              <Spinner label={`Loading ${ICON_SETS[set].label} icons…`} />
            </div>
          ) : items.length === 0 ? (
            <div className="wbi-iconpicker__empty">{query ? `No ${ICON_SETS[set].label} icons match “${query}” in the ${variant.label} style.` : category === 'recent' ? 'Icons you insert show up here.' : 'No icons in this category.'}</div>
          ) : (
            <IconGrid items={items} selected={current} theme={theme} onSelect={pickItem} onChoose={(r) => choose(r)} />
          )}
        </div>
        <aside className="wbi-iconpicker__side" aria-label="Icon options">
          <Preview icon={current} theme={theme} />
          <div className="wbi-iconpicker__name" aria-live="polite">
            {current ? iconTitle(current.name) : 'Select an icon'}
          </div>
          <div className="wbi-iconpicker__sub">{current ? `${ICON_SETS[set].label} · ${variant.label}` : `${data ? Object.keys(data.icons).length.toLocaleString() : '…'} ${ICON_SETS[set].label} icons`}</div>
          <StyleControls set={set} style={style} name={name} data={data} theme={theme} onChange={setStyle} />
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

/** Variant, colours and stroke weight of the current style. */
export function StyleControls({ set, style, name, data, theme, onChange, compact }: { set: IconSetId; style: Omit<IconRef, 'name'>; name?: string; data?: IconSetData; theme: ResolvedTheme; onChange(patch: Partial<IconRef>): void; compact?: boolean }) {
  const spec = refVariant({ ...style, name: '' })
  const avail = name && data ? variantsOf(data, name) : undefined
  const hex = resolveIconColors({ ...style, name: '' }, theme)
  const stored = slotColors({ ...style, name: '' })
  return (
    <div className={cx('wbi-iconpicker__controls', compact && 'is-compact')}>
      <div className="wbi-iconpicker__label" id={`ivar-${set}`}>
        Style
      </div>
      <div className="wbi-iconpicker__variants" role="radiogroup" aria-labelledby={`ivar-${set}`}>
        {ICON_SETS[set].variants.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === spec.id}
            className={cx('wbi-iconpicker__chip', v.id === spec.id && 'is-on')}
            disabled={!!avail && !avail.includes(v.id)}
            title={avail && !avail.includes(v.id) ? `${v.label}: not drawn for this icon` : v.label}
            onClick={() => onChange(withVariant({ ...style, name: name ?? '' }, v.id))}
          >
            {v.label}
          </button>
        ))}
      </div>
      {spec.slots.length > 0 && (
        <div className="wbi-iconpicker__colors">
          {spec.slots.map((s, i) => (
            <ColorPicker
              key={`${spec.id}-${i}`}
              label={s.label}
              value={hex[i]}
              themeColors={theme}
              onChange={(h, t) => {
                const colors = [...(style.colors ?? [])]
                while (colors.length < spec.slots.length) colors.push(null)
                colors[i] = t ? themeColor(t.colorId, t.percent) : h.toUpperCase()
                onChange({ colors })
              }}
              onReset={typeof stored[i] === 'string' && style.colors?.[i] ? () => onChange({ colors: (style.colors ?? []).map((c, j) => (j === i ? null : c)) }) : undefined}
              emptyTitle="Default"
            />
          ))}
        </div>
      )}
      {spec.slots.length === 0 && <div className="wbi-muted wbi-iconpicker__note">This style uses the icon's own colors.</div>}
      {spec.stroke && (
        <div className="wbi-iconpicker__stroke">
          <div className="wbi-iconpicker__label">Stroke weight</div>
          <Slider value={style.strokeWidth ?? spec.stroke.default} min={spec.stroke.min} max={spec.stroke.max} step={spec.stroke.step} onChange={(w) => onChange({ strokeWidth: w })} />
        </div>
      )}
    </div>
  )
}

function Preview({ icon, theme }: { icon?: IconRef; theme: ResolvedTheme }) {
  const data = useIconSet(icon?.set)
  const svg = (prefix: string) => (icon && data ? buildIconSvg(data, icon, theme, { size: '100%', idPrefix: prefix }) : undefined)
  return (
    <div className="wbi-iconpicker__preview" aria-hidden="true">
      {(['light', 'dark'] as const).map((bg) => {
        const s = svg(`pv-${bg}-`)
        return (
          <div key={bg} className={cx('wbi-iconpicker__tile', `is-${bg}`)} title={bg === 'light' ? 'On a light background' : 'On a dark background'}>
            {s ? <span className="wbi-iconpicker__tileglyph" dangerouslySetInnerHTML={{ __html: s }} /> : null}
          </div>
        )
      })}
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
              return <Cell key={iconKey(it) + it.set} item={it} index={i} theme={theme} on={iconKey(it) === selKey} tabbable={i === active} onClick={() => { setActive(i); onSelect(it) }} onDouble={() => onChoose(it)} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Cell({ item, index, theme, on, tabbable, onClick, onDouble }: { item: IconRef; index: number; theme: ResolvedTheme; on: boolean; tabbable: boolean; onClick(): void; onDouble(): void }) {
  const data = useIconSet(item.set)
  const svg = data ? buildIconSvg(data, item, theme, { size: '100%', idPrefix: `g${index}-` }) : undefined
  const label = `${iconTitle(item.name)}, ${ICON_SETS[item.set].label}`
  return (
    <button
      type="button"
      role="gridcell"
      data-i={index}
      data-icon={`${item.set}:${item.name}`}
      aria-label={label}
      aria-selected={on}
      title={iconTitle(item.name)}
      tabIndex={tabbable ? 0 : -1}
      className={cx('wbi-iconpicker__cell', on && 'is-on')}
      onClick={onClick}
      onDoubleClick={onDouble}
    >
      <span className="wbi-iconpicker__glyph" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
    </button>
  )
}
