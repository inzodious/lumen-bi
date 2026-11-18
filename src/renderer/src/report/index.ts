/**
 * Public surface of the report canvas workstream (for the app shell, panes, exports).
 */
export { ReportView, computeScale, setReady, type ReportViewProps } from './ReportView'
export { PageTabs } from './PageTabs'
export { PrintLayout, type PrintLayoutProps } from './PrintLayout'
export { PageCanvas, type PageCanvasProps } from './PageCanvas'

// selection-based edit commands (ribbon Format ▸ Align / Arrange / Group, Edit menu, selection pane)
export {
  alignSelection,
  distributeSelection,
  distributeSelectionWithGap,
  tidyUpSelection,
  matchSizeSelection,
  resizeSelection,
  arrangeSelection,
  groupSelection,
  ungroupSelection,
  copySelection,
  cutSelection,
  pasteClipboard,
  hasClipboard,
  duplicateSelection,
  deleteSelection,
  selectAllVisuals,
  nudgeSelection,
  setSelectionHidden,
  handleCanvasKey,
  exportVisualDataOf,
  canExportVisualData
} from './commands'

// pure document operations (wrap in useApp().mutateReport for undo)
export * as editOps from './editOps'
export * as geometry from './geometry'

// runtime: navigation, slicers, bookmarks
export {
  navigatePage,
  goBack,
  drillthrough,
  drillthroughTargets,
  applyBookmark,
  addBookmarkFromState,
  updateBookmarkFromState,
  removeBookmark,
  setSlicerFilter,
  flushSlicers,
  clearAllSlicers,
  effectiveSlicerFilter,
  syncTargets,
  selectDataPoints,
  runtimeSnapshot,
  includeExclude,
  sortVisual
} from './runtime'
export { captureBookmark, planBookmarkApply, addBookmark, updateBookmark, deleteBookmark, type CaptureOptions, type BookmarkApplyPlan } from './bookmarks'
export { computeVisualFilters, pageScopeFilters, normalizeReportFilter, interactionKind, buildDrillthrough } from './filters'
export { useCanvasPrefs, SPACING_PRESETS, LAYOUT_PRESETS } from './prefs'
export { resolveChrome, fontStack } from './chrome'
export { describeFilter, describeFilters } from './filterSummary'
export { resolveImageUrl } from './images'
export * as pbir from './pbir'
