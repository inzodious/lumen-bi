/**
 * End-to-end test hooks (route option `e2e=1`, set by e2e/harness.ts through WBI_ROUTE).
 *
 * Exposes the app's stores and a few commands on `window.__lumen` so the Playwright journeys can
 * (a) wait on precise state instead of sleeping and (b) assert on document state that has no DOM
 * representation (e.g. undo stack depth, model tables). Journeys drive the UI through the DOM; these hooks
 * are for observation and for setup steps that are not under test (e.g. opening a file without the native
 * file dialog). Never installed in normal runs.
 */
import { useApp } from '../state/store'
import { useInteraction } from '../state/interaction'
import { useShell } from './shellState'
import { openPath, saveAs } from './commands'
import { exportReport, exportReportWithResult } from '../export'
import { isBusy } from './readiness'
import { setVisualIcon } from '../icons/actions'
import { setMotionOverride } from '../report/motion/env'

export interface LumenE2EHooks {
  useApp: typeof useApp
  useShell: typeof useShell
  useInteraction: typeof useInteraction
  openPath: typeof openPath
  saveAs: typeof saveAs
  exportReport: typeof exportReport
  exportReportWithResult: typeof exportReportWithResult
  isBusy: typeof isBusy
  /** bake a built-in icon into a visual's image slot (icons/actions.ts) */
  setVisualIcon: typeof setVisualIcon
  /** e2e runs render without motion (--lumen-still); 'on' turns visual animations and page transitions back on */
  setMotion: typeof setMotionOverride
  /** console errors / uncaught errors seen by the renderer since the hooks were installed */
  errors: string[]
}

declare global {
  interface Window {
    __lumen?: LumenE2EHooks
  }
}

export function installE2EHooks(): void {
  if (window.__lumen) return
  const errors: string[] = []
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      errors.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 2000))
    } catch {
      errors.push('[unserializable console.error]')
    }
    orig(...args)
  }
  // a thrown DOMException (e.g. DataCloneError) reports only "Uncaught" as the event message: keep the error's own name / text
  window.addEventListener('error', (e) => {
    const err = e.error as { name?: string; message?: string; stack?: string } | undefined
    errors.push(`[uncaught] ${e.message}${err && typeof err === 'object' ? ` ${err.name ?? ''}: ${err.message ?? ''}\n${err.stack ?? ''}` : ''}`.slice(0, 2000))
  })
  window.addEventListener('unhandledrejection', (e) => errors.push(`[unhandledrejection] ${String((e as PromiseRejectionEvent).reason)}`))
  window.__lumen = { useApp, useShell, useInteraction, openPath, saveAs, exportReport, exportReportWithResult, isBusy, setVisualIcon, setMotion: setMotionOverride, errors }
}
