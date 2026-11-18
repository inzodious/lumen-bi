/**
 * Mobile layout view state (runtime only, not persisted): on/off, phone-canvas selection and the
 * canvas controls (gridlines, snap to grid, lock). Kept apart from the document store so the desktop
 * canvas selection / keyboard shortcuts never act on the phone layout and vice versa.
 */
import { create } from 'zustand'

export type AppearanceFilter = 'all' | 'visible' | 'hidden'

export interface MobileLayoutState {
  on: boolean
  /** selected visuals on the phone canvas */
  selected: string[]
  showGrid: boolean
  snapToGrid: boolean
  lock: boolean
  /** Page visuals pane: filter by appearance status */
  appearance: AppearanceFilter
  setOn(on: boolean): void
  toggle(): void
  select(names: string[]): void
  set(p: Partial<Pick<MobileLayoutState, 'showGrid' | 'snapToGrid' | 'lock' | 'appearance'>>): void
}

export const useMobileLayout = create<MobileLayoutState>()((set, get) => ({
  on: false,
  selected: [],
  showGrid: true,
  snapToGrid: true,
  lock: false,
  appearance: 'all',
  setOn: (on) => set({ on, selected: [] }),
  toggle: () => set({ on: !get().on, selected: [] }),
  select: (selected) => set({ selected }),
  set: (p) => set(p)
}))

/** True while the phone layout editor replaces the desktop canvas (guards desktop shortcuts). */
export function isMobileLayoutOn(): boolean {
  return useMobileLayout.getState().on
}
