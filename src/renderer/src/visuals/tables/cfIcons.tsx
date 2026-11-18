/** Conditional-formatting / KPI icon rendering (SVG). Name resolution and the icon catalog: ./iconSet.ts */
import { useId, type ReactElement } from 'react'
import { ICON_EMPTY, resolveIcon, type IconSpec } from './iconSet'

export * from './iconSet'

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export function CFIcon({ name, size }: { name: string; size: number }): ReactElement | null {
  const spec = resolveIcon(name)
  if (!spec) return null
  return <IconSvg spec={spec} size={size} label={name} />
}

export function IconSvg({ spec, size, label }: { spec: IconSpec; size: number; label?: string }): ReactElement {
  const c = spec.color
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  let body: ReactElement
  switch (spec.shape) {
    case 'circle':
      body = spec.ring ? (
        <g>
          <circle cx="8" cy="8" r="6.5" fill={c} />
          <circle cx="8" cy="8" r="3" fill="#FFFFFF" />
        </g>
      ) : (
        <circle cx="8" cy="8" r="6.5" fill={c} />
      )
      break
    case 'trafficLight':
      // rimmed traffic light: colored lamp in a black square housing (PBI glyph)
      body = (
        <g>
          <rect x="1" y="1" width="14" height="14" fill="#000000" />
          <circle cx="8" cy="8" r="3.6" fill={c} />
        </g>
      )
      break
    case 'thinArrow': {
      const rot = { up: 0, upRight: 45, right: 90, downRight: 135, down: 180 }[spec.dir ?? 'right']
      body = (
        <g transform={`rotate(${rot} 8 8)`}>
          <path d="M8 14.5 V2 M3.2 6.8 L8 2 L12.8 6.8" stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="butt" strokeLinejoin="miter" />
        </g>
      )
      break
    }
    case 'triangleUp':
      body = <path d="M8 1.5 L14.5 14 H1.5 Z" fill={c} />
      break
    case 'triangleDown':
      body = <path d="M1.5 2 H14.5 L8 14.5 Z" fill={c} />
      break
    case 'diamond':
      body = <path d="M8 1 L15 8 L8 15 L1 8 Z" fill={c} />
      break
    case 'square':
      body = <rect x="2" y="2" width="12" height="12" fill={c} />
      break
    case 'arrowUp':
      body = <path d="M8 1 L14 8 H10 V15 H6 V8 H2 Z" fill={c} />
      break
    case 'arrowDown':
      body = <path d="M8 15 L14 8 H10 V1 H6 V8 H2 Z" fill={c} />
      break
    case 'arrowRight':
      body = <path d="M15 8 L8 2 V6 H1 V10 H8 V14 Z" fill={c} />
      break
    case 'arrowUpRight':
      body = <path d="M14 2 V10 L11 7 L4 14 L2 12 L9 5 L6 2 Z" fill={c} />
      break
    case 'arrowDownRight':
      body = <path d="M14 14 H6 L9 11 L2 4 L4 2 L11 9 L14 6 Z" fill={c} />
      break
    case 'check':
      body = spec.plain ? (
        <path d="M2.5 8.5 L6.3 12.2 L13.6 3.8" stroke={c} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <g>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M4.5 8.2 L7 10.7 L11.6 5.6" stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )
      break
    case 'x':
      body = spec.plain ? (
        <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
      ) : (
        <g>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M5.3 5.3 L10.7 10.7 M10.7 5.3 L5.3 10.7" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )
      break
    case 'exclamation':
      body = spec.plain ? (
        <g>
          <path d="M8 2 V10" stroke={c} strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="8" cy="13.5" r="1.5" fill={c} />
        </g>
      ) : (
        <g>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M8 4 V9" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.8" r="1" fill="#FFFFFF" />
        </g>
      )
      break
    case 'flag':
      body = (
        <g>
          <path d="M3 1.5 V15" stroke="#605E5C" strokeWidth="1.4" />
          <path d="M3.7 2 H13 L10.8 5.2 L13 8.4 H3.7 Z" fill={c} />
        </g>
      )
      break
    case 'star':
    case 'starHalf':
    case 'starEmpty': {
      const d = 'M8 1 L10.1 5.6 L15 6.1 L11.3 9.4 L12.4 14.3 L8 11.8 L3.6 14.3 L4.7 9.4 L1 6.1 L5.9 5.6 Z'
      const id = `wbi-star-half-${uid}`
      body =
        spec.shape === 'starHalf' ? (
          <g>
            <defs>
              <clipPath id={id}>
                <rect x="0" y="0" width="8" height="16" />
              </clipPath>
            </defs>
            {spec.emptyFill ? <path d={d} fill={spec.emptyFill} /> : <path d={d} fill="none" stroke={c} strokeWidth="1" />}
            <path d={d} fill={c} clipPath={`url(#${id})`} />
          </g>
        ) : spec.shape === 'starEmpty' && spec.emptyFill ? (
          <path d={d} fill={spec.emptyFill} />
        ) : (
          <path d={d} fill={spec.shape === 'star' ? c : 'none'} stroke={c} strokeWidth="1" />
        )
      break
    }
    case 'quarter': {
      const lvl = Math.max(0, Math.min(4, spec.level ?? 2))
      const angle = (lvl / 4) * Math.PI * 2
      const x = 8 + 6.5 * Math.sin(angle)
      const y = 8 - 6.5 * Math.cos(angle)
      body = (
        <g>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke={lvl === 4 ? c : '#605E5C'} strokeWidth="1" />
          {lvl === 4 ? <circle cx="8" cy="8" r="6.5" fill={c} /> : lvl > 0 ? <path d={`M8 8 L8 1.5 A6.5 6.5 0 ${lvl > 2 ? 1 : 0} 1 ${x} ${y} Z`} fill={c} /> : null}
        </g>
      )
      break
    }
    case 'bars': {
      const lvl = Math.max(0, Math.min(4, spec.level ?? 2))
      body = (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={1.5 + i * 3.5} y={12 - i * 3} width="2.6" height={3 + i * 3} fill={i < lvl ? c : ICON_EMPTY} />
          ))}
        </g>
      )
      break
    }
    case 'boxes': {
      // filled cells per level (PBI's 5 boxes glyphs): 1 = top-left, 2 = bottom row, 3 = top-left +
      // bottom row, 4 = all. Cells: top-left, top-right, bottom-left, bottom-right.
      const lvl = Math.max(0, Math.min(4, spec.level ?? 2))
      const FILLED = [[], [0], [2, 3], [0, 2, 3], [0, 1, 2, 3]][lvl]
      const cells: Array<[number, number]> = [
        [1.5, 1.5],
        [8.5, 1.5],
        [1.5, 8.5],
        [8.5, 8.5]
      ]
      body = (
        <g>
          {cells.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="6" height="6" fill={FILLED.includes(i) ? c : ICON_EMPTY} />
          ))}
        </g>
      )
      break
    }
    default:
      body = <rect x="2" y="6.8" width="12" height="2.4" fill={c} />
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: '0 0 auto', display: 'block' }} aria-label={label}>
      {body}
    </svg>
  )
}
