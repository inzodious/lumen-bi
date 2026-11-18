/**
 * An icon as a React element: the icon library's own component (react-icons / @fluentui/react-icons), never markup
 * assembled by Lumen. The same element tree is drawn on the canvas, in the picker and the Format pane, and rendered
 * to the picture copy saved for Power BI (picture.ts), so all of them show the same thing.
 *
 * Tree: an outer `<svg viewBox="0 0 256 256">` that only positions (padding, image fit through preserveAspectRatio)
 * and the component's own `<svg>` nested in it at the padded box:
 *   react-icons  `size` (width / height), `color` (its root `style="color"`, the artwork draws in currentColor),
 *                `strokeWidth` (passed through to the root, which the artwork's strokes inherit)
 *   Fluent       fixed artwork; its root is always `width="1em"`, so the box is set with `fontSize` (1em = the box);
 *                `idPrefix` scopes its gradient / clip-path ids, which are not unique otherwise (the same icon twice
 *                on a page would share ids, and an icon in a hidden element would break the visible one's gradients)
 */
import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { BAKE_SIZE } from '@core/icons/bake'
import { refStrokeWidth, resolveRefColor } from '@core/icons/ref'
import type { IconRef } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { getLoadedIconSet, type LoadedIconSet } from './registry'
import { useIconSet } from './useIconSet'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface IconSvgOptions {
  /** prefix for ids inside the icon (Fluent gradients); must be unique per icon on a page */
  idPrefix: string
  /** outer width / height attributes (px, or '100%'); default '100%' */
  size?: number | string
  /** outer preserveAspectRatio (image fit); default xMidYMid meet */
  preserveAspectRatio?: string
  /** accessible name (role="img"); omitted = decorative (aria-hidden) */
  title?: string
}

/** The icon's element tree (undefined when the set has no such icon). */
export function iconSvgElement(set: LoadedIconSet, ref: IconRef, theme: ResolvedTheme, opts: IconSvgOptions): ReactElement | undefined {
  const Icon = set.components.get(ref.name)
  if (!Icon) return undefined
  const box = BAKE_SIZE
  const pad = Math.round((Math.max(0, Math.min(40, ref.padding ?? 0)) / 100) * box * 100) / 100
  const inner = box - 2 * pad
  let glyph: ReactElement
  if (set.kind === 'react-icons') {
    const color = resolveRefColor(ref, theme)
    const strokeWidth = refStrokeWidth(ref)
    glyph = <Icon x={pad} y={pad} size={inner} {...(color ? { color } : {})} {...(strokeWidth !== undefined ? { strokeWidth } : {})} aria-hidden="true" />
  } else {
    glyph = <Icon x={pad} y={pad} fontSize={inner} idPrefix={opts.idPrefix} />
  }
  const size = opts.size ?? '100%'
  const a11y = opts.title ? { role: 'img', 'aria-label': opts.title } : { 'aria-hidden': true as const }
  return (
    <svg xmlns={SVG_NS} width={size} height={size} viewBox={`0 0 ${box} ${box}`} preserveAspectRatio={opts.preserveAspectRatio} {...a11y}>
      {opts.title ? <title>{opts.title}</title> : null}
      {glyph}
    </svg>
  )
}

/** Unique id prefix for icon instances (React ids contain characters that are not valid in XML ids). */
export function useIconIdPrefix(): string {
  return 'ic' + useId().replace(/[^A-Za-z0-9]/g, '') + '-'
}

export interface IconGlyphProps {
  icon: IconRef
  theme: ResolvedTheme
  /** CSS size of the glyph box (default 100% of the parent) */
  size?: number | string
  /** SVG preserveAspectRatio (image fit) */
  preserveAspectRatio?: string
  /** accessible name; omitted = decorative */
  title?: string
  className?: string
  style?: CSSProperties
  /** shown while the set loads / when the icon does not exist */
  fallback?: ReactNode
}

export function IconGlyph({ icon, theme, size = '100%', preserveAspectRatio, title, className, style, fallback = null }: IconGlyphProps) {
  const set = useIconSet(icon.set) ?? getLoadedIconSet(icon.set)
  const idPrefix = useIconIdPrefix()
  const el = set ? iconSvgElement(set, icon, theme, { idPrefix, preserveAspectRatio, title }) : undefined
  const box: CSSProperties = { display: 'inline-flex', width: size, height: size, lineHeight: 0, ...style }
  return (
    <span className={className} style={box} aria-hidden={title ? undefined : true}>
      {el ?? fallback}
    </span>
  )
}
