/**
 * Page transitions (Lumen extension: Power BI has none). A page canvas mounts once per page, so the transition is an
 * entrance of the new page: it fades, slides (in the direction of travel through the page order), rises or zooms in.
 * The first page shown in a window, and pages opened while editing, appear without one.
 */
import type { PageTransition } from '@core/report/motion'
import { EASING, MOTION_ANIMATION_ID } from './animator'

let last: { pages: string[]; index: number } | null = null

/** Remember the page that was shown; returns -1 / 1 for the direction of travel, 0 when there was no previous page of this report. */
export function notePageShown(pageOrder: string[], page: string): -1 | 0 | 1 {
  const index = pageOrder.indexOf(page)
  const prev = last
  last = { pages: pageOrder, index }
  if (!prev || prev.pages.length !== pageOrder.length || prev.pages.some((p, i) => p !== pageOrder[i])) return 0
  if (prev.index === index) return 0
  return index > prev.index ? 1 : -1
}

/** Forget the last page (a different report opened). */
export function resetPageHistory(): void {
  last = null
}

export function transitionFrames(kind: PageTransition, direction: -1 | 1, width: number): Keyframe[] | null {
  const shift = Math.round(Math.min(160, Math.max(24, width * 0.12)))
  switch (kind) {
    case 'fade':
      return [{ opacity: 0 }, { opacity: 1 }]
    case 'slide':
      return [{ opacity: 0, transform: `translateX(${direction * shift}px)` }, { opacity: 1, transform: 'none' }]
    case 'rise':
      return [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }]
    case 'zoom':
      return [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }]
    default:
      return null
  }
}

export function playPageTransition(el: HTMLElement, kind: PageTransition, direction: -1 | 1, duration: number): Animation | null {
  const frames = transitionFrames(kind, direction, el.offsetWidth)
  if (!frames) return null
  try {
    const a = el.animate(frames, { duration, easing: EASING, fill: 'backwards' })
    a.id = MOTION_ANIMATION_ID
    return a
  } catch {
    return null
  }
}
