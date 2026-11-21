import type { CSSProperties } from 'react'
import type { VisualProps } from '../contract'
import { withTransparency } from '@core/report/theme'
import { cssFont, ptToPx } from '../common/textStyle'
import { normalizeShapeKind } from './shapes'
import { ShapeSvg, type GlowSpec, type ShadowSpec } from './ShapeSvg'
import { Props, stateSelector, useElementState, type ElementState } from './util'
import { useAction } from './useAction'

/**
 * Power BI shape defaults (Insert → Shapes, `shape` visual). Evidence:
 *  - fill: the theme's first data color ("Color 1"; #118DFF in the default theme) — Fabric community answers
 *    on "Default fill colour for new shapes";
 *  - fill and border are ON by default: reports that want no fill/border write `fill.show=false` /
 *    `outline.show=false` explicitly (observed on every shape of a real-world PBIR corpus);
 *  - border color: no contrasting outline is visible on Microsoft Learn's default-styled shape screenshot
 *    ("Add text boxes, shapes…"), so the outline defaults to the fill color (approximation: PBI's exact default
 *    border color isn't documented).
 * `fill` / `outline` here are the fallbacks when the theme has no data colors.
 */
export const SHAPE_DEFAULTS = { fill: '#118DFF', outline: '#118DFF', weight: 1, roundedCurve: 10, textSize: 12, textColor: '#252423' }

/** Theme-aware shape fill default (theme data color 1). */
export function shapeDefaultFill(theme: { dataColors?: string[] }): string {
  return theme.dataColors?.[0] ?? SHAPE_DEFAULTS.fill
}

export function readShadow(p: Props, object: string, state?: ElementState): ShadowSpec | undefined {
  const sel = state ? stateSelector(state) : undefined
  if (!p.bool(object, 'show', false, sel)) return undefined
  const color = withTransparency(p.color(object, 'color', '#000000', sel), p.num(object, 'transparency', 70, sel))
  const angle = (p.num(object, 'angle', 45, sel) * Math.PI) / 180
  const dist = p.num(object, 'shadowDistance', p.num(object, 'distance', 10, sel), sel)
  const blur = p.num(object, 'shadowBlur', p.num(object, 'blur', 10, sel), sel)
  return { color, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, blur }
}

export function readGlow(p: Props, object: string, state?: ElementState): GlowSpec | undefined {
  const sel = state ? stateSelector(state) : undefined
  if (!p.bool(object, 'show', false, sel)) return undefined
  return {
    color: withTransparency(p.color(object, 'color', '#000000', sel), p.num(object, 'transparency', 70, sel)),
    blur: p.num(object, 'glowBlur', p.num(object, 'blur', 10, sel), sel)
  }
}

export interface ShapeTextSpec {
  text: string
  style: CSSProperties
}

/** `text` object of shapes/buttons for a state → content + CSS (margins as padding, alignment as flex). */
export function readShapeText(p: Props, state: ElementState, defaults: { size: number; color: string; align?: string; valign?: string; show?: boolean; family?: string }): ShapeTextSpec | undefined {
  const sel = stateSelector(state)
  if (!p.bool('text', 'show', defaults.show ?? false, sel)) return undefined
  const text = p.str('text', 'text', '', sel)
  const family = cssFont(p.str('text', 'fontFamily', defaults.family ?? 'Segoe UI', sel))
  const bold = p.bool('text', 'bold', false, sel)
  const halign = p.str('text', 'horizontalAlignment', defaults.align ?? 'center', sel).toLowerCase()
  const valign = p.str('text', 'verticalAlignment', defaults.valign ?? 'middle', sel).toLowerCase()
  return {
    text,
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
      textAlign: halign === 'left' ? 'left' : halign === 'right' ? 'right' : 'center',
      fontFamily: family.fontFamily,
      fontWeight: bold ? 700 : family.fontWeight ?? 400,
      fontStyle: p.bool('text', 'italic', false, sel) ? 'italic' : 'normal',
      textDecoration: p.bool('text', 'underline', false, sel) ? 'underline' : undefined,
      fontSize: ptToPx(p.num('text', 'fontSize', defaults.size, sel)),
      color: withTransparency(p.color('text', 'fontColor', defaults.color, sel), p.num('text', 'transparency', 0, sel)),
      paddingLeft: p.num('text', 'leftMargin', 10, sel),
      paddingRight: p.num('text', 'rightMargin', 10, sel),
      paddingTop: p.num('text', 'topMargin', 4, sel),
      paddingBottom: p.num('text', 'bottomMargin', 4, sel),
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      lineHeight: 1.25
    }
  }
}

export function ShapeVisual({ visual, width, height, ctx }: VisualProps) {
  const p = new Props(visual.json, ctx.theme)
  const action = useAction(visual.json, ctx)
  const { state, handlers } = useElementState(action.interactive)
  const sel = stateSelector(state)
  const kind = normalizeShapeKind(p.str('shape', 'tileShape', 'rectangle'))
  const radius = p.num('shape', 'rectangleRoundedCurve', p.num('shape', 'roundEdge', SHAPE_DEFAULTS.roundedCurve))
  const defFill = shapeDefaultFill(ctx.theme)
  const fill = p.bool('fill', 'show', true, sel) ? withTransparency(p.color('fill', 'fillColor', defFill, sel), p.num('fill', 'transparency', 0, sel)) : undefined
  const outlineOn = p.bool('outline', 'show', true, sel)
  const stroke = outlineOn ? withTransparency(p.color('outline', 'lineColor', defFill, sel), p.num('outline', 'transparency', 0, sel)) : undefined
  const fillGradient = fill ? p.gradient('fill', 'fillColor', sel) : undefined
  const strokeGradient = stroke ? p.gradient('outline', 'lineColor', sel) : undefined
  const weight = outlineOn ? p.num('outline', 'weight', SHAPE_DEFAULTS.weight, sel) : 0
  const rotation = p.num('rotation', 'shapeAngle', p.num('rotation', 'angle', 0))
  const text = readShapeText(p, state, { size: SHAPE_DEFAULTS.textSize, color: SHAPE_DEFAULTS.textColor })
  const textAngle = p.num('rotation', 'textAngle', 0)
  return (
    <div
      style={{ position: 'relative', width, height, cursor: action.interactive ? 'pointer' : undefined }}
      title={action.interactive ? action.title : undefined}
      onClick={action.onClick}
      {...handlers}
    >
      <ShapeSvg
        kind={kind}
        width={width}
        height={height}
        radius={radius}
        fill={fill}
        stroke={stroke}
        fillPaint={fillGradient ? { gradient: fillGradient, transparency: p.num('fill', 'transparency', 0, sel) } : undefined}
        strokePaint={strokeGradient ? { gradient: strokeGradient, transparency: p.num('outline', 'transparency', 0, sel) } : undefined}
        strokeWidth={weight}
        rotation={rotation}
        shadow={readShadow(p, 'shadow', state)}
        glow={readGlow(p, 'glow', state)}
      />
      {text && (
        <div style={{ position: 'absolute', inset: 0, ...text.style, transform: textAngle ? `rotate(${textAngle}deg)` : undefined }}>
          {text.text}
        </div>
      )}
    </div>
  )
}
