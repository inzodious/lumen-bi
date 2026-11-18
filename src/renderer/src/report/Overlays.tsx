/**
 * Screen-space overlays of the report view: data-point tooltip (default PBI-style, or a report-page
 * tooltip rendered live with the hovered point's filters) and the visual context menu.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightRegular } from '@fluentui/react-icons'
import type { DataPointIdentity, SQExpr } from '@core/report/sq'
import { fieldKey, identitiesToFilter } from '@core/report/sq'
import type { Scalar } from '@core/model/data'
import { useApp } from '../state/store'
import { useInteraction, type ContextMenuState } from '../state/interaction'
import { getVisual } from '../visuals/registry'
import type { VisualHostContext } from '../visuals/contract'
import { resolveChrome } from './chrome'
import { autoTooltipPage, tooltipIsAuto } from './tooltipPages'
import { PageCanvas } from './PageCanvas'
import { deleteVisuals, topLevelOf } from './editOps'
import { copySelection, groupSelection, ungroupSelection } from './commands'
import { findPage, findVisual, isGroup, pageInfo, parentOf, visualFields, visualTypeOf } from './pbir'
import { drillthrough, drillthroughTargets, includeExclude, setDrill, sortVisual } from './runtime'
import { liveContext } from './host'

// ---------------------------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------------------------

function useClampedPosition(x: number, y: number, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = x + 14
    let top = y + 14
    if (left + w > window.innerWidth - 4) left = Math.max(4, x - w - 14)
    if (top + h > window.innerHeight - 4) top = Math.max(4, y - h - 14)
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return { ref, pos }
}

export function TooltipLayer() {
  const tip = useInteraction((s) => s.tooltip)
  const report = useApp((s) => s.project?.report)
  const theme = useApp((s) => s.theme)
  const sourcePage = findPage(report, tip?.page)
  const sourceVisual = findVisual(sourcePage, tip?.visual ?? '')
  const chrome = useMemo(() => (sourceVisual ? resolveChrome(sourceVisual.json, theme) : undefined), [sourceVisual, theme])
  const tooltipPage = useMemo(() => {
    if (!chrome || !report || !sourceVisual) return undefined
    if (chrome.tooltip.type === 'Canvas' && chrome.tooltip.section) return findPage(report, chrome.tooltip.section)
    // PBI "Auto": a tooltip page whose tooltip fields the visual uses
    return tooltipIsAuto(sourceVisual.json, chrome.tooltip) ? autoTooltipPage(report, sourceVisual.json) : undefined
  }, [chrome, report, sourceVisual])
  const { ref, pos } = useClampedPosition(tip?.req.x ?? 0, tip?.req.y ?? 0, [tip, tooltipPage])
  const extraFilters = useMemo(() => {
    if (!tip) return undefined
    const idf = tip.req.identity ? identitiesToFilter([tip.req.identity]) : undefined
    return [...(tip.sourceFilters ?? []), ...(idf ? [idf] : [])]
  }, [tip])
  if (!tip || !report || !chrome || !chrome.tooltip.show) return null
  if (tooltipPage) {
    const info = pageInfo(tooltipPage)
    const scale = Math.min(1, 480 / info.width, 360 / info.height)
    return (
      <div ref={ref} className="wbi-tooltip page" style={{ left: pos.left, top: pos.top }}>
        <PageCanvas report={report} page={tooltipPage} scale={scale} mode="view" interactive={false} editing={false} extraFilters={extraFilters} />
      </div>
    )
  }
  if (!tip.req.items.length) return null
  return (
    <div
      ref={ref}
      className="wbi-tooltip"
      style={{ left: pos.left, top: pos.top, background: chrome.tooltip.background, fontSize: chrome.tooltip.fontSizePx, fontFamily: chrome.tooltip.fontFamily }}
    >
      {tip.req.items.map((it, i) => (
        <div key={i} className="wbi-tooltip-row">
          {it.color ? <span className="wbi-tooltip-swatch" style={{ background: it.color }} /> : null}
          <span className="wbi-tooltip-label" style={chrome.tooltip.labelColor ? { color: chrome.tooltip.labelColor } : undefined}>
            {it.label}
          </span>
          <span className="wbi-tooltip-value" style={chrome.tooltip.valueColor ? { color: chrome.tooltip.valueColor } : undefined}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------------------------

export interface MenuItem {
  label?: string
  onClick?(): void
  disabled?: boolean
  checked?: boolean
  items?: MenuItem[]
  separator?: boolean
}

export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose(): void }) {
  const { ref, pos } = useClampedPosition(x - 14, y - 14, [items])
  // Escape closes the menu and nothing else (like the app's popover menus): capture phase, not propagated to the
  // canvas shortcuts. Covers every menu built on this component (visual context menu, page-tab menu).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <div ref={ref} className="wbi-menu" role="menu" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <MenuRow key={i} item={it} onClose={onClose} />
      ))}
    </div>
  )
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose(): void }) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  if (item.separator) return <div className="wbi-menu-sep" role="separator" />
  const hasSub = !!item.items?.length
  const r = open && rowRef.current ? rowRef.current.getBoundingClientRect() : null
  return (
    <div
      ref={rowRef}
      className={'wbi-menu-item' + (item.disabled ? ' disabled' : '')}
      role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={item.checked !== undefined ? !!item.checked : undefined}
      aria-disabled={item.disabled || undefined}
      aria-haspopup={hasSub || undefined}
      aria-expanded={hasSub ? open : undefined}
      aria-label={item.label}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (item.disabled || hasSub) return
        item.onClick?.()
        onClose()
      }}
    >
      <span className="wbi-menu-check">{item.checked ? '✓' : ''}</span>
      <span className="wbi-menu-label">{item.label}</span>
      {hasSub ? <ChevronRightRegular className="wbi-menu-chevron" /> : null}
      {hasSub && open && r && !item.disabled ? <Menu items={item.items!} x={r.right + 12} y={r.top + 10} onClose={onClose} /> : null}
    </div>
  )
}

function scalarText(v: Scalar): string {
  if (v === null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined)
}

function toTsv(data: { columns: string[]; rows: Scalar[][] }): string {
  return [data.columns.join('\t'), ...data.rows.map((r) => r.map(scalarText).join('\t'))].join('\n')
}

function downloadCsv(name: string, data: { columns: string[]; rows: Scalar[][] }) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const csv = [data.columns.map(esc).join(','), ...data.rows.map((r) => r.map((v) => esc(scalarText(v))).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `${name || 'data'}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Drillable hierarchy of a visual: the role with several fields (charts' Category / matrix Rows or, with "Drill on: Columns", Columns). */
function drillHierarchy(v: { json: any }, def: ReturnType<typeof getVisual>, onColumns: boolean): SQExpr[] {
  const qs = v.json?.visual?.query?.queryState ?? {}
  const roles = onColumns ? ['Columns'] : (def?.roles ?? []).filter((r) => r.drillable && r.name !== 'Columns').map((r) => r.name)
  for (const r of roles) {
    const ps: any[] = qs[r]?.projections ?? []
    if (ps.length > 1) return ps.map((p) => p.field)
  }
  return []
}

