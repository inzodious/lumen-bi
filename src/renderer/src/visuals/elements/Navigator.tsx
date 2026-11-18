import { useState } from 'react'
import type { VisualProps } from '../contract'
import { withTransparency } from '@core/report/theme'
import { normalizeShapeKind } from './shapes'
import { ShapeSvg } from './ShapeSvg'
import { readGlow, readShadow, readShapeText } from './Shape'
import { Props, actionAllowed, stateSelector, useElementState, type ElementState } from './util'
import { buildBookmarkItems, buildPageItems, navLayout, resolveSelectedBookmark, type BookmarkPick, type NavItem } from './navigatorModel'

/**
 * PBI navigator defaults (Classic base theme), sampled from Microsoft Learn's "Create page and bookmark
 * navigators" screenshots: white buttons with a 1px dark-gray outline and #252423 text; the selected
 * page / bookmark is filled #333333 with white text.
 */
export const NAV_DEFAULTS: Record<'default' | 'selected', { fill: string; text: string; outline: string }> = {
  default: { fill: '#FFFFFF', text: '#252423', outline: '#333333' },
  selected: { fill: '#333333', text: '#FFFFFF', outline: '#333333' }
}

function NavButton({ item, p, x, y, w, h, interactive, onActivate }: { item: NavItem; p: Props; x: number; y: number; w: number; h: number; interactive: boolean; onActivate(e: React.MouseEvent): void }) {
  const { state: hs, handlers } = useElementState(interactive)
  // PBI: the selected state wins over hover/press for the current page.
  const state: ElementState = item.selected ? 'selected' : hs
  const sel = stateSelector(state)
  const d = NAV_DEFAULTS[item.selected ? 'selected' : 'default']
  const kind = normalizeShapeKind(p.str('shape', 'tileShape', 'rectangle', sel))
  const radius = p.num('shape', 'roundEdge', p.num('shape', 'rectangleRoundedCurve', 0, sel), sel)
  const fill = p.bool('fill', 'show', true, sel) ? withTransparency(p.color('fill', 'fillColor', d.fill, sel), p.num('fill', 'transparency', 0, sel)) : undefined
  const outlineOn = p.bool('outline', 'show', true, sel)
  const stroke = outlineOn ? withTransparency(p.color('outline', 'lineColor', d.outline, sel), p.num('outline', 'transparency', 0, sel)) : undefined
  const weight = outlineOn ? p.num('outline', 'weight', 1, sel) : 0
  const text = readShapeText(p, state, { size: 10, color: d.text, show: true })
  return (
    <div
      role="tab"
      aria-selected={item.selected}
      title={item.label}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h, cursor: interactive ? 'pointer' : 'default' }}
      onClick={onActivate}
      {...handlers}
    >
      <ShapeSvg kind={kind} width={w} height={h} radius={radius} fill={fill} stroke={stroke} strokeWidth={weight} shadow={readShadow(p, 'shadow', state)} glow={readGlow(p, 'glow', state)} />
      {text && (
        <div style={{ position: 'absolute', inset: 0, ...text.style, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', justifyContent: text.style.textAlign === 'left' ? 'flex-start' : text.style.textAlign === 'right' ? 'flex-end' : 'center', flexDirection: 'row' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
        </div>
      )}
    </div>
  )
}

function NavigatorBody({ items, props: p, width, height, interactive, onActivate }: { items: NavItem[]; props: Props; width: number; height: number; interactive: boolean; onActivate(item: NavItem, e: React.MouseEvent): void }) {
  const orientation = p.num('layout', 'orientation', 0)
  const cells = navLayout(items.length, width, height, {
    orientation,
    rowCount: p.num('layout', 'rowCount', 0) || undefined,
    columnCount: p.num('layout', 'columnCount', 0) || undefined,
    gap: p.num('layout', 'cellPadding', 6)
  })
  if (!items.length) {
    return <div style={{ width, height, display: 'grid', placeItems: 'center', color: '#A19F9D', fontSize: 11 }}>No items to show</div>
  }
  return (
    <div style={{ position: 'relative', width, height, userSelect: 'none' }}>
      {items.map((it, i) => (
        <NavButton key={it.key} item={it} p={p} {...cells[i]} interactive={interactive} onActivate={(e) => onActivate(it, e)} />
      ))}
    </div>
  )
}

export function PageNavigatorVisual({ visual, width, height, ctx }: VisualProps) {
  const p = new Props(visual.json, ctx.theme)
  const items = buildPageItems(visual.json, ctx.report)
  return (
    <NavigatorBody
      items={items}
      props={p}
      width={width}
      height={height}
      interactive={ctx.mode === 'view'}
      onActivate={(it, e) => {
        if (!actionAllowed(ctx.mode, e) || it.selected) return
        e.stopPropagation()
        ctx.actions.navigatePage(it.key)
      }}
    />
  )
}

export function BookmarkNavigatorVisual({ visual, width, height, ctx }: VisualProps) {
  const p = new Props(visual.json, ctx.theme)
  const active = ctx.report.activeBookmark
  const [pick, setPick] = useState<BookmarkPick | undefined>()
  const allowDeselect = p.bool('bookmarks', 'allowDeselection', false)
  const keys = new Set(buildBookmarkItems(visual.json, ctx.report).map((i) => i.key))
  const items = buildBookmarkItems(visual.json, ctx.report, resolveSelectedBookmark(active, pick, (n) => keys.has(n)))
  return (
    <NavigatorBody
      items={items}
      props={p}
      width={width}
      height={height}
      interactive={ctx.mode === 'view'}
      onActivate={(it, e) => {
        if (!actionAllowed(ctx.mode, e)) return
        e.stopPropagation()
        if (it.selected) {
          if (allowDeselect) setPick({ name: null, basis: active })
          return
        }
        setPick({ name: it.key, basis: active })
        ctx.actions.applyBookmark(it.key)
      }}
    />
  )
}
