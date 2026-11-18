/**
 * List-style slicer bodies: Basic (vertical list), Dropdown, Tile (horizontal orientation) and
 * hierarchy slicers (multiple fields in Values) — all sharing the same selection logic.
 *
 * Power BI behavior kept as the default; Lumen extras (object `lumenSlicer`, see slicerFormat.ts):
 * dropdown summary styles (value list / count / removable chips), clear button in the box, popup
 * width / max height, row counts, selected-first and A–Z / Z–A / count / measure sorts, date presets
 * and Force selection. Keyboard: the dropdown box opens with Enter / Space / Alt+↓; inside a list,
 * ↑ ↓ Home End PgUp PgDn move, Space / Enter select (Ctrl adds with "Multi-select with CTRL"),
 * → / ← expand / collapse hierarchy nodes, Esc closes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Scalar } from '@core/model/data'
import { setObjectProp } from '@core/report/props'
import type { SQExpr, SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { fontStyle, measureText, ptToPx, type FontSpec } from '../common/textStyle'
import {
  buildHierTree,
  compressSelection,
  DATE_PRESETS,
  datePresetFilter,
  detectDatePreset,
  hierarchyFilter,
  leafPaths,
  listFilter,
  nodeState,
  parseContainsFilter,
  parseListFilter,
  pathKey,
  persistedFilter,
  selectedLeafKeys,
  toggleHierNode,
  type HierNode,
  type TriState
} from './filterModel'
import { CheckBox, ChevronDown, ChevronRight, DismissIcon, PlusMinus, Radio } from './icons'
import { clickItem, clickSelectAll, hasSelection, isEmptySelection, itemSelected, selectAllState, selectOnly, type ListState, type ListUpdate } from './listLogic'
import { findMeasure, matchPasted, moveFocus, orderItems, summaryText } from './listOptions'
import { parsePastedValues } from './buttonSlicerModel'
import { SearchBox, SlicerHeader, SlicerMessage } from './SlicerChrome'
import { formatItem, itemKey, keyFieldFor, loadHierTuples, loadItemStats, loadListItems, BLANK_LABEL, type ListItem } from './slicerData'
import { outlineCss, type SlicerFormat } from './slicerFormat'

export interface ListSlicerProps {
  visualJson: any
  ctx: VisualHostContext
  fmt: SlicerFormat
  fields: SQExpr[]
  filter: SQFilter | undefined
  headerText: string
  width: number
  height: number
  dropdown: boolean
  /** field data type (date presets apply to dateTime fields) */
  dataType?: string
}

export interface RowModel {
  id: string
  label: string
  depth: number
  state: TriState
  expandable: boolean
  expanded: boolean
  selectAll?: boolean
  /** formatted row count (showCounts) */
  count?: string
  onClick(e: { ctrlKey: boolean; metaKey: boolean }): void
  onToggle?(): void
  /** deselect only this item (chips) */
  onRemove?(): void
}

/** Persist a list update (inverted flag in objects.data, filter through the host). */
export function applyUpdate(ctx: VisualHostContext, fmt: SlicerFormat, upd: ListUpdate): void {
  if (upd.inverted !== fmt.inverted) {
    ctx.updateVisual((j) => setObjectProp(j, 'data', 'isInvertedSelectionMode', upd.inverted ? true : undefined))
  }
  ctx.setSlicerFilter(upd.filter)
}

