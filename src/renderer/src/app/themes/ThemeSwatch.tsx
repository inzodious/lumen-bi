/**
 * Theme gallery thumbnail (PBI View ▸ Themes): "Aa" in the theme's foreground over its background,
 * with four data-color bars underneath. ~64×44 px.
 */
import type { BuiltinTheme } from './index'

export function ThemeSwatch({ theme, width = 64, height = 44, title }: { theme: Pick<BuiltinTheme, 'name' | 'preview' | 'previewBackground' | 'previewForeground'>; width?: number; height?: number; title?: string }) {
  const bg = theme.previewBackground ?? '#FFFFFF'
  const fg = theme.previewForeground ?? '#252423'
  const colors = theme.preview.slice(0, 4)
  return (
    <span
      title={title ?? theme.name}
      aria-label={theme.name}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        width,
        height,
        background: bg,
        border: '1px solid #E1DFDD',
        borderRadius: 2,
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      <span style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 6, color: fg, fontSize: Math.round(height * 0.32), fontWeight: 600, lineHeight: 1 }}>Aa</span>
      <span style={{ display: 'flex', gap: 2, padding: '0 4px 4px', height: Math.round(height * 0.32), alignItems: 'flex-end' }}>
        {colors.map((c, i) => (
          <span key={i} style={{ flex: 1, background: c, height: `${[100, 70, 85, 55][i]}%` }} />
        ))}
      </span>
    </span>
  )
}
