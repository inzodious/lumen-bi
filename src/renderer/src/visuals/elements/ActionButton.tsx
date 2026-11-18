import type { CSSProperties } from 'react'
import type { VisualProps } from '../contract'
import { withTransparency } from '@core/report/theme'
import { iconPaths, normalizeIconKind, type ButtonIconKind } from './buttonIcons'
import { normalizeShapeKind } from './shapes'
import { ShapeSvg } from './ShapeSvg'
import { readGlow, readShadow, readShapeText } from './Shape'
import { Props, stateSelector, useElementState, type ElementState } from './util'
import { useAction } from './useAction'
import type { ActionType } from './actions'

/**
 * PBI button defaults (Classic base theme): white fill, 1px gray outline (ON by default — reports that hide it
 * write `outline.show=false` explicitly), icon ON in #605E5C (sampled from Microsoft Learn's "Create buttons"
 * screenshot of a default Q&A button), text OFF, Segoe UI 10pt #252423 when turned on.
 */
export const BUTTON_DEFAULTS = { fill: '#FFFFFF', outline: '#B3B0AD', icon: '#605E5C', iconWeight: 2, textSize: 10, textColor: '#252423' }

/** Icon a new button of an action type shows (used when `icon.shapeType` is unset). */
export function defaultIconFor(type: ActionType | undefined): ButtonIconKind {
  switch (type) {
    case 'Back':
      return 'back'
    case 'Bookmark':
      return 'bookmark'
    case 'QnA':
      return 'qna'
    case 'ClearAllSlicers':
      return 'clearAllSlicers'
    case 'ApplyAllSlicers':
      return 'applyAllSlicers'
    default:
      return 'blank'
  }
}

export function ButtonIcon({ kind, size, color, weight }: { kind: ButtonIconKind; size: number; color: string; weight: number }) {
  const paths = iconPaths(kind)
  if (!paths.length || size <= 0) return null
  // PBI scales stroke with the icon; keep the visual weight comparable at 24px.
  const sw = (weight * 24) / Math.max(8, size)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: '0 0 auto', display: 'block' }}>
      {paths.map((d, i) =>
        d.startsWith('F:') ? (
          <path key={i} d={d.slice(2)} fill={color} />
        ) : (
          <path key={i} d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        )
      )}
    </svg>
  )
}

export function ActionButtonVisual({ visual, width, height, ctx }: VisualProps) {
  const p = new Props(visual.json, ctx.theme)
  const action = useAction(visual.json, ctx)
  const disabled = !!action.spec && !action.enabled && (action.spec.type === 'Drillthrough' || action.spec.type === 'PageNavigation' || action.spec.type === 'Bookmark')
  const { state: hoverState, handlers } = useElementState(action.interactive)
  const state: ElementState = disabled ? 'disabled' : hoverState
  const sel = stateSelector(state)

  const kind = normalizeShapeKind(p.str('shape', 'tileShape', 'rectangle'))
  const radius = p.num('shape', 'rectangleRoundedCurve', p.num('outline', 'roundEdge', 0, sel))
  const fill = p.bool('fill', 'show', true, sel) ? withTransparency(p.color('fill', 'fillColor', BUTTON_DEFAULTS.fill, sel), p.num('fill', 'transparency', 0, sel)) : undefined
  const outlineOn = p.bool('outline', 'show', true, sel)
  const stroke = outlineOn ? withTransparency(p.color('outline', 'lineColor', BUTTON_DEFAULTS.outline, sel), p.num('outline', 'transparency', 0, sel)) : undefined
  const weight = outlineOn ? p.num('outline', 'weight', 1, sel) : 0

  const iconKind = normalizeIconKind(p.str('icon', 'shapeType', defaultIconFor(action.spec?.type), sel))
  const iconOn = p.bool('icon', 'show', true, sel) && iconKind !== 'blank'
  const iconColor = withTransparency(p.color('icon', 'lineColor', BUTTON_DEFAULTS.icon, sel), p.num('icon', 'transparency', 0, sel))
  const iconWeight = p.num('icon', 'lineWeight', BUTTON_DEFAULTS.iconWeight, sel)
  const placement = p.str('icon', 'placement', 'left', sel).toLowerCase()
  const im = {
    l: p.num('icon', 'leftMargin', 0, sel),
    r: p.num('icon', 'rightMargin', 0, sel),
    t: p.num('icon', 'topMargin', 0, sel),
    b: p.num('icon', 'bottomMargin', 0, sel)
  }
  const text = readShapeText(p, state, { size: BUTTON_DEFAULTS.textSize, color: BUTTON_DEFAULTS.textColor })
  const hasText = !!text && text.text !== ''
  const vertical = placement === 'top' || placement === 'bottom'
  const explicitSize = p.num('icon', 'iconSize', 0, sel)
  const innerH = height - weight * 2 - im.t - im.b
  const innerW = width - weight * 2 - im.l - im.r
  const autoSize = hasText ? (vertical ? Math.min(innerH * 0.45, innerW, 40) : Math.min(innerH * 0.7, 28)) : Math.min(innerH, innerW) * 0.7
  const iconSize = Math.max(0, explicitSize > 0 ? explicitSize : autoSize)

  const iconHAlign = p.str('icon', 'horizontalAlignment', 'center', sel).toLowerCase()
  const iconVAlign = p.str('icon', 'verticalAlignment', 'middle', sel).toLowerCase()
  const justify = (a: string) => (a === 'left' || a === 'top' ? 'flex-start' : a === 'right' || a === 'bottom' ? 'flex-end' : 'center')

  const iconEl = iconOn ? (
    <div style={{ padding: `${im.t}px ${im.r}px ${im.b}px ${im.l}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
      <ButtonIcon kind={iconKind} size={iconSize} color={iconColor} weight={iconWeight} />
    </div>
  ) : null
  const textEl = hasText ? <div style={{ ...text!.style, flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>{text!.text}</div> : null

  const content: CSSProperties = {
    position: 'absolute',
    inset: weight,
    display: 'flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: hasText ? 'stretch' : vertical ? 'center' : justify(iconVAlign),
    justifyContent: hasText ? 'center' : vertical ? justify(iconVAlign) : justify(iconHAlign),
    overflow: 'hidden'
  }
  const iconFirst = placement === 'left' || placement === 'top'

  return (
    <div
      role="button"
      aria-disabled={disabled || undefined}
      title={action.title}
      style={{ position: 'relative', width, height, cursor: action.interactive ? 'pointer' : 'default', userSelect: 'none', opacity: disabled && !p.has('fill', 'fillColor', { id: 'disabled' }) ? 0.6 : 1 }}
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
        strokeWidth={weight}
        shadow={readShadow(p, 'shadow', state)}
        glow={readGlow(p, 'glow', state)}
      />
      <div style={content}>
        {iconFirst ? iconEl : textEl}
        {iconFirst ? textEl : iconEl}
      </div>
    </div>
  )
}
