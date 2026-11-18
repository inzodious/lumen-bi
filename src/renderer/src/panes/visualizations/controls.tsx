/**
 * Format-pane controls with Power BI Desktop's shapes: the numeric spin box (value + unit + up/down), the percent
 * slider (spin box followed by the track), the Bold / Italic / Underline button group and the alignment group.
 * All of them are sized by the pane (min-width: 0 everywhere), so nothing is clipped at the narrowest pane width.
 * Styles: visualizations.css (".wbi-spin", ".wbi-fslider", ".wbi-fmt__seg").
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDownRegular, ChevronUpRegular } from '@fluentui/react-icons'
import { Tip, cx } from '../../app/ui'

/** Parse what the user typed in a numeric box: '' → undefined (reset), junk → null (keep the old value). */
export function parseNumberInput(text: string): number | undefined | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Clamp to [min, max] and round to the step grid's precision (integers stay integers, 0.1 steps keep one decimal). */
export function normalizeNumber(n: number, opts: { min?: number; max?: number; integer?: boolean; step?: number }): number {
  let v = n
  if (opts.integer) v = Math.round(v)
  else {
    const decimals = Math.min(6, Math.max(2, (String(opts.step ?? 1).split('.')[1] ?? '').length))
    const f = 10 ** decimals
    v = Math.round(v * f) / f
  }
  if (opts.min !== undefined) v = Math.max(opts.min, v)
  if (opts.max !== undefined) v = Math.min(opts.max, v)
  return v
}

/** Value after one click on a spin arrow: from the current value, or from the nearest bound / 0 when there is none yet. */
export function stepNumber(current: number | undefined, dir: 1 | -1, opts: { min?: number; max?: number; integer?: boolean; step?: number }): number {
  const step = opts.step ?? 1
  const base = current ?? (opts.min !== undefined && opts.min > 0 ? opts.min - (dir > 0 ? step : 0) : dir > 0 ? -step : step)
  return normalizeNumber(base + dir * step, opts)
}

export interface SpinFieldProps {
  value: number | undefined
  /** `stepping` is true for arrow clicks / arrow keys (callers coalesce those into one undo step) */
  onChange(value: number | undefined, stepping?: boolean): void
  min?: number
  max?: number
  step?: number
  integer?: boolean
  /** unit shown after the number (pt, %, px) */
  unit?: string
  /** shown in gray when there is no value: the visual decides ("Auto") */
  placeholder?: string
  label: string
  disabled?: boolean
  className?: string
}

/** Numeric box that commits on blur / Enter, with PBI's stacked up / down arrows (↑ / ↓ keys step too). */
export function SpinField(p: SpinFieldProps) {
  const shown = p.value === undefined ? '' : String(p.value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const opts = { min: p.min, max: p.max, integer: p.integer, step: p.step }
  const commit = (t: string) => {
    const parsed = parseNumberInput(t)
    if (parsed === null) return setText(shown)
    if (parsed === undefined) {
      if (p.value !== undefined) p.onChange(undefined)
      return setText(shown)
    }
    const n = normalizeNumber(parsed, opts)
    setText(String(n))
    if (n !== p.value) p.onChange(n)
  }
  const step = (dir: 1 | -1) => {
    const typed = parseNumberInput(text)
    const n = stepNumber(typeof typed === 'number' ? typed : p.value, dir, opts)
    setText(String(n))
    if (n !== p.value) p.onChange(n, true)
  }
  return (
    <div className={cx('wbi-input', 'wbi-input--small', 'wbi-spin', p.disabled && 'is-disabled', p.className)}>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={p.label}
        aria-valuenow={p.value}
        aria-valuemin={p.min}
        aria-valuemax={p.max}
        value={text}
        placeholder={p.placeholder ?? 'Auto'}
        disabled={p.disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          else if (e.key === 'Escape') setText(shown)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      {p.unit && text.trim() !== '' && <span className="wbi-spin__unit">{p.unit}</span>}
      <span className="wbi-spin__btns">
        <button type="button" tabIndex={-1} aria-label={`Increase ${p.label}`} disabled={p.disabled || (p.max !== undefined && p.value !== undefined && p.value >= p.max)} onClick={() => step(1)}>
          <ChevronUpRegular fontSize={10} />
        </button>
        <button type="button" tabIndex={-1} aria-label={`Decrease ${p.label}`} disabled={p.disabled || (p.min !== undefined && p.value !== undefined && p.value <= p.min)} onClick={() => step(-1)}>
          <ChevronDownRegular fontSize={10} />
        </button>
      </span>
    </div>
  )
}

/** PBI's percent control: spin box, then the slider. `value` undefined = automatic (thumb at the start, box says Auto). */
export function PercentSlider(p: { value: number | undefined; onChange(value: number | undefined, sliding?: boolean): void; min?: number; max?: number; label: string }) {
  const min = p.min ?? 0
  const max = p.max ?? 100
  const v = Math.max(min, Math.min(max, p.value ?? min))
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0
  return (
    <div className="wbi-fslider">
      <SpinField className="wbi-fslider__num" label={p.label} value={p.value} min={min} max={max} integer unit="%" onChange={p.onChange} />
      <input type="range" aria-label={`${p.label} slider`} min={min} max={max} step={1} value={v} style={{ '--wbi-pct': `${pct}%` } as React.CSSProperties} onChange={(e) => p.onChange(Number(e.target.value), true)} />
    </div>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon: ReactNode
}

/** Icon button group. `mode="radio"`: one of the options (alignment); `mode="toggle"`: independent on/off buttons (B / I / U). */
export function Segmented<T extends string>(p: { mode: 'radio' | 'toggle'; options: Array<SegmentOption<T>>; isOn(value: T): boolean; onPick(value: T): void; label: string; propOf?(value: T): string }) {
  return (
    <div className="wbi-fmt__seg" role={p.mode === 'radio' ? 'radiogroup' : 'group'} aria-label={p.label}>
      {p.options.map((o) => {
        const on = p.isOn(o.value)
        return (
          <Tip key={o.value} title={o.label}>
            <button
              type="button"
              {...(p.mode === 'radio' ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on })}
              aria-label={o.label}
              data-prop={p.propOf?.(o.value)}
              className={cx('wbi-fmt__segbtn', on && 'is-on')}
              onClick={() => p.onPick(o.value)}
            >
              {o.icon}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}
