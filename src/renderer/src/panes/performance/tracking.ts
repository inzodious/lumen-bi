/**
 * Performance analyzer: names the user action that the next visual timings belong to ("Changed a slicer",
 * "Changed page", "Refreshed visual", …) by watching the stores, so the canvas code doesn't have to report it.
 * Installed once (imported by PaneHost): recording can run while the pane itself is closed (ribbon ▸ Optimize).
 */
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import { useShell } from '../../app/shellState'
import { PERF_ACTIONS, noteAction } from '../../report/perf'

let installed = false
let slicerPending = false

export function installPerfTracking(): void {
  if (installed) return
  installed = true
  const recording = () => useShell.getState().perfRecording
  useShell.subscribe((s, prev) => {
    // PBI starts every recording with a "Recording started (time)" line
    if (s.perfRecording && !prev.perfRecording) s.logPerf({ visual: '', title: '', ms: 0, marker: true, action: PERF_ACTIONS.recording })
  })
  useApp.subscribe((s, prev) => {
    if (!recording()) return
    if (s.activePage !== prev.activePage) noteAction(PERF_ACTIONS.page)
    // Refresh visuals / data refresh / model edits rebuild the engine: every visual queries again
    if (s.engine !== prev.engine) noteAction(PERF_ACTIONS.refresh)
    else if (s.project?.report !== prev.project?.report) noteAction(PERF_ACTIONS.edit)
  })
  useInteraction.subscribe((s, prev) => {
    if (!recording()) return
    if (s.appliedBookmark !== prev.appliedBookmark && s.appliedBookmark) noteAction(PERF_ACTIONS.bookmark)
    if (s.drillthrough !== prev.drillthrough) noteAction(PERF_ACTIONS.drillthrough)
    // a slicer change arrives in two steps: the slicer's own (pending) selection, then — after the slicer debounce —
    // the committed filter the rest of the page reacts to. Both belong to one "Changed a slicer" action.
    if (s.slicers !== prev.slicers) {
      noteAction(PERF_ACTIONS.slicer, slicerPending)
      slicerPending = false
    } else if (s.pendingSlicers !== prev.pendingSlicers) {
      noteAction(PERF_ACTIONS.slicer, slicerPending)
      slicerPending = true
    }
    if (s.crossFilter !== prev.crossFilter) noteAction(PERF_ACTIONS.highlight)
    if (s.drill !== prev.drill) noteAction(PERF_ACTIONS.drill)
  })
}

installPerfTracking()
