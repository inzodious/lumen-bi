/**
 * Screen-space overlays of the report view: data-point tooltip (default PBI-style, or a report-page
 * tooltip rendered live with the hovered point's filters) and the visual context menu.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightRegular } from '@fluentui/react-icons'
import type { DataPointIdentity, SQExpr } from '@core/report/sq'
import { identitiesToFilter } from '@core/report/sq'
import type { Scalar } from '@core/model/data'
import { useApp } from '../state/store'
import { useInteraction, type ContextMenuState } from '../state/interaction'
import { getVisual } from '../visuals/registry'
import type { VisualHostContext } from '../visuals/contract'
import { resolveChrome } from './chrome'
import { autoTooltipPage, tooltipIsAuto } from './tooltipPages'
import { PageCanvas } from './PageCanvas'
import { deleteVisuals } from './editOps'
import { findPage, findVisual, pageInfo, visualFields, visualTypeOf } from './pbir'
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

/** Build the visual context menu (PBI order: Show as a table · Include/Exclude · Drill · Drill through · Copy · Sort · Export · Spotlight · Remove). */
export function buildVisualMenu(state: ContextMenuState, ctx: VisualHostContext | null, opts: { editing: boolean; title: string }): MenuItem[] {
  const { page, visual } = state
  const report = useApp.getState().project?.report
  const pageDoc = findPage(report, page)
  const v = findVisual(pageDoc, visual)
  if (!v) return []
  const def = getVisual(visualTypeOf(v))
  const id: DataPointIdentity | undefined = state.req.identity
  const it = useInteraction.getState()
  const items: MenuItem[] = []
  const getData = () => (def?.getData && ctx ? def.getData(v, ctx) : undefined)

  items.push({ label: 'Show as a table', onClick: () => it.setFocus({ page, visual, mode: 'table' }), disabled: !def })
  if (id) {
    const sel = it.crossFilter[page]?.source === visual && it.crossFilter[page]!.identities.length ? it.crossFilter[page]!.identities : [id]
    items.push({ separator: true })
    items.push({ label: 'Include', onClick: () => includeExclude(page, visual, sel, 'Include') })
    items.push({ label: 'Exclude', onClick: () => includeExclude(page, visual, sel, 'Exclude') })
  }
  if (def?.supportsDrill && ctx) {
    const d = ctx.drill
    items.push({ separator: true })
    items.push({ label: 'Drill down', disabled: !id, onClick: () => id && setDrill(page, visual, { ...d, level: d.level + 1, path: [...d.path, id] }) })
    items.push({ label: 'Drill up', disabled: d.level === 0 && !d.path.length, onClick: () => setDrill(page, visual, { ...d, level: Math.max(0, d.level - 1), path: d.path.slice(0, -1) }) })
  }
  const targets = drillthroughTargets(id)
  if (id) {
    items.push({
      label: 'Drill through',
      disabled: !targets.length,
      items: targets.map((t) => ({ label: t.displayName, onClick: () => drillthrough(page, t.name, id, ctx?.filters ?? []) }))
    })
  }
  items.push({ separator: true })
  items.push({
    label: 'Copy',
    items: [
      { label: 'Copy value', disabled: !id, onClick: () => id && copyText(id.fields.map((f) => scalarText(f.value)).join('\t')) },
      {
        label: 'Copy selection',
        disabled: !def?.getData,
        onClick: () => {
          const d = getData()
          if (d) copyText(toTsv(d))
        }
      }
    ]
  })
  const fields = visualFields(v.json).filter((f) => !['Tooltips'].includes(f.role))
  const sort: any = v.json?.visual?.query?.sortDefinition?.sort?.[0]
  const sortKey = sort ? JSON.stringify(sort.field) : undefined
  if (fields.length && def?.category !== 'slicer' && def?.category !== 'element') {
    const uniq = new Map<string, { expr: SQExpr; label: string }>()
    for (const f of fields) {
      const k = JSON.stringify(f.expr)
      if (!uniq.has(k)) uniq.set(k, { expr: f.expr, label: f.displayName ?? ctx?.engine.describeField(f.expr)?.displayName ?? f.queryRef })
    }
    items.push({
      label: 'Sort axis',
      items: [
        ...[...uniq.entries()].map(([k, f]) => ({
          label: f.label,
          checked: k === sortKey,
          onClick: () => sortVisual(page, visual, f.expr, sort?.direction === 'Ascending' && k === sortKey ? 'Ascending' : 'Descending')
        })),
        { separator: true },
        { label: 'Sort descending', checked: sort?.direction === 'Descending', disabled: !sort, onClick: () => sort && sortVisual(page, visual, sort.field, 'Descending') },
        { label: 'Sort ascending', checked: sort?.direction === 'Ascending', disabled: !sort, onClick: () => sort && sortVisual(page, visual, sort.field, 'Ascending') }
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
  items.push({ separator: true })
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

