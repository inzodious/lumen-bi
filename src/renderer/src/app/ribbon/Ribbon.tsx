/**
 * Power BI Desktop ribbon: tab strip (File opens the backstage) + a white rounded command surface
 * of labelled groups with large (32px icon) and small (16px icon, stacked three high) buttons,
 * split buttons with dropdown menus, and inline galleries (themes). Tabs come from ./registry.
 *
 * Building blocks exported for other workstreams' contextual tabs:
 *   RibbonGroup, RibbonButton, RibbonStack, RibbonGallery, RibbonControl.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDownRegular, ChevronUpRegular, ChevronDown12Regular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { useShell } from '../shellState'
import { cx } from '../ui/cx'
import { Popover } from '../ui/Popover'
import { Menu, type MenuItem } from '../ui/Menu'
import { Tip } from '../ui/Tooltip'
import { useRibbonRegistry, visibleTabs } from './registry'

export function Ribbon() {
  const app = useApp()
  const tabs = useRibbonRegistry((s) => s.tabs)
  const { ribbonTab, setRibbonTab, ribbonCollapsed, toggleRibbon, openBackstage } = useShell()
  const visible = visibleTabs(tabs, app)
  const [peek, setPeek] = useState(false)
  const prevIds = useRef<string[]>([])

  // keep a valid selection; auto-select contextual tabs that ask for it when they appear
  useEffect(() => {
    const ids = visible.map((t) => t.id)
    const appeared = visible.find((t) => t.autoSelect && !prevIds.current.includes(t.id))
    prevIds.current = ids
    if (appeared) setRibbonTab(appeared.id)
    else if (!ids.includes(ribbonTab) && ids.length) setRibbonTab(ids[0])
  })

  const active = visible.find((t) => t.id === ribbonTab) ?? visible[0]
  const showBody = !ribbonCollapsed || peek
  return (
    <div className={cx('wbi-ribbon', ribbonCollapsed && 'is-collapsed')} onMouseLeave={() => peek && setPeek(false)}>
      <div className="wbi-ribbon__tabs" role="tablist">
        <button type="button" className="wbi-ribbon__tab wbi-ribbon__tab--file" onClick={() => openBackstage('home')}>
          File
        </button>
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active?.id}
            className={cx('wbi-ribbon__tab', t.contextual && 'is-contextual', t.id === active?.id && showBody && 'is-active')}
            onClick={() => {
              setRibbonTab(t.id)
              if (ribbonCollapsed) setPeek(true)
            }}
            onDoubleClick={toggleRibbon}
          >
            {t.label}
          </button>
        ))}
      </div>
      {showBody && active && (
        <div className={cx('wbi-ribbon__body', peek && 'is-peek')} role="tabpanel">
          <div className="wbi-ribbon__groups">{active.render()}</div>
          <Tip title={ribbonCollapsed ? 'Pin the ribbon' : 'Collapse the ribbon'} description="Ctrl+F1">
            <button
              type="button"
              className="wbi-ribbon__collapse"
              aria-label={ribbonCollapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
              onClick={() => {
                toggleRibbon()
                setPeek(false)
              }}
            >
              {ribbonCollapsed ? <ChevronDownRegular fontSize={14} /> : <ChevronUpRegular fontSize={14} />}
            </button>
          </Tip>
        </div>
      )}
    </div>
  )
}

export function RibbonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('wbi-rgroup', className)} role="group" aria-label={label}>
      <div className="wbi-rgroup__items">{children}</div>
      <div className="wbi-rgroup__label">{label}</div>
    </div>
  )
}

/** Column of up to three small buttons. */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="wbi-rstack">{children}</div>
}

export interface RibbonButtonProps {
  label: string
  icon: ReactElement
  size?: 'large' | 'small'
  onClick?(): void
  disabled?: boolean
  checked?: boolean
  /** dropdown menu: whole button opens it (no onClick) or split button (with onClick) */
  menu?: MenuItem[] | (() => MenuItem[])
  /** custom popover content instead of a menu */
  popover?: (close: () => void) => ReactNode
  tooltip?: string
  shortcut?: string
}