export function useListRows(p: ListSlicerProps, search: string) {
  const { ctx, fmt, fields, filter } = p
  const ext = fmt.ext
  const hierarchical = fields.length > 1
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const filtersKey = JSON.stringify(ctx.filters)
  const force = ext.forceSelection

  // ---- flat list -------------------------------------------------------------------------------
  const keyField = useMemo(() => {
    if (hierarchical) return undefined
    return parseListFilter(filter, fields[0])?.keyField ?? keyFieldFor(ctx.engine, fields[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchical, JSON.stringify(filter), JSON.stringify(fields[0]), ctx.engine])
  const flat = useMemo(
    () => (hierarchical || !fields[0] ? undefined : loadListItems(ctx, fields[0], search, keyField)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hierarchical, ctx.engine, filtersKey, search, JSON.stringify(fields[0]), JSON.stringify(keyField)]
  )
  const sortMeasure = ext.sort === 'measureAsc' || ext.sort === 'measureDesc' ? findMeasure(ctx.engine.model, ext.sortMeasure) : undefined
  const wantCounts = ext.showCounts || ext.sort === 'countAsc' || ext.sort === 'countDesc'
  const stats = useMemo(
    () => (fields[0] && (wantCounts || sortMeasure) ? loadItemStats(ctx, fields[0], { counts: wantCounts, measure: sortMeasure }) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.engine, filtersKey, JSON.stringify(fields[0]), wantCounts, JSON.stringify(sortMeasure)]
  )

  // ---- hierarchy -------------------------------------------------------------------------------
  const tree = useMemo(() => {
    if (!hierarchical) return undefined
    const { tuples, error } = loadHierTuples(ctx, fields)
    const s = search.trim().toLowerCase()
    const matching = s ? tuples.filter((t) => t.some((v, i) => formatItem(ctx, fields[i], v).toLowerCase().includes(s))) : tuples
    if (fmt.sort === 'desc') matching.reverse()
    return { root: buildHierTree(matching, fields.length), error }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchical, ctx.engine, filtersKey, search, JSON.stringify(fields), fmt.sort])

  const listState: ListState | undefined = fields[0] ? { field: fields[0], filter, inverted: fmt.inverted, keyField } : undefined
  const strict = fmt.selection.strictSingle
  const rows: RowModel[] = []
  let error: string | undefined
  let selectedLabels: string[] = []
  let selectedCount: number | undefined
  let total = 0
  let firstItem: ListItem | undefined
  /** PBI paste-to-select: returns true when something matched */
  let paste: (lines: string[][]) => boolean = () => false
  const fmtCount = (n: number | null | undefined) => (n === null || n === undefined ? '' : ctx.format(n, '#,0', 'int64'))

  if (!hierarchical && flat && listState) {
    error = flat.error
    total = flat.items.length
    const labels = flat.items.map((i) => i.value)
    const keys = flat.items.map((i) => i.key)
    if (fmt.selection.selectAll && !strict && flat.items.length) {
      rows.push({
        id: '__all__',
        label: 'Select all',
        depth: 0,
        state: selectAllState(listState, keys, labels),
        expandable: false,
        expanded: false,
        selectAll: true,
        onClick: () => applyUpdate(ctx, fmt, clickSelectAll(listState, force))
      })
    }
    const ordered = orderItems(
      flat.items.map((it) => ({
        it,
        value: it.value,
        text: it.text,
        selected: itemSelected(listState, it.key, it.value),
        count: stats.counts?.get(itemKey(it.value)) ?? null,
        measure: stats.measures?.get(itemKey(it.value)) ?? null
      })),
      { pbiSort: fmt.sort, sort: ext.sort, selectedFirst: ext.selectedFirst }
    )
    firstItem = ordered[0]?.it
    let excluded = 0
    for (const o of ordered) {
      const it = o.it
      if (o.selected) selectedLabels.push(it.text)
      else excluded++
      const click = (e: { ctrlKey: boolean; metaKey: boolean }) =>
        applyUpdate(ctx, fmt, clickItem(listState, it.key, it.value, { ctrl: e.ctrlKey || e.metaKey, ctrlMulti: fmt.selection.ctrlMulti, strictSingle: strict, force }))
      rows.push({
        id: 'v' + pathKey([it.value]),
        label: it.text,
        depth: 0,
        state: o.selected ? 'on' : 'off',
        expandable: false,
        expanded: false,
        count: ext.showCounts ? fmtCount(o.count as number | null) : undefined,
        onClick: click,
        onRemove: o.selected ? () => applyUpdate(ctx, fmt, clickItem(listState, it.key, it.value, { ctrl: true, ctrlMulti: true, strictSingle: false, force })) : undefined
      })
    }
    paste = (lines) => {
      const hit = matchPasted(
        lines.map((l) => l[0]),
        flat.items
      )
      if (!hit.length) return false
      const keys = strict ? hit.slice(0, 1) : hit
      applyUpdate(ctx, fmt, {
        filter: listFilter(listState.field, { mode: 'include', values: keys.map((h) => h.key), keyField, labels: keyField ? keys.map((h) => h.value) : undefined }),
        inverted: false
      })
      return true
    }
    // inverted selections may hide excluded values that are not in the (searched) list
    if (fmt.inverted && filter) selectedCount = Math.max(0, total - excluded)
  } else if (hierarchical && tree) {
    error = tree.error
    const root = tree.root
    const selected = selectedLeafKeys(root, fields, filter, fmt.inverted)
    total = root.children.length
    const commit = (next: Set<string>) => {
      const all = root.leaves
      if (next.size === 0) {
        if (force) return
        return applyUpdate(ctx, fmt, { filter: undefined, inverted: false })
      }
      if (next.size === all && fmt.inverted) return applyUpdate(ctx, fmt, { filter: undefined, inverted: true })
      const sel = compressSelection(root, next, fmt.inverted)
      applyUpdate(ctx, fmt, { filter: hierarchyFilter(fields, sel), inverted: fmt.inverted })
    }
    if (fmt.selection.selectAll && !strict && root.children.length) {
      const st = nodeState(root, selected)
      const allOn = fmt.inverted && !filter
      rows.push({
        id: '__all__',
        label: 'Select all',
        depth: 0,
        state: allOn ? 'on' : st,
        expandable: false,
        expanded: false,
        selectAll: true,
        onClick: () => {
          if (allOn && force) return
          applyUpdate(ctx, fmt, allOn ? { filter: undefined, inverted: false } : { filter: undefined, inverted: true })
        }
      })
    }
    const walk = (n: HierNode, depth: number) => {
      for (const c of n.children) {
        const k = pathKey(c.path)
        const isOpen = expanded.has(k) || !!search
        const st = nodeState(c, selected)
        if (st === 'on' && depth === 0) selectedLabels.push(formatItem(ctx, fields[0], c.value))
        rows.push({
          id: 'h' + k,
          label: formatItem(ctx, fields[depth], c.value),
          depth,
          state: st,
          expandable: c.children.length > 0,
          expanded: isOpen,
          onClick: (e) => {
            const replace = strict || (fmt.selection.ctrlMulti && !(e.ctrlKey || e.metaKey))
            commit(toggleHierNode(c, selected, replace))
          },
          onRemove: depth === 0 && st === 'on' ? () => commit(toggleHierNode(c, selected, false)) : undefined,
          onToggle: () =>
            setExpanded((prev) => {
              const nx = new Set(prev)
              if (nx.has(k)) nx.delete(k)
              else nx.add(k)
              return nx
            })
        })
        if (isOpen && c.children.length) walk(c, depth + 1)
      }
    }
    walk(root, 0)
    paste = (lines) => {
      // each line = the path of levels (tab separated); a shorter path selects the whole node
      const next = new Set<string>()
      for (const line of lines) {
        let nodes: HierNode[] = [root]
        line.forEach((cell, d) => {
          const want = cell.toLowerCase()
          nodes = nodes.flatMap((n) => n.children.filter((c) => formatItem(ctx, fields[d], c.value).toLowerCase() === want || String(c.value ?? '').toLowerCase() === want))
        })
        if (line.length) for (const n of nodes) for (const l of leafPaths(n)) next.add(pathKey(l))
      }
      if (!next.size) return false
      commit(next)
      return true
    }
    if (selected.size && selected.size < root.leaves && !selectedLabels.length) selectedLabels = ['…']
  }
  const canClear = listState ? hasSelection(listState) && !force : false

  // PBI: with "Single select" on, an empty slicer selects its first item. Force selection does the same.
  const pickKey = firstItem ? itemKey(firstItem.value) : ''
  useEffect(() => {
    if (hierarchical || !listState || !firstItem || search) return
    if (!(strict || force)) return
    if (!isEmptySelection({ filter, inverted: fmt.inverted })) return
    applyUpdate(ctx, fmt, selectOnly(listState, firstItem.key, firstItem.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strict, force, pickKey, !!filter, fmt.inverted, hierarchical, search])

  return { rows, error, selectedLabels, selectedCount, total, canClear, listState, paste }
}

/** Row height in px for an item font + padding. */
export function rowHeightFor(font: FontSpec, padding: number): number {
  return Math.ceil(ptToPx(font.size) * 1.36) + Math.max(0, padding) + 2
}

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  preventDefault(): void
}

/** Keyboard handling shared by the list body and the dropdown popup. */
function useListKeyboard(rows: RowModel[], onEscape?: () => void) {
  const [focus, setFocus] = useState(-1)
  useEffect(() => {
    if (focus >= rows.length) setFocus(rows.length - 1)
  }, [rows.length, focus])
  const onKeyDown = (e: KeyLike) => {
    const r = rows[focus]
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
      case 'PageDown':
      case 'PageUp':
        e.preventDefault()
        setFocus(moveFocus(focus, e.key, rows.length))
        return
      case ' ':
      case 'Enter':
        if (r) {
          e.preventDefault()
          r.onClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey })
        }
        return
      case 'ArrowRight':
        if (r?.expandable && !r.expanded) {
          e.preventDefault()
          r.onToggle?.()
        }
        return
      case 'ArrowLeft':
        if (r?.expandable && r.expanded) {
          e.preventDefault()
          r.onToggle?.()
        }
        return
      case 'Escape':
        onEscape?.()
        return
    }
  }
  return { focus, setFocus, onKeyDown }
}

