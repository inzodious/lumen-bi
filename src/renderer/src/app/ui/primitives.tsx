/**
 * Basic Power BI–style form primitives: Button, IconButton, TextField, SearchBox, Checkbox, Radio,
 * Toggle, Slider, Pivot, ProgressBar, Spinner. Styles: ./ui.css.
 */
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { CheckmarkFilled, DismissRegular, SearchRegular, SubtractFilled } from '@fluentui/react-icons'
import { cx } from './cx'
import { Tip } from './Tooltip'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'subtle'
  size?: 'normal' | 'small'
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'normal', icon, className, children, type, ...rest }, ref) {
  return (
    <button ref={ref} type={type ?? 'button'} className={cx('wbi-btn', `wbi-btn--${variant}`, size === 'small' && 'wbi-btn--small', className)} {...rest}>
      {icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** tooltip + aria-label */
  label: string
  checked?: boolean
  tipDescription?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, checked, className, tipDescription, ...rest }, ref) {
  return (
    <Tip title={label} description={tipDescription}>
      <button ref={ref} type="button" aria-label={label} aria-pressed={checked} className={cx('wbi-btn', 'wbi-btn--icon', checked && 'is-checked', className)} {...rest}>
        {icon}
      </button>
    </Tip>
  )
})

export interface TextFieldProps {
  label?: string
  value: string
  onChange(value: string): void
  /** called on Enter / blur with the final value (use for commit-on-blur edits) */
  onCommit?(value: string): void
  placeholder?: string
  hint?: string
  error?: string
  multiline?: boolean
  rows?: number
  disabled?: boolean
  autoFocus?: boolean
  type?: 'text' | 'number' | 'password' | 'url'
  prefix?: ReactNode
  suffix?: ReactNode
  size?: 'normal' | 'small'
  className?: string
  inputClassName?: string
  min?: number
  max?: number
  step?: number
  spellCheck?: boolean
  onKeyDown?(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void
  style?: React.CSSProperties
}

export function TextField(p: TextFieldProps) {
  const cls = cx('wbi-input', p.multiline && 'wbi-input--multiline', p.size === 'small' && 'wbi-input--small', p.error && 'is-invalid', p.disabled && 'is-disabled', p.inputClassName)
  const common = {
    value: p.value,
    placeholder: p.placeholder,
    disabled: p.disabled,
    autoFocus: p.autoFocus,
    spellCheck: p.spellCheck ?? false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => p.onChange(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => p.onCommit?.(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !p.multiline) p.onCommit?.((e.target as HTMLInputElement).value)
      p.onKeyDown?.(e)
    }
  }
  const input = (
    <div className={cls} style={p.style}>
      {p.prefix}
      {p.multiline ? <textarea rows={p.rows ?? 3} {...common} /> : <input type={p.type ?? 'text'} min={p.min} max={p.max} step={p.step} {...common} />}
      {p.suffix}
    </div>
  )
  if (!p.label && !p.hint && !p.error) return <div className={p.className}>{input}</div>
  return (
    <label className={cx('wbi-field', p.className)}>
      {p.label && <span className="wbi-field__label">{p.label}</span>}
      {input}
      {p.error ? <span className="wbi-field__error">{p.error}</span> : p.hint ? <span className="wbi-field__hint">{p.hint}</span> : null}
    </label>
  )
}

/** Numeric field that commits on blur/Enter; empty = undefined. */
export function NumberField(p: { label?: string; value: number | undefined; onChange(v: number | undefined): void; min?: number; max?: number; step?: number; size?: 'normal' | 'small'; suffix?: ReactNode; placeholder?: string; disabled?: boolean; className?: string }) {
  const [text, setText] = useState(p.value === undefined ? '' : String(p.value))
  useEffect(() => setText(p.value === undefined ? '' : String(p.value)), [p.value])
  const commit = (t: string) => {
    if (t.trim() === '') return p.onChange(undefined)
    let n = Number(t)
    if (!Number.isFinite(n)) return setText(p.value === undefined ? '' : String(p.value))
    if (p.min !== undefined) n = Math.max(p.min, n)
    if (p.max !== undefined) n = Math.min(p.max, n)
    if (n !== p.value) p.onChange(n)
    setText(String(n))
  }
  return <TextField label={p.label} value={text} onChange={setText} onCommit={commit} size={p.size} suffix={p.suffix} placeholder={p.placeholder} disabled={p.disabled} className={p.className} type="text" />
}

export function SearchBox(p: { value: string; onChange(v: string): void; placeholder?: string; autoFocus?: boolean; className?: string; size?: 'normal' | 'small' }) {
  return (
    <div className={cx('wbi-input', 'wbi-search', p.size === 'small' && 'wbi-input--small', p.className)}>
      <SearchRegular fontSize={14} />
      <input value={p.value} placeholder={p.placeholder ?? 'Search'} autoFocus={p.autoFocus} spellCheck={false} onChange={(e) => p.onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && p.onChange('')} />
      {p.value && (
        <button type="button" className="wbi-btn wbi-btn--icon" style={{ width: 18, height: 18 }} aria-label="Clear search" onClick={() => p.onChange('')}>
          <DismissRegular fontSize={12} />
        </button>
      )}
    </div>
  )
}

export interface CheckboxProps {
  checked: boolean | 'mixed'
  onChange?(checked: boolean): void
  label?: ReactNode
  disabled?: boolean
  className?: string
  title?: string
}

export function Checkbox({ checked, onChange, label, disabled, className, title }: CheckboxProps) {
  return (
    <span
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={title}
      className={cx('wbi-check', checked === true && 'is-checked', checked === 'mixed' && 'is-mixed', disabled && 'is-disabled', className)}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange?.(checked !== true)
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          onChange?.(checked !== true)
        }
      }}
    >
      <span className="wbi-check__box">{checked === true ? <CheckmarkFilled fontSize={12} /> : checked === 'mixed' ? <SubtractFilled fontSize={12} /> : null}</span>
      {label !== undefined && <span className="wbi-check__label">{label}</span>}
    </span>
  )
}

