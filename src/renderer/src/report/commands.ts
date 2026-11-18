/**
 * Canvas edit commands on the current selection (keyboard shortcuts, ribbon, native menu). All undoable.
 * Exported for the shell through ./index.ts.
 */
import type { ReportDocument } from '@core/report/types'
import { useApp } from '../state/store'
import type { AlignMode, DistributeAxis } from './geometry'
import { useCanvasPrefs } from './prefs'
import { useFormatPainter } from './formatPainter'
import {
  alignVisuals,
  distributeVisualsWithGap,
  matchVisualSize,
  resizeVisualsBy,
  tidyUpVisuals,
  copyVisuals,
  deleteVisuals,
  distributeVisuals,
  groupVisuals,
  moveVisualsBy,
  pasteVisuals,
  reorderZ,
  setVisualsHidden,
  topLevelOf,
  ungroupVisuals,
  type VisualClipboard,
  type ZOrderOp
} from './editOps'
import { findPage, isGroup, parentOf, visualTypeOf } from './pbir'
import { liveContext } from './host'
import { getVisual } from '../visuals/registry'
import { resolveChrome } from './chrome'
import { autoTitle } from './VisualContainer'

let clipboard: VisualClipboard | null = null

function current(): { report: ReportDocument; pageName: string; selected: string[] } | null {
  const s = useApp.getState()
  const report = s.project?.report
  if (!report || !s.activePage) return null
  return { report, pageName: s.activePage, selected: s.selectedVisuals }
}

function onPage(label: string, fn: (page: NonNullable<ReturnType<typeof findPage>>) => void, coalesce?: string): void {
  const c = current()
  if (!c) return
  useApp.getState().mutateReport(
    label,
    (draft) => {
      const p = findPage(draft, c.pageName)
      if (p) fn(p)
    },
    coalesce ? { coalesce: `${coalesce}:${c.pageName}:${c.selected.join(',')}` } : undefined
  )
}

export function selectAllVisuals(): void {
  const c = current()
  const p = findPage(c?.report, c?.pageName)
  if (!p) return
  useApp.getState().selectVisuals(p.visuals.filter((v) => !parentOf(v) && !v.json?.isHidden).map((v) => v.name))
}

export function deleteSelection(): void {
  const c = current()
  if (!c?.selected.length) return
  onPage(c.selected.length > 1 ? 'Delete visuals' : 'Delete visual', (p) => deleteVisuals(p, c.selected))
  useApp.getState().selectVisuals([])
}

export function copySelection(): boolean {
  const c = current()
  const p = findPage(c?.report, c?.pageName)
  if (!c?.selected.length || !p) return false
  clipboard = copyVisuals(p, c.selected)
  try {
    void navigator.clipboard?.writeText(JSON.stringify(clipboard)).catch(() => undefined)
  } catch {
    /* clipboard unavailable */
  }
  return true
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection()
}

export function hasClipboard(): boolean {
  return !!clipboard
}

export function pasteClipboard(): void {
  if (!clipboard) return
  const clip = clipboard
  let names: string[] = []
  onPage('Paste', (p) => {
    names = pasteVisuals(p, clip)
  })
  if (names.length) useApp.getState().selectVisuals(names)
  // pasting again offsets once more (PBI cascades pastes)
  clipboard = { ...clip, visuals: clip.visuals.map((v) => (v.json.parentGroupName ? v : { ...v, json: { ...v.json, position: { ...v.json.position, x: (v.json.position?.x ?? 0) + 20, y: (v.json.position?.y ?? 0) + 20 } } })) }
}

export function duplicateSelection(): void {
  if (copySelection()) pasteClipboard()
}

export function nudgeSelection(dx: number, dy: number): void {
  const c = current()
  if (!c?.selected.length) return
  onPage('Move', (p) => moveVisualsBy(p, c.selected, dx, dy), 'nudge')
}

export function alignSelection(mode: AlignMode, to = useCanvasPrefs.getState().alignTo): void {
  const c = current()
  if (!c?.selected.length) return
  // the key object is the first selected visual (selection order is kept by the store)
  onPage('Align', (p) => alignVisuals(p, c.selected, mode, to))
}

/** Distribute with a fixed gap (2+ visuals). */
export function distributeSelectionWithGap(axis: DistributeAxis, gap: number): void {
  const c = current()
  if (!c || c.selected.length < 2 || !(gap >= 0)) return
  onPage('Distribute', (p) => distributeVisualsWithGap(p, c.selected, axis, gap))
}

/** Tidy up the selection into an even row / grid. */
export function tidyUpSelection(gap?: number): void {
  const c = current()
  if (!c || c.selected.length < 2) return
  onPage('Tidy up', (p) => tidyUpVisuals(p, c.selected, gap))
}

/** Make same width / height / size as the key object (first selected). */
export function matchSizeSelection(dim: 'width' | 'height' | 'both'): void {
  const c = current()
  if (!c || c.selected.length < 2) return
  onPage(dim === 'width' ? 'Make same width' : dim === 'height' ? 'Make same height' : 'Make same size', (p) => matchVisualSize(p, c.selected, dim))
}