function ItemRows({ rows, fmt, strict, focus, onHover }: { rows: RowModel[]; fmt: SlicerFormat; strict: boolean; focus: number; onHover?(i: number): void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowH = rowHeightFor(fmt.items.font, fmt.items.padding)
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 })
  useEffect(() => {
    if (focus >= 0 && focus < rows.length) virt.scrollToIndex(focus, { align: 'auto' })
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const fs = fontStyle(fmt.items.font)
  const box = Math.max(10, Math.min(20, Math.round(ptToPx(fmt.items.font.size) * 0.9)))
  const color = fmt.items.font.color
  const bg = fmt.items.background ?? 'transparent'
  const icon = fmt.selectionIcon
  const anyExpandable = rows.some((x) => x.expandable)
  const countFont = fontStyle({ ...fmt.items.font, color: '#605E5C', bold: false, size: Math.max(7, fmt.items.font.size - 1) })
  return (
    <OverlayScroll scrollRef={scrollRef} style={{ flex: 1, minHeight: 0 }}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vi) => {
          const r = rows[vi.index]
          const style: CSSProperties = {
            position: 'absolute',
            top: vi.start,
            left: 0,
            right: 0,
            height: rowH,
            paddingLeft: 2 + r.depth * fmt.items.indent,
            paddingRight: 4,
            gap: 6,
            background: vi.index === focus ? 'rgba(0,0,0,0.06)' : fmt.items.background,
            outline: vi.index === focus ? '1px dashed #605E5C' : undefined,
            outlineOffset: -1,
            ...outlineCss(fmt.items.outline, fmt.items.outlineColor)
          }
          return (
            <div
              key={r.id}
              role="option"
              aria-selected={r.state === 'on'}
              className="wbi-slicer-row"
              style={style}
              onClick={r.onClick}
              onMouseEnter={() => onHover?.(vi.index)}
              title={r.label}
            >
              {fmt.items.toggleType === 1 || !r.expandable ? (
                r.expandable ? (
                  <span
                    style={{ display: 'flex', cursor: 'pointer', flex: 'none' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      r.onToggle?.()
                    }}
                  >
                    <PlusMinus size={box - 1} color={color} expanded={r.expanded} />
                  </span>
                ) : r.depth > 0 || anyExpandable ? (
                  <span style={{ width: box - 1, flex: 'none' }} />
                ) : null
              ) : (
                <span
                  style={{ display: 'flex', flex: 'none' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    r.onToggle?.()
                  }}
                >
                  {r.expanded ? <ChevronDown size={box} color={color} /> : <ChevronRight size={box} color={color} />}
                </span>
              )}
              {strict && !r.selectAll ? <Radio size={box} color={icon} stroke={color} on={r.state === 'on'} background={bg} /> : <CheckBox size={box} color={icon} stroke={color} state={r.state} background={bg} />}
              <span style={{ ...fs, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: `${rowH}px` }}>{r.label}</span>
              {r.count !== undefined && <span style={{ ...countFont, flex: 'none', lineHeight: `${rowH}px` }}>{r.count}</span>}
            </div>
          )
        })}
      </div>
    </OverlayScroll>
  )
}