/**
 * Build the visual context menu. One menu serves Power BI's right-click menu and its "More options (…)" menu, in
 * this order: Show as a table · Show data point as a table · Include / Exclude · the visual's own entries
 * (Expand ▸ / Collapse ▸, Set column width, a slicer's Search / Clear selections) · Drill down / Drill up / Show next
 * level / Expand to next level · Drill through ▸ · Copy ▸ · Sort ▸ · Group ▸ · Export data · Spotlight · Remove.
 * Entries without a working feature behind them in this context are left out (never shown dead).
 */
export function buildVisualMenu(state: ContextMenuState, ctx: VisualHostContext | null, opts: { editing: boolean; title: string }): MenuItem[] {
  const { page, visual, req } = state
  const report = useApp.getState().project?.report
  const pageDoc = findPage(report, page)
  const v = findVisual(pageDoc, visual)
  if (!v || !pageDoc) return []
  const def = getVisual(visualTypeOf(v))
  const id: DataPointIdentity | undefined = req.identity?.fields.length ? req.identity : undefined
  const it = useInteraction.getState()
  const items: MenuItem[] = []
  const getData = () => (def?.getData && ctx ? def.getData(v, ctx) : undefined)
  const isSlicer = def?.category === 'slicer' || !!def?.isSlicer
  const sep = () => items.push({ separator: true })

  items.push({ label: 'Show as a table', onClick: () => it.setFocus({ page, visual, mode: 'table' }), disabled: !def?.getData })
  // PBI lists the records behind the point; here: the visual and its data restricted to the point (see ShowAsTable)
  if (id && def?.getData && !isSlicer) items.push({ label: 'Show data point as a table', onClick: () => it.setFocus({ page, visual, mode: 'table', point: id }) })
  if (id && !isSlicer) {
    const sel = it.crossFilter[page]?.source === visual && it.crossFilter[page]!.identities.length ? it.crossFilter[page]!.identities : [id]
    sep()
    items.push({ label: 'Include', onClick: () => includeExclude(page, visual, sel, 'Include') })
    items.push({ label: 'Exclude', onClick: () => includeExclude(page, visual, sel, 'Exclude') })
  }
  if (req.entries?.length) {
    sep()
    items.push(...req.entries)
  }
  if (def?.supportsDrill && ctx) {
    const d = ctx.drill
    const onColumns = d.target === 'columns' && visualTypeOf(v) === 'pivotTable'
    const levels = drillHierarchy(v, def, onColumns)
    if (levels.length > 1) {
      const last = levels.length - 1
      const level = onColumns ? (d.columnLevel ?? 0) : d.level
      const expandedTo = onColumns ? (d.columnExpandedLevel ?? level) : (d.expandedLevel ?? level)
      // drill into the clicked point: below the deepest hierarchy level the point belongs to
      const keys = levels.map((e) => fieldKey(e))
      const pointLevel = id ? Math.max(-1, ...id.fields.map((f) => keys.indexOf(fieldKey(f.expr)))) : -1
      const canDrillDown = !!id && pointLevel >= 0 && pointLevel < last
      sep()
      items.push({
        label: 'Drill down',
        disabled: !canDrillDown,
        onClick: () => {
          if (!id) return
          const path = [...d.path, id]
          setDrill(page, visual, onColumns ? { ...d, columnLevel: pointLevel + 1, columnExpandedLevel: undefined, path } : { ...d, level: pointLevel + 1, expandedLevel: undefined, path })
        }
      })
      items.push({
        label: 'Drill up',
        disabled: level === 0 && !d.path.length,
        onClick: () => {
          const path = d.path.slice(0, -1)
          setDrill(page, visual, onColumns ? { ...d, path, columnLevel: Math.max(0, level - 1), columnExpandedLevel: undefined } : { ...d, path, level: Math.max(0, level - 1), expandedLevel: undefined })
        }
      })
      items.push({
        label: 'Show next level',
        disabled: level >= last,
        onClick: () => setDrill(page, visual, onColumns ? { ...d, columnLevel: level + 1, columnExpandedLevel: undefined } : { ...d, level: level + 1, expandedLevel: undefined })
      })
      items.push({
        label: 'Expand to next level',
        disabled: expandedTo >= last,
        onClick: () => setDrill(page, visual, onColumns ? { ...d, columnExpandedLevel: expandedTo + 1 } : { ...d, expandedLevel: expandedTo + 1 })
      })
    }
  }
  const targets = drillthroughTargets(id)
  if (id && targets.length) {
    items.push({
      label: 'Drill through',
      items: targets.map((t) => ({ label: t.displayName, onClick: () => drillthrough(page, t.name, id, ctx?.filters ?? []) }))
    })
  }
  sep()
  const value = req.value ?? (id ? id.fields.map((f) => scalarText(f.value)).join('\t') : undefined)
  const inSelection = useApp.getState().selectedVisuals
  items.push({
    label: 'Copy',
    items: [
      { label: 'Copy value', disabled: value === undefined || value === '', onClick: () => value !== undefined && copyText(value) },
      {
        label: 'Copy selection',
        disabled: !req.selectionText && !def?.getData,
        onClick: () => {
          // the visual's selected rows / points; without a selection, everything the visual shows
          const text = req.selectionText?.()
          if (text !== undefined) return copyText(text)
          const d = getData()
          if (d) copyText(toTsv(d))
        }
      },
      // the visual itself, for Paste on a report page
      ...(opts.editing
        ? [
            {
              label: 'Copy visual',
              onClick: () => {
                if (!inSelection.includes(visual)) useApp.getState().selectVisuals([visual])
                copySelection()
              }
            }
          ]
        : [])
    ]
  })
  const fields = visualFields(v.json).filter((f) => !['Tooltips'].includes(f.role))
  const sort: any = v.json?.visual?.query?.sortDefinition?.sort?.[0]
  const sortKey = sort ? JSON.stringify(sort.field) : undefined
  if (fields.length && def?.category !== 'element') {
    const uniq = new Map<string, { expr: SQExpr; label: string }>()
    // a slicer sorts by its (first) field only
    for (const f of isSlicer ? fields.slice(0, 1) : fields) {
      const k = JSON.stringify(f.expr)
      if (!uniq.has(k)) uniq.set(k, { expr: f.expr, label: f.displayName ?? ctx?.engine.describeField(f.expr)?.displayName ?? f.queryRef })
    }
    const first = [...uniq.values()][0]
    // slicers sort ascending unless told otherwise; choosing a direction sorts by the slicer's field
    const target = sort?.field ?? (isSlicer ? first?.expr : undefined)
    const direction: 'Ascending' | 'Descending' | undefined = sort?.direction ?? (isSlicer ? 'Ascending' : undefined)
    items.push({
      label: def?.category === 'table' ? 'Sort by' : 'Sort axis',
      items: [
        ...[...uniq.entries()].map(([k, f]) => ({
          label: f.label,
          checked: k === sortKey || (isSlicer && !sortKey),
          onClick: () => sortVisual(page, visual, f.expr, k === sortKey || isSlicer ? (direction ?? 'Descending') : 'Descending')
        })),
        { separator: true },
        { label: 'Sort descending', checked: direction === 'Descending', disabled: !target, onClick: () => target && sortVisual(page, visual, target, 'Descending') },
        { label: 'Sort ascending', checked: direction === 'Ascending', disabled: !target, onClick: () => target && sortVisual(page, visual, target, 'Ascending') }
      ]
    })
  }
  if (opts.editing) {
    // Group / Ungroup the selected visuals (the Selection pane's groups)
    const picked = inSelection.includes(visual) ? inSelection : [visual]
    const groups = picked.filter((n) => isGroup(findVisual(pageDoc, n)))
    const parent = parentOf(v)
    items.push({
      label: 'Group',
      items: [
        {
          label: 'Group',
          disabled: topLevelOf(pageDoc, picked).length < 2,
          onClick: () => {
            useApp.getState().selectVisuals(picked)
            groupSelection()
          }
        },
        {
          label: 'Ungroup',
          disabled: !groups.length && !parent,
          onClick: () => {
            useApp.getState().selectVisuals(groups.length ? groups : [parent!])
            ungroupSelection()
          }
        }
      ]
    })
  }
  items.push({
    label: 'Export data',
    disabled: !def?.getData,
    onClick: () => {
      const data = getData()
      const handler = useApp.getState().exportVisualData
      if (handler) handler({ pageName: page, visualName: visual, title: opts.title, data })
      else if (data) downloadCsv(opts.title, data)
    }
  })
  sep()
  const spot = it.spotlight?.page === page && it.spotlight.visual === visual
  items.push({ label: 'Spotlight', checked: spot, onClick: () => it.setSpotlight(spot ? null : { page, visual }) })
  if (opts.editing) {
    items.push({
      label: 'Remove',
      onClick: () => {
        useApp.getState().mutateReport('Delete visual', (draft) => {
          const p = findPage(draft, page)
          if (p) deleteVisuals(p, [visual])
        })
        useApp.getState().selectVisuals([])
      }
    })
  }
  // drop leading/trailing/double separators
  return items.filter((x, i, arr) => !(x.separator && (i === 0 || i === arr.length - 1 || arr[i - 1]?.separator)))
}

export function ContextMenuLayer({ editing }: { editing: boolean }) {
  const menu = useInteraction((s) => s.contextMenu)
  if (!menu) return null
  const close = () => useInteraction.getState().setContextMenu(null)
  const report = useApp.getState().project?.report
  const v = findVisual(findPage(report, menu.page), menu.visual)
  const title = v ? (resolveChrome(v.json, useApp.getState().theme).title.text ?? visualTypeOf(v)) : ''
  const ctx = liveContext(menu.page, menu.visual) ?? null
  const items = buildVisualMenu(menu, ctx, { editing, title })
  return (
    <div className="wbi-menu-backdrop" onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <Menu items={items} x={menu.req.x} y={menu.req.y} onClose={close} />
    </div>
  )
}

