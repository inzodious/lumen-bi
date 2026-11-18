/** Small SVG glyphs drawn like Power BI's slicer chrome (Fluent-style strokes). */
import type { CSSProperties } from 'react'

interface P {
  size?: number
  color?: string
  style?: CSSProperties
}

export function ChevronDown({ size = 12, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={style} aria-hidden>
      <path d="M2.2 4.2 6 8l3.8-3.8" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronRight({ size = 12, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={style} aria-hidden>
      <path d="M4.2 2.2 8 6 4.2 9.8" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SearchIcon({ size = 12, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={style} aria-hidden>
      <circle cx="4.9" cy="4.9" r="3.6" fill="none" stroke={color} strokeWidth="1" />
      <path d="m7.6 7.6 3.3 3.3" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

export function EraserIcon({ size = 14, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden>
      <path
        d="M9.2 2.6a1.3 1.3 0 0 1 1.84 0l2.36 2.36a1.3 1.3 0 0 1 0 1.84L7.6 12.6H4.9L2.6 10.3a1.3 1.3 0 0 1 0-1.84z M5.6 6.2l4.2 4.2 M4.9 12.6h8.6"
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CalendarIcon({ size = 14, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="1.2" fill="none" stroke={color} strokeWidth="1" />
      <path d="M2 6.2h12M5 1.8v2.4M11 1.8v2.4" stroke={color} strokeWidth="1" strokeLinecap="round" />
      <path d="M5 9h1M7.5 9h1M10 9h1M5 11.4h1M7.5 11.4h1" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function DismissIcon({ size = 10, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={style} aria-hidden>
      <path d="m1.5 1.5 7 7m0-7-7 7" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

export function SendIcon({ size = 14, color = 'currentColor', style }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden>
      <path d="M2.3 2.4 14 8 2.3 13.6l1.9-5.6zM4.2 8H9" fill="none" stroke={color} strokeWidth="1.05" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Plus/minus toggle in a square (expandCollapseToggleType = 1). */
export function PlusMinus({ size = 11, color = 'currentColor', expanded }: P & { expanded: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" aria-hidden>
      <rect x="0.5" y="0.5" width="10" height="10" fill="none" stroke={color} strokeWidth="1" />
      <path d={expanded ? 'M3 5.5h5' : 'M3 5.5h5M5.5 3v5'} stroke={color} strokeWidth="1" />
    </svg>
  )
}

/**
 * PBI slicer check box: unchecked = thin outline in the item color over the slicer background; checked = a solid
 * square in the selection icon color, without a tick (measured on Microsoft Learn's slicer screenshots);
 * partial = outline with an inner square.
 */
export function CheckBox({ size = 12, color = '#252423', state, background = 'transparent', stroke }: { size?: number; color?: string; state: 'on' | 'off' | 'partial'; background?: string; stroke?: string }) {
  const line = stroke ?? color
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ flex: 'none' }} aria-hidden>
      {state === 'on' ? <rect x="0" y="0" width="12" height="12" fill={color} /> : <rect x="0.5" y="0.5" width="11" height="11" fill={background} stroke={line} strokeWidth="1" />}
      {state === 'partial' && <rect x="3" y="3" width="6" height="6" fill={color} />}
    </svg>
  )
}

/** Radio circle for "Single select" slicers. */
export function Radio({ size = 12, color = '#252423', on, background = 'transparent', stroke }: { size?: number; color?: string; on: boolean; background?: string; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ flex: 'none' }} aria-hidden>
      <circle cx="6" cy="6" r="5.5" fill={background} stroke={stroke ?? color} strokeWidth="1" />
      {on && <circle cx="6" cy="6" r="3" fill={color} />}
    </svg>
  )
}