/**
 * Scroll area with an overlay scrollbar like PBI's slicers: the native bar takes no width (so long
 * values are not truncated by a gutter) and a thin thumb appears while hovering the slicer.
 */
function OverlayScroll({ scrollRef, style, children }: { scrollRef: React.MutableRefObject<HTMLDivElement | null>; style?: CSSProperties; children: ReactNode }) {
  const [m, setM] = useState({ top: 0, h: 0, ch: 0 })
  const measure = () => {
    const el = scrollRef.current
    if (el) setM((prev) => (prev.top === el.scrollTop && prev.h === el.scrollHeight && prev.ch === el.clientHeight ? prev : { top: el.scrollTop, h: el.scrollHeight, ch: el.clientHeight }))
  }
  useLayoutEffect(measure)
  const overflow = m.h > m.ch + 1
  const thumbH = overflow ? Math.max(20, (m.ch * m.ch) / m.h) : 0
  const thumbTop = overflow ? (m.top / (m.h - m.ch)) * (m.ch - thumbH) : 0
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = scrollRef.current
    if (!el) return
    const y0 = e.clientY
    const s0 = el.scrollTop
    const ratio = (m.h - m.ch) / Math.max(1, m.ch - thumbH)
    const move = (ev: PointerEvent) => {
      el.scrollTop = s0 + (ev.clientY - y0) * ratio
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', ...style }}>
      <div ref={scrollRef} className="wbi-slicer-scroll wbi-slicer-overlay" role="listbox" style={{ flex: 1, minHeight: 0, position: 'relative' }} onScroll={measure}>
        {children}
      </div>
      {overflow && <div className="wbi-slicer-vthumb" onPointerDown={drag} onClick={(e) => e.stopPropagation()} style={{ top: thumbTop, height: thumbH }} />}
    </div>
  )
}

