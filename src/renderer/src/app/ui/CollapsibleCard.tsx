/**
 * Format-pane style collapsible card: chevron + title + optional on/off toggle on the right.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons'
import { Toggle } from './primitives'
import { cx } from './cx'

export interface CollapsibleCardProps {
  title: ReactNode
  children?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?(open: boolean): void
  /** on/off toggle shown in the header (e.g. Legend On) */
  toggle?: { on: boolean; onChange(on: boolean): void }
  level?: 1 | 2
  className?: string
  actions?: ReactNode
}

export function CollapsibleCard(p: CollapsibleCardProps) {
  const [inner, setInner] = useState(p.defaultOpen ?? false)
  const open = p.open ?? inner
  const setOpen = (v: boolean) => {
    setInner(v)
    p.onOpenChange?.(v)
  }
  return (
    <div className={cx('wbi-card', `wbi-card--l${p.level ?? 1}`, open && 'is-open', p.className)}>
      <div className="wbi-card__header" onClick={() => setOpen(!open)} role="button" aria-expanded={open}>
        <span className="wbi-card__chevron">{open ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />}</span>
        <span className="wbi-card__title">{p.title}</span>
        {p.actions}
        {p.toggle && <Toggle size="small" on={p.toggle.on} onChange={p.toggle.onChange} />}
      </div>
      {open && <div className="wbi-card__body">{p.children}</div>}
    </div>
  )
}
