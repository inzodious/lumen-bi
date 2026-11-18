/**
 * Placeholder for Power BI AI visuals that Lumen does not emulate (Q&A). They depend on
 * Microsoft cloud services / ML models and are intentionally not emulated.
 */
import type { VisualProps } from '../../contract'
import { ICONS } from '../icons'

export function AiPlaceholder({ width, height, type, displayName }: VisualProps & { type: string; displayName: string }) {
  const s = Math.max(16, Math.min(40, Math.min(width, height) * 0.3))
  const icon = (ICONS[type] ?? '').replace('stroke="#252423"', 'stroke="#605E5C"').replace(/fill="#252423"/g, 'fill="#605E5C"').replace('<svg', `<svg width="${s}" height="${s}"`)
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: height > 70 ? 6 : 2,
        overflow: 'hidden',
        textAlign: 'center',
        fontFamily: "'Segoe UI', 'Selawik', 'Open Sans', sans-serif",
        padding: 6,
        boxSizing: 'border-box'
      }}
    >
      {height > 44 ? <div style={{ width: s, height: s }} dangerouslySetInnerHTML={{ __html: icon }} /> : null}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#252423', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{displayName}</div>
      {height >= 90 ? <div style={{ fontSize: 11, color: '#605E5C', maxWidth: 260 }}>AI visuals aren't available in Lumen</div> : null}
    </div>
  )
}
