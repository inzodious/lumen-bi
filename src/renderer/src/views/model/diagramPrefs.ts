/**
 * Model view preferences, per user (localStorage; never part of the document):
 *  - `lineStyle`: the relationship line style used for layouts that do not store one ("Make … my default" in the
 *    canvas menu). Unset = the built-in default, so an untouched installation draws untouched models as before;
 *  - pointer mode and pinch-point snapping.
 */
import { create } from 'zustand'
import { LINE_STYLES, type LineStyle } from '@core/io/diagramSidecar'

export interface DiagramPrefs {
  lineStyle: LineStyle | null
  mode: 'pan' | 'select'
  snap: boolean
  set(p: Partial<Omit<DiagramPrefs, 'set'>>): void
}

const KEY = 'lumen.modelView.v1'
type Persisted = Omit<DiagramPrefs, 'set'>
const DEFAULTS: Persisted = { lineStyle: null, mode: 'pan', snap: true }

/** Validate stored preferences (anything unexpected falls back to the default). */
export function parseDiagramPrefs(text: string | null | undefined): Persisted {
  try {
    const raw = text ? (JSON.parse(text) as Partial<Persisted> | null) : null
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return {
      lineStyle: LINE_STYLES.includes(raw.lineStyle as LineStyle) ? (raw.lineStyle as LineStyle) : null,
      mode: raw.mode === 'select' ? 'select' : 'pan',
      snap: raw.snap !== false
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function load(): Persisted {
  try {
    return parseDiagramPrefs(globalThis.localStorage?.getItem(KEY))
  } catch {
    return { ...DEFAULTS }
  }
}

export const useDiagramPrefs = create<DiagramPrefs>()((set, get) => ({
  ...load(),
  set(p) {
    set(p)
    try {
      const { lineStyle, mode, snap } = get()
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ lineStyle, mode, snap }))
    } catch {
      /* preferences are a convenience: ignore storage failures */
    }
  }
}))
