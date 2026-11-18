/**
 * Modal dialog (PBI dialog look: white card, 20px semibold title, close X, right-aligned footer
 * buttons with the primary in PBI yellow). Also imperative helpers: confirmDialog / promptDialog /
 * alertDialog returning promises, rendered by <DialogHost/>.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { DismissRegular } from '@fluentui/react-icons'
import { Button, TextField } from './primitives'
import { cx } from './cx'

export interface ModalProps {
  open?: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose(): void
  children?: ReactNode
  footer?: ReactNode
  footerLeft?: ReactNode
  width?: number | string
  height?: number | string
  className?: string
  bodyClassName?: string
  /** close on backdrop click (default false: PBI dialogs are modal) */
  dismissOnBackdrop?: boolean
  hideClose?: boolean
  /** called on Enter when focus isn't in a textarea/button */
  onSubmit?(): void
}

export function Modal(p: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (p.open === false) return
    const key = (e: KeyboardEvent) => {
      if (!ref.current) return
      // only the top-most modal reacts
      const modals = document.querySelectorAll('.wbi-modal')
      if (modals[modals.length - 1] !== ref.current) return
      if (e.key === 'Escape' && !document.querySelector('.wbi-popover')) {
        e.stopPropagation()
        p.onClose()
      }
      if (e.key === 'Enter' && p.onSubmit) {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return
        e.preventDefault()
        p.onSubmit()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [p.open, p.onClose, p.onSubmit])
  if (p.open === false) return null
  return createPortal(
    <div className="wbi-modal-backdrop" onMouseDown={(e) => p.dismissOnBackdrop && e.target === e.currentTarget && p.onClose()}>
      <div ref={ref} className={cx('wbi-modal', p.className)} style={{ width: p.width ?? 520, height: p.height }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="wbi-modal__header">
          <h2 className="wbi-modal__title" id={titleId}>
            {p.title}
          </h2>
          {!p.hideClose && (
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Close" onClick={p.onClose}>
              <DismissRegular fontSize={18} />
            </button>
          )}
        </div>
        {p.subtitle && <div className="wbi-modal__subtitle">{p.subtitle}</div>}
        <div className={cx('wbi-modal__body', p.bodyClassName)}>{p.children}</div>
        {(p.footer || p.footerLeft) && (
          <div className="wbi-modal__footer">
            {p.footerLeft && <div className="wbi-modal__footer-left">{p.footerLeft}</div>}
            {p.footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------------------------
// Imperative dialogs
// ---------------------------------------------------------------------------------------------

type DialogRequest =
  | { kind: 'confirm'; title: string; message: ReactNode; buttons: string[]; primary: number; resolve(v: number): void }
  | { kind: 'prompt'; title: string; message?: ReactNode; label?: string; value: string; okText: string; validate?(v: string): string | undefined; resolve(v: string | null): void }

const useDialogs = create<{ queue: DialogRequest[]; push(d: DialogRequest): void; pop(): void }>((set) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, d] })),
  pop: () => set((s) => ({ queue: s.queue.slice(1) }))
}))

/**
 * Ask a question. Resolves with the index of the button clicked; Escape / X resolves with the
 * index of the last button (conventionally "Cancel").
 */
export function confirmDialog(opts: { title: string; message: ReactNode; buttons?: string[]; primary?: number }): Promise<number> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'confirm', title: opts.title, message: opts.message, buttons: opts.buttons ?? ['OK', 'Cancel'], primary: opts.primary ?? 0, resolve }))
}

export function alertDialog(title: string, message: ReactNode): Promise<void> {
  return confirmDialog({ title, message, buttons: ['OK'] }).then(() => undefined)
}

/** Ask for a text value; resolves null when cancelled. */
export function promptDialog(opts: { title: string; message?: ReactNode; label?: string; value?: string; okText?: string; validate?(v: string): string | undefined }): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'prompt', title: opts.title, message: opts.message, label: opts.label, value: opts.value ?? '', okText: opts.okText ?? 'OK', validate: opts.validate, resolve }))
}

function PromptBody({ d, done }: { d: Extract<DialogRequest, { kind: 'prompt' }>; done(v: string | null): void }) {
  const [v, setV] = useState(d.value)
  const err = d.validate?.(v)
  return (
    <Modal
      title={d.title}
      onClose={() => done(null)}
      width={440}
      onSubmit={() => !err && done(v)}
      footer={
        <>
          <Button variant="primary" disabled={!!err} onClick={() => done(v)}>
            {d.okText}
          </Button>
          <Button onClick={() => done(null)}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col">
        {d.message && <div>{d.message}</div>}
        <TextField label={d.label} value={v} onChange={setV} autoFocus error={v !== d.value ? err : undefined} />
      </div>
    </Modal>
  )
}

export function DialogHost() {
  const d = useDialogs((s) => s.queue[0])
  const pop = useDialogs((s) => s.pop)
  if (!d) return null
  if (d.kind === 'prompt')
    return (
      <PromptBody
        key={String(useDialogs.getState().queue.length) + d.title}
        d={d}
        done={(v) => {
          pop()
          d.resolve(v)
        }}
      />
    )
  const done = (i: number) => {
    pop()
    d.resolve(i)
  }
  return (
    <Modal
      title={d.title}
      onClose={() => done(d.buttons.length - 1)}
      width={480}
      footer={d.buttons.map((b, i) => (
        <Button key={b} variant={i === d.primary ? 'primary' : 'default'} autoFocus={i === d.primary} onClick={() => done(i)}>
          {b}
        </Button>
      ))}
    >
      <div style={{ fontSize: 13, lineHeight: '20px' }}>{d.message}</div>
    </Modal>
  )
}
