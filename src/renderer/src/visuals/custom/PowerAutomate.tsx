/**
 * Power Automate for Power BI (`FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A`), Microsoft's
 * custom visual that runs a cloud flow when clicked. We render the button exactly as formatted
 * (objects from the visual's capabilities: `buttonText` show/text/fontColor/fontSize/fontFamily/
 * textPadding/horizontalAlignment/verticalAlignment, `buttonFill` show/color, each with button-state
 * selectors `default` / `hover` / `selected`). Flows can't run outside the Power BI service, so a click
 * shows a short notice instead of triggering anything.
 *
 * Defaults are sampled from Microsoft Learn's "Run flow" screenshot (power-bi-automate-visual):
 * fill #0066FF, white "Run flow" label with a play glyph, ~14px Segoe UI, 2px corners.
 */
import { useEffect, useState } from 'react'
import { getProp, makePropContext, type Selector } from '@core/report/props'
import type { VisualProps } from '../contract'
import { cssAlign, fontStyle, readFont } from '../common/textStyle'

export const POWER_AUTOMATE_TYPE = 'FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A'

export interface PowerAutomateFormat {
  showText: boolean
  text: string
  fontColor: string
  /** pt */
  fontSize: number
  fontFamily?: string
  padding: number
  hAlign: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
  fill?: string
}

export type PowerAutomateState = 'default' | 'hover' | 'selected'

/** Resolve the button format for a state (state entries fall back to the default entry). */
export function readPowerAutomateFormat(visualJson: any, theme: any, state: PowerAutomateState = 'default'): PowerAutomateFormat {
  const pc = makePropContext(visualJson, theme)
  const sel: Selector | undefined = state === 'default' ? undefined : { id: state }
  const get = <T,>(obj: string, prop: string, d: T): T => {
    const v = sel ? getProp<T | undefined>(pc, obj, prop, undefined, sel) : undefined
    return v ?? getProp<T>(pc, obj, prop, d)
  }
  const font = readFont(pc, 'buttonText', { size: 10.5, color: '#FFFFFF', family: 'Segoe UI' }, {}, sel)
  const fallbackFont = sel ? readFont(pc, 'buttonText', { size: 10.5, color: '#FFFFFF', family: 'Segoe UI' }) : font
  const has = (prop: string) => sel && getProp<any>(pc, 'buttonText', prop, undefined, sel) !== undefined
  const v = String(get<any>('buttonText', 'verticalAlignment', 'middle')).toLowerCase()
  const fillShow = get<boolean>('buttonFill', 'show', true) !== false
  const fill = get<any>('buttonFill', 'color', '#0066FF')
  return {
    showText: get<boolean>('buttonText', 'show', true) !== false,
    text: String(get<any>('buttonText', 'text', 'Run flow') ?? 'Run flow'),
    fontColor: has('fontColor') ? font.color : fallbackFont.color,
    fontSize: has('fontSize') ? font.size : fallbackFont.size,
    fontFamily: has('fontFamily') ? font.family : fallbackFont.family,
    padding: Number(get<any>('buttonText', 'textPadding', 0)) || 0,
    hAlign: cssAlign(get<any>('buttonText', 'horizontalAlignment', 'center'), 'center') as PowerAutomateFormat['hAlign'],
    vAlign: v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle',
    fill: fillShow && typeof fill === 'string' ? fill : undefined
  }
}

export function PowerAutomateVisual({ visual, ctx, width, height }: VisualProps) {
  const [hover, setHover] = useState(false)
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(false), 2500)
    return () => clearTimeout(t)
  }, [notice])
  const f = readPowerAutomateFormat(visual.json, ctx.theme, hover ? 'hover' : 'default')
  const fs = fontStyle({ family: f.fontFamily, size: f.fontSize, color: f.fontColor })
  const px = Number.parseFloat(String(fs.fontSize)) || 14
  const run = (e: React.MouseEvent) => {
    // PBI: plain click in reading view, Ctrl+click while editing
    if (ctx.mode === 'edit' && !(e.ctrlKey || e.metaKey)) return
    setNotice(true)
  }
  const label = notice ? 'Flows run only in the Power BI service' : f.text
  return (
    <div
      role="button"
      aria-label={f.text}
      title={ctx.mode === 'edit' ? 'CTRL+click to run the flow' : 'Power Automate flows run only in the Power BI service'}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={run}
      style={{
        width,
        height,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: f.vAlign === 'top' ? 'flex-start' : f.vAlign === 'bottom' ? 'flex-end' : 'center',
        justifyContent: f.hAlign === 'left' ? 'flex-start' : f.hAlign === 'right' ? 'flex-end' : 'center',
        gap: Math.round(px * 0.55),
        padding: f.padding,
        background: f.fill ?? 'transparent',
        borderRadius: 2,
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {f.showText && (
        <>
          <svg width={px * 0.85} height={px * 0.85} viewBox="0 0 16 16" aria-hidden style={{ flex: 'none' }}>
            <path d="M4 2.5v11l9-5.5z" fill="none" stroke={f.fontColor} strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span style={{ ...fs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{label}</span>
        </>
      )}
    </div>
  )
}
