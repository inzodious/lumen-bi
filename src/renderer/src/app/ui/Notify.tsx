/**
 * Notifications: <NotificationBar/> (PBI's yellow/red bar under the ribbon with action buttons)
 * and toasts (`toast({ title, message, kind })`) rendered by <ToastHost/> in the bottom right.
 */
import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'
import { CheckmarkCircleRegular, DismissRegular, ErrorCircleRegular, InfoRegular, WarningRegular } from '@fluentui/react-icons'
import { Button } from './primitives'
import { cx } from './cx'

export type NoticeKind = 'info' | 'warning' | 'error' | 'success'

function KindIcon({ kind }: { kind: NoticeKind }) {
  if (kind === 'warning') return <WarningRegular fontSize={16} />
  if (kind === 'error') return <ErrorCircleRegular fontSize={16} />
  if (kind === 'success') return <CheckmarkCircleRegular fontSize={16} />
  return <InfoRegular fontSize={16} />
}

export interface NoticeAction {
  label: string
  primary?: boolean
  onClick(): void
}

export function NotificationBar({ kind = 'warning', children, actions = [], onDismiss }: { kind?: NoticeKind; children: ReactNode; actions?: NoticeAction[]; onDismiss?(): void }) {
  return (
    <div className={cx('wbi-notice', `wbi-notice--${kind}`)} role="status">
      <span className="wbi-notice__icon">
        <KindIcon kind={kind} />
      </span>
      <div className="wbi-notice__text">{children}</div>
      <div className="wbi-notice__actions">
        {actions.map((a) => (
          <Button key={a.label} variant={a.primary ? 'primary' : 'default'} onClick={a.onClick}>
            {a.label}
          </Button>
        ))}
      </div>
      {onDismiss && (
        <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Dismiss" onClick={onDismiss}>
          <DismissRegular fontSize={14} />
        </button>
      )}
    </div>
  )
}

export interface Toast {
  id: number
  kind: NoticeKind
  title?: string
  message: ReactNode
  /** ms; 0 = sticky */
  duration: number
  action?: NoticeAction
}

const useToasts = create<{ toasts: Toast[]; add(t: Toast): void; remove(id: number): void }>((set) => ({
  toasts: [],
  add: (t) => set((s) => ({ toasts: [...s.toasts.slice(-4), t] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

let nextToast = 1

export function toast(opts: { title?: string; message: ReactNode; kind?: NoticeKind; duration?: number; action?: NoticeAction }): number {
  const id = nextToast++
  const kind = opts.kind ?? 'info'
  useToasts.getState().add({ id, kind, title: opts.title, message: opts.message, duration: opts.duration ?? (kind === 'error' ? 10000 : 5000), action: opts.action })
  return id
}

export function dismissToast(id: number): void {
  useToasts.getState().remove(id)
}

function ToastItem({ t }: { t: Toast }) {
  const remove = useToasts((s) => s.remove)
  useEffect(() => {
    if (!t.duration) return
    const h = window.setTimeout(() => remove(t.id), t.duration)
    return () => window.clearTimeout(h)
  }, [t.id, t.duration, remove])
  return (
    <div className={cx('wbi-toast', `wbi-toast--${t.kind}`)} role="alert">
      <div className="wbi-toast__body">
        {t.title && <div className="wbi-toast__title">{t.title}</div>}
        <div className="wbi-toast__msg">{t.message}</div>
        {t.action && (
          <button
            type="button"
            className="wbi-link"
            style={{ marginTop: 6 }}
            onClick={() => {
              remove(t.id)
              t.action!.onClick()
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" className="wbi-btn wbi-btn--icon" style={{ width: 20, height: 20 }} aria-label="Dismiss" onClick={() => remove(t.id)}>
        <DismissRegular fontSize={12} />
      </button>
    </div>
  )
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="wbi-toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  )
}
