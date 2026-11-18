/**
 * A table group ("container") in the model diagram: a softly tinted rounded box behind its member cards with a
 * label, or — collapsed — a compact chip that relationship lines attach to. Lumen-only (Power BI has no groups);
 * stored in `diagramLayout.lumen.json`.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDownRegular, ChevronRightRegular, MoreHorizontalRegular } from '@fluentui/react-icons'
import type { GroupColor } from '@core/io/diagramSidecar'
import { cx } from '../../app/ui'
import type { Rect } from './edges'
import { GROUP_PALETTE, RESIZE_HANDLES, type ResizeHandle } from './groups'

export const GROUP_COLOR_LABELS: Record<GroupColor, string> = { gray: 'Gray', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', rose: 'Rose', purple: 'Purple' }

export interface GroupBoxProps {
  id: string
  name: string
  color: GroupColor
  rect: Rect
  collapsed: boolean
  selected: boolean
  /** number of member tables shown in this diagram */
  count: number
  /** feedback while cards are dragged: a card will join / the dragged member will leave */
  hint: 'join' | 'leave' | null
  renaming: boolean
  onDown(e: React.MouseEvent): void
  onMenu(e: React.MouseEvent): void
  onToggleCollapse(): void
  onStartRename(): void
  onRename(name: string | null): void
  onResizeDown(e: React.MouseEvent, handle: ResizeHandle): void
}

export function GroupBox(p: GroupBoxProps) {
  const c = GROUP_PALETTE[p.color]
  return (
    <div
      className={cx('wbi-mv-group', p.selected && 'is-selected', p.collapsed && 'is-collapsed', p.hint === 'join' && 'is-join', p.hint === 'leave' && 'is-leave')}
      style={{ left: p.rect.x, top: p.rect.y, width: p.rect.width, height: p.rect.height, '--g-fill': c.fill, '--g-border': c.border, '--g-text': c.text } as React.CSSProperties}
      data-group={p.id}
      data-color={p.color}
      data-collapsed={p.collapsed ? '1' : '0'}
      role="group"
      aria-label={`Group ${p.name}`}
      onMouseDown={p.onDown}
      onContextMenu={p.onMenu}
      onDoubleClick={(e) => {
        // double-click on the chip (not on its label, which renames) expands it
        if (p.collapsed && !(e.target as HTMLElement).closest('.wbi-mv-group__label, .wbi-mv-group__input')) p.onToggleCollapse()
      }}
    >
      <div className="wbi-mv-group__head">
        <button type="button" className="wbi-mv-group__btn" aria-label={p.collapsed ? 'Expand group' : 'Collapse group'} title={p.collapsed ? 'Expand group' : 'Collapse group'} onMouseDown={(e) => e.stopPropagation()} onClick={p.onToggleCollapse}>
          {p.collapsed ? <ChevronRightRegular /> : <ChevronDownRegular />}
        </button>
        {p.renaming ? (
          <RenameInput initial={p.name} onDone={p.onRename} />
        ) : p.hint && !p.collapsed ? (
          // while a card is dragged over / out of the container the label makes room for what a drop will do
          <span className="wbi-mv-group__hint">{p.hint === 'join' ? 'Release to add to this group' : 'Release to remove from this group'}</span>
        ) : (
          <span
            className="wbi-mv-group__label"
            title={`${p.name} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              p.onStartRename()
            }}
          >
            {p.name}
          </span>
        )}
        {p.collapsed && !p.renaming && <span className="wbi-mv-group__count">{p.count === 1 ? '1 table' : `${p.count} tables`}</span>}
        <span className="wbi-mv-group__spacer" />
        <button type="button" className="wbi-mv-group__btn wbi-mv-group__more" aria-label="Group options" title="Group options" onMouseDown={(e) => e.stopPropagation()} onClick={p.onMenu}>
          <MoreHorizontalRegular />
        </button>
      </div>
      {p.selected && !p.collapsed && RESIZE_HANDLES.map((h) => <div key={h} className={`wbi-mv-group__handle is-${h}`} data-handle={h} onMouseDown={(e) => p.onResizeDown(e, h)} />)}
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (v: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      ref={ref}
      className="wbi-mv-group__input"
      aria-label="Group name"
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