export function RibbonButton(p: RibbonButtonProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hasDrop = !!(p.menu || p.popover)
  const split = hasDrop && !!p.onClick
  const large = p.size !== 'small'
  const tipTitle = p.shortcut ? `${p.label} (${p.shortcut})` : p.label
  const drop = (
    <>
      {open && hasDrop && (
        <Popover anchor={ref.current} open onClose={() => setOpen(false)} ignoreOutside={[ref.current]}>
          {p.popover ? p.popover(() => setOpen(false)) : <Menu items={typeof p.menu === 'function' ? p.menu() : p.menu!} onDone={() => setOpen(false)} />}
        </Popover>
      )}
    </>
  )
  if (split) {
    return (
      <div ref={ref} className={cx('wbi-rbtn', 'wbi-rbtn--split', large ? 'wbi-rbtn--large' : 'wbi-rbtn--small', p.disabled && 'is-disabled', open && 'is-open')}>
        <Tip title={tipTitle} description={p.tooltip}>
          <button type="button" className="wbi-rbtn__main" disabled={p.disabled} onClick={p.onClick} aria-pressed={p.checked} aria-label={p.label}>
            <span className="wbi-rbtn__icon">{p.icon}</span>
            {!large && <span className="wbi-rbtn__label">{p.label}</span>}
          </button>
        </Tip>
        <button type="button" className="wbi-rbtn__drop" disabled={p.disabled} onClick={() => setOpen((o) => !o)} aria-label={`${p.label} options`}>
          {large && <span className="wbi-rbtn__label">{p.label}</span>}
          <ChevronDown12Regular />
        </button>
        {drop}
      </div>
    )
  }
  return (
    <div ref={ref} className="wbi-rbtn-wrap">
      <Tip title={tipTitle} description={p.tooltip}>
        <button
          type="button"
          disabled={p.disabled}
          aria-pressed={p.checked}
          className={cx('wbi-rbtn', large ? 'wbi-rbtn--large' : 'wbi-rbtn--small', p.checked && 'is-checked', open && 'is-open')}
          onClick={() => (hasDrop ? setOpen((o) => !o) : p.onClick?.())}
        >
          <span className="wbi-rbtn__icon">{p.icon}</span>
          <span className="wbi-rbtn__label">
            {p.label}
            {hasDrop && <ChevronDown12Regular className="wbi-rbtn__chev" />}
          </span>
        </button>
      </Tip>
      {drop}
    </div>
  )
}

/** Arbitrary control inside a group (e.g. a dropdown or a checkbox) with an optional caption. */
export function RibbonControl({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="wbi-rcontrol">
      {label && <span className="wbi-rcontrol__label">{label}</span>}
      {children}
    </div>
  )
}

/** Inline gallery with a "more" dropdown showing every item (Themes gallery). */
export function RibbonGallery<T>({ items, renderItem, isSelected, onPick, footer, columns = 4, visibleCount = 4 }: { items: T[]; renderItem(item: T): ReactNode; isSelected?(item: T): boolean; onPick(item: T): void; footer?: MenuItem[]; columns?: number; visibleCount?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className="wbi-rgallery">
      <div className="wbi-rgallery__strip">
        {items.slice(0, visibleCount).map((it, i) => (
          <button key={i} type="button" className={cx('wbi-rgallery__item', isSelected?.(it) && 'is-selected')} onClick={() => onPick(it)}>
            {renderItem(it)}
          </button>
        ))}
      </div>
      <button type="button" className="wbi-rgallery__more" aria-label="More" onClick={() => setOpen((o) => !o)}>
        <ChevronDownRegular fontSize={12} />
      </button>
      {open && (
        <Popover anchor={ref.current} open onClose={() => setOpen(false)} ignoreOutside={[ref.current]}>
          <div className="wbi-rgallery__pop" style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}>
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                className={cx('wbi-rgallery__item', isSelected?.(it) && 'is-selected')}
                onClick={() => {
                  setOpen(false)
                  onPick(it)
                }}
              >
                {renderItem(it)}
              </button>
            ))}
          </div>
          {footer && (
            <>
              <div className="wbi-menu__sep" />
              <Menu items={footer} onDone={() => setOpen(false)} />
            </>
          )}
        </Popover>
      )}
    </div>
  )
}
