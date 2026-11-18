/**
 * Icon edits on the document (undoable through mutateReport) and the background work that keeps the saved pictures
 * in step with the report: re-bake on theme changes (same undo step), preload the sets a report uses, and a final
 * re-bake before saving. The picture is rendered from the icon component here (picture.ts); core/icons/bake.ts stores it.
 */
import { IMAGE_VISUAL_SLOT, bakeIcon, hasIconBindings, iconSetsInReport, rebakeIcons, removeIcon, type IconSlot } from '@core/icons/bake'
import type { IconRef } from '@core/icons/types'
import type { ResolvedTheme } from '@core/report/theme'
import { onReportThemeChange, useApp } from '../state/store'
import { findPage, findVisual } from '../report/pbir'
import { loadIconSet, loadIconSets } from './registry'
import { renderIconPicture } from './picture'

export { IMAGE_VISUAL_SLOT }

const renderWith = (theme: ResolvedTheme) => (ref: IconRef) => renderIconPicture(ref, theme)

/** Bake an icon into a visual's image slot (one undo step; `coalesce` merges continuous edits such as a stroke slider). */
export async function setVisualIcon(pageName: string, visualName: string, slot: IconSlot, ref: IconRef, opts: { label?: string; coalesce?: string } = {}): Promise<boolean> {
  await loadIconSet(ref.set)
  const svg = renderIconPicture(ref, useApp.getState().theme)
  if (!svg) return false
  useApp.getState().mutateReport(
    opts.label ?? 'Change icon',
    (r) => {
      const v = findVisual(findPage(r, pageName), visualName)
      // rendered again inside the edit: the theme in force when the edit applies
      if (v) bakeIcon(r, v.json, slot, ref, renderIconPicture(ref, useApp.getState().theme) || svg)
    },
    opts.coalesce ? { coalesce: opts.coalesce } : undefined
  )
  return true
}

/** Remove the icon of a slot (image reference, binding and the baked resource when unused). */
export function clearVisualIcon(pageName: string, visualName: string, slot: IconSlot, label = 'Remove icon'): void {
  useApp.getState().mutateReport(label, (r) => {
    const v = findVisual(findPage(r, pageName), visualName)
    if (v) removeIcon(r, v.json, slot)
  })
}

// ---------------------------------------------------------------------------------------------
// Theme changes: icons drawn in theme colours follow, in the same undo step
// ---------------------------------------------------------------------------------------------

onReportThemeChange((draft, theme) => {
  if (!hasIconBindings(draft)) return
  const { missing } = rebakeIcons(draft, renderWith(theme))
  if (!missing.size) return
  // a set that was never loaded in this session (rare: sets are preloaded on open): re-bake once it is
  void loadIconSets(missing).then(() => {
    const { project, theme: now } = useApp.getState()
    if (!project?.report || !hasIconBindings(project.report)) return
    // patchReport: no undo entry (the theme change already has one); immer keeps the report when nothing changed
    useApp.getState().patchReport((r) => void rebakeIcons(r, renderWith(now)))
  })
})

// preload the sets a newly opened report uses, so re-bakes inside edits are synchronous
let lastProjectId: string | undefined
useApp.subscribe((s) => {
  const id = s.project?.id
  if (id === lastProjectId) return
  lastProjectId = id
  const report = s.project?.report
  if (report && hasIconBindings(report)) void loadIconSets(iconSetsInReport(report)).catch(() => undefined)
})

/**
 * Before saving: make every baked icon match the current theme (a theme changed outside Lumen, or a set that
 * was not loaded during a theme change). Patches the document only when something changed.
 */
export async function rebakeIconsBeforeSave(): Promise<void> {
  const report = useApp.getState().project?.report
  if (!report || !hasIconBindings(report)) return
  await loadIconSets(iconSetsInReport(report)).catch(() => undefined)
  const { theme } = useApp.getState()
  // immer returns the same report (no dirty flag, no new object) when every icon is already current
  useApp.getState().patchReport((r) => void rebakeIcons(r, renderWith(theme)))
}
