/**
 * Canvas view preferences (View ribbon: gridlines, snap to grid, lock objects, layout guides, smart guides).
 * Exported for the shell. Persisted per user in localStorage (per-viewer convenience; never part of the report).
 *
 * The smart guides (equal spacing, match size) go beyond Power BI Desktop: they only influence snapping and edit-mode
 * overlays. Layout guides (page margin + gutter) are per report and live in report.json (report/layoutGuides.ts); the
 * `layout` field here is no longer read (kept so older stored prefs still parse).
 */
import { create } from 'zustand'
import type { AlignTo, LayoutGuides } from './geometry'

export interface CanvasPrefs {
  showGridlines: boolean
  snapToGrid: boolean
  /** View ▸ Lock objects: visuals can't be moved/resized */
  lockObjects: boolean
  /** grid size in page px (PBI Desktop uses 16) */
  gridSize: number
  /** @deprecated layout guides are stored per report (report/layoutGuides.ts); this value is ignored */
  layout: LayoutGuides
  /** draw the margin guides in edit mode */
  showLayoutGuides: boolean
  /** snap to equal spacing between neighbors (Figma-style distance guides) */
  equalSpacing: boolean
  /** while resizing, snap to neighbors' width / height */
  matchSize: boolean
  /** Format ▸ Align reference with several visuals */
  alignTo: AlignTo
  set(p: Partial<Omit<CanvasPrefs, 'set'>>): void
}

/** Spacing presets offered for the gutter, "Distribute with fixed gap" and Tidy up. */
export const SPACING_PRESETS = [4, 8, 12, 16, 24, 32] as const

/** Margin + gutter presets (View ▸ Layout guides). */
export const LAYOUT_PRESETS: Array<{ id: string; label: string; layout: LayoutGuides }> = [
  { id: 'none', label: 'None', layout: { margin: 0, gutter: 0 } },
  { id: 'compact', label: 'Compact (8 px margin, 8 px gutter)', layout: { margin: 8, gutter: 8 } },
  { id: 'comfortable', label: 'Comfortable (16 px margin, 16 px gutter)', layout: { margin: 16, gutter: 16 } },
  { id: 'spacious', label: 'Spacious (24 px margin, 16 px gutter)', layout: { margin: 24, gutter: 16 } },
  { id: 'wide', label: 'Wide (32 px margin, 24 px gutter)', layout: { margin: 32, gutter: 24 } }
]

const KEY = 'lumen.canvasPrefs.v1'
type Persisted = Omit<CanvasPrefs, 'set'>

const DEFAULTS: Persisted = {
  showGridlines: false,
  snapToGrid: false,
  lockObjects: false,
  gridSize: 16,
  layout: { margin: 0, gutter: 0 },
  showLayoutGuides: true,
  equalSpacing: true,
  matchSize: true,
  alignTo: 'selection'
}

function load(): Persisted {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Persisted>
    return { ...DEFAULTS, ...p, layout: { ...DEFAULTS.layout, ...(p.layout ?? {}) }, lockObjects: false }
  } catch {
    return DEFAULTS
  }
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode / capture): prefs stay in memory */
  }
}

export const useCanvasPrefs = create<CanvasPrefs>()((set, get) => ({
  ...load(),
  set: (p) => {
    set(p)
    const { set: _s, ...rest } = get()
    save(rest)
  }
}))
