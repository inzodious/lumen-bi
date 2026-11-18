/**
 * Anchored popover rendered in a portal. Closes on outside click / Escape. Positions below the
 * anchor (flips above / shifts left when it would overflow the window).
 */
import { useLayoutEffect, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

export type Anchor = HTMLElement | DOMRect | { x: number; y: number }

function anchorRect(a: Anchor): { left: number; top: number; right: number; bottom: number; width: number } {
  if (a instanceof HTMLElement) {
    const r = a.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
  }
  if ('width' in a) return { left: a.left, top: a.top, right: a.right, bottom: a.bottom, width: a.width }
  return { left: a.x, top: a.y, right: a.x, bottom: a.y, width: 0 }
}

export interface PopoverProps {
  anchor: Anchor | null
  open: boolean
  onClose(): void
  children: ReactNode
  className?: string
  /** match anchor width */
  matchWidth?: boolean
  placement?: 'bottom-start' | 'bottom-end' | 'right-start' | 'top-start'
  style?: CSSProperties
  /** elements that count as "inside" (e.g. the anchor button, so clicking it toggles) */
  ignoreOutside?: Array<HTMLElement | null>
}

export function Popover({ anchor, open, onClose, children, className, matchWidth, placement = 'bottom-start', style, ignoreOutside }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return
    const a = anchorRect(anchor)
    const el = ref.current
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = placement === 'bottom-end' ? a.right - w : placement === 'right-start' ? a.right + 2 : a.left
    let top = placement === 'right-start' ? a.top : placement === 'top-start' ? a.top - h - 2 : a.bottom + 2
    if (left + w > window.innerWidth - 4) left = placement === 'right-start' ? a.left - w - 2 : window.innerWidth - w - 4
    if (left < 4) left = 4
    if (top + h > window.innerHeight - 4) top = placement === 'right-start' ? window.innerHeight - h - 4 : Math.max(4, a.top - h - 2)
    if (top < 4) top = 4
    setPos({ left, top, minWidth: matchWidth ? a.width : undefined })
  }, [open, anchor, placement, matchWidth, children])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (ignoreOutside?.some((x) => x?.contains(t))) return
      // nested popovers (submenus / color pickers) are rendered as siblings in body: treat any popover as inside
      if ((t as HTMLElement).closest?.('.wbi-popover') && (t as HTMLElement).closest('.wbi-popover') !== ref.current) {
        const z = Number((t as HTMLElement).closest<HTMLElement>('.wbi-popover')?.dataset.depth ?? 0)
        if (z > Number(ref.current?.dataset.depth ?? 0)) return
      }
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const blur = () => onClose()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
    }
  }, [open, onClose, ignoreOutside])

  if (!open || !anchor) return null
  const depth = document.querySelectorAll('.wbi-popover').length
  return createPortal(
    <div
      ref={ref}
      data-depth={depth}
      className={cx('wbi-popover', className)}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth: pos?.minWidth, ...style }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  )
}
