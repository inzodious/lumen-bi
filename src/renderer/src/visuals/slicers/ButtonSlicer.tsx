/**
 * Button slicer (`advancedSlicerVisual`): one button per field value in a horizontal / vertical / grid
 * arrangement with Fit to space or fixed button size, continuous scroll or pagination, per-state
 * formatting (default / hover / press / selected), images, accent bar, selection icon, the Label
 * (`Data`) measure under the value, dimmed items without data under a cross-highlight, Select all,
 * Single select (+Ctrl) / Force selection, Show selected first, paste-to-select and keyboard support.
 * Formatting model: ./buttonSlicerModel.ts.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { VisualProps } from '../contract'
import { getProjections } from '../common/query'
import { fontStyle, ptToPx } from '../common/textStyle'
import { buttonPosition, layoutButtons, parsePastedValues, readButtonSlicerFormat, type ButtonState, type ButtonStateStyle } from './buttonSlicerModel'
import { listFilter, parseListFilter } from './filterModel'
import { ChevronRight } from './icons'
import { clickItem, clickSelectAll, isEmptySelection, itemSelected, selectAllState, selectOnly, type ListState } from './listLogic'
import { matchPasted, moveFocus, orderItems } from './listOptions'
import { applyUpdate } from './ListSlicer'
import { SlicerMessage, SlicerStyle } from './SlicerChrome'
import { currentFilter, itemKey, keyFieldFor, loadListItems, slicerProjections } from './slicerData'
import { readSlicerFormat } from './slicerFormat'

const ALL_KEY = '__all__'

export function ButtonSlicerVisual({ visual, ctx, width, height }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => readSlicerFormat(json, ctx.theme), [json, ctx.theme])
  const bf = useMemo(() => readButtonSlicerFormat(json, ctx.theme), [json, ctx.theme])
  const proj = slicerProjections(json)[0]
  const roles = getProjections(json)
  const valueProj = (roles.Values ?? []).find((p) => p.isMeasure) ?? (roles.Data ?? roles.Label ?? [])[0]
  const filter = currentFilter(json, ctx)
  const [hover, setHover] = useState<string | null>(null)
  const [press, setPress] = useState<string | null>(null)
  const [focus, setFocus] = useState(-1)
  const [page, setPage] = useState(0)
  const filtersKey = JSON.stringify(ctx.filters)
  const hlKey = JSON.stringify(ctx.highlightFilters ?? [])
  const keyField = proj ? parseListFilter(filter, proj.expr)?.keyField ?? keyFieldFor(ctx.engine, proj.expr) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => (proj ? loadListItems(ctx, proj.expr, '', keyField) : undefined), [ctx.engine, filtersKey, proj && JSON.stringify(proj.expr), JSON.stringify(keyField)])
  // Label measure (formatted) per item
  const labels = useMemo(() => {
    if (!proj || !valueProj || !data) return undefined
    try {
      const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: proj.expr }, filters: ctx.filters, withMeasure: { kind: 'sq', expr: valueProj.expr } })
      const d = ctx.engine.describeField(valueProj.expr)
      return new Map(r.values.map((v, i) => [itemKey(v), ctx.format(r.measures?.[i] ?? null, d?.formatString, d?.dataType)]))
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.engine, filtersKey, proj && JSON.stringify(proj.expr), valueProj && JSON.stringify(valueProj.expr), data])
  // cross-highlight: items without data under the other visual's selection are dimmed (PBI highlight behavior)
  const enabled = useMemo(() => {
    if (!proj || !ctx.highlightFilters?.length) return undefined
    try {
      const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: proj.expr }, filters: [...ctx.filters, ...ctx.highlightFilters] })
      return new Set(r.values.map(itemKey))
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.engine, filtersKey, hlKey, proj && JSON.stringify(proj.expr)])
  // images per item from a column (image.field)
  const images = useMemo(() => {
    if (!proj || !bf.image.show || bf.image.source !== 'field' || !bf.image.field) return undefined
    try {
      const r = ctx.engine.summarize({ groupBy: [{ kind: 'sq', expr: proj.expr }, { kind: 'sq', expr: bf.image.field }], values: [], filters: ctx.filters })
      return new Map(r.rows.map((row) => [itemKey(row[0]), row[1] == null ? undefined : String(row[1])]))
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.engine, filtersKey, proj && JSON.stringify(proj.expr), bf.image.show, bf.image.source, JSON.stringify(bf.image.field)])

  const st: ListState | undefined = proj ? { field: proj.expr, filter, inverted: fmt.inverted, keyField } : undefined
  // New slicers: "Single select" = PBI `singleSelect` (click replaces, Ctrl adds), "Force selection" = `strictSingleSelect`
  const force = fmt.selection.strictSingle || fmt.ext.forceSelection
  const opts = (ctrl: boolean) => ({ ctrl, ctrlMulti: fmt.selection.ctrlMulti, strictSingle: fmt.selection.strictSingle, force })
  const items = useMemo(() => {
    if (!st || !data) return []
    return orderItems(
      data.items.map((it) => ({ it, value: it.value, text: it.text, selected: itemSelected(st, it.key, it.value) })),
      { pbiSort: fmt.sort, sort: fmt.ext.sort, selectedFirst: fmt.ext.selectedFirst }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, JSON.stringify(filter), fmt.inverted, fmt.sort, fmt.ext.sort, fmt.ext.selectedFirst])

  // Force selection: an empty slicer selects its first item (like PBI when the option is turned on)
  const first = items[0]?.it
  useEffect(() => {
    if (!st || !first || !force) return
    if (!isEmptySelection({ filter, inverted: fmt.inverted })) return
    applyUpdate(ctx, fmt, selectOnly(st, first.key, first.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force, first && itemKey(first.value), !!filter, fmt.inverted])

  if (!proj) return <SlicerMessage text="Add a field to the slicer" font={fmt.items.font} />
  if (data?.error) return <SlicerMessage text={data.error} font={fmt.items.font} />

  const showAll = fmt.selection.selectAll && !fmt.selection.strictSingle && items.length > 0
  const entries: Array<{ key: string; text: string; label?: string; selected: boolean; disabled: boolean; img?: string; onClick(ctrl: boolean): void }> = []
  if (showAll && st) {
    const s = selectAllState(st, items.map((i) => i.it.key), items.map((i) => i.it.value))
    entries.push({ key: ALL_KEY, text: 'Select all', selected: s === 'on', disabled: false, onClick: () => applyUpdate(ctx, fmt, clickSelectAll(st, force)) })
  }
  for (const o of items) {
    const k = itemKey(o.it.value)
    entries.push({
      key: k,
      text: o.it.text,
      label: labels?.get(k),
      selected: o.selected,
      disabled: !!enabled && !enabled.has(k),
      img: !bf.image.show ? undefined : bf.image.source === 'field' ? images?.get(k) : bf.image.source === 'image' && bf.image.resource ? ctx.report.resolveImage(bf.image.resource) : bf.image.url,
      onClick: (ctrl) => st && applyUpdate(ctx, fmt, clickItem(st, o.it.key, o.it.value, opts(ctrl)))
    })
  }

  const inner = { w: Math.max(1, width - 2), h: Math.max(1, height - 2) }
  const paginate = bf.overflow === 'paginate'
  const navH = paginate ? 22 : 0
  const valueLine = Math.ceil(ptToPx(bf.states.default.valueFont.size) * 1.36)
  const labelLine = labels ? Math.ceil(ptToPx(bf.states.default.labelFont.size) * 1.36) : 0
  const minCellH = valueLine + labelLine + bf.padding.top + bf.padding.bottom + 4
  const grid = layoutButtons(entries.length, inner.w, inner.h - navH, bf, minCellH)
  const pageCount = paginate ? grid.pages : 1
  const curPage = Math.min(page, pageCount - 1)

  const onKey = (e: React.KeyboardEvent) => {
    const keys: Record<string, string> = { ArrowRight: 'ArrowDown', ArrowLeft: 'ArrowUp' }
    const k = keys[e.key] ?? e.key
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(k)) {
      e.preventDefault()
      const step = grid.cols > 1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp') ? grid.cols : 1
      let next = moveFocus(focus, k, entries.length, grid.perPage)
      if (step > 1 && focus >= 0) next = Math.max(0, Math.min(entries.length - 1, focus + (e.key === 'ArrowDown' ? step : -step)))
      setFocus(next)
      if (paginate && next >= 0) setPage(Math.floor(next / grid.perPage))
    } else if ((e.key === ' ' || e.key === 'Enter') && entries[focus]) {
      e.preventDefault()
      entries[focus].onClick(e.ctrlKey || e.metaKey)
    }
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (!st) return
    const lines = parsePastedValues(e.clipboardData.getData('text/plain')).map((l) => l[0])
    const hit = matchPasted(lines, items.map((i) => ({ ...i.it, text: i.it.text })))
    if (!hit.length) return
    e.preventDefault()
    const keys = fmt.selection.strictSingle ? hit.slice(0, 1) : hit
    applyUpdate(ctx, fmt, {
      filter: listFilter(st.field, { mode: 'include', values: keys.map((h) => h.key), keyField, labels: keyField ? keys.map((h) => h.value) : undefined }),
      inverted: false
    })
  }

  const renderButton = (en: (typeof entries)[number], i: number) => {
    const state: ButtonState = en.disabled ? 'disabled' : press === en.key ? 'press' : en.selected ? 'selected' : hover === en.key ? 'hover' : 'default'
    const s = bf.states[state]
    const pos = buttonPosition(i, grid, bf)
    if (paginate && pos.page !== curPage) return null
    return (
      <Button
        key={en.key}
        s={s}
        en={en}
        focused={i === focus}
        style={{ position: 'absolute', left: pos.x, top: pos.y, width: grid.cellW, height: grid.cellH }}
        bf={bf}
        onEnter={() => setHover(en.key)}
        onLeave={() => {
          setHover(null)
          setPress(null)
        }}
        onDown={() => setPress(en.key)}
        onUp={() => setPress(null)}
      />
    )
  }

  const content = paginate ? { w: inner.w, h: inner.h - navH } : { w: grid.contentW, h: grid.contentH }
  return (
    <div className="wbi-slicer-root" tabIndex={0} role="listbox" aria-multiselectable={!fmt.selection.strictSingle} onKeyDown={onKey} onPaste={onPaste} onBlur={() => setFocus(-1)}>
      <SlicerStyle />
      <div className={paginate ? undefined : 'wbi-slicer-scroll'} style={{ flex: 1, minHeight: 0, overflowX: paginate || content.w <= inner.w + 1 ? 'hidden' : 'auto', overflowY: paginate || content.h <= inner.h + 1 ? 'hidden' : 'auto', padding: 1 }}>
        <div style={{ position: 'relative', width: content.w, height: content.h }}>{entries.map(renderButton)}</div>
      </div>
      {paginate && pageCount > 1 && (
        <div style={{ height: navH, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flex: 'none', ...fontStyle({ ...bf.states.default.labelFont, color: '#605E5C' }) }}>
          <button className="wbi-slicer-pager" aria-label="Previous page" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
            <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <span>
            {curPage + 1} / {pageCount}
          </span>
          <button className="wbi-slicer-pager" aria-label="Next page" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

interface ButtonProps {
  s: ButtonStateStyle
  en: { key: string; text: string; label?: string; selected: boolean; disabled: boolean; img?: string; onClick(ctrl: boolean): void }
  bf: ReturnType<typeof readButtonSlicerFormat>
  focused: boolean
  style: CSSProperties
  onEnter(): void
  onLeave(): void
  onDown(): void
  onUp(): void
}

function Button({ s, en, bf, focused, style, onEnter, onLeave, onDown, onUp }: ButtonProps) {
  const img = bf.image.show && en.img ? en.img : undefined
  const vertical = bf.image.position === 'top' || bf.image.position === 'bottom'
  const accent = s.accentBar
  const accentCss: CSSProperties = accent ? { [`border${accent.position[0].toUpperCase()}${accent.position.slice(1)}`]: `${accent.width}px solid ${accent.color}` } : {}
  const justify = bf.textAlign === 'left' ? 'flex-start' : bf.textAlign === 'right' ? 'flex-end' : 'center'
  const text = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: justify, textAlign: bf.textAlign }}>
      {s.valueShow && <span style={{ ...fontStyle(s.valueFont), maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.36 }}>{en.text}</span>}
      {s.labelShow && en.label !== undefined && <span style={{ ...fontStyle(s.labelFont), maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.36 }}>{en.label}</span>}
    </div>
  )
  const image = img ? (
    <div style={{ flex: `0 0 ${bf.image.areaSize}%`, alignSelf: 'stretch', padding: bf.image.padding, boxSizing: 'border-box', minWidth: 0, minHeight: 0, display: 'flex' }}>
      <img src={img} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: bf.image.fit === 'fill' ? 'cover' : bf.image.fit === 'normal' ? 'none' : 'contain' }} />
    </div>
  ) : null
  const first = bf.image.position === 'left' || bf.image.position === 'top'
  return (
    <div
      role="option"
      aria-selected={en.selected}
      aria-disabled={en.disabled}
      title={en.label ? `${en.text}\n${en.label}` : en.text}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onClick={(e) => en.onClick(e.ctrlKey || e.metaKey)}
      style={{
        ...style,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        alignItems: 'center',
        gap: 6,
        background: s.fill,
        border: s.borderWidth ? `${s.borderWidth}px solid ${s.border}` : '0',
        borderRadius: s.radius,
        boxShadow: s.shadow,
        padding: `${bf.padding.top}px ${bf.padding.right}px ${bf.padding.bottom}px ${bf.padding.left}px`,
        cursor: 'pointer',
        overflow: 'hidden',
        outline: focused ? '1px dashed #605E5C' : undefined,
        outlineOffset: 2,
        ...accentCss
      }}
    >
      {first && image}
      {text}
      {!first && image}
      {bf.selectionIcon.show && en.selected && <SelectionCheck color={bf.selectionIcon.color} size={bf.selectionIcon.size} position={bf.selectionIcon.position} />}
    </div>
  )
}

function SelectionCheck({ color, size, position }: { color: string; size: number; position: string }) {
  const at: CSSProperties = position === 'topLeft' ? { left: 4, top: 4 } : position === 'left' ? { left: 4, top: '50%', marginTop: -size / 2 } : position === 'right' ? { right: 4, top: '50%', marginTop: -size / 2 } : { right: 4, top: 4 }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ position: 'absolute', ...at }} aria-hidden>
      <circle cx="8" cy="8" r="8" fill={color} />
      <path d="M4.5 8.2 7 10.6l4.6-5" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

