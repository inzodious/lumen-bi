/**
 * Gradient tab of the color picker (Lumen-only, core/report/gradientFill.ts): a preview bar with draggable stops,
 * the selected stop's color (theme swatches + hex), its position, the gradient type and angle.
 */
import { useRef, useState } from 'react'
import { AddRegular, DeleteRegular } from '@fluentui/react-icons'
import { colorAt, gradientCss, type GradientFill, type GradientStop } from '@core/report/gradientFill'
import { shadeColor } from '@core/report/theme'
import { TextField } from './primitives'
import { cx } from './cx'

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
const MAX_STOPS = 8

export interface GradientEditorProps {
  initial: GradientFill
  swatches: string[]
  onApply(g: GradientFill): void
  onCancel(): void
}

interface EditStop extends GradientStop {
  /** stable identity while stops are re-sorted and recolored */
  id: number
}

interface EditState {
  kind: GradientFill['kind']
  angle: number
  stops: EditStop[]
  sel: number
}

const sortStops = (stops: EditStop[]) => [...stops].sort((a, b) => a.offset - b.offset)

export function GradientEditor({ initial, swatches, onApply, onCancel }: GradientEditorProps) {
  const [st, setSt] = useState<EditState>(() => ({ kind: initial.kind, angle: initial.angle, stops: initial.stops.map((x, i) => ({ ...x, id: i })), sel: 0 }))
  const nextId = useRef(initial.stops.length)
  const stop = st.stops.find((x) => x.id === st.sel) ?? st.stops[0]
  const [hex, setHex] = useState(stop.color)
  const bar = useRef<HTMLDivElement>(null)
  const g: GradientFill = { kind: st.kind, angle: st.angle, stops: st.stops.map(({ color, offset }) => ({ color, offset })) }

  const select = (s: EditStop) => {
    setSt((cur) => ({ ...cur, sel: s.id }))
    setHex(s.color)
  }
  const patchStop = (id: number, patch: Partial<GradientStop>) => setSt((cur) => ({ ...cur, stops: sortStops(cur.stops.map((x) => (x.id === id ? { ...x, ...patch } : x))) }))
  const setStopColor = (color: string) => {
    patchStop(stop.id, { color: color.toUpperCase() })
    setHex(color.toUpperCase())
  }
  const setStopOffset = (offset: number) => patchStop(stop.id, { offset: Math.max(0, Math.min(1, offset)) })
  const addStop = () => {
    if (st.stops.length >= MAX_STOPS) return
    // halfway along the widest gap
    const s = st.stops
    let best = 0
    for (let i = 1; i < s.length - 1; i++) if (s[i + 1].offset - s[i].offset > s[best + 1].offset - s[best].offset) best = i
    const offset = (s[best].offset + s[best + 1].offset) / 2
    const added: EditStop = { color: colorAt(g, offset).slice(0, 7), offset, id: nextId.current++ }
    setSt((cur) => ({ ...cur, stops: sortStops([...cur.stops, added]), sel: added.id }))
    setHex(added.color)
  }
  const removeStop = () => {
    if (st.stops.length <= 2) return
    const i = st.stops.indexOf(stop)
    const rest = st.stops.filter((x) => x.id !== stop.id)
    const next = rest[Math.max(0, i - 1)]
    setSt((cur) => ({ ...cur, stops: cur.stops.filter((x) => x.id !== stop.id), sel: next.id }))
    setHex(next.color)
  }
  const dragStop = (e: React.PointerEvent, s: EditStop) => {
    e.preventDefault()
    e.stopPropagation()
    select(s)
    const el = bar.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const move = (ev: PointerEvent) => patchStop(s.id, { offset: Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 100) / 100 })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="wbi-gradpop" data-gradient-editor>
      <div className="wbi-gradpop__preview" style={{ background: gradientCss(g) }} aria-label="Gradient preview" />
      <div ref={bar} className="wbi-gradpop__bar" style={{ background: gradientCss({ ...g, kind: 'linear', angle: 90 }) }}>
        {st.stops.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={cx('wbi-gradpop__stop', s === stop && 'is-current')}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
            title={`${s.color}, ${Math.round(s.offset * 100)}%`}
            aria-label={`Stop ${i + 1}`}
            onPointerDown={(e) => dragStop(e, s)}
          />
        ))}
      </div>
      <div className="wbi-row wbi-gradpop__stoprow">
        <span className="wbi-gradpop__label">Stop {st.stops.indexOf(stop) + 1}</span>
        <button type="button" className="wbi-btn wbi-btn--small" onClick={addStop} disabled={st.stops.length >= MAX_STOPS} title="Add stop" aria-label="Add stop">
          <AddRegular fontSize={14} />
        </button>
        <button type="button" className="wbi-btn wbi-btn--small" onClick={removeStop} disabled={st.stops.length <= 2} title="Remove stop" aria-label="Remove stop">
          <DeleteRegular fontSize={14} />
        </button>
      </div>
      <div className="wbi-colorpop__grid">
        {swatches.map((c, i) => (
          <button key={i} type="button" title={c.toUpperCase()} className={cx('wbi-colorpop__sw', stop.color === c.toUpperCase() && 'is-current')} style={{ background: c }} onClick={() => setStopColor(c)} />
        ))}
      </div>
      <div className="wbi-colorpop__grid wbi-colorpop__grid--tints">
        {[0.6, 0.3, -0.25, -0.5].flatMap((t, row) =>
          swatches.map((c, i) => {
            const h = shadeColor(c, t)
            return <button key={`${row}-${i}`} type="button" title={h} className={cx('wbi-colorpop__sw', stop.color === h && 'is-current')} style={{ background: h }} onClick={() => setStopColor(h)} />
          })
        )}
      </div>
      <div className="wbi-row wbi-gradpop__fields">
        <span className="wbi-color-btn__swatch" style={{ background: stop.color, width: 24, height: 24 }} />
        <TextField
          value={hex}
          onChange={setHex}
          onCommit={(t) => {
            const v = t.trim().startsWith('#') ? t.trim() : '#' + t.trim()
            if (/^#[0-9a-f]{6}$/i.test(v)) setStopColor(v)
            else setHex(stop.color)
          }}
          size="small"
          style={{ width: 84 }}
          aria-label="Stop color"
        />
        <label className="wbi-gradpop__label" title="Position">
          <input type="number" className="wbi-gradpop__num" min={0} max={100} value={Math.round(stop.offset * 100)} onChange={(e) => setStopOffset(Number(e.target.value) / 100)} aria-label="Stop position" />%
        </label>
      </div>
      <div className="wbi-row wbi-gradpop__fields">
        <div className="wbi-gradpop__seg" role="radiogroup" aria-label="Gradient type">
          {(['linear', 'radial'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={g.kind === k} className={cx('wbi-gradpop__segbtn', g.kind === k && 'is-on')} onClick={() => setSt((cur) => ({ ...cur, kind: k }))}>
              {k === 'linear' ? 'Linear' : 'Radial'}
            </button>
          ))}
        </div>
        {g.kind === 'linear' && (
          <label className="wbi-gradpop__label" title="Angle">
            <input type="number" className="wbi-gradpop__num" min={0} max={359} value={g.angle} onChange={(e) => setSt((cur) => ({ ...cur, angle: ((Math.round(Number(e.target.value)) % 360) + 360) % 360 }))} aria-label="Angle" />°
          </label>
        )}
      </div>
      {g.kind === 'linear' && (
        <div className="wbi-gradpop__angles" role="radiogroup" aria-label="Direction">
          {ANGLES.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={g.angle === a} aria-label={`${a}°`} title={`${a}°`} className={cx('wbi-gradpop__angle', g.angle === a && 'is-on')} onClick={() => setSt((cur) => ({ ...cur, angle: a }))}>
              <span style={{ transform: `rotate(${a}deg)` }}>↑</span>
            </button>
          ))}
        </div>
      )}
      <div className="wbi-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="wbi-btn wbi-btn--small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="wbi-btn wbi-btn--small wbi-btn--primary" onClick={() => onApply(g)}>
          Apply
        </button>
      </div>
    </div>
  )
}
