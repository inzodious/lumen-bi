/**
 * Power BI color picker: swatch button → popover with "Theme colors" (background, foreground and
 * the first 8 data colors, each with 5 tint/shade rows like PBI), "Recent colors", and
 * "More colors…" (saturation/value square + hue slider + hex field).
 *
 * onChange receives the hex color and, when a theme swatch was picked, the ThemeDataColor
 * reference ({ colorId, percent }) so callers can store `{ expr: { ThemeDataColor } }` like PBI.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowResetRegular, ChevronDownRegular, ColorRegular } from '@fluentui/react-icons'
import { shadeColor, parseHex, toHex } from '@core/report/theme'
import { Popover } from './Popover'
import { TextField } from './primitives'
import { cx } from './cx'

export interface ThemeColorRef {
  colorId: number
  percent: number
}

const RECENT_KEY = 'wbi.recentColors'
const TINTS = [0.6, 0.4, 0.2, -0.25, -0.5]

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

function pushRecent(hex: string): void {
  try {
    const list = [hex.toUpperCase(), ...readRecent().filter((c) => c.toUpperCase() !== hex.toUpperCase())].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: recent colors are a convenience only */
  }
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export interface ColorPickerProps {
  value: string | undefined
  onChange(hex: string, theme?: ThemeColorRef): void
  /** theme colors: [background, foreground, ...dataColors] */
  themeColors: { background: string; foreground: string; dataColors: string[] }
  /** show a "Reset to default" action */
  onReset?(): void
  disabled?: boolean
  label?: string
  className?: string
  /** tooltip of the swatch when no color is set (default "No color") */
  emptyTitle?: string
}

export function ColorPicker(p: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const base = useMemo(() => [p.themeColors.background, p.themeColors.foreground, ...p.themeColors.dataColors.slice(0, 8)], [p.themeColors])
  const pick = (hex: string, theme?: ThemeColorRef) => {
    pushRecent(hex)
    p.onChange(hex, theme)
    setOpen(false)
    setCustom(false)
  }
  const cur = p.value?.toUpperCase()
  const button = (
    <button ref={ref} type="button" disabled={p.disabled} className={cx('wbi-color-btn', !p.label && p.className)} onClick={() => setOpen((o) => !o)} aria-label={p.label ?? 'Color'} title={p.value ? p.value.toUpperCase() : (p.emptyTitle ?? 'No color')}>
      <span className={cx('wbi-color-btn__swatch', !p.value && 'is-empty')} style={p.value ? { background: p.value } : undefined} />
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
        <Popover anchor={ref.current} open onClose={() => (setOpen(false), setCustom(false))} ignoreOutside={[ref.current]}>
          <div className="wbi-colorpop">
            {custom ? (
              <CustomColor initial={p.value ?? '#118DFF'} onPick={(h) => pick(h)} onBack={() => setCustom(false)} />
            ) : (
              <>
                <div className="wbi-colorpop__title">Theme colors</div>
                <div className="wbi-colorpop__grid">
                  {base.map((c, i) => (
                    <button key={i} type="button" title={`${i === 0 ? 'White' : i === 1 ? 'Black' : `Theme color ${i - 1}`}, ${c.toUpperCase()}`} className={cx('wbi-colorpop__sw', cur === c.toUpperCase() && 'is-current')} style={{ background: c }} onClick={() => pick(c.toUpperCase(), { colorId: i, percent: 0 })} />
                  ))}
                </div>
                <div className="wbi-colorpop__grid wbi-colorpop__grid--tints">
                  {TINTS.flatMap((t, row) =>
                    base.map((c, i) => {
                      const hex = shadeColor(c, t)
                      return (
                        <button
                          key={`${row}-${i}`}
                          type="button"
                          title={`${hex}, ${t > 0 ? `${Math.round(t * 100)}% lighter` : `${Math.round(-t * 100)}% darker`}`}
                          className={cx('wbi-colorpop__sw', cur === hex && 'is-current')}
                          style={{ background: hex, borderTop: row === 0 ? undefined : 0, borderBottom: row === TINTS.length - 1 ? undefined : 0 }}
                          onClick={() => pick(hex, { colorId: i, percent: t })}
                        />
                      )
                    })
                  )}
                </div>
                <RecentRow onPick={(h) => pick(h)} current={cur} />
                <div className="wbi-colorpop__sep" />
                <button type="button" className="wbi-colorpop__link" onClick={() => setCustom(true)}>
                  <ColorRegular fontSize={16} /> More colors…
                </button>
                {p.onReset && (
                  <button
                    type="button"
                    className="wbi-colorpop__link"
                    onClick={() => {
                      setOpen(false)
                      p.onReset!()
                    }}
                  >
                    <ArrowResetRegular fontSize={16} /> Reset to default
                  </button>
                )}
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  )
}

function RecentRow({ onPick, current }: { onPick(hex: string): void; current?: string }) {
  const recent = readRecent()
  if (!recent.length) return null
  return (
    <>
      <div className="wbi-colorpop__title" style={{ marginTop: 10 }}>
        Recent colors
      </div>
      <div className="wbi-colorpop__grid">
        {recent.map((c) => (
          <button key={c} type="button" title={c} className={cx('wbi-colorpop__sw', current === c && 'is-current')} style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
    </>
  )
}

function CustomColor({ initial, onPick, onBack }: { initial: string; onPick(hex: string): void; onBack(): void }) {
  const [hsv, setHsv] = useState(() => {
    const [r, g, b] = parseHex(/^#[0-9a-f]{3,8}$/i.test(initial) ? initial : '#118DFF')
    return rgbToHsv(r, g, b)
  })
  const hex = hsvToHex(hsv[0], hsv[1], hsv[2])
  const [text, setText] = useState(hex)
  useEffect(() => setText(hex), [hex])
  const sv = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent) => {
    const el = sv.current!
    const r = el.getBoundingClientRect()
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
      const v = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height))
      setHsv((h) => [h[0], s, v])
    }
    move(e)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="wbi-colorpop__custom">
      <div ref={sv} className="wbi-colorpop__sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv[0], 1, 1)})` }} onPointerDown={drag}>
        <span className="wbi-colorpop__dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <input className="wbi-colorpop__hue" type="range" min={0} max={359} value={Math.round(hsv[0])} onChange={(e) => setHsv((h) => [Number(e.target.value), h[1], h[2]])} />
      <div className="wbi-row">
        <span className="wbi-color-btn__swatch" style={{ background: hex, width: 32, height: 28 }} />
        <TextField
          value={text}
          onChange={setText}
          onCommit={(t) => {
            const v = t.trim().startsWith('#') ? t.trim() : '#' + t.trim()
            if (/^#[0-9a-f]{6}$/i.test(v)) {
              const [r, g, b] = parseHex(v)
              setHsv(rgbToHsv(r, g, b))
            } else setText(hex)
          }}
          size="small"
          style={{ width: 100 }}
        />
      </div>
      <div className="wbi-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="wbi-btn wbi-btn--small" onClick={onBack}>
          Back
        </button>
        <button type="button" className="wbi-btn wbi-btn--small wbi-btn--primary" onClick={() => onPick(hex)}>
          Apply
        </button>
      </div>
    </div>
  )
}
