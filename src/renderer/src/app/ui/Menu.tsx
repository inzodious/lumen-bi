/**
 * Menus: <Menu items/> (list with icons, shortcuts, checks, submenus, separators),
 * <ContextMenuHost/> + showContextMenu(e, items) for right-click menus anywhere,
 * <MenuButton/> for "button that opens a menu" (ribbon split buttons, pane "…" menus).
 */
import { useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { CheckmarkRegular, ChevronRightRegular } from '@fluentui/react-icons'
import { Popover, type Anchor } from './Popover'
import { cx } from './cx'

export type MenuItem =
  | {
      key?: string
      label: string
      icon?: ReactNode
      shortcut?: string
      disabled?: boolean
      checked?: boolean
      /** highlighted as the current choice */
      selected?: boolean
      onClick?(): void
      submenu?: MenuItem[]
      title?: string
    }
  | { separator: true; key?: string }
  | { header: string; key?: string }

export function Menu({ items, onDone, className }: { items: MenuItem[]; onDone(): void; className?: string }) {
  const [sub, setSub] = useState<{ index: number; el: HTMLElement } | null>(null)
  const hasChecks = items.some((i) => 'label' in i && i.checked !== undefined)
  const hasIcons = items.some((i) => 'label' in i && i.icon)
  return (
    <div className={cx('wbi-menu', className)} role="menu">
      {items.map((item, i) => {
        if ('separator' in item) return <div key={item.key ?? `sep${i}`} className="wbi-menu__sep" />
        if ('header' in item) return <div key={item.key ?? `h${i}`} className="wbi-menu__header">{item.header}</div>
        return (
          <button
            key={item.key ?? item.label}
            type="button"
            role="menuitem"
            title={item.title}
            disabled={item.disabled}
            className={cx('wbi-menu__item', sub?.index === i && 'is-active', item.selected && 'is-selected')}
            onMouseEnter={(e) => setSub(item.submenu ? { index: i, el: e.currentTarget } : null)}
            onClick={(e) => {
              if (item.submenu) return setSub({ index: i, el: e.currentTarget })
              onDone()
              item.onClick?.()
            }}
          >
            {(hasChecks || hasIcons) && <span className="wbi-menu__icon">{item.checked ? <CheckmarkRegular fontSize={14} /> : item.icon}</span>}
            <span className="wbi-menu__label">{item.label}</span>
            {item.shortcut && <span className="wbi-menu__shortcut">{item.shortcut}</span>}
            {item.submenu && <ChevronRightRegular fontSize={12} />}
          </button>
        )
      })}
      {sub && 'submenu' in items[sub.index] && (
        <Popover anchor={sub.el} open placement="right-start" onClose={() => setSub(null)}>
          <Menu items={(items[sub.index] as { submenu: MenuItem[] }).submenu} onDone={onDone} />
        </Popover>
      )}
    </div>
  )
}

interface ContextMenuState {
  menu: { anchor: Anchor; items: MenuItem[] } | null
  show(anchor: Anchor, items: MenuItem[]): void
  hide(): void
}

const useContextMenuState = create<ContextMenuState>((set) => ({
  menu: null,
  show: (anchor, items) => set({ menu: { anchor, items } }),
  hide: () => set({ menu: null })
}))

/** Open a context menu at the mouse position (or an anchor element / point). */
export function showContextMenu(at: React.MouseEvent | MouseEvent | Anchor, items: MenuItem[]): void {
  let anchor: Anchor
  if ('clientX' in at && 'preventDefault' in at) {
    at.preventDefault()
    at.stopPropagation()
    anchor = { x: at.clientX, y: at.clientY }
  } else anchor = at as Anchor
  if (!items.length) return
  useContextMenuState.getState().show(anchor, items)
}

export function hideContextMenu(): void {
  useContextMenuState.getState().hide()
}

export function ContextMenuHost() {
  const menu = useContextMenuState((s) => s.menu)
  const hide = useContextMenuState((s) => s.hide)
  if (!menu) return null
  return (
    <Popover anchor={menu.anchor} open onClose={hide}>
      <Menu items={menu.items} onDone={hide} />
    </Popover>
  )
}

/** A button that toggles a dropdown menu. `render` receives the open state. */
export function MenuButton({ items, children, className, title, placement, disabled }: { items: MenuItem[] | (() => MenuItem[]); children: ReactNode; className?: string; title?: string; placement?: 'bottom-start' | 'bottom-end'; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} type="button" title={title} disabled={disabled} className={cx(className, open && 'is-open')} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {children}
      </button>
      {open && (
        <Popover anchor={ref.current} open placement={placement} onClose={() => setOpen(false)} ignoreOutside={[ref.current]}>
          <Menu items={typeof items === 'function' ? items() : items} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </>
  )
}
