/**
 * An icon as a React element: inline SVG built from the registry's own data (never from file content),
 * colours resolved through the given theme. Inline SVG stays vector in PDF exports.
 */
import { useId, useMemo, type CSSProperties } from 'react'
import { buildIconSvg } from '@core/icons/svg'
import type { IconRef } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { useIconSet } from './useIconSet'

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
  fallback?: React.ReactNode
}

export function IconGlyph({ icon, theme, size = '100%', preserveAspectRatio, title, className, style, fallback = null }: IconGlyphProps) {
  const data = useIconSet(icon.set)
  const prefix = 'ic' + useId().replace(/[^A-Za-z0-9]/g, '') + '-'
  const svg = useMemo(() => (data ? buildIconSvg(data, icon, theme, { size: '100%', idPrefix: prefix, preserveAspectRatio, title }) : undefined), [data, icon, theme, prefix, preserveAspectRatio, title])
  const box: CSSProperties = { display: 'inline-flex', width: size, height: size, lineHeight: 0, ...style }
  if (!svg) return <span className={className} style={box} aria-hidden={title ? undefined : true}>{fallback}</span>
  return <span className={className} style={box} aria-hidden={title ? undefined : true} dangerouslySetInnerHTML={{ __html: svg }} />
}
