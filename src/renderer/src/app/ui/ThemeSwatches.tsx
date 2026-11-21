/**
 * The "Theme colors" grid shared by the color picker's Solid tab and the Gradient tab's stop editor: one row of base
 * colors (background, foreground, the first 8 data colors) and, under each, a framed column of 5 tints/shades.
 *
 * Like Power BI Desktop, a near-white base only gets darker shades and a near-black base only lighter tints, so no
 * column repeats the same color five times. Exactly one swatch is marked current (the first match).
 */
import { parseHex, shadeColor } from '@core/report/theme'
import { cx } from './cx'

export interface ThemeColorRef {
  colorId: number
  percent: number
}

const TINTS = [0.6, 0.4, 0.2, -0.25, -0.5]
const LIGHT_SHADES = [-0.05, -0.15, -0.25, -0.35, -0.5]
const DARK_TINTS = [0.5, 0.35, 0.25, 0.15, 0.05]

/** The tint (+) / shade (−) percents offered under a base color, top to bottom: near-white and near-black (gray) bases only go one way. */
export function shadePercents(hex: string): number[] {
  if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return TINTS
  const [r, g, b] = parseHex(hex)
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const gray = Math.max(r, g, b) - Math.min(r, g, b) < 40
  return l > 0.9 ? LIGHT_SHADES : gray && l < 0.2 ? DARK_TINTS : TINTS
}

export function baseColorName(i: number): string {
  return i === 0 ? 'White' : i === 1 ? 'Black' : `Theme color ${i - 1}`
}

export function ThemeSwatches({ base, current, onPick }: { base: string[]; current?: string; onPick(hex: string, ref: ThemeColorRef): void }) {
  const cur = current?.toUpperCase()
  const columns = base.map((c, i) => ({
    base: c.toUpperCase(),
    name: baseColorName(i),
    shades: shadePercents(c).map((t) => ({ t, hex: shadeColor(c, t).toUpperCase() }))
  }))
  let currentKey: string | undefined
  if (cur) {
    const b = columns.findIndex((c) => c.base === cur)
    if (b >= 0) currentKey = `b${b}`
    else
      for (let row = 0; row < 5 && !currentKey; row++) {
        const i = columns.findIndex((c) => c.shades[row]?.hex === cur)
        if (i >= 0) currentKey = `${row}-${i}`
      }
  }
  return (
    <div className="wbi-colorpop__theme">
      <div className="wbi-colorpop__grid">
        {columns.map((c, i) => (
          <button key={i} type="button" title={`${c.name}, ${c.base}`} className={cx('wbi-colorpop__sw', currentKey === `b${i}` && 'is-current')} style={{ background: c.base }} onClick={() => onPick(c.base, { colorId: i, percent: 0 })} />
        ))}
      </div>
      <div className="wbi-colorpop__grid wbi-colorpop__grid--tints">
        {columns.map((c, i) => (
          <div key={i} className="wbi-colorpop__col">
            {c.shades.map(({ t, hex }, row) => (
              <button
                key={row}
                type="button"
                title={`${hex}, ${c.name} ${t > 0 ? `${Math.round(t * 100)}% lighter` : `${Math.round(-t * 100)}% darker`}`}
                className={cx('wbi-colorpop__sw', currentKey === `${row}-${i}` && 'is-current')}
                style={{ background: hex }}
                onClick={() => onPick(hex, { colorId: i, percent: t })}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
