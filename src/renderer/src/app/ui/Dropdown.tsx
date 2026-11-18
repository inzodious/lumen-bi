/**
 * Dropdown (Fluent combobox look). Options can carry icons; optional search box for long lists.
 */
import { useRef, useState, type ReactNode } from 'react'
import { ChevronDownRegular } from '@fluentui/react-icons'
import { Popover } from './Popover'
import { SearchBox } from './primitives'
import { cx } from './cx'

export interface DropdownOption<T> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
  /** render a header row above this option */
  group?: string
  /** CSS font-family preview for font pickers */
  fontFamily?: string
}

export interface DropdownProps<T> {
  value: T | undefined
  options: Array<DropdownOption<T>>
  onChange(value: NoInfer<T>): void
  placeholder?: string
  label?: string
  disabled?: boolean
  size?: 'normal' | 'small'
  searchable?: boolean
  className?: string
  title?: string
  /** displayed text override */
  renderValue?(opt: DropdownOption<T> | undefined): ReactNode
}

export function Dropdown<T extends string | number | boolean>(p: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLButtonElement>(null)
  const current = p.options.find((o) => o.value === p.value)
  const filtered = q ? p.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : p.options
  const button = (
    <button
      ref={ref}
      type="button"
      title={p.title}
      disabled={p.disabled}
      className={cx('wbi-dropdown', p.size === 'small' && 'wbi-dropdown--small', open && 'is-open', !p.label && p.className)}
      onClick={() => setOpen((o) => !o)}
      aria-haspopup="listbox"
    >
      {current?.icon}
      <span className={cx('wbi-dropdown__value', !current && 'wbi-dropdown__placeholder')} style={current?.fontFamily ? { fontFamily: current.fontFamily } : undefined}>
        {p.renderValue ? p.renderValue(current) : current?.label ?? p.placeholder ?? 'Select'}
      </span>
      <ChevronDownRegular fontSize={12} />
    </button>
  )
  return (
    <>
      {p.label ? (
        <div className={cx('wbi-field', p.className)}>
          <span className="wbi-field__label">{p.label}</span>
          {button}
        </div>
      ) : (
        button
      )}
      {open && (
        <Popover anchor={ref.current} open matchWidth onClose={() => (setOpen(false), setQ(''))} ignoreOutside={[ref.current]}>
          <div className="wbi-menu" role="listbox">
            {(p.searchable || p.options.length > 20) && (
              <div style={{ padding: '4px 8px 6px' }}>
                <SearchBox value={q} onChange={setQ} size="small" autoFocus />
              </div>
            )}
            {filtered.map((o, i) => (
              <div key={String(o.value)}>
                {o.group && o.group !== filtered[i - 1]?.group && <div className="wbi-menu__header">{o.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === p.value}
                  disabled={o.disabled}
                  className={cx('wbi-menu__item', o.value === p.value && 'is-selected')}
                  style={o.fontFamily ? { fontFamily: o.fontFamily } : undefined}
                  onClick={() => {
                    setOpen(false)
                    setQ('')
                    p.onChange(o.value)
                  }}
                >
                  {o.icon && <span className="wbi-menu__icon">{o.icon}</span>}
                  <span className="wbi-menu__label">{o.label}</span>
                </button>
              </div>
            ))}
            {!filtered.length && <div className="wbi-menu__header">No matches</div>}
          </div>
        </Popover>
      )}
    </>
  )
}