/** Date preset chips (Lumen extra) above the items of a date slicer. */
function DatePresets({ p, compact }: { p: ListSlicerProps; compact?: boolean }) {
  const { ctx, fmt, fields } = p
  const active = detectDatePreset(p.filter, fields[0])
  const f = { ...fmt.items.font, size: Math.max(7, fmt.items.font.size - 1) }
  const accent = ctx.theme.dataColors?.[0] ?? '#118DFF'
  return (
    <div style={{ display: 'flex', flexWrap: compact ? 'nowrap' : 'wrap', overflowX: compact ? 'auto' : undefined, gap: 4, padding: '4px 0', flex: 'none' }} className="wbi-slicer-scroll">
      {DATE_PRESETS.map((d) => {
        const on = active === d.id
        return (
          <button
            key={d.id}
            className="wbi-slicer-chip"
            onClick={() => applyUpdate(ctx, fmt, { filter: on ? undefined : datePresetFilter(fields[0], d.id), inverted: false })}
            style={{ ...fontStyle({ ...f, color: on ? '#FFFFFF' : f.color }), background: on ? accent : '#FFFFFF', borderColor: on ? accent : '#C8C6C4' }}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

/** Basic (vertical list) and Dropdown slicer. */
export function ListSlicer(p: ListSlicerProps) {
  const { fmt, ctx } = p
  const initialSearch = useMemo(() => parseContainsFilter(persistedFilter(p.visualJson, 'selfFilter')) ?? '', [p.visualJson])
  const [search, setSearch] = useState(initialSearch)
  const { rows, error, selectedLabels, selectedCount, total, canClear, paste } = useListRows(p, search)
  const clear = () => applyUpdate(ctx, fmt, { filter: undefined, inverted: false })
  const strict = fmt.selection.strictSingle
  const presets = fmt.ext.datePresets && p.dataType === 'dateTime' && p.fields.length === 1
  const kb = useListKeyboard(rows)
  // Ctrl+F shows the search box even when the format pane's Search option is off (PBI: More options › Search)
  const [searchOn, setSearchOn] = useState(false)
  const showSearch = fmt.searchEnabled || searchOn || !!search
  const onPaste = (e: React.ClipboardEvent) => {
    if (paste(parsePastedValues(e.clipboardData.getData('text/plain')))) e.preventDefault()
  }

  const header = (
    <SlicerHeader
      show={fmt.header.show}
      text={fmt.header.text ?? p.headerText}
      font={fmt.header.font}
      background={fmt.header.background}
      outline={fmt.header.outline}
      outlineColor={fmt.header.outlineColor}
      outlineWeight={fmt.header.outlineWeight}
      canClear={canClear}
      onClear={clear}
    />
  )
  if (p.dropdown) return <>{header}<DropdownList p={p} search={search} setSearch={setSearch} paste={paste} rows={rows} error={error} selectedLabels={selectedLabels} selectedCount={selectedCount} total={total} canClear={canClear} onClear={clear} presets={presets} /></>
  return (
    <>
      {header}
      {showSearch && (
        <SearchBox
          value={search}
          onChange={setSearch}
          font={fmt.items.font}
          autoFocus={searchOn}
          background={fmt.searchBox.background}
          borderColor={fmt.searchBox.borderColor}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !fmt.searchEnabled) {
              setSearch('')
              setSearchOn(false)
            }
          }}
        />
      )}
      {presets && <DatePresets p={p} />}
      <div
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault()
            setSearchOn(true)
            return
          }
          kb.onKeyDown(e)
        }}
        onPaste={onPaste}
        onBlur={() => kb.setFocus(-1)} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
        {error ? <SlicerMessage text={error} font={fmt.items.font} /> : rows.length ? <ItemRows rows={rows} fmt={fmt} strict={strict} focus={kb.focus} /> : search ? <SlicerMessage text="No results" font={fmt.items.font} /> : null}
      </div>
    </>
  )
}

