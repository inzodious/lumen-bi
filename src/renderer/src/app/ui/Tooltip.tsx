/**
 * Power BI–style hover tooltip (white card with optional bold title + description), shown after
 * a short delay. Wrap a single element: <Tip title="Refresh" description="Refresh all data">…</Tip>.
 */
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Tip({ title, description, children, placement = 'below' }: { title?: ReactNode; description?: ReactNode; children: ReactElement; placement?: 'below' | 'above' | 'right' | 'left' }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!title && !description) return children
  if (!isValidElement(children)) return children
  const props = children.props as Record<string, any>
  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      if (placement === 'right') setPos({ x: r.right + 8, y: r.top })
      else if (placement === 'left') setPos({ x: r.left - 8, y: r.top })
      else if (placement === 'above') setPos({ x: r.left, y: r.top - 8 })
      else setPos({ x: r.left, y: r.bottom + 6 })
    }, 600)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }
  const child = cloneElement(children as ReactElement<any>, {
    ref: (el: HTMLElement | null) => {
      ref.current = el
      const r = (children as any).ref ?? props.ref
      if (typeof r === 'function') r(el)
      else if (r && typeof r === 'object') r.current = el
    },
    onMouseEnter: (e: any) => {
      props.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: any) => {
      props.onMouseLeave?.(e)
      hide()
    },
    onMouseDown: (e: any) => {
      props.onMouseDown?.(e)
      hide()
    }
  })
  return (
    <>
      {child}
      {pos &&
        createPortal(
          <div
            className="wbi-tooltip"
            style={{
              left: Math.min(pos.x, window.innerWidth - 290),
              top: placement === 'above' ? undefined : pos.y,
              bottom: placement === 'above' ? window.innerHeight - pos.y : undefined,
              transform: placement === 'left' ? 'translateX(-100%)' : undefined
            }}
          >
            {title && <div className="wbi-tooltip__title">{title}</div>}
            {description && <div className="wbi-tooltip__desc">{description}</div>}
          </div>,
          document.body
        )}
    </>
  )
}
