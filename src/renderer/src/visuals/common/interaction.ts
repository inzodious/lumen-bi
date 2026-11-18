/**
 * Selection / drill / tooltip / context-menu plumbing shared by data visuals.
 *
 * Power BI semantics:
 *  - click a data point → select it (cross-filter/highlight other visuals); click it again → clear
 *  - Ctrl/⌘-click → toggle in a multi-selection
 *  - click on empty plot space → clear the selection
 *  - drill mode (header "drill down" toggled): click drills into the category instead of selecting
 *  - non-selected points render dimmed (opacity 0.4)
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { fieldKey, identityKey, type DataPointIdentity } from '@core/report/sq'
import type { TooltipItem, VisualHostContext } from '../contract'

export interface Interactions {
  selectedKeys: Set<string>
  hasSelection: boolean
  isSelected(id: DataPointIdentity): boolean
  /** opacity multiplier for a point given selection state */
  opacityFor(id: DataPointIdentity): number
  onPointClick(id: DataPointIdentity, e: ReactMouseEvent, opts?: { drillable?: boolean; categoryOnly?: DataPointIdentity }): void
  onBackgroundClick(e: ReactMouseEvent): void
  onContextMenu(id: DataPointIdentity | undefined, e: ReactMouseEvent): void
  showTooltip(e: ReactMouseEvent, items: TooltipItem[], id?: DataPointIdentity): void
  hideTooltip(): void
}

/** A selection identity matches a point when every selected field equals the point's field (partial = category-only selections). */
export function identityMatches(sel: DataPointIdentity, point: DataPointIdentity): boolean {
  if (!sel.fields.length) return false
  const pk = new Map(point.fields.map((f) => [fieldKey(f.expr), identityKey({ fields: [f] })]))
  return sel.fields.every((f) => pk.get(fieldKey(f.expr)) === identityKey({ fields: [f] }))
}

export function makeInteractions(ctx: VisualHostContext, opts: { drillLevels?: number } = {}): Interactions {
  const selection = ctx.selection ?? []
  const selectedKeys = new Set(selection.map(identityKey))
  const hasSelection = selection.length > 0
  const isSelected = (id: DataPointIdentity) => selectedKeys.has(identityKey(id)) || selection.some((s) => identityMatches(s, id))
  const canDrill = (opts.drillLevels ?? 1) > 1 && (ctx.drill?.level ?? 0) < (opts.drillLevels ?? 1) - 1

  return {
    selectedKeys,
    hasSelection,
    isSelected,
    opacityFor: (id) => (!hasSelection || isSelected(id) ? 1 : 0.4),
    onPointClick(id, e, o) {
      e.stopPropagation()
      ctx.showTooltip(null)
      if (ctx.drill?.drillMode && canDrill && o?.drillable !== false) {
        const cat = o?.categoryOnly ?? id
        ctx.setDrill({ ...ctx.drill, level: (ctx.drill.level ?? 0) + 1, path: [...(ctx.drill.path ?? []), cat] })
        return
      }
      const multi = e.ctrlKey || e.metaKey
      const key = identityKey(id)
      if (multi) {
        const exists = selection.some((s) => identityKey(s) === key)
        ctx.select(exists ? selection.filter((s) => identityKey(s) !== key) : [...selection, id], { multi: true })
      } else if (selection.length === 1 && identityKey(selection[0]) === key) {
        ctx.select([])
      } else {
        ctx.select([id])
      }
    },
    onBackgroundClick(e) {
      if (e.defaultPrevented) return
      if (hasSelection) ctx.select([])
    },
    onContextMenu(id, e) {
      e.preventDefault()
      e.stopPropagation()
      ctx.showTooltip(null)
      ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: id })
    },
    showTooltip(e, items, id) {
      ctx.showTooltip({ x: e.clientX, y: e.clientY, items, identity: id })
    },
    hideTooltip() {
      ctx.showTooltip(null)
    }
  }
}