interface DropdownListProps {
  p: ListSlicerProps
  paste(lines: string[][]): boolean
  search: string
  setSearch(s: string): void
  rows: RowModel[]
  error?: string
  selectedLabels: string[]
  selectedCount?: number
  total: number
  canClear: boolean
  onClear(): void
  presets: boolean
}

function DropdownList({ p, search, setSearch, paste, rows, error, selectedLabels, selectedCount, total, canClear, onClear, presets }: DropdownListProps) {
  const { fmt } = p
  const ext = fmt.ext
  const strict = fmt.selection.strictSingle
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null)
  const kb = useListKeyboard(rows, () => {
    setOpen(false)
    boxRef.current?.focus()
  })
  const fs = fontStyle(fmt.items.font)
  const lineH = Math.ceil(ptToPx(fmt.items.font.size) * 1.36)
  const rowH = rowHeightFor(fmt.items.font, fmt.items.padding)
  const allOn = fmt.inverted && !p.filter
  const items = rows.filter((r) => !r.selectAll)
  const text = summaryText({ style: ext.summary, selected: selectedLabels, total, all: !p.filter || allOn, selectedCount })
  const chips = ext.summary === 'chips' && !!p.filter && !allOn ? items.filter((r) => r.depth === 0 && r.state === 'on' && r.onRemove) : []

  useLayoutEffect(() => {
    if (!open || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const cap = ext.popupMaxHeight > 0 ? ext.popupMaxHeight : 320
    const flip = below < Math.min(cap, 160) && above > below
    const maxH = Math.max(120, Math.min(cap, flip ? above : below))
    const width = ext.popupWidth > 0 ? ext.popupWidth : r.width
    const left = Math.max(4, Math.min(r.left, window.innerWidth - width - 4))
    setPos({ left, top: flip ? r.top - 1 - maxH : r.bottom + 1, width, maxH })
  }, [open, p.width, ext.popupWidth, ext.popupMaxHeight])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || boxRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open])
  useEffect(() => {
    if (open) {
      kb.setFocus(-1)
      if (!fmt.searchEnabled) popRef.current?.focus()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const searchH = fmt.searchEnabled ? rowHeightFor(fmt.items.font, 4) + 6 : 0
  const presetsH = presets ? rowHeightFor({ ...fmt.items.font, size: Math.max(7, fmt.items.font.size - 1) }, 8) + 8 : 0
  const contentH = Math.max(1, rows.length) * rowH + searchH + presetsH + 2
  const accent = fmt.dropdown.accentBar
  const accentCss: CSSProperties = accent
    ? { [`border${accent.position[0].toUpperCase()}${accent.position.slice(1)}`]: `${accent.width}px solid ${accent.color}` }
    : {}
  const chipFont = { ...fmt.items.font, size: Math.max(7, fmt.items.font.size - 1) }

  return (
    <>
      <div
        ref={boxRef}
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onPaste={(e) => {
          if (paste(parsePastedValues(e.clipboardData.getData('text/plain')))) e.preventDefault()
        }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault()
            setOpen(true)
          } else if (open) kb.onKeyDown(e)
        }}
        className="wbi-slicer-ddbox"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: lineH + 10,
          padding: chips.length ? '2px 6px 2px 4px' : '0 6px 0 8px',
          border: `1px solid ${open ? '#605E5C' : fmt.dropdown.borderColor}`,
          borderRadius: fmt.dropdown.radius,
          background: fmt.items.background ?? '#FFFFFF',
          cursor: 'pointer',
          flex: 'none',
          marginTop: 2,
          boxSizing: 'border-box',
          ...accentCss
        }}
      >
        {chips.length ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: Math.max(lineH + 6, p.height - 40), overflow: 'hidden' }}>
            {chips.map((c) => (
              <span key={c.id} className="wbi-slicer-pill" style={{ ...fontStyle(chipFont) }} title={c.label}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{c.label}</span>
                <span
                  role="button"
                  aria-label={`Remove ${c.label}`}
                  className="wbi-slicer-pill-x"
                  onClick={(e) => {
                    e.stopPropagation()
                    c.onRemove?.()
                  }}
                >
                  <DismissIcon size={8} />
                </span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ ...fs, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>
            {text}
          </span>
        )}
        {ext.clearButton && canClear && (
          <span
            role="button"
            aria-label="Clear selections"
            title="Clear selections"
            className="wbi-slicer-pill-x"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
          >
            <DismissIcon size={Math.round(ptToPx(fmt.items.font.size) * 0.7)} color={fmt.dropdown.iconColor} />
          </span>
        )}
        <ChevronDown size={Math.round(ptToPx(fmt.items.font.size) * 0.95)} color={fmt.dropdown.iconColor} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined }} />
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            tabIndex={-1}
            onKeyDown={kb.onKeyDown}
            onPaste={(e) => {
              if ((e.target as HTMLElement).tagName !== 'INPUT' && paste(parsePastedValues(e.clipboardData.getData('text/plain')))) e.preventDefault()
            }}
            className="wbi-slicer-root wbi-slicer-popup"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              width: pos.width,
              height: 'auto',
              maxHeight: pos.maxH,
              background: fmt.items.background ?? '#FFFFFF',
              border: '1px solid #C8C6C4',
              borderRadius: fmt.dropdown.radius,
              boxShadow: '0 3.2px 7.2px rgba(0,0,0,.13), 0 .6px 1.8px rgba(0,0,0,.11)',
              zIndex: 10000,
              padding: '4px 4px 4px 6px',
              display: 'flex',
              flexDirection: 'column',
              outline: 'none'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(pos.maxH - 10, contentH) }}>
              {fmt.searchEnabled && (
                <SearchBox
                  value={search}
                  onChange={(v) => {
                    setSearch(v)
                    kb.setFocus(-1)
                  }}
                  font={fmt.items.font}
                  autoFocus
                  background={fmt.searchBox.background}
                  borderColor={fmt.searchBox.borderColor}
                  onKeyDown={(e) => {
                    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Escape'].includes(e.key) || ((e.key === 'Enter' || (e.key === ' ' && kb.focus >= 0)) && kb.focus >= 0)) kb.onKeyDown(e)
                    else if (e.key === 'Enter' && rows.length) {
                      // Enter in the search box picks the first match (keyboard-only workflow)
                      e.preventDefault()
                      const first = rows.find((r) => !r.selectAll)
                      first?.onClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey })
                    }
                  }}
                />
              )}
              {presets && <DatePresets p={p} compact />}
              {error ? (
                <SlicerMessage text={error} font={fmt.items.font} />
              ) : rows.length ? (
                <ItemRows rows={rows} fmt={fmt} strict={strict} focus={kb.focus} />
              ) : (
                <SlicerMessage text={search ? 'No results' : 'No values'} font={fmt.items.font} />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** Horizontal orientation ("Tile" style): one tile per value, wrapping into a responsive grid. */
export function TileSlicer(p: ListSlicerProps) {
  const { fmt, ctx } = p
  const { rows, error, canClear } = useListRows({ ...p, fields: p.fields.slice(0, 1) }, '')
  const items = rows.filter((r) => !r.selectAll)
  const fs = fontStyle(fmt.items.font)
  const pad = Math.max(2, fmt.items.padding)
  const minW = Math.min(p.width, Math.max(40, ...items.map((r) => measureText(r.label, fmt.items.font) + pad * 2 + 12)))
  const perRow = Math.max(1, Math.min(items.length, Math.floor((p.width + 0) / minW)))
  const tileH = Math.ceil(ptToPx(fmt.items.font.size) * 1.36) + pad * 2
  const fg = fmt.items.font.color
  const bg = fmt.items.background ?? '#FFFFFF'
  // selected tile: filled with the selection color (foreground), white text (Learn: tile slicer screenshot)
  const selFill = fmt.selectionIcon
  const tileBorder = fmt.items.outline ? fmt.items.outlineColor : '#C8C6C4'
  const kb = useListKeyboard(items)
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
        canClear={canClear}
        onClear={() => applyUpdate(ctx, fmt, { filter: undefined, inverted: false })}
      />
      {error ? (
        <SlicerMessage text={error} font={fmt.items.font} />
      ) : (
        <div
          className="wbi-slicer-scroll"
          tabIndex={0}
          role="listbox"
          onKeyDown={(e) => {
            const map: Record<string, string> = { ArrowRight: 'ArrowDown', ArrowLeft: 'ArrowUp' }
            kb.onKeyDown(map[e.key] ? { key: map[e.key], ctrlKey: e.ctrlKey, metaKey: e.metaKey, preventDefault: () => e.preventDefault() } : e)
          }}
          onBlur={() => kb.setFocus(-1)}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
            gridAutoRows: `minmax(${tileH}px, 1fr)`,
            gap: 0,
            alignContent: 'stretch',
            borderLeft: `1px solid ${tileBorder}`,
            borderTop: `1px solid ${tileBorder}`
          }}
        >
          {items.map((r, i) => {
            const on = r.state === 'on'
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={on}
                className="wbi-slicer-tile"
                title={r.label}
                onClick={r.onClick}
                style={{
                  ...fs,
                  color: on ? (fmt.items.background ?? '#FFFFFF') : fg,
                  background: on ? selFill : bg,
                  borderRight: `1px solid ${tileBorder}`,
                  borderBottom: `1px solid ${tileBorder}`,
                  padding: `0 ${pad}px`,
                  minHeight: tileH,
                  outline: i === kb.focus ? '1px dashed #605E5C' : undefined,
                  outlineOffset: -3
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function listGetData(ctx: VisualHostContext, field: SQExpr, filter: SQFilter | undefined, inverted: boolean, label: string): { columns: string[]; rows: Scalar[][] } {
  const data = loadListItems(ctx, field, '', parseListFilter(filter, field)?.keyField)
  const st: ListState = { field, filter, inverted, keyField: parseListFilter(filter, field)?.keyField }
  return { columns: [label, 'Selected'], rows: data.items.map((i) => [i.value === null ? BLANK_LABEL : i.value, itemSelected(st, i.key, i.value)]) }
}