export function Radio({ checked, onChange, label, disabled, className }: { checked: boolean; onChange?(): void; label?: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <span
      role="radio"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      className={cx('wbi-check', 'wbi-check--radio', checked && 'is-checked', disabled && 'is-disabled', className)}
      onClick={() => !disabled && onChange?.()}
      onKeyDown={(e) => !disabled && (e.key === ' ' || e.key === 'Enter') && onChange?.()}
    >
      <span className="wbi-check__box" />
      {label !== undefined && <span>{label}</span>}
    </span>
  )
}

export function Toggle({ on, onChange, label, disabled, size = 'normal', showState, className }: { on: boolean; onChange?(on: boolean): void; label?: ReactNode; disabled?: boolean; size?: 'normal' | 'small'; showState?: boolean; className?: string }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      tabIndex={disabled ? -1 : 0}
      className={cx('wbi-toggle', on && 'is-on', disabled && 'is-disabled', size === 'small' && 'wbi-toggle--small', className)}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange?.(!on)
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          onChange?.(!on)
        }
      }}
    >
      <span className="wbi-toggle__track">
        <span className="wbi-toggle__thumb" />
      </span>
      {showState && <span>{on ? 'On' : 'Off'}</span>}
      {label !== undefined && <span>{label}</span>}
    </span>
  )
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, showValue = true, suffix, className }: { value: number; onChange(v: number): void; min?: number; max?: number; step?: number; showValue?: boolean; suffix?: string; className?: string }) {
  return (
    <div className={cx('wbi-slider', className)}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {showValue && <NumberField size="small" className="wbi-slider__value" value={value} min={min} max={max} onChange={(v) => v !== undefined && onChange(v)} suffix={suffix} />}
    </div>
  )
}

export function Pivot<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ key: T; label: ReactNode }>; value: T; onChange(v: NoInfer<T>): void; className?: string }) {
  return (
    <div className={cx('wbi-pivot', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={t.key === value} type="button" className={cx('wbi-pivot__tab', t.key === value && 'is-active')} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, className }: { value?: number; className?: string }) {
  const indeterminate = value === undefined || !Number.isFinite(value)
  return (
    <div className={cx('wbi-progress', indeterminate && 'is-indeterminate', className)} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(value! * 100)}>
      <div className="wbi-progress__bar" style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(1, value!)) * 100}%` }} />
    </div>
  )
}

export function Spinner({ size = 'normal', label }: { size?: 'normal' | 'large'; label?: string }) {
  return (
    <span className="wbi-row" role="status">
      <span className={cx('wbi-spinner', size === 'large' && 'wbi-spinner--large')} />
      {label && <span>{label}</span>}
    </span>
  )
}

/** Focus-trap-free autofocus helper for dialogs' first input. */
export function useAutoFocus<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}