export function resizeSelection(dw: number, dh: number): void {
  const c = current()
  if (!c?.selected.length) return
  onPage('Resize', (p) => resizeVisualsBy(p, c.selected, dw, dh), 'kbresize')
}

export function distributeSelection(axis: DistributeAxis): void {
  const c = current()
  if (!c || c.selected.length < 3) return
  onPage('Distribute', (p) => distributeVisuals(p, c.selected, axis))
}

export function arrangeSelection(op: ZOrderOp): void {
  const c = current()
  if (!c?.selected.length) return
  onPage(op === 'front' ? 'Bring to front' : op === 'back' ? 'Send to back' : op === 'forward' ? 'Bring forward' : 'Send backward', (p) => reorderZ(p, c.selected, op))
}

export function groupSelection(): void {
  const c = current()
  const p = findPage(c?.report, c?.pageName)
  if (!c || !p) return
  const tops = topLevelOf(p, c.selected)
  if (tops.length < 2) return
  let g: string | undefined
  onPage('Group', (dp) => {
    g = groupVisuals(dp, tops)
  })
  if (g) useApp.getState().selectVisuals([g])
}

export function ungroupSelection(): void {
  const c = current()
  const p = findPage(c?.report, c?.pageName)
  if (!c || !p) return
  const groups = c.selected.filter((n) => isGroup(p.visuals.find((v) => v.name === n)))
  if (!groups.length) return
  let freed: string[] = []
  onPage('Ungroup', (dp) => {
    freed = ungroupVisuals(dp, groups)
  })
  useApp.getState().selectVisuals(freed)
}

export function setSelectionHidden(hidden: boolean): void {
  const c = current()
  if (!c?.selected.length) return
  onPage(hidden ? 'Hide' : 'Show', (p) => setVisualsHidden(p, c.selected, hidden))
}

/** Handle a canvas keyboard shortcut; returns true when consumed. */
export function handleCanvasKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key
  const sel = useApp.getState().selectedVisuals
  if (k === 'Delete' || (k === 'Backspace' && !mod)) {
    if (!sel.length) return false
    deleteSelection()
    return true
  }
  if (k.startsWith('Arrow') && !e.altKey) {
    if (!sel.length) return false
    if (useCanvasPrefs.getState().lockObjects) return true
    // Arrow: move 1 px · Ctrl+Arrow: move 10 px (grid size with Snap to grid) · Shift+Arrow: resize 1 px · Ctrl+Shift+Arrow: resize 10 px
    const prefs = useCanvasPrefs.getState()
    const step = mod ? (prefs.snapToGrid ? prefs.gridSize : 10) : 1
    const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0
    const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0
    if (e.shiftKey) resizeSelection(dx, dy)
    else nudgeSelection(dx, dy)
    return true
  }
  if (k === 'Escape' && useFormatPainter.getState().format) {
    useFormatPainter.getState().arm(null)
    return true
  }
  if (k === 'Escape' && sel.length) {
    useApp.getState().selectVisuals([])
    return true
  }
  if (!mod) return false
  if (e.altKey && k.toLowerCase() === 't') {
    if (sel.length < 2) return false
    tidyUpSelection()
    return true
  }
  switch (k.toLowerCase()) {
    case 'c':
      return copySelection()
    case 'x':
      cutSelection()
      return true
    case 'v':
      if (!clipboard) return false
      pasteClipboard()
      return true
    case 'a':
      selectAllVisuals()
      return true
    case 'g':
      if (e.shiftKey) ungroupSelection()
      else groupSelection()
      return true
    default:
      return false
  }
}

/**
 * Export data of a visual (ribbon Data/Drill ▸ Export data): uses the live host context of the
 * rendered visual, like the visual's "…" menu. Returns false when the visual has no exportable data.
 */
export function exportVisualDataOf(pageName: string, visualName: string): boolean {
  const report = useApp.getState().project?.report
  const v = findPage(report, pageName)?.visuals.find((x) => x.name === visualName)
  const ctx = liveContext(pageName, visualName)
  const def = v ? getVisual(visualTypeOf(v)) : undefined
  if (!v || !ctx || !def?.getData) return false
  const title = resolveChrome(v.json, ctx.theme).title.text ?? autoTitle(v.json, ctx)
  const data = def.getData(v, ctx)
  const handler = useApp.getState().exportVisualData
  if (!handler) return false
  handler({ pageName, visualName, title, data })
  return true
}

/** Can the selected visual export data? */
export function canExportVisualData(pageName: string | null, visualName: string | null): boolean {
  if (!pageName || !visualName) return false
  const v = findPage(useApp.getState().project?.report, pageName)?.visuals.find((x) => x.name === visualName)
  return !!v && !!getVisual(visualTypeOf(v))?.getData
}
